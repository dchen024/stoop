-- Sentry alerting for the ingest queue. drain_hpd_queue() runs in pg_cron, which can't
-- reach Sentry, so the ingest-hpd edge function asks for this summary on every run and
-- reports set-aside batches and a stalled queue.

create function public.hpd_queue_health(p_run_id bigint)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select queue_length, oldest_msg_age_sec from pgmq.metrics('hpd_ingest')),
  prev as (
    -- Start of the run before this one: failures after it haven't been reported yet.
    select coalesce(max(r.started_at), now() - interval '15 minutes') as since
    from public.ingest_runs r
    where r.source = 'hpd_complaints' and r.id < p_run_id
  ),
  dead as (
    select count(*) as n, (array_agg(f.error order by f.failed_at desc))[1] as last_error
    from public.ingest_queue_failures f, prev
    where f.dead and f.failed_at >= prev.since
  )
  select jsonb_build_object(
    'batches',             m.queue_length,
    'oldest_age_s',        m.oldest_msg_age_sec,
    'dead_since_last_run', dead.n,
    'last_dead_error',     dead.last_error)
  from m, dead
$$;

revoke execute on function public.hpd_queue_health(bigint) from public, anon, authenticated;
grant  execute on function public.hpd_queue_health(bigint) to service_role;
