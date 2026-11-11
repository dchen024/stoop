-- Sodabase (2026-11-10) flagged public.buildings: 119 buildings without a BIN, 22 BINs
-- shared by several buildings, and 4 community boards that don't exist (30, 32, 41, 86).
-- Looking closer:
--   * Shared BINs are mostly correct. A BIN is one physical structure; an HPD building
--     id is one registered address, so a corner building with three entrances has one
--     BIN and three ids. Only two are real duplicates, two HPD ids for one address:
--     60-14 Beach Channel Dr and 36-26 41 St (both Queens).
--   * 131 BBLs on HPD records are not in PLUTO. Some can't exist (1058740063: Manhattan
--     blocks stop near 2255); others may be lots since merged or renumbered. The
--     coordinates on the same records look right, so they stay on the map.
--   * Some BINs are missing at the city too: 3057 Sedgwick Ave is vacant land, and City
--     Planning returns the placeholder 2000000 for it.
-- Here:
--   1. Community boards are checked per borough (Manhattan 12, Bronx 12, Brooklyn 18,
--      Queens 14, Staten Island 3). A trigger drops impossible values from the feed
--      instead of failing the ingest; PLUTO fills the board when HPD has none.
--   2. building_checks records what City Planning's data says about each building:
--      whether its BBL is a real tax lot (PLUTO) and, for buildings without a BIN, what
--      an exact address lookup in the Property Address Directory returns (via GeoSearch).
--      The check-buildings edge function fills it hourly; save_building_checks() writes
--      back only answers that agree with what we have.
--   3. building_aliases maps a duplicate HPD id to the building it duplicates. Search,
--      the leaderboard and the map count both under one building. Both rows are kept:
--      HPD keeps sending complaints under both ids. A duplicate id's page redirects to
--      the building's own, so analytics skips the page view recorded before the redirect.
-- Apply with lock_timeout set: drain_hpd_queue() writes to buildings every minute.

-- ---------------------------------------------------------------------------
-- 1. Community boards
-- ---------------------------------------------------------------------------
create function public.community_board_max(p_borough public.borough)
returns smallint language sql immutable parallel safe set search_path = '' as $$
  select (case p_borough
            when 'MANHATTAN' then 12 when 'BRONX' then 12 when 'BROOKLYN' then 18
            when 'QUEENS' then 14 when 'STATEN ISLAND' then 3
          end)::smallint
$$;

-- The feed sends a few impossible boards. Keep the value we had (or none) rather than
-- letting the check constraint fail the whole ingest batch.
create function public.drop_invalid_community_board()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.community_board > public.community_board_max(new.borough) then
    new.community_board := case
      when tg_op = 'UPDATE' and old.community_board <= public.community_board_max(new.borough)
      then old.community_board
    end;
  end if;
  return new;
end $$;
revoke execute on function public.drop_invalid_community_board() from public, anon, authenticated;

create trigger buildings_community_board
  before insert or update of community_board, borough on public.buildings
  for each row execute function public.drop_invalid_community_board();

update public.buildings set community_board = null
 where community_board > public.community_board_max(borough);

alter table public.buildings drop constraint buildings_community_board_check;
-- NOT VALID + VALIDATE: the scan runs without blocking the ingest's writes.
alter table public.buildings add constraint buildings_community_board_check
  check (community_board between 1 and public.community_board_max(borough)) not valid;
alter table public.buildings validate constraint buildings_community_board_check;

-- ---------------------------------------------------------------------------
-- 2. Checks against City Planning's data
-- ---------------------------------------------------------------------------
create table public.building_checks (
  building_id     bigint primary key references public.buildings on delete cascade,
  -- PLUTO, by BBL: is it a real tax lot?
  lot_bbl         text,        -- the BBL that was checked; rechecked if the building's changes
  lot_found       boolean,
  lot_cd          smallint,    -- PLUTO community district: borough digit + board, e.g. 305
  lot_council     smallint,
  lot_checked_at  timestamptz,
  -- Property Address Directory, by exact address. Only for buildings without a BIN.
  geo_status      text check (geo_status in ('match', 'no_bin', 'no_match')),
  geo_bin         text check (geo_bin ~ '^[1-5][0-9]{6}$'),
  geo_bbl         text check (geo_bbl ~ '^[1-5][0-9]{9}$'),
  geo_checked_at  timestamptz,
  bin_filled_at   timestamptz  -- when geo_bin was written to buildings.bin
);

alter table public.building_checks enable row level security;
create policy "public read" on public.building_checks for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.building_checks from anon, authenticated;

-- What the edge function should look up next. A lot is rechecked every 90 days (PLUTO
-- is republished a few times a year); an address without a BIN every 7 days.
create function public.buildings_to_check(p_limit integer default 2000)
returns table (building_id bigint, borough public.borough, house_number text, street_name text,
               bbl text, check_lot boolean, check_address boolean)
language sql stable security definer set search_path = '' as $$
  with due as (
    select b.building_id, b.borough, b.house_number, b.street_name, b.bbl,
           b.bbl is not null and (k.lot_checked_at is null or k.lot_bbl is distinct from b.bbl
                                  or k.lot_checked_at < now() - interval '90 days') as check_lot,
           b.bin is null and (k.geo_checked_at is null
                              or k.geo_checked_at < now() - interval '7 days') as check_address,
           k.building_id is null as never_checked
    from public.buildings b
    left join public.building_checks k on k.building_id = b.building_id
  )
  select building_id, borough, house_number, street_name, bbl, check_lot, check_address
  from due
  where check_lot or check_address
  order by check_address desc, never_checked desc, building_id
  limit least(greatest(p_limit, 1), 5000)
$$;

-- Saves one run's answers, then writes back the ones that agree with what we have:
--   * BIN, when the address matched exactly and the city's BBL is ours. If our BBL is
--     not in PLUTO, the matched address's BBL replaces it too.
--   * Community board and council district from PLUTO, only where HPD sent none.
-- A row carries lot_* keys if its lot was checked this run, geo_* keys if its address was.
create function public.save_building_checks(p_rows jsonb)
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

-- ---------------------------------------------------------------------------
-- 3. Duplicate HPD ids
-- ---------------------------------------------------------------------------
create table public.building_aliases (
  alias_id     bigint primary key references public.buildings on delete cascade,
  canonical_id bigint not null references public.buildings on delete cascade,
  reason       text not null,
  created_at   timestamptz not null default now(),
  check (alias_id <> canonical_id)
);
create index building_aliases_canonical on public.building_aliases (canonical_id);

alter table public.building_aliases enable row level security;
create policy "public read" on public.building_aliases for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.building_aliases from anon, authenticated;

-- Two HPD ids are one building when borough and address match and so does either the
-- BIN or the exact coordinates (with no conflicting BINs). The lowest id stays
-- canonical, so the choice never flips as complaints come in.
create function public.refresh_building_aliases()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_added integer;
begin
  insert into public.building_aliases (alias_id, canonical_id, reason)
  select x.building_id, c.building_id,
         case when x.bin = c.bin then 'same address and BIN' else 'same address and location' end
  from public.buildings x
  join lateral (
    select c.building_id, c.bin
    from public.buildings c
    where c.borough = x.borough
      and c.address = x.address
      and c.building_id < x.building_id
      and (c.bin = x.bin
           or (c.latitude = x.latitude and c.longitude = x.longitude
               and (c.bin is null or x.bin is null)))
      and not exists (select 1 from public.building_aliases a where a.alias_id = c.building_id)
    order by c.building_id
    limit 1
  ) c on true
  on conflict (alias_id) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end $$;

select public.refresh_building_aliases();

revoke execute on function public.buildings_to_check(integer)   from public, anon, authenticated;
grant  execute on function public.buildings_to_check(integer)   to service_role;
revoke execute on function public.save_building_checks(jsonb)   from public, anon, authenticated;
grant  execute on function public.save_building_checks(jsonb)   to service_role;
revoke execute on function public.refresh_building_aliases()    from public, anon, authenticated;
grant  execute on function public.refresh_building_aliases()    to service_role;

-- Search hides aliases and counts their complaints under the canonical building.
create or replace function public.search_buildings(q text, max_results integer default 10)
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
         coalesce(s.total, 0), coalesce(s.open, 0),
         extensions.similarity(b.address, norm.q)
  from public.buildings b
  cross join norm
  left join lateral (
    select sum(bs.complaints_total)::integer as total, sum(bs.complaints_open)::integer as open
    from public.building_stats bs
    where bs.season = public.current_season()
      and (bs.building_id = b.building_id
           or bs.building_id in (select a.alias_id from public.building_aliases a
                                 where a.canonical_id = b.building_id))
  ) s on true
  where b.address operator(extensions.%) norm.q
    and not exists (select 1 from public.building_aliases a where a.alias_id = b.building_id)
  order by extensions.similarity(b.address, norm.q) desc, coalesce(s.total, 0) desc
  limit least(greatest(max_results, 1), 50)
$$;

create or replace function public.top_buildings(
  p_category text default null,
  p_limit integer default 10,
  p_sort text default 'complaints',
  p_season smallint default public.current_season())
returns table (building_id bigint, address text, borough public.borough, nta text,
               complaints bigint, open_complaints bigint, complaint_days bigint)
language sql stable
set search_path = ''
as $$
  with agg as (
    select b.building_id, b.address, b.borough, b.nta,
           count(*) as complaints,
           count(*) filter (where c.problem_status = 'OPEN') as open_complaints,
           count(distinct (c.received_at at time zone 'America/New_York')::date) as complaint_days
    from public.complaints c
    left join public.building_aliases a on a.alias_id = c.building_id
    join public.buildings b on b.building_id = coalesce(a.canonical_id, c.building_id)
    where c.season = p_season
      and (p_category is null or c.category = p_category)
    group by b.building_id
  )
  select * from agg
  order by
    case p_sort when 'open' then open_complaints when 'days' then complaint_days else complaints end desc,
    complaints desc,
    complaint_days desc
  limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.map_buildings(
  p_category text default null,
  p_open_only boolean default true,
  p_limit integer default 3000,
  p_season smallint default public.current_season())
returns table (building_id bigint, address text, latitude double precision, longitude double precision,
               complaints bigint, open_complaints bigint)
language sql stable
set search_path = ''
as $$
  select b.building_id, b.address, b.latitude, b.longitude,
         count(*),
         count(*) filter (where c.problem_status = 'OPEN')
  from public.complaints c
  left join public.building_aliases a on a.alias_id = c.building_id
  join public.buildings b on b.building_id = coalesce(a.canonical_id, c.building_id)
  where c.season = p_season
    and b.latitude is not null
    and (p_category is null or c.category = p_category)
  group by b.building_id
  having not p_open_only or count(*) filter (where c.problem_status = 'OPEN') > 0
  order by 5 desc
  limit least(greatest(p_limit, 1), 5000)
$$;

-- A visit to a duplicate id is recorded twice: once by the middleware before the page
-- redirects, once on the building's own page. Keep the second.
create function public.skip_alias_page_view()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.name = 'page_view' and new.building_id is not null
     and exists (select 1 from public.building_aliases a where a.alias_id = new.building_id) then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.skip_alias_page_view() from public, anon, authenticated;

create trigger analytics_events_skip_alias
  before insert on public.analytics_events
  for each row execute function public.skip_alias_page_view();

-- ---------------------------------------------------------------------------
-- Hourly at :07, off the ingest's quarter hours.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'check-buildings-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url     := 'https://vpimtcehzrrqyjcmjwbp.supabase.co/functions/v1/check-buildings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
