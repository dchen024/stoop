-- The admin page's "Dropped values" section: a summary of public.dropped_values by
-- source, column and reason, plus the most recent drops. Admins only, like
-- admin_dashboard(): the table itself stays unreadable to anon and authenticated.
create function public.admin_dropped_values(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_new   timestamptz := now() - interval '7 days';
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total',  (select count(*) from public.dropped_values),
    'new_7d', (select count(*) from public.dropped_values d where d.first_seen > v_new),
    'summary', coalesce((
      select jsonb_agg(s order by s.new_7d desc, s.last_seen desc)
      from (
        select d.source, d.column_name, d.reason,
               count(*)                                  as "values",
               sum(d.times_seen)                         as seen,
               count(*) filter (where d.first_seen > v_new) as new_7d,
               min(d.first_seen)                         as first_seen,
               max(d.last_seen)                          as last_seen
        from public.dropped_values d
        group by d.source, d.column_name, d.reason
      ) s), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r.last_seen desc, r.id desc)
      from (
        select d.id, d.row_id as building_id, b.address, b.borough, d.column_name,
               d.dropped_value, d.kept_value, d.reason, d.source,
               d.first_seen, d.last_seen, d.times_seen, d.first_seen > v_new as is_new
        from public.dropped_values d
        left join public.buildings b on d.table_name = 'buildings' and b.building_id = d.row_id
        order by d.last_seen desc, d.id desc
        limit v_limit
      ) r), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

revoke execute on function public.admin_dropped_values(integer) from public, anon;
grant  execute on function public.admin_dropped_values(integer) to authenticated;
