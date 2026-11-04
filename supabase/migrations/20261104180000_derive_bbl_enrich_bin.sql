-- Sodabase finding (2026-11-04): public.buildings had 99 rows missing bbl and 98
-- missing bin. Root cause: HPD's complaint feed omits bbl/bin on some rows, and the
-- ingest took identifiers from the single latest row per building. Fix at the source:
--   1. derive BBL (borough code + 5-digit block + 4-digit lot) when the feed omits it,
--   2. keep any valid bbl/bin seen for the building anywhere in the batch,
--   3. fill BIN from HPD's building registry (dataset kj4p-ruqc) via
--      enrich_buildings_from_registry(), called by the ingest edge function.

create function public.borough_code(b public.borough)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case b when 'MANHATTAN' then '1' when 'BRONX' then '2' when 'BROOKLYN' then '3'
                when 'QUEENS' then '4' when 'STATEN ISLAND' then '5' end
$$;

create function public.make_bbl(b public.borough, block text, lot text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case
    when block ~ '^[0-9]{1,5}$' and lot ~ '^[0-9]{1,4}$' and block::int > 0 and lot::int > 0
    then public.borough_code(b) || lpad(block, 5, '0') || lpad(lot, 4, '0')
  end
$$;

create or replace function public.ingest_hpd_batch(p_run_id bigint, p_rows jsonb)
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

-- p_rows: rows from HPD "Buildings Subject to HPD Jurisdiction" (kj4p-ruqc):
-- {buildingid, bin, block, lot}. Fills only what is missing; never overwrites.
create function public.enrich_buildings_from_registry(p_rows jsonb)
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
     and (b.bin is null or b.bbl is null);
  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

revoke execute on function public.ingest_hpd_batch(bigint, jsonb)            from public, anon, authenticated;
grant  execute on function public.ingest_hpd_batch(bigint, jsonb)            to service_role;
revoke execute on function public.enrich_buildings_from_registry(jsonb)      from public, anon, authenticated;
grant  execute on function public.enrich_buildings_from_registry(jsonb)      to service_role;
