-- HPD republishes once a day and stamps every changed row with the SAME :updated_at
-- (2026-11-04: 34,873 rows at 19:17:55.277Z). So the resume point must come from the
-- last run that finished cleanly, never from rows a half-finished run left behind;
-- otherwise a crash mid-batch would skip the rest of that day's batch forever.
create or replace function public.begin_ingest_run(p_source text default 'hpd_complaints')
returns table (run_id bigint, watermark_from timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_watermark timestamptz;
  v_id bigint;
begin
  -- A run still "running" after 15 minutes died (edge functions cap well below that).
  update public.ingest_runs
     set status = 'failed', finished_at = now(), error = 'abandoned: no finish after 15 minutes'
   where source = p_source and status = 'running' and started_at < now() - interval '15 minutes';

  select coalesce(max(r.newest_source_update), '2026-10-01'::timestamptz)
    into v_watermark
    from public.ingest_runs r
   where r.source = p_source and r.status = 'succeeded';

  insert into public.ingest_runs (source, watermark_from)
  values (p_source, v_watermark)
  returning id into v_id;

  return query select v_id, v_watermark;
end $$;

revoke execute on function public.begin_ingest_run(text) from public, anon, authenticated;
grant  execute on function public.begin_ingest_run(text) to service_role;

-- Live UI: a user's alerts and new resident reports stream to the browser.
-- Realtime applies RLS, so each user only receives their own alerts.
alter publication supabase_realtime add table public.alerts, public.resident_reports;
