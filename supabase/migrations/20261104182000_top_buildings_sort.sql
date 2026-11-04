-- Leaderboard sort: most complaints (default), most still open, or most days with a complaint.
drop function if exists public.top_buildings(text, integer, smallint);

create function public.top_buildings(
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
    join public.buildings b on b.building_id = c.building_id
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

grant execute on function public.top_buildings(text, integer, text, smallint) to anon, authenticated;
