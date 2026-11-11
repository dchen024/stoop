-- dropped_values: an audit log of every value Stoop discards or replaces, so each one can
-- be reviewed later. Whole rows the feed rejects still go to ingest_rejects; this covers
-- single values dropped from rows that were kept:
--   * hpd feed: a malformed BBL, placeholder or invalid BIN, zip code, community board,
--     council district, or coordinates outside NYC (apply_hpd_rows), and a community
--     board that doesn't exist in its borough (the buildings_community_board trigger).
--   * check-buildings: a BBL that isn't a real tax lot, replaced by the address
--     directory's BBL when its BIN is filled.
--   * migration: the 4 impossible community boards cleared by 20261110210000.
-- One row per (building, column, value): seeing it again bumps last_seen and times_seen.
-- Admin only: no RLS policies, so only the service role and SQL can read it.

create table public.dropped_values (
  id            bigint generated always as identity primary key,
  table_name    text not null,
  row_id        bigint not null,
  column_name   text not null,
  dropped_value text not null,
  kept_value    text,
  reason        text not null,
  source        text not null check (source in ('hpd feed', 'check-buildings', 'migration')),
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  times_seen    integer not null default 1,
  unique (table_name, row_id, column_name, dropped_value)
);
create index dropped_values_recent on public.dropped_values (last_seen desc);

alter table public.dropped_values enable row level security;
revoke all on public.dropped_values from anon, authenticated;

-- Community boards: log what the trigger drops.
create or replace function public.drop_invalid_community_board()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.community_board > public.community_board_max(new.borough) then
    insert into public.dropped_values as d (table_name, row_id, column_name, dropped_value, kept_value, reason, source)
    values ('buildings', new.building_id, 'community_board', new.community_board::text,
            case when tg_op = 'UPDATE' and old.community_board <= public.community_board_max(new.borough)
                 then old.community_board::text end,
            format('%s has %s community boards', initcap(new.borough::text), public.community_board_max(new.borough)),
            'hpd feed')
    on conflict (table_name, row_id, column_name, dropped_value) do update
      set last_seen = now(), times_seen = d.times_seen + 1;
    new.community_board := case
      when tg_op = 'UPDATE' and old.community_board <= public.community_board_max(new.borough)
      then old.community_board
    end;
  end if;
  return new;
end $$;
revoke execute on function public.drop_invalid_community_board() from public, anon, authenticated;

-- The ingest: log values dropped from kept rows.
CREATE OR REPLACE FUNCTION public.apply_hpd_rows(p_run_id bigint, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Values dropped from rows that were otherwise kept, for audit (see dropped_values).
  insert into public.dropped_values as d (table_name, row_id, column_name, dropped_value, reason, source)
  select 'buildings', v.building_id, v.column_name, v.dropped_value, min(v.reason), 'hpd feed'
  from (
    select s.building_id::bigint as building_id, x.column_name, x.dropped_value, x.reason
    from pg_temp._src s
    cross join lateral (values
      ('bbl', nullif(trim(s.bbl), ''),
       case when nullif(trim(s.bbl), '') is not null and s.bbl !~ '^[1-5][0-9]{9}$' then 'not a 10-digit BBL' end),
      ('bin', nullif(trim(s.bin), ''),
       case when nullif(trim(s.bin), '') is not null and public.real_bin(s.bin) is null then
         case when trim(s.bin) ~ '^[1-5]000000$' then 'NYC placeholder BIN (none assigned)' else 'not a valid BIN' end end),
      ('postcode', nullif(trim(s.post_code), ''),
       case when nullif(trim(s.post_code), '') is not null and s.post_code !~ '^[0-9]{5}$' then 'not a 5-digit zip code' end),
      ('community_board', nullif(trim(s.community_board), ''),
       case when nullif(trim(s.community_board), '') is not null
             and not (s.community_board ~ '^[0-9]{1,2}$' and s.community_board::int between 1 and 99)
            then 'not a community board number' end),
      ('council_district', nullif(trim(s.council_district), ''),
       case when nullif(trim(s.council_district), '') is not null
             and not (s.council_district ~ '^[0-9]{1,2}$' and s.council_district::int between 1 and 51)
            then 'not a council district (1-51)' end),
      ('latitude,longitude', nullif(trim(coalesce(s.latitude, '') || ',' || coalesce(s.longitude, '')), ','),
       case when (nullif(trim(s.latitude), '') is not null or nullif(trim(s.longitude), '') is not null)
             and not (s.latitude ~ '^-?[0-9.]+$' and s.longitude ~ '^-?[0-9.]+$'
                      and s.latitude::float8 between 40.40 and 41.00 and s.longitude::float8 between -74.30 and -73.60)
            then 'coordinates outside NYC' end)
    ) as x(column_name, dropped_value, reason)
    where s.ok and x.reason is not null
  ) v
  group by v.building_id, v.column_name, v.dropped_value
  on conflict (table_name, row_id, column_name, dropped_value) do update
    set last_seen = now(), times_seen = d.times_seen + 1;

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
end $function$;
revoke execute on function public.apply_hpd_rows(bigint, jsonb) from public, anon, authenticated;

create or replace function public.save_building_checks(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids       bigint[];
  v_bins      integer;
  v_boards    integer;
  v_districts integer;
begin
  with saved as (
    insert into public.building_checks as k (
      building_id, lot_bbl, lot_found, lot_cd, lot_council, lot_checked_at,
      geo_status, geo_bin, geo_bbl, geo_checked_at)
    select r.building_id, r.lot_bbl, r.lot_found, r.lot_cd, r.lot_council,
           case when r.lot_found is not null then now() end,
           r.geo_status, public.real_bin(r.geo_bin),
           case when r.geo_bbl ~ '^[1-5][0-9]{9}$' then r.geo_bbl end,
           case when r.geo_status is not null then now() end
    from jsonb_to_recordset(p_rows) as r(
      building_id bigint, lot_bbl text, lot_found boolean, lot_cd smallint, lot_council smallint,
      geo_status text, geo_bin text, geo_bbl text)
    join public.buildings b on b.building_id = r.building_id
    on conflict (building_id) do update set
      lot_bbl        = case when excluded.lot_checked_at is null then k.lot_bbl     else excluded.lot_bbl     end,
      lot_found      = case when excluded.lot_checked_at is null then k.lot_found   else excluded.lot_found   end,
      lot_cd         = case when excluded.lot_checked_at is null then k.lot_cd      else excluded.lot_cd      end,
      lot_council    = case when excluded.lot_checked_at is null then k.lot_council else excluded.lot_council end,
      lot_checked_at = coalesce(excluded.lot_checked_at, k.lot_checked_at),
      geo_status     = case when excluded.geo_checked_at is null then k.geo_status  else excluded.geo_status  end,
      geo_bin        = case when excluded.geo_checked_at is null then k.geo_bin     else excluded.geo_bin     end,
      geo_bbl        = case when excluded.geo_checked_at is null then k.geo_bbl     else excluded.geo_bbl     end,
      geo_checked_at = coalesce(excluded.geo_checked_at, k.geo_checked_at)
    returning k.building_id
  )
  select coalesce(array_agg(building_id), '{}') into v_ids from saved;

  -- A BBL that is not a real tax lot is replaced along with the BIN fill below: log it.
  insert into public.dropped_values as d (table_name, row_id, column_name, dropped_value, kept_value, reason, source)
  select 'buildings', b.building_id, 'bbl', b.bbl, k.geo_bbl,
         'not a tax lot in PLUTO; replaced by the address directory''s BBL', 'check-buildings'
    from public.buildings b
    join public.building_checks k on k.building_id = b.building_id
   where b.building_id = any(v_ids)
     and b.bin is null and k.geo_status = 'match' and k.geo_bin is not null and k.geo_bbl is not null
     and k.lot_found = false and k.lot_bbl = b.bbl and k.geo_bbl is distinct from b.bbl
  on conflict (table_name, row_id, column_name, dropped_value) do update
    set last_seen = now(), times_seen = d.times_seen + 1, kept_value = excluded.kept_value;

  with filled as (
    update public.buildings b
       set bin = k.geo_bin,
           bbl = k.geo_bbl
      from public.building_checks k
     where k.building_id = b.building_id
       and b.building_id = any(v_ids)
       and b.bin is null
       and k.geo_status = 'match'
       and k.geo_bin is not null
       and k.geo_bbl is not null
       and (k.geo_bbl = b.bbl or (k.lot_found = false and k.lot_bbl = b.bbl))
    returning b.building_id
  )
  update public.building_checks k set bin_filled_at = now()
    from filled f where k.building_id = f.building_id;
  get diagnostics v_bins = row_count;

  update public.buildings b
     set community_board = k.lot_cd % 100
    from public.building_checks k
   where k.building_id = b.building_id
     and b.building_id = any(v_ids)
     and b.community_board is null
     and k.lot_found and k.lot_bbl = b.bbl
     and k.lot_cd / 100 = public.borough_code(b.borough)::int
     and k.lot_cd % 100 between 1 and public.community_board_max(b.borough);
  get diagnostics v_boards = row_count;

  update public.buildings b
     set council_district = k.lot_council
    from public.building_checks k
   where k.building_id = b.building_id
     and b.building_id = any(v_ids)
     and b.council_district is null
     and k.lot_found and k.lot_bbl = b.bbl
     and k.lot_council between 1 and 51;
  get diagnostics v_districts = row_count;

  return jsonb_build_object('saved', cardinality(v_ids), 'bins_filled', v_bins,
                            'boards_filled', v_boards, 'districts_filled', v_districts);
end $$;
revoke execute on function public.save_building_checks(jsonb) from public, anon, authenticated;
grant  execute on function public.save_building_checks(jsonb) to service_role;

-- Backfill: BBLs check-buildings replaced before this table existed (building_checks keeps
-- the old one in lot_bbl).
insert into public.dropped_values (table_name, row_id, column_name, dropped_value, kept_value, reason, source, first_seen, last_seen)
select 'buildings', k.building_id, 'bbl', k.lot_bbl, k.geo_bbl,
       'not a tax lot in PLUTO; replaced by the address directory''s BBL', 'check-buildings',
       k.bin_filled_at, k.bin_filled_at
  from public.building_checks k
 where k.bin_filled_at is not null and k.lot_found = false and k.lot_bbl is distinct from k.geo_bbl
on conflict do nothing;

-- Backfill: the 4 impossible boards 20261110210000 cleared (values read back from the HPD feed).
insert into public.dropped_values (table_name, row_id, column_name, dropped_value, reason, source, first_seen, last_seen)
select 'buildings', v.building_id, 'community_board', v.board,
       format('%s has %s community boards', initcap(v.borough), public.community_board_max(v.borough::public.borough)),
       'migration', '2026-11-11 00:13:00+00', '2026-11-11 00:13:00+00'
  from (values (810048, 'BROOKLYN', '32'), (995394, 'QUEENS', '41'),
               (1007390, 'BROOKLYN', '30'), (1017000, 'BROOKLYN', '86')) as v(building_id, borough, board)
  join public.buildings b on b.building_id = v.building_id
on conflict do nothing;
