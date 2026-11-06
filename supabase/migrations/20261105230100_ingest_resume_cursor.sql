-- Incident 2026-11-05: NYC Open Data returned 503s from 8:30 AM to 1:30 PM ET, then
-- HPD's daily batch (33,602 rows) had to be read in one 2-minute run because the
-- watermark only moved on a fully finished run. Every run hit the deadline or the
-- 8 s PostgREST statement timeout and started over; 32 runs failed in ~9.5 hours.
--
-- Fixes here:
--   1. A saved position (ingest_cursors), advanced in the same transaction as each
--      page's writes. Rows in one daily batch share :updated_at, so the position is
--      (:updated_at, Socrata :id); the edge function asks for rows strictly after it.
--      Socrata orders :id by internal row number, not as text, so ids are only ever
--      compared by Socrata, never here.
--   2. Pages only write what changed: buildings skip no-op updates and building_stats
--      refreshes only buildings whose complaints changed. Before this, each page
--      rewrote every building it saw (202k building updates for 33.6k real changes).
--   3. Runs end as succeeded / partial / upstream_down / failed, and source_status
--      summarizes each data source for the status page.

create table public.ingest_cursors (
  source      text primary key check (source in ('hpd_complaints')),
  updated_at  timestamptz not null,   -- :updated_at of the last row saved
  row_id      text,                   -- Socrata :id of that row; null = after every row at updated_at
  saved_at    timestamptz not null default now()
);
alter table public.ingest_cursors enable row level security;
create policy "public read" on public.ingest_cursors for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.ingest_cursors from anon, authenticated;

-- Start from where the old watermark left off: everything up to the newest fully synced batch.
insert into public.ingest_cursors (source, updated_at, row_id)
select 'hpd_complaints', max(newest_source_update), null
from public.ingest_runs
where source = 'hpd_complaints' and status = 'succeeded'
having max(newest_source_update) is not null;

alter table public.ingest_runs
  add column rows_remaining integer check (rows_remaining >= 0),  -- rows left at the source when the run ended
  add column enriched       integer check (enriched >= 0),            -- buildings filled from the registry; null = registry not called
  add column registry_error text,                                 -- building registry fetch failure (best effort)
  add constraint ingest_runs_upstream_has_error check (status <> 'upstream_down' or error is not null);

drop function public.begin_ingest_run(text);
create function public.begin_ingest_run(p_source text default 'hpd_complaints')
returns table (run_id bigint, watermark_from timestamptz, cursor_row_id text)
language plpgsql security definer set search_path = '' as $$
declare
  v_watermark timestamptz;
  v_row_id text;
  v_id bigint;
begin
  -- A run still "running" after 15 minutes died (edge functions cap well below that).
  update public.ingest_runs
     set status = 'failed', finished_at = now(), error = 'abandoned: no finish after 15 minutes'
   where source = p_source and status = 'running' and started_at < now() - interval '15 minutes';

  select k.updated_at, k.row_id into v_watermark, v_row_id
    from public.ingest_cursors k where k.source = p_source;
  v_watermark := coalesce(v_watermark, '2026-10-01'::timestamptz);

  insert into public.ingest_runs (source, watermark_from)
  values (p_source, v_watermark)
  returning id into v_id;

  return query select v_id, v_watermark, v_row_id;
end $$;

drop function public.finish_ingest_run(bigint, text);
create function public.finish_ingest_run(
  p_run_id         bigint,
  p_error          text default null,
  p_status         public.ingest_status default null,
  p_rows_remaining integer default null,
  p_enriched       integer default null,
  p_registry_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.ingest_runs
     set status         = coalesce(p_status, case when p_error is null then 'succeeded' else 'failed' end::public.ingest_status),
         finished_at    = now(),
         error          = p_error,
         rows_remaining = p_rows_remaining,
         enriched       = p_enriched,
         registry_error = p_registry_error
   where id = p_run_id and status = 'running';
$$;

create or replace function public.ingest_hpd_batch(p_run_id bigint, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fetched  integer;
  v_rejected integer;
  v_upserted integer;
  v_changed  bigint[];
  v_last     jsonb;
begin
  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('fetched', 0, 'upserted', 0, 'rejected', 0);
  end if;

  -- Rows arrive ordered by (:updated_at, :id); the last one is the new saved position.
  v_last := p_rows -> (jsonb_array_length(p_rows) - 1);
  if v_last ->> ':updated_at' is null or v_last ->> ':id' is null then
    raise exception 'page is missing :updated_at/:id on its last row; cannot save position';
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
           max(s.bin) filter (where s.bin ~ '^[1-5][0-9]{6}$') as bin,
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

  -- Same transaction as the writes above: the position never gets ahead of the data.
  -- Rejected rows count as read (they are quarantined), so they advance it too.
  insert into public.ingest_cursors as k (source, updated_at, row_id, saved_at)
  select r.source, (v_last ->> ':updated_at')::timestamptz, v_last ->> ':id', now()
  from public.ingest_runs r where r.id = p_run_id
  on conflict (source) do update set
    updated_at = excluded.updated_at, row_id = excluded.row_id, saved_at = excluded.saved_at
  where excluded.updated_at >= k.updated_at;

  drop table pg_temp._src;

  return jsonb_build_object('fetched', v_fetched, 'upserted', v_upserted, 'rejected', v_rejected);
end $$;

-- Only count (and write) buildings the registry actually fills. ~70 buildings have no
-- BIN anywhere, so the old version rewrote them every run and reported them as enriched.
create or replace function public.enrich_buildings_from_registry(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_updated integer;
begin
  update public.buildings b
     set bin = coalesce(b.bin, case when r.bin ~ '^[1-5][0-9]{6}$' then r.bin end),
         bbl = coalesce(b.bbl, public.make_bbl(b.borough, r.block, r.lot))
    from jsonb_to_recordset(p_rows) as r(buildingid text, bin text, block text, lot text)
   where r.buildingid ~ '^[0-9]+$'
     and b.building_id = r.buildingid::bigint
     and ((b.bin is null and r.bin ~ '^[1-5][0-9]{6}$')
       or (b.bbl is null and public.make_bbl(b.borough, r.block, r.lot) is not null));
  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

revoke execute on function public.begin_ingest_run(text) from public, anon, authenticated;
revoke execute on function public.finish_ingest_run(bigint, text, public.ingest_status, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.ingest_hpd_batch(bigint, jsonb) from public, anon, authenticated;
grant  execute on function public.begin_ingest_run(text) to service_role;
grant  execute on function public.finish_ingest_run(bigint, text, public.ingest_status, integer, integer, text) to service_role;
grant  execute on function public.ingest_hpd_batch(bigint, jsonb) to service_role;

-- One row per data source, for the status page.
--   healthy        last run reached the end of the feed (complaints) / last lookup worked (registry)
--   catching_up    last run saved progress and stopped at its time budget
--   upstream_down  the city's API kept failing
--   failing        our pipeline errored
--   stalled        no run has finished in 45 minutes (scheduler or function not running)
create view public.source_status
with (security_invoker = true) as
with runs as (
  select r.*,
         row_number() over (order by r.started_at desc) as n,
         -- Runs since the latest run whose status differs from this one (0 for the leading streak).
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
)
select
  'hpd_complaints'::text                              as source,
  'HPD housing complaints'::text                      as label,
  'data.cityofnewyork.us/resource/ygpa-z7cr'::text    as endpoint,
  case
    when l.finished_at is null or l.finished_at < now() - interval '45 minutes' then 'stalled'
    when l.status = 'succeeded'     then 'healthy'
    when l.status = 'partial'       then 'catching_up'
    when l.status = 'upstream_down' then 'upstream_down'
    else 'failing'
  end                                                 as state,
  l.status::text                                      as last_status,
  l.finished_at                                       as last_run_at,
  l.error                                             as last_error,
  l.rows_remaining                                    as rows_remaining,
  s.runs                                              as streak_runs,
  s.since                                             as streak_since,
  (select max(finished_at) from public.ingest_runs
    where source = 'hpd_complaints' and status in ('succeeded', 'partial')) as last_contact_at,
  (select max(finished_at) from public.ingest_runs
    where source = 'hpd_complaints' and status = 'succeeded')               as last_caught_up_at,
  (select updated_at from public.ingest_cursors where source = 'hpd_complaints') as synced_through
from (select 1) one
left join latest l on true
left join streak s on true
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
  null, null
from (select 1) one
left join registry g on true;

grant select on public.source_status to anon, authenticated;
