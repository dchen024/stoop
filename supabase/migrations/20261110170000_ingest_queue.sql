-- Incident 2026-11-10: the 15:45 UTC sync failed with "canceling statement due to
-- statement timeout". HPD's daily batch was 34.5k rows; 9 pages of 2,000 went in,
-- then one ingest_hpd_batch() call ran past PostgREST's 8 s limit. The next run
-- resumed and finished, but each page did the fetch AND all the writes in one
-- PostgREST call, so a bigger city batch (or a busy database) times it out again.
--
-- Fix: a queue (pgmq) between reading the city's feed and writing to our tables.
--   1. The edge function only fetches. Each page goes to enqueue_hpd_page(), which
--      splits it into 500-row messages on the hpd_ingest queue and saves the position,
--      in one transaction. That is a plain insert, far under the 8 s limit.
--   2. drain_hpd_queue(), run by pg_cron every minute (no PostgREST, own timeout),
--      applies messages one at a time, each in its own subtransaction. Only one
--      drain runs at a time (advisory lock), so writes never pile up on each other.
--   3. A message that fails is retried after its visibility timeout (5 min). After
--      5 tries it is archived (pgmq.a_hpd_ingest keeps the rows) and logged in
--      ingest_queue_failures, so one bad batch can't block the ones behind it.
-- Out-of-order apply is safe: complaints only take a newer :updated_at.
--
-- ingest_hpd_batch() stays (now a wrapper) so the previous edge function keeps
-- working until the new one is deployed, and for rollback.

create extension if not exists pgmq;
select pgmq.create('hpd_ingest');

create table public.ingest_queue_failures (
  id          bigint generated always as identity primary key,
  msg_id      bigint not null,
  run_id      bigint references public.ingest_runs on delete set null,
  attempt     integer not null,
  error       text not null,
  dead        boolean not null default false,   -- true = gave up and archived the message
  failed_at   timestamptz not null default now()
);
create index ingest_queue_failures_failed_at on public.ingest_queue_failures (failed_at desc);
alter table public.ingest_queue_failures enable row level security;
create policy "public read" on public.ingest_queue_failures for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.ingest_queue_failures from anon, authenticated;

-- ---------------------------------------------------------------------------
-- apply_hpd_rows: validate and write one set of rows. Same body as the last
-- ingest_hpd_batch(), minus saving the position (enqueue does that now).
-- ---------------------------------------------------------------------------
create function public.apply_hpd_rows(p_run_id bigint, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fetched  integer;
  v_rejected integer;
  v_upserted integer;
  v_changed  bigint[];
begin
  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('fetched', 0, 'upserted', 0, 'rejected', 0);
  end if;

  create temp table _src on commit drop as
  select r.*, (r.problem_id ~ '^[0-9]+$' and r.complaint_id ~ '^[0-9]+$' and r.building_id ~ '^[0-9]+$'
               and upper(trim(r.borough)) in ('MANHATTAN','BRONX','BROOKLYN','QUEENS','STATEN ISLAND')
               and nullif(trim(r.house_number), '') is not null
               and nullif(trim(r.street_name), '') is not null
               and nullif(trim(r.major_category), '') is not null
               and r.received_date is not null
               and r.":updated_at" is not null
               and upper(r.complaint_status) in ('OPEN','CLOSE')
               and upper(r.problem_status) in ('OPEN','CLOSE')) as ok
  from jsonb_to_recordset(p_rows) as r(
    problem_id text, complaint_id text, building_id text, borough text,
    house_number text, street_name text, post_code text, bbl text, bin text,
    block text, lot text,
    apartment text, unit_type text, space_type text, type text,
    major_category text, minor_category text, problem_code text,
    complaint_status text, complaint_status_date text,
    problem_status text, problem_status_date text, status_description text,
    problem_duplicate_flag text, received_date text,
    latitude text, longitude text, nta text, community_board text, council_district text,
    ":updated_at" text
  );

  select count(*), count(*) filter (where not ok) into v_fetched, v_rejected from pg_temp._src;

  insert into public.ingest_rejects (run_id, source_key, reason, payload)
  select p_run_id, s.problem_id,
         case
           when s.building_id is null or s.building_id !~ '^[0-9]+$' then 'missing building_id'
           when s.problem_id  is null or s.problem_id  !~ '^[0-9]+$' then 'missing problem_id'
           when nullif(trim(s.house_number), '') is null or nullif(trim(s.street_name), '') is null then 'missing address'
           else 'invalid field'
         end,
         to_jsonb(s) - 'ok'
  from pg_temp._src s where not s.ok;

  -- Lookups first.
  insert into public.categories (name)
  select distinct upper(trim(s.major_category)) from pg_temp._src s where s.ok
  on conflict do nothing;

  insert into public.status_descriptions (description, status, closure_reason)
  select distinct on (trim(s.status_description))
         trim(s.status_description),
         upper(s.problem_status)::public.complaint_status,
         public.classify_closure(s.status_description, upper(s.problem_status)::public.complaint_status)
  from pg_temp._src s
  where s.ok and nullif(trim(s.status_description), '') is not null
  order by trim(s.status_description)
  on conflict (description) do nothing;

  -- Buildings: latest row per building wins for address fields, but identifiers use
  -- any valid value seen for that building in the batch. HPD omits bbl/bin on some
  -- complaint rows (Sodabase flagged ~0.5% of buildings missing them); block + lot
  -- are always present, so BBL is derived from them when the feed leaves it out.
  with ids as (
    select s.building_id::bigint as building_id,
           max(s.bbl) filter (where s.bbl ~ '^[1-5][0-9]{9}$') as bbl,
           max(public.real_bin(s.bin)) as bin,
           max(public.make_bbl(upper(trim(s.borough))::public.borough, s.block, s.lot)) as derived_bbl
    from pg_temp._src s
    where s.ok
    group by s.building_id::bigint
  )
  insert into public.buildings as b (
    building_id, bbl, bin, borough, house_number, street_name, postcode,
    nta, community_board, council_district, latitude, longitude)
  select distinct on (s.building_id::bigint)
    s.building_id::bigint,
    coalesce(ids.bbl, ids.derived_bbl),
    ids.bin,
    upper(trim(s.borough))::public.borough,
    trim(s.house_number),
    trim(s.street_name),
    case when s.post_code ~ '^[0-9]{5}$' then s.post_code end,
    nullif(trim(s.nta), ''),
    case when s.community_board ~ '^[0-9]{1,2}$' and s.community_board::int between 1 and 99 then s.community_board::smallint end,
    case when s.council_district ~ '^[0-9]{1,2}$' and s.council_district::int between 1 and 51 then s.council_district::smallint end,
    case when s.latitude ~ '^-?[0-9.]+$' and s.longitude ~ '^-?[0-9.]+$'
          and s.latitude::float8 between 40.40 and 41.00 and s.longitude::float8 between -74.30 and -73.60
         then s.latitude::float8 end,
    case when s.latitude ~ '^-?[0-9.]+$' and s.longitude ~ '^-?[0-9.]+$'
          and s.latitude::float8 between 40.40 and 41.00 and s.longitude::float8 between -74.30 and -73.60
         then s.longitude::float8 end
  from pg_temp._src s
  join ids on ids.building_id = s.building_id::bigint
  where s.ok
  order by s.building_id::bigint, s.":updated_at" desc
  on conflict (building_id) do update set
    bbl              = coalesce(b.bbl, excluded.bbl),
    bin              = coalesce(b.bin, excluded.bin),
    borough          = excluded.borough,
    house_number     = excluded.house_number,
    street_name      = excluded.street_name,
    postcode         = coalesce(excluded.postcode, b.postcode),
    nta              = coalesce(excluded.nta, b.nta),
    community_board  = coalesce(excluded.community_board, b.community_board),
    council_district = coalesce(excluded.council_district, b.council_district),
    latitude         = coalesce(excluded.latitude, b.latitude),
    longitude        = coalesce(excluded.longitude, b.longitude)
  -- Same expressions as the SET list: only rewrite the row if one of them changes it.
  where (b.bbl, b.bin, b.borough, b.house_number, b.street_name, b.postcode,
         b.nta, b.community_board, b.council_district, b.latitude, b.longitude)
        is distinct from
        (coalesce(b.bbl, excluded.bbl), coalesce(b.bin, excluded.bin), excluded.borough,
         excluded.house_number, excluded.street_name, coalesce(excluded.postcode, b.postcode),
         coalesce(excluded.nta, b.nta), coalesce(excluded.community_board, b.community_board),
         coalesce(excluded.council_district, b.council_district),
         coalesce(excluded.latitude, b.latitude), coalesce(excluded.longitude, b.longitude));

  -- Complaints: never let an older city update overwrite a newer one.
  with up as (
    insert into public.complaints as c (
      problem_id, complaint_id, building_id, apartment, unit_type, space_type, urgency,
      category, subcategory, problem_code, complaint_status, problem_status,
      status_description_id, is_duplicate, received_at, status_changed_at, source_updated_at)
    select distinct on (s.problem_id::bigint)
      s.problem_id::bigint,
      s.complaint_id::bigint,
      s.building_id::bigint,
      nullif(trim(s.apartment), ''),
      nullif(trim(s.unit_type), ''),
      nullif(trim(s.space_type), ''),
      coalesce(nullif(upper(trim(s.type)), ''), 'UNKNOWN'),
      upper(trim(s.major_category)),
      nullif(upper(trim(s.minor_category)), ''),
      nullif(upper(trim(s.problem_code)), ''),
      upper(s.complaint_status)::public.complaint_status,
      upper(s.problem_status)::public.complaint_status,
      sd.id,
      coalesce(upper(s.problem_duplicate_flag) = 'Y', false),
      s.received_date::timestamp at time zone 'America/New_York',
      s.problem_status_date::timestamp at time zone 'America/New_York',
      s.":updated_at"::timestamptz
    from pg_temp._src s
    left join public.status_descriptions sd on sd.description = trim(s.status_description)
    where s.ok
    order by s.problem_id::bigint, s.":updated_at" desc
    on conflict (problem_id) do update set
      complaint_status      = excluded.complaint_status,
      problem_status        = excluded.problem_status,
      status_description_id = excluded.status_description_id,
      status_changed_at     = excluded.status_changed_at,
      is_duplicate          = excluded.is_duplicate,
      source_updated_at     = excluded.source_updated_at,
      ingested_at           = now()
    where c.source_updated_at < excluded.source_updated_at
    returning c.building_id
  )
  select count(*), coalesce(array_agg(distinct up.building_id), '{}') into v_upserted, v_changed from up;

  -- Stats depend only on complaints, so only buildings with a written complaint need a refresh.
  insert into public.building_stats as bs (
    building_id, season, complaints_total, complaints_open, heat_complaints,
    complaint_days, heat_days, no_access_closures, last_complaint_at, refreshed_at)
  select c.building_id, c.season,
         count(*),
         count(*) filter (where c.problem_status = 'OPEN'),
         count(*) filter (where c.category = 'HEAT/HOT WATER'),
         count(distinct (c.received_at at time zone 'America/New_York')::date),
         count(distinct (c.received_at at time zone 'America/New_York')::date) filter (where c.category = 'HEAT/HOT WATER'),
         count(*) filter (where sd.closure_reason = 'no_access'),
         max(c.received_at),
         now()
  from public.complaints c
  left join public.status_descriptions sd on sd.id = c.status_description_id
  where c.building_id = any(v_changed)
  group by c.building_id, c.season
  on conflict (building_id, season) do update set
    complaints_total   = excluded.complaints_total,
    complaints_open    = excluded.complaints_open,
    heat_complaints    = excluded.heat_complaints,
    complaint_days     = excluded.complaint_days,
    heat_days          = excluded.heat_days,
    no_access_closures = excluded.no_access_closures,
    last_complaint_at  = excluded.last_complaint_at,
    refreshed_at       = excluded.refreshed_at;

  update public.ingest_runs r
     set rows_fetched         = r.rows_fetched  + v_fetched,
         rows_upserted        = r.rows_upserted + v_upserted,
         rows_rejected        = r.rows_rejected + v_rejected,
         newest_source_update = greatest(r.newest_source_update,
                                  (select max(s.":updated_at"::timestamptz) from pg_temp._src s where s.ok)),
         newest_received_at   = greatest(r.newest_received_at,
                                  (select max(s.received_date::timestamp at time zone 'America/New_York') from pg_temp._src s where s.ok))
   where r.id = p_run_id;

  drop table pg_temp._src;

  return jsonb_build_object('fetched', v_fetched, 'upserted', v_upserted, 'rejected', v_rejected);
end $$;

-- ---------------------------------------------------------------------------
-- Saving the position: shared by the queue and the old direct path.
-- ---------------------------------------------------------------------------
create function public.save_hpd_position(p_rows jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_last jsonb;
begin
  -- Rows arrive ordered by (:updated_at, :id); the last one is the new saved position.
  v_last := p_rows -> (jsonb_array_length(p_rows) - 1);
  if v_last ->> ':updated_at' is null or v_last ->> ':id' is null then
    raise exception 'page is missing :updated_at/:id on its last row; cannot save position';
  end if;
  insert into public.ingest_cursors as k (source, updated_at, row_id, saved_at)
  values ('hpd_complaints', (v_last ->> ':updated_at')::timestamptz, v_last ->> ':id', now())
  on conflict (source) do update set
    updated_at = excluded.updated_at, row_id = excluded.row_id, saved_at = excluded.saved_at
  where excluded.updated_at >= k.updated_at;
end $$;

-- Old entry point, kept for the edge function that is live until the new one ships.
create or replace function public.ingest_hpd_batch(p_run_id bigint, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('fetched', 0, 'upserted', 0, 'rejected', 0);
  end if;
  v_result := public.apply_hpd_rows(p_run_id, p_rows);
  perform public.save_hpd_position(p_rows);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- enqueue_hpd_page: called by the edge function for each page it reads.
-- Queues the rows in chunks and saves the position in the same transaction,
-- so the position never gets ahead of what is safely stored.
-- ---------------------------------------------------------------------------
create function public.enqueue_hpd_page(p_run_id bigint, p_rows jsonb, p_chunk integer default 500)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n    integer := jsonb_array_length(p_rows);
  v_msgs jsonb[];
begin
  if v_n = 0 then
    return jsonb_build_object('fetched', 0, 'queued_batches', 0);
  end if;
  if p_chunk < 1 then
    raise exception 'p_chunk must be positive';
  end if;

  select array_agg(jsonb_build_object('run_id', p_run_id, 'rows', chunk) order by i)
    into v_msgs
  from (
    select i, jsonb_agg(p_rows -> j order by j) as chunk
    from generate_series(0, v_n - 1) as j,
         lateral (select j / p_chunk as i) g
    group by i
  ) c;

  perform pgmq.send_batch('hpd_ingest', v_msgs);
  perform public.save_hpd_position(p_rows);

  return jsonb_build_object('fetched', v_n, 'queued_batches', cardinality(v_msgs));
end $$;

-- ---------------------------------------------------------------------------
-- drain_hpd_queue: apply queued batches, oldest first, until the queue is empty
-- or the time budget is used. Run by pg_cron; safe to call while another is
-- running (the second one returns right away).
-- ---------------------------------------------------------------------------
create function public.drain_hpd_queue(
  p_budget       interval default '40 seconds',
  p_max_attempts integer  default 5,
  p_vt_seconds   integer  default 300)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  v_msg     record;
  v_run_id  bigint;
  v_applied integer := 0;
  v_failed  integer := 0;
  v_dead    integer := 0;
  v_err     text;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.drain_hpd_queue')) then
    return jsonb_build_object('skipped', 'another drain is running');
  end if;

  while clock_timestamp() - v_started < p_budget loop
    select * into v_msg from pgmq.read('hpd_ingest', p_vt_seconds, 1);
    exit when not found;

    v_run_id := (v_msg.message ->> 'run_id')::bigint;

    if v_msg.read_ct > p_max_attempts then
      perform pgmq.archive('hpd_ingest', v_msg.msg_id);
      insert into public.ingest_queue_failures (msg_id, run_id, attempt, error, dead)
      values (v_msg.msg_id,
              (select r.id from public.ingest_runs r where r.id = v_run_id),
              v_msg.read_ct,
              format('gave up after %s tries; rows kept in pgmq.a_hpd_ingest', p_max_attempts),
              true);
      v_dead := v_dead + 1;
      continue;
    end if;

    begin
      perform public.apply_hpd_rows(v_run_id, v_msg.message -> 'rows');
      perform pgmq.delete('hpd_ingest', v_msg.msg_id);
      v_applied := v_applied + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into public.ingest_queue_failures (msg_id, run_id, attempt, error)
      values (v_msg.msg_id,
              (select r.id from public.ingest_runs r where r.id = v_run_id),
              v_msg.read_ct,
              left(v_err, 500));
      v_failed := v_failed + 1;
      -- The message stays invisible for p_vt_seconds, then is retried.
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'failed', v_failed, 'dead', v_dead);
end $$;

revoke execute on function public.apply_hpd_rows(bigint, jsonb)            from public, anon, authenticated;
revoke execute on function public.save_hpd_position(jsonb)                 from public, anon, authenticated;
revoke execute on function public.ingest_hpd_batch(bigint, jsonb)          from public, anon, authenticated;
revoke execute on function public.enqueue_hpd_page(bigint, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.drain_hpd_queue(interval, integer, integer) from public, anon, authenticated;
grant  execute on function public.ingest_hpd_batch(bigint, jsonb)          to service_role;
grant  execute on function public.enqueue_hpd_page(bigint, jsonb, integer) to service_role;
grant  execute on function public.drain_hpd_queue(interval, integer, integer) to service_role;

-- Every minute. pg_cron runs as postgres (no PostgREST 8 s limit); this caps it.
select cron.schedule(
  'drain-hpd-queue',
  '* * * * *',
  $$ set statement_timeout = '55s'; select public.drain_hpd_queue(); $$
);

-- Keep the failure log bounded, like ingest_runs.
select cron.schedule(
  'prune-ingest-queue-failures',
  '19 4 * * *',
  $$ delete from public.ingest_queue_failures where failed_at < now() - interval '30 days' $$
);

-- Batches waiting (including ones invisible while being retried). The view is
-- security_invoker and the public can't read pgmq tables, so this exposes the count only.
create function public.hpd_queue_depth()
returns bigint
language sql stable security definer set search_path = '' as $$
  select queue_length from pgmq.metrics('hpd_ingest')
$$;
revoke execute on function public.hpd_queue_depth() from public;
grant  execute on function public.hpd_queue_depth() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Status page: rows still waiting in the queue count as "catching up", and a
-- batch that was given up on shows as failing until someone looks at it.
-- New columns go at the end so the view can be replaced in place.
-- ---------------------------------------------------------------------------
create or replace view public.source_status
with (security_invoker = true) as
with runs as (
  select r.*,
         row_number() over (order by r.started_at desc) as n,
         count(*) filter (where r.status is distinct from first_status) over (order by r.started_at desc) as breaks
  from (
    select r.*, first_value(r.status) over (order by r.started_at desc) as first_status
    from public.ingest_runs r
    where r.source = 'hpd_complaints' and r.status <> 'running'
  ) r
),
latest as (select * from runs where n = 1),
streak as (select count(*) as runs, min(started_at) as since from runs where breaks = 0),
registry as (
  select r.finished_at, r.registry_error
  from public.ingest_runs r
  where r.source = 'hpd_complaints' and r.status <> 'running' and (r.enriched is not null or r.registry_error is not null)
  order by r.started_at desc limit 1
),
queue as (
  select public.hpd_queue_depth() as batches,
         (select count(*) from public.ingest_queue_failures f
           where f.dead and f.failed_at > now() - interval '24 hours') as dead_24h
)
select
  'hpd_complaints'::text                              as source,
  'HPD housing complaints'::text                      as label,
  'data.cityofnewyork.us/resource/ygpa-z7cr'::text    as endpoint,
  case
    when l.finished_at is null or l.finished_at < now() - interval '45 minutes' then 'stalled'
    when q.dead_24h > 0             then 'failing'
    when l.status = 'succeeded' and q.batches > 0 then 'catching_up'
    when l.status = 'succeeded'     then 'healthy'
    when l.status = 'partial'       then 'catching_up'
    when l.status = 'upstream_down' then 'upstream_down'
    else 'failing'
  end                                                 as state,
  l.status::text                                      as last_status,
  l.finished_at                                       as last_run_at,
  coalesce(l.error, case when q.dead_24h > 0 then
    format('%s queued batch(es) kept failing and were set aside (see ingest_queue_failures)', q.dead_24h) end) as last_error,
  l.rows_remaining                                    as rows_remaining,
  s.runs                                              as streak_runs,
  s.since                                             as streak_since,
  (select max(finished_at) from public.ingest_runs
    where source = 'hpd_complaints' and status in ('succeeded', 'partial')) as last_contact_at,
  (select max(finished_at) from public.ingest_runs
    where source = 'hpd_complaints' and status = 'succeeded')               as last_caught_up_at,
  (select updated_at from public.ingest_cursors where source = 'hpd_complaints') as synced_through,
  q.batches                                           as queued_batches
from (select 1) one
left join latest l on true
left join streak s on true
cross join queue q
union all
select
  'hpd_registry',
  'HPD building registry',
  'data.cityofnewyork.us/resource/kj4p-ruqc',
  case when g.finished_at is null then 'idle'
       when g.registry_error is not null then 'upstream_down'
       else 'healthy' end,
  null, g.finished_at, g.registry_error, null, null, null,
  case when g.registry_error is null then g.finished_at end,
  null, null, null
from (select 1) one
left join registry g on true;

grant select on public.source_status to anon, authenticated;
