-- refresh_building_aliases() matches buildings on exact (borough, address). Without this
-- index Postgres used the trigram index for the equality and took ~60 s, past PostgREST's
-- 8 s statement timeout, so check-buildings' hourly alias refresh failed.
-- Built concurrently: drain_hpd_queue() writes to buildings every minute.
create index concurrently if not exists buildings_borough_address on public.buildings (borough, address);
