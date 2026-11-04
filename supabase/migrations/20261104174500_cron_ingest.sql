-- Every 15 minutes, pg_cron asks the ingest-hpd edge function to sync.
-- The shared secret lives in Supabase Vault (name 'cron_secret'), created out of band:
--   select vault.create_secret('<random>', 'cron_secret');
-- and the same value is set on the function: supabase secrets set CRON_SECRET=<random>
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'ingest-hpd-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://vpimtcehzrrqyjcmjwbp.supabase.co/functions/v1/ingest-hpd',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Keep the sync log from growing forever: drop rows older than 30 days, nightly.
select cron.schedule(
  'prune-ingest-runs',
  '17 4 * * *',
  $$ delete from public.ingest_runs where started_at < now() - interval '30 days' $$
);
