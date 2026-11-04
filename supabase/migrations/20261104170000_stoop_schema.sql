-- Stoop: know what's going on in your building.
--
-- Official data: NYC HPD "Housing Maintenance Code Complaints and Problems"
-- (data.cityofnewyork.us, dataset ygpa-z7cr), one row per complaint *problem*.
-- Community data: resident reports filed in the app.
--
-- Write paths:
--   * official tables (buildings, complaints, categories, status_descriptions,
--     building_stats, ingest_*) are written ONLY by public.ingest_hpd_batch(),
--     which only service_role may execute (called by the ingest edge function).
--   * user tables (watchlist, resident_reports, alerts) are written by signed-in
--     users through RLS, scoped to auth.uid().

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.borough as enum ('MANHATTAN', 'BRONX', 'BROOKLYN', 'QUEENS', 'STATEN ISLAND');
create type public.complaint_status as enum ('OPEN', 'CLOSE');
-- What an HPD status description actually says happened. "Closed" is not "fixed".
create type public.closure_reason as enum (
  'still_open',        -- complaint is open
  'reported_fixed',    -- a tenant/phone contact said it was corrected
  'no_access',         -- inspector could not get in; closed anyway
  'no_violation',      -- inspected, nothing that violates the code
  'violation_issued',  -- inspected, violation written
  'other'
);
create type public.watch_relationship as enum ('live_here', 'considering', 'organizing');
create type public.report_status as enum ('open', 'resolved');
create type public.alert_kind as enum ('new_complaint', 'complaint_closed', 'new_report');
create type public.ingest_status as enum ('running', 'succeeded', 'failed');

-- Heat season N runs Oct 1 of year N through May 31 of year N+1 (NYC Admin Code 27-2029).
-- Season key = the year it started, computed in New York time.
create function public.heat_season(ts timestamptz)
returns smallint
language sql immutable parallel safe
set search_path = ''
as $$
  select extract(year from (ts at time zone 'America/New_York') - interval '9 months')::smallint
$$;

create function public.current_season()
returns smallint
language sql stable parallel safe
set search_path = ''
as $$ select public.heat_season(now()) $$;

create function public.classify_closure(description text, status public.complaint_status)
returns public.closure_reason
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when status = 'OPEN'                                         then 'still_open'
    when description ilike '%gain access%'                       then 'no_access'
    when description ilike '%did not violate%'                   then 'no_violation'
    when description ilike '%violation%issued%'
      or description ilike '%issued%violation%'                  then 'violation_issued'
    when description ilike '%corrected%'
      or description ilike '%restored%'                          then 'reported_fixed'
    else 'other'
  end::public.closure_reason
$$;

-- ---------------------------------------------------------------------------
-- Official data
-- ---------------------------------------------------------------------------
create table public.categories (
  name        text primary key check (length(trim(name)) > 0),
  first_seen  timestamptz not null default now()
);

create table public.status_descriptions (
  id              integer generated always as identity primary key,
  description     text not null unique check (length(trim(description)) > 0),
  status          public.complaint_status not null,
  closure_reason  public.closure_reason not null
);

create table public.buildings (
  building_id       bigint primary key,                 -- HPD building id
  bbl               text check (bbl ~ '^[1-5][0-9]{9}$'),
  bin               text check (bin ~ '^[1-5][0-9]{6}$'),
  borough           public.borough not null,
  house_number      text not null check (length(trim(house_number)) > 0),
  street_name       text not null check (length(trim(street_name)) > 0),
  postcode          text check (postcode ~ '^[0-9]{5}$'),
  address           text generated always as (
                      upper(trim(house_number) || ' ' || regexp_replace(trim(street_name), '\s+', ' ', 'g'))
                    ) stored,
  nta               text,
  community_board   smallint check (community_board between 1 and 99),
  council_district  smallint check (council_district between 1 and 51),
  latitude          double precision check (latitude  between 40.40 and 41.00),
  longitude         double precision check (longitude between -74.30 and -73.60),
  check ((latitude is null) = (longitude is null)),
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index buildings_address_trgm on public.buildings using gin (address extensions.gin_trgm_ops);
create index buildings_bbl on public.buildings (bbl);

create table public.complaints (
  problem_id             bigint primary key,            -- HPD problem id
  complaint_id           bigint not null,               -- groups problems filed together
  building_id            bigint not null references public.buildings on delete cascade,
  apartment              text,
  unit_type              text,
  space_type             text,
  urgency                text not null,                 -- EMERGENCY / IMMEDIATE EMERGENCY / NON EMERGENCY
  category               text not null references public.categories,
  subcategory            text,
  problem_code           text,
  complaint_status       public.complaint_status not null,
  problem_status         public.complaint_status not null,
  status_description_id  integer references public.status_descriptions,
  is_duplicate           boolean not null default false,
  received_at            timestamptz not null,          -- when the city received it
  status_changed_at      timestamptz,
  season                 smallint generated always as (public.heat_season(received_at)) stored,
  source_updated_at      timestamptz not null,          -- Socrata :updated_at (city-side freshness)
  ingested_at            timestamptz not null default now(),  -- our-side freshness
  updated_at             timestamptz not null default now(),
  check (received_at > '2000-01-01' and received_at < source_updated_at + interval '1 day')
);
create index complaints_building_recent on public.complaints (building_id, received_at desc);
create index complaints_building_open   on public.complaints (building_id) where problem_status = 'OPEN';
create index complaints_recent          on public.complaints (received_at desc);
create index complaints_category_recent on public.complaints (category, received_at desc);
create index complaints_source_updated  on public.complaints (source_updated_at);
create index complaints_complaint_id    on public.complaints (complaint_id);
create index complaints_status_desc     on public.complaints (status_description_id);

-- Per building, per heat season. Maintained by ingest so building pages never scan complaints.
create table public.building_stats (
  building_id        bigint not null references public.buildings on delete cascade,
  season             smallint not null,
  complaints_total   integer not null check (complaints_total >= 0),
  complaints_open    integer not null check (complaints_open between 0 and complaints_total),
  heat_complaints    integer not null check (heat_complaints between 0 and complaints_total),
  complaint_days     integer not null check (complaint_days between 0 and complaints_total),
  heat_days          integer not null check (heat_days between 0 and complaint_days),
  no_access_closures integer not null check (no_access_closures >= 0),
  last_complaint_at  timestamptz,
  refreshed_at       timestamptz not null default now(),
  primary key (building_id, season)
);
create index building_stats_season_rank on public.building_stats (season, complaint_days desc);
create index building_stats_season_heat on public.building_stats (season, heat_days desc);

create table public.ingest_runs (
  id                  bigint generated always as identity primary key,
  source              text not null check (source in ('hpd_complaints')),
  status              public.ingest_status not null default 'running',
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  watermark_from      timestamptz,                  -- fetched rows with :updated_at > this
  newest_source_update timestamptz,                 -- max :updated_at seen this run
  newest_received_at  timestamptz,                  -- max received_at seen this run
  rows_fetched        integer not null default 0 check (rows_fetched >= 0),
  rows_upserted       integer not null default 0 check (rows_upserted >= 0),
  rows_rejected       integer not null default 0 check (rows_rejected >= 0),
  error               text,
  check ((status = 'running') = (finished_at is null)),
  check (status <> 'failed' or error is not null)
);
create index ingest_runs_source_recent on public.ingest_runs (source, started_at desc);

-- Rows we refused, with why. Bad data is kept out of the main tables, not silently dropped.
create table public.ingest_rejects (
  id          bigint generated always as identity primary key,
  run_id      bigint not null references public.ingest_runs on delete cascade,
  source_key  text,
  reason      text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index ingest_rejects_run on public.ingest_rejects (run_id);

-- ---------------------------------------------------------------------------
-- User data
-- ---------------------------------------------------------------------------
create table public.watchlist (
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  building_id   bigint not null references public.buildings on delete cascade,
  relationship  public.watch_relationship not null default 'live_here',
  created_at    timestamptz not null default now(),
  primary key (user_id, building_id)
);
create index watchlist_building on public.watchlist (building_id);

create table public.resident_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  building_id  bigint not null references public.buildings on delete cascade,
  category     text not null references public.categories,
  description  text not null check (length(trim(description)) between 10 and 1000),
  apartment    text check (length(apartment) <= 20),
  status       public.report_status not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  check ((status = 'resolved') = (resolved_at is not null))
);
create index resident_reports_building_recent on public.resident_reports (building_id, created_at desc);
create index resident_reports_user            on public.resident_reports (user_id);
create index resident_reports_category        on public.resident_reports (category);

create table public.alerts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,
  building_id  bigint not null references public.buildings on delete cascade,
  kind         public.alert_kind not null,
  problem_id   bigint references public.complaints on delete cascade,
  report_id    uuid references public.resident_reports on delete cascade,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check ((problem_id is null) <> (report_id is null)),
  check ((kind = 'new_report') = (report_id is not null))
);
create index alerts_user_recent on public.alerts (user_id, created_at desc);
create index alerts_user_unread on public.alerts (user_id) where read_at is null;
create index alerts_building    on public.alerts (building_id);
create index alerts_problem     on public.alerts (problem_id);
create index alerts_report      on public.alerts (report_id);
create unique index alerts_once_per_event
  on public.alerts (user_id, kind, coalesce(problem_id::text, report_id::text));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger buildings_touch        before update on public.buildings        for each row execute function public.touch_updated_at();
create trigger complaints_touch       before update on public.complaints       for each row execute function public.touch_updated_at();
create trigger resident_reports_touch before update on public.resident_reports for each row execute function public.touch_updated_at();

-- Statement-level fan-out: one set-based insert per ingest batch, not one per row.
-- Only complaints received in the last 3 days alert, so backfills don't spam watchers.
create function public.alert_new_complaints()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alerts (user_id, building_id, kind, problem_id)
  select w.user_id, n.building_id, 'new_complaint', n.problem_id
  from new_rows n
  join public.watchlist w on w.building_id = n.building_id
  where n.received_at > now() - interval '3 days'
  on conflict do nothing;
  return null;
end $$;

create trigger complaints_alert_insert
  after insert on public.complaints
  referencing new table as new_rows
  for each statement execute function public.alert_new_complaints();

create function public.alert_closed_complaints()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alerts (user_id, building_id, kind, problem_id)
  select w.user_id, n.building_id, 'complaint_closed', n.problem_id
  from new_rows n
  join old_rows o on o.problem_id = n.problem_id
  join public.watchlist w on w.building_id = n.building_id
  where o.problem_status = 'OPEN' and n.problem_status = 'CLOSE'
  on conflict do nothing;
  return null;
end $$;

create trigger complaints_alert_update
  after update on public.complaints
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.alert_closed_complaints();

create function public.alert_new_report()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alerts (user_id, building_id, kind, report_id)
  select w.user_id, new.building_id, 'new_report', new.id
  from public.watchlist w
  where w.building_id = new.building_id
    and w.user_id <> new.user_id
  on conflict do nothing;
  return null;
end $$;

create trigger resident_reports_alert
  after insert on public.resident_reports
  for each row execute function public.alert_new_report();

-- ---------------------------------------------------------------------------
-- Ingest (service_role only)
-- ---------------------------------------------------------------------------
create function public.begin_ingest_run(p_source text default 'hpd_complaints')
returns table (run_id bigint, watermark_from timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_watermark timestamptz;
  v_id bigint;
begin
  -- Resume from the newest city-side update we have actually stored.
  select coalesce(max(c.source_updated_at), '2025-10-01'::timestamptz)
    into v_watermark
    from public.complaints c;

  insert into public.ingest_runs (source, watermark_from)
  values (p_source, v_watermark)
  returning id into v_id;

  return query select v_id, v_watermark;
end $$;

create function public.finish_ingest_run(p_run_id bigint, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.ingest_runs
     set status      = case when p_error is null then 'succeeded' else 'failed' end::public.ingest_status,
         finished_at = now(),
         error       = p_error
   where id = p_run_id and status = 'running';
$$;

-- p_rows: a JSON array of raw Socrata rows from ygpa-z7cr, requested with
-- $select=:*, * so each row carries ":updated_at" (":updated_at, *" is rejected
-- with a 400). Extra system keys (:id, :version, ...) are ignored.
create function public.ingest_hpd_batch(p_run_id bigint, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fetched  integer;
  v_rejected integer;
  v_upserted integer;
begin
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

  -- Buildings: latest row per building wins.
  insert into public.buildings as b (
    building_id, bbl, bin, borough, house_number, street_name, postcode,
    nta, community_board, council_district, latitude, longitude)
  select distinct on (s.building_id::bigint)
    s.building_id::bigint,
    case when s.bbl ~ '^[1-5][0-9]{9}$' then s.bbl end,
    case when s.bin ~ '^[1-5][0-9]{6}$' then s.bin end,
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
  where s.ok
  order by s.building_id::bigint, s.":updated_at" desc
  on conflict (building_id) do update set
    bbl              = coalesce(excluded.bbl, b.bbl),
    bin              = coalesce(excluded.bin, b.bin),
    borough          = excluded.borough,
    house_number     = excluded.house_number,
    street_name      = excluded.street_name,
    postcode         = coalesce(excluded.postcode, b.postcode),
    nta              = coalesce(excluded.nta, b.nta),
    community_board  = coalesce(excluded.community_board, b.community_board),
    council_district = coalesce(excluded.council_district, b.council_district),
    latitude         = coalesce(excluded.latitude, b.latitude),
    longitude        = coalesce(excluded.longitude, b.longitude);

  -- Complaints: never let an older city update overwrite a newer one.
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
  where c.source_updated_at < excluded.source_updated_at;
  get diagnostics v_upserted = row_count;

  -- Refresh per-season stats for every building this batch touched.
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
  where c.building_id in (select distinct s.building_id::bigint from pg_temp._src s where s.ok)
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

revoke execute on function public.begin_ingest_run(text)            from public, anon, authenticated;
revoke execute on function public.finish_ingest_run(bigint, text)   from public, anon, authenticated;
revoke execute on function public.ingest_hpd_batch(bigint, jsonb)   from public, anon, authenticated;
grant  execute on function public.begin_ingest_run(text)            to service_role;
grant  execute on function public.finish_ingest_run(bigint, text)   to service_role;
grant  execute on function public.ingest_hpd_batch(bigint, jsonb)   to service_role;

-- ---------------------------------------------------------------------------
-- Read API
-- ---------------------------------------------------------------------------
-- Fuzzy address search: "1040b e 217" finds "1040B EAST 217 STREET".
create function public.search_buildings(q text, max_results integer default 10)
returns table (building_id bigint, address text, borough public.borough, postcode text,
               complaints_this_season integer, open_complaints integer, similarity real)
language sql stable
set search_path = ''
as $$
  with norm as (
    select upper(regexp_replace(regexp_replace(regexp_replace(regexp_replace(trim(q),
             '\mE\M', 'EAST', 'gi'), '\mW\M', 'WEST', 'gi'), '\mST\M', 'STREET', 'gi'), '\mAVE?\M', 'AVENUE', 'gi')) as q
  )
  select b.building_id, b.address, b.borough, b.postcode,
         coalesce(bs.complaints_total, 0), coalesce(bs.complaints_open, 0),
         extensions.similarity(b.address, norm.q)
  from public.buildings b
  cross join norm
  left join public.building_stats bs
         on bs.building_id = b.building_id and bs.season = public.current_season()
  where b.address operator(extensions.%) norm.q
  order by extensions.similarity(b.address, norm.q) desc, coalesce(bs.complaints_total, 0) desc
  limit least(greatest(max_results, 1), 50)
$$;

-- What the city data "as of" line in the UI reads: our freshness vs the city's.
create view public.data_freshness
with (security_invoker = true) as
select
  (select max(finished_at) from public.ingest_runs where status = 'succeeded') as last_successful_sync,
  (select max(source_updated_at) from public.complaints)                       as city_last_updated,
  (select max(received_at) from public.complaints)                             as newest_complaint;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.categories          enable row level security;
alter table public.status_descriptions enable row level security;
alter table public.buildings           enable row level security;
alter table public.complaints          enable row level security;
alter table public.building_stats      enable row level security;
alter table public.ingest_runs         enable row level security;
alter table public.ingest_rejects      enable row level security;
alter table public.watchlist           enable row level security;
alter table public.resident_reports    enable row level security;
alter table public.alerts              enable row level security;

-- Public data: anyone can read, nobody but service_role (which bypasses RLS) can write.
create policy "public read" on public.categories          for select to anon, authenticated using (true);
create policy "public read" on public.status_descriptions for select to anon, authenticated using (true);
create policy "public read" on public.buildings           for select to anon, authenticated using (true);
create policy "public read" on public.complaints          for select to anon, authenticated using (true);
create policy "public read" on public.building_stats      for select to anon, authenticated using (true);
-- Sync health is public (it powers "city data as of ..."); rejects stay private (raw payloads).
create policy "public read" on public.ingest_runs         for select to anon, authenticated using (true);

-- Watchlist: yours only.
create policy "own rows" on public.watchlist for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Resident reports: everyone reads; you write only your own.
create policy "public read"  on public.resident_reports for select to anon, authenticated using (true);
create policy "own insert"   on public.resident_reports for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own update"   on public.resident_reports for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own delete"   on public.resident_reports for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Alerts: you can see yours and mark them read. Created only by triggers.
create policy "own read"   on public.alerts for select to authenticated using ((select auth.uid()) = user_id);
create policy "mark read"  on public.alerts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Users may only flip read_at on alerts, and only report columns they own.
revoke insert, update, delete on public.alerts from anon, authenticated;
grant  select on public.alerts to authenticated;
grant  update (read_at) on public.alerts to authenticated;
revoke insert, update, delete, truncate on
  public.categories, public.status_descriptions, public.buildings, public.complaints,
  public.building_stats, public.ingest_runs, public.ingest_rejects
  from anon, authenticated;
revoke select on public.ingest_rejects from anon, authenticated;
-- Column privileges only narrow access if the table-level grant is gone first.
revoke update on public.resident_reports from anon, authenticated;
grant  update (category, description, apartment, status, resolved_at) on public.resident_reports to authenticated;
