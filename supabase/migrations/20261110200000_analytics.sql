-- First-party analytics for Stoop's GTM: page views, unique visitors per day, clicks,
-- the activation funnel, people, and building rankings. No cookies, no third parties.
--
--   * Only the web server writes events, through record_event() with the service role.
--     The tables have RLS on and no policies: nobody can read or write them from a browser.
--   * Visitors are counted per day by a hash of IP + user agent with a random salt that
--     is replaced every day and deleted the next. IPs are never stored, and a visitor
--     can't be followed from one day to the next.
--   * Signed-in users are linked by user id. Emails stay in auth.users and are only
--     joined in for admins, so deleting a user removes them everywhere.
--   * Admins (app_admins, by email) are flagged on their own events and left out of
--     every metric. Rows are added at deploy time, not here: this repo is public.
--   * Rate limits: 60 events per visitor per minute; a page view of the same path by the
--     same visitor within 10 s counts once (router refreshes). Neighbor reports are capped
--     per account (5 an hour, 20 a day) and watchlists at 100 buildings.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table public.app_admins (
  email     text primary key check (email = lower(email) and email like '%@%'),
  added_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

-- True for a signed-in, non-guest user whose (verified) email is on the admin list.
create function public.is_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from public.app_admins a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table public.analytics_salts (
  day   date primary key,
  salt  bytea not null default extensions.gen_random_bytes(32)
);
alter table public.analytics_salts enable row level security;
revoke all on public.analytics_salts from anon, authenticated;

create table public.analytics_events (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  day            date not null default (now() at time zone 'America/New_York')::date,
  env            text not null default 'production' check (env in ('production', 'preview', 'development')),
  name           text not null check (name in
                   ('page_view', 'search', 'search_no_result', 'badge_click', 'outbound_click', 'share')),
  path           text check (length(path) <= 300),
  building_id    bigint,
  user_id        uuid references auth.users on delete set null,
  is_guest       boolean,                 -- signed in as an anonymous (guest) account
  is_admin       boolean not null default false,
  visitor        text not null,           -- daily-rotating hash; see above
  referrer_host  text check (length(referrer_host) <= 200),
  utm_source     text check (length(utm_source) <= 100),
  utm_medium     text check (length(utm_medium) <= 100),
  utm_campaign   text check (length(utm_campaign) <= 100),
  device         text check (device in ('mobile', 'tablet', 'desktop')),
  city           text check (length(city) <= 100),
  region         text check (length(region) <= 20),
  country        text check (length(country) <= 2),
  props          jsonb not null default '{}' check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 2000)
);
create index analytics_events_day_name on public.analytics_events (day, name);
create index analytics_events_visitor_at on public.analytics_events (visitor, at);
create index analytics_events_building on public.analytics_events (building_id, day) where building_id is not null;
create index analytics_events_user on public.analytics_events (user_id, at) where user_id is not null;
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;

-- Called by the web server only. Returns 'ok', 'duplicate', 'rate_limited' or 'rejected'.
create function public.record_event(
  p_name          text,
  p_ip            text,
  p_user_agent    text,
  p_env           text    default 'production',
  p_path          text    default null,
  p_building_id   bigint  default null,
  p_user_id       uuid    default null,
  p_referrer_host text    default null,
  p_utm_source    text    default null,
  p_utm_medium    text    default null,
  p_utm_campaign  text    default null,
  p_device        text    default null,
  p_city          text    default null,
  p_region        text    default null,
  p_country       text    default null,
  p_props         jsonb   default '{}')
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_day     date := (now() at time zone 'America/New_York')::date;
  v_salt    bytea;
  v_visitor text;
  v_guest   boolean;
  v_admin   boolean := false;
begin
  insert into public.analytics_salts (day) values (v_day) on conflict do nothing;
  select s.salt into v_salt from public.analytics_salts s where s.day = v_day;
  v_visitor := encode(extensions.digest(
    v_salt || convert_to(coalesce(p_ip, '') || '|' || coalesce(p_user_agent, ''), 'UTF8'), 'sha256'), 'hex');

  if (select count(*) from public.analytics_events e
       where e.visitor = v_visitor and e.at > now() - interval '1 minute') >= 60 then
    return 'rate_limited';
  end if;

  if p_name = 'page_view' and exists (
       select 1 from public.analytics_events e
        where e.visitor = v_visitor and e.name = 'page_view' and e.path is not distinct from p_path
          and e.at > now() - interval '10 seconds') then
    return 'duplicate';
  end if;

  if p_user_id is not null then
    select u.is_anonymous, exists (select 1 from public.app_admins a where a.email = lower(u.email))
      into v_guest, v_admin
      from auth.users u where u.id = p_user_id;
    if not found then
      p_user_id := null;
      v_admin := false;
    end if;
  end if;

  insert into public.analytics_events (
    day, env, name, path, building_id, user_id, is_guest, is_admin, visitor,
    referrer_host, utm_source, utm_medium, utm_campaign, device, city, region, country, props)
  values (
    v_day, p_env, p_name, left(p_path, 300), p_building_id, p_user_id, v_guest, coalesce(v_admin, false), v_visitor,
    left(lower(p_referrer_host), 200), left(p_utm_source, 100), left(p_utm_medium, 100), left(p_utm_campaign, 100),
    p_device, left(p_city, 100), left(p_region, 20), left(upper(p_country), 2), coalesce(p_props, '{}'));
  return 'ok';
exception
  when check_violation or not_null_violation or invalid_text_representation then
    return 'rejected';
end $$;

-- ---------------------------------------------------------------------------
-- Abuse limits on what signed-in (including guest) accounts can write
-- ---------------------------------------------------------------------------
create index resident_reports_user_created on public.resident_reports (user_id, created_at);

create function public.limit_resident_reports()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.resident_reports r
       where r.user_id = new.user_id and r.created_at > now() - interval '1 hour') >= 5
  or (select count(*) from public.resident_reports r
       where r.user_id = new.user_id and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve posted a lot of reports recently. Please try again later.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger resident_reports_rate_limit
  before insert on public.resident_reports
  for each row execute function public.limit_resident_reports();

create function public.limit_watchlist()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.watchlist w where w.user_id = new.user_id) >= 100 then
    raise exception 'You can watch up to 100 buildings.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger watchlist_limit
  before insert on public.watchlist
  for each row execute function public.limit_watchlist();

-- ---------------------------------------------------------------------------
-- Admin dashboard (admins only; everything excludes admins and non-production)
-- ---------------------------------------------------------------------------
create function public.admin_dashboard(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 400);
  v_from  date := (now() at time zone 'America/New_York')::date - (v_days - 1);
  v_since timestamptz := (v_from::timestamp at time zone 'America/New_York');
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with
  admin_users as (
    select u.id from auth.users u join public.app_admins a on a.email = lower(u.email)
  ),
  ev as (
    select * from public.analytics_events e
     where e.day >= v_from and e.env = 'production' and not e.is_admin
  ),
  days as (
    select d::date as day from generate_series(v_from, (now() at time zone 'America/New_York')::date, interval '1 day') d
  ),
  daily as (
    select d.day,
      count(*) filter (where e.name = 'page_view')                                as page_views,
      count(distinct e.visitor) filter (where e.name = 'page_view')               as visitors,
      count(*) filter (where e.name = 'page_view' and e.building_id is not null)  as building_views,
      count(*) filter (where e.name in ('search', 'search_no_result'))            as searches,
      count(*) filter (where e.name = 'search_no_result')                         as no_result_searches,
      count(*) filter (where e.name = 'badge_click')                              as badge_clicks,
      count(*) filter (where e.name = 'share')                                    as shares
    from days d left join ev e on e.day = d.day
    group by d.day
  ),
  signups as (
    select (u.created_at at time zone 'America/New_York')::date as day,
           count(*) as new_accounts,
           count(*) filter (where not coalesce(u.is_anonymous, false)) as new_email_accounts
    from auth.users u
    where u.created_at >= v_since and u.id not in (select id from admin_users)
    group by 1
  ),
  watches as (
    select (w.created_at at time zone 'America/New_York')::date as day, count(*) as watch_adds
    from public.watchlist w
    where w.created_at >= v_since and w.user_id not in (select id from admin_users)
    group by 1
  ),
  reps as (
    select (r.created_at at time zone 'America/New_York')::date as day, count(*) as reports
    from public.resident_reports r
    where r.created_at >= v_since and r.user_id not in (select id from admin_users)
    group by 1
  ),
  daily_full as (
    select d.*, coalesce(s.new_accounts, 0) as new_accounts, coalesce(s.new_email_accounts, 0) as new_email_accounts,
           coalesce(w.watch_adds, 0) as watch_adds, coalesce(r.reports, 0) as reports
    from daily d
    left join signups s using (day)
    left join watches w using (day)
    left join reps r using (day)
  ),
  clicks as (
    select e.name, coalesce(e.props ->> 'badge', e.props ->> 'target', e.props ->> 'method') as what,
           count(*) as clicks, count(distinct e.visitor) as visitors
    from ev e where e.name in ('badge_click', 'outbound_click', 'share')
    group by 1, 2
  ),
  -- Where each visitor-day came from: their first page view's external source.
  firsts as (
    select distinct on (e.day, e.visitor)
           coalesce(nullif(e.utm_source, ''), nullif(e.referrer_host, ''), 'direct') as source
    from ev e where e.name = 'page_view'
    order by e.day, e.visitor, e.at
  ),
  sources as (
    select source, count(*) as visitor_days from firsts group by 1
  ),
  funnel as (
    select
      (select count(distinct (e.day, e.visitor)) from ev e where e.name = 'page_view')                      as visitor_days,
      (select count(distinct (e.day, e.visitor)) from ev e where e.name in ('search', 'search_no_result'))  as searched,
      (select count(distinct (e.day, e.visitor)) from ev e where e.name = 'page_view' and e.building_id is not null) as viewed_building,
      (select count(distinct w.user_id) from public.watchlist w
        where w.created_at >= v_since and w.user_id not in (select id from admin_users))                    as watched,
      (select count(*) from auth.users u
        where not coalesce(u.is_anonymous, false) and u.email_confirmed_at >= v_since
          and u.id not in (select id from admin_users))                                                      as email_signups,
      (select count(*) from (select e.user_id from ev e where e.user_id is not null and e.name = 'page_view'
                              group by e.user_id having count(distinct e.day) >= 2) x)                       as returned
  ),
  bstats as (
    select e.building_id,
           count(*) as views,
           count(distinct (e.day, e.visitor)) as viewers,
           count(*) filter (where e.name = 'share') as shares
    from ev e where e.building_id is not null and e.name in ('page_view', 'share')
    group by 1
  ),
  bwatch as (
    select w.building_id, count(*) as watchers,
           count(*) filter (where w.created_at >= v_since) as new_watchers
    from public.watchlist w where w.user_id not in (select id from admin_users)
    group by 1
  ),
  brep as (
    select r.building_id, count(*) as reports, count(distinct r.user_id) as reporters
    from public.resident_reports r
    where r.created_at >= v_since and r.user_id not in (select id from admin_users)
    group by 1
  ),
  buildings as (
    select b.building_id, b.house_number || ' ' || b.street_name as address, b.borough::text as borough,
           coalesce(s.views, 0) as views, coalesce(s.viewers, 0) as viewers, coalesce(s.shares, 0) as shares,
           coalesce(w.watchers, 0) as watchers, coalesce(w.new_watchers, 0) as new_watchers,
           coalesce(r.reports, 0) as reports, coalesce(r.reporters, 0) as reporters
    from public.buildings b
    left join bstats s using (building_id)
    left join bwatch w using (building_id)
    left join brep r using (building_id)
    where s.building_id is not null or w.building_id is not null or r.building_id is not null
  ),
  people as (
    select u.id, u.email, coalesce(u.is_anonymous, false) as guest, u.created_at,
           (u.id in (select id from admin_users)) as admin,
           greatest(u.last_sign_in_at, (select max(e.at) from public.analytics_events e where e.user_id = u.id)) as last_seen,
           (select count(*) from public.analytics_events e
             where e.user_id = u.id and e.name = 'page_view' and e.env = 'production') as page_views,
           (select count(distinct e.building_id) from public.analytics_events e
             where e.user_id = u.id and e.building_id is not null and e.env = 'production') as buildings_viewed,
           (select count(*) from public.watchlist w where w.user_id = u.id) as watching,
           (select count(*) from public.resident_reports r where r.user_id = u.id) as reports,
           (select count(distinct r.building_id) from public.resident_reports r where r.user_id = u.id) as report_buildings
    from auth.users u
  )
  select jsonb_build_object(
    'days',      v_days,
    'from',      v_from,
    'daily',     (select coalesce(jsonb_agg(to_jsonb(d) order by d.day desc), '[]') from daily_full d),
    'clicks',    (select coalesce(jsonb_agg(to_jsonb(c) order by c.clicks desc), '[]') from clicks c),
    'sources',   (select coalesce(jsonb_agg(to_jsonb(s) order by s.visitor_days desc), '[]')
                    from (select * from sources order by visitor_days desc limit 20) s),
    'funnel',    (select to_jsonb(f) from funnel f),
    'top_viewed',  (select coalesce(jsonb_agg(to_jsonb(b) order by b.views desc, b.watchers desc), '[]')
                    from (select * from buildings where views > 0 order by views desc, watchers desc limit 25) b),
    'top_watched', (select coalesce(jsonb_agg(to_jsonb(b) order by b.watchers desc, b.views desc), '[]')
                    from (select * from buildings where watchers > 0 order by watchers desc, views desc limit 25) b),
    'people',    (select coalesce(jsonb_agg(to_jsonb(p) order by p.last_seen desc nulls last), '[]')
                    from (select p.*, (p.watching >= 3 or p.report_buildings >= 2) as organizer
                          from people p order by p.last_seen desc nulls last limit 200) p),
    'totals',    jsonb_build_object(
                   'accounts',       (select count(*) from auth.users u where u.id not in (select id from admin_users)),
                   'email_accounts', (select count(*) from auth.users u where not coalesce(u.is_anonymous, false)
                                        and u.id not in (select id from admin_users)),
                   'watching_users', (select count(distinct w.user_id) from public.watchlist w
                                        where w.user_id not in (select id from admin_users)))
  ) into v_out;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Grants and retention
-- ---------------------------------------------------------------------------
revoke execute on function public.is_admin()                 from public;
revoke execute on function public.record_event(text, text, text, text, text, bigint, uuid, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_dashboard(integer)   from public, anon;
revoke execute on function public.limit_resident_reports()   from public, anon, authenticated;
revoke execute on function public.limit_watchlist()          from public, anon, authenticated;
grant  execute on function public.is_admin()                 to anon, authenticated, service_role;
grant  execute on function public.record_event(text, text, text, text, text, bigint, uuid, text, text, text, text, text, text, text, text, jsonb) to service_role;
grant  execute on function public.admin_dashboard(integer)   to authenticated;

-- Nightly: drop old salts (so past visitor hashes can't be recomputed), strip typed
-- search text after 90 days (it can be someone's home address), drop events after 13 months.
select cron.schedule(
  'analytics-retention',
  '23 4 * * *',
  $$
  delete from public.analytics_salts where day < (now() at time zone 'America/New_York')::date;
  update public.analytics_events set props = props - 'query'
   where name in ('search', 'search_no_result') and at < now() - interval '90 days' and props ? 'query';
  delete from public.analytics_events where at < now() - interval '400 days';
  $$
);

-- ---------------------------------------------------------------------------
-- Neighbor reports are switched off to prevent misuse (no moderation yet). Existing
-- rows stay; the app hides them (web/src/lib/features.ts). To turn back on:
--   grant insert on public.resident_reports to authenticated;
-- ---------------------------------------------------------------------------
revoke insert on public.resident_reports from anon, authenticated;
