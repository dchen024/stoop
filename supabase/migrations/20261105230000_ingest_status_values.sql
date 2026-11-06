-- New run outcomes. Separate migration: Postgres cannot use an enum value in the
-- same transaction that adds it.
--   partial        saved its place and stopped at the time budget; the next run continues
--   upstream_down  NYC Open Data kept failing (5xx/429/network) after retries
alter type public.ingest_status add value if not exists 'partial' after 'succeeded';
alter type public.ingest_status add value if not exists 'upstream_down' after 'partial';
