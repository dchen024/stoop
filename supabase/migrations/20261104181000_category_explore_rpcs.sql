-- Read API for the home page: filter the city by complaint category.
-- All three are SECURITY INVOKER over public-read tables, so RLS still applies.

create index if not exists complaints_season_category on public.complaints (season, category);

-- Totals per category for a season (powers the filter chips and the breakdown).
create function public.category_summary(p_season smallint default public.current_season())
returns table (category text, complaints bigint, open_complaints bigint, buildings bigint)
language sql stable
set search_path = ''
as $$
  select c.category,
         count(*),
         count(*) filter (where c.problem_status = 'OPEN'),
         count(distinct c.building_id)
  from public.complaints c
  where c.season = p_season
  group by c.category
  order by count(*) desc
$$;

-- Buildings with the most days with a complaint in a category (or any category).
create function public.top_buildings(
  p_category text default null,
  p_limit integer default 10,
  p_season smallint default public.current_season())
returns table (building_id bigint, address text, borough public.borough, nta text,
               complaints bigint, open_complaints bigint, complaint_days bigint)
language sql stable
set search_path = ''
as $$
  select b.building_id, b.address, b.borough, b.nta,
         count(*),
         count(*) filter (where c.problem_status = 'OPEN'),
         count(distinct (c.received_at at time zone 'America/New_York')::date)
  from public.complaints c
  join public.buildings b on b.building_id = c.building_id
  where c.season = p_season
    and (p_category is null or c.category = p_category)
  group by b.building_id
  order by 7 desc, 5 desc
  limit least(greatest(p_limit, 1), 50)
$$;

-- Map points: buildings with complaints in a category this season, worst first.
create function public.map_buildings(
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
  join public.buildings b on b.building_id = c.building_id
  where c.season = p_season
    and b.latitude is not null
    and (p_category is null or c.category = p_category)
  group by b.building_id
  having not p_open_only or count(*) filter (where c.problem_status = 'OPEN') > 0
  order by 5 desc
  limit least(greatest(p_limit, 1), 5000)
$$;

grant execute on function public.category_summary(smallint)                          to anon, authenticated;
grant execute on function public.top_buildings(text, integer, smallint)              to anon, authenticated;
grant execute on function public.map_buildings(text, boolean, integer, smallint)     to anon, authenticated;
