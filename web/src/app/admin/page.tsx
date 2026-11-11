import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

type Daily = {
  day: string; page_views: number; visitors: number; building_views: number; searches: number;
  no_result_searches: number; badge_clicks: number; shares: number; new_accounts: number;
  new_email_accounts: number; watch_adds: number; reports: number;
};
type Building = {
  building_id: number; address: string; borough: string; views: number; viewers: number; shares: number;
  watchers: number; new_watchers: number; reports: number; reporters: number;
};
type Person = {
  id: string; email: string | null; guest: boolean; admin: boolean; created_at: string; last_seen: string | null;
  page_views: number; buildings_viewed: number; watching: number; reports: number; organizer: boolean;
};
type Dashboard = {
  days: number; from: string; daily: Daily[];
  clicks: { name: string; what: string | null; clicks: number; visitors: number }[];
  sources: { source: string; visitor_days: number }[];
  funnel: { visitor_days: number; searched: number; viewed_building: number; watched: number; email_signups: number; returned: number };
  top_viewed: Building[]; top_watched: Building[]; people: Person[];
  totals: { accounts: number; email_accounts: number; watching_users: number };
};

type Dropped = {
  total: number; new_7d: number;
  summary: {
    source: string; column_name: string; reason: string; values: number; seen: number;
    new_7d: number; first_seen: string; last_seen: string;
  }[];
  recent: {
    id: number; building_id: number; address: string | null; borough: string | null; column_name: string;
    dropped_value: string; kept_value: string | null; reason: string; source: string;
    first_seen: string; last_seen: string; times_seen: number; is_new: boolean;
  }[];
};

const RANGES = [7, 30, 90];

// "2026-11-10" is already a New York calendar day; don't let time zones shift it.
const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const requested = Number((await searchParams).days);
  const days = RANGES.includes(requested) ? requested : 30;
  const [{ data, error }, { data: droppedData, error: droppedError }] = await Promise.all([
    supabase.rpc("admin_dashboard", { p_days: days }),
    supabase.rpc("admin_dropped_values", { p_limit: 50 }),
  ]);
  if (error || !data) {
    return <p className="text-red-700">Couldn&apos;t load the dashboard: {error?.message}</p>;
  }
  const d = data as unknown as Dashboard;
  const dropped = droppedData as unknown as Dropped | null;
  const sum = (k: keyof Daily) => d.daily.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const today = d.daily[0];
  const f = d.funnel;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stoop admin</h1>
          <p className="text-sm text-stone-500">
            Production only. Your own activity and other admins&apos; is left out. Since {fmtDay(d.from)}.
          </p>
        </div>
        <nav className="flex gap-1 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin?days=${r}`}
              className={`rounded-lg px-3 py-1.5 ${r === days ? "bg-orange-700 text-white" : "border border-stone-300 dark:border-stone-700"}`}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Page views" value={sum("page_views")} sub={`${today?.page_views ?? 0} today`} />
        <Tile label="Unique visitors (sum of daily)" value={sum("visitors")} sub={`${today?.visitors ?? 0} today`} />
        <Tile label="Badge clicks" value={sum("badge_clicks")} sub={`${sum("shares")} shares`} />
        <Tile label="Email sign-ups" value={sum("new_email_accounts")} sub={`${d.totals.email_accounts} email accounts total`} />
      </section>

      <Section title="Activation funnel" note="Visitor-days are counted per day (no cookies), accounts by user.">
        <ol className="space-y-2">
          {[
            ["Visited", f.visitor_days, "visitor-days"],
            ["Searched an address", f.searched, "visitor-days"],
            ["Viewed a building", f.viewed_building, "visitor-days"],
            ["Watched a building", f.watched, "accounts"],
            ["Signed up with email", f.email_signups, "accounts"],
            ["Came back on another day", f.returned, "signed-in accounts"],
          ].map(([label, n, unit], i) => (
            <li key={label as string} className="grid grid-cols-[12rem_1fr_6rem] items-center gap-3 text-sm sm:grid-cols-[16rem_1fr_8rem]">
              <span>{i + 1}. {label}</span>
              <span className="h-3 rounded-full bg-stone-200 dark:bg-stone-800">
                <span
                  className="block h-3 rounded-full bg-orange-600"
                  style={{ width: `${f.visitor_days ? Math.max(2, (Number(n) / f.visitor_days) * 100) : 0}%` }}
                />
              </span>
              <span className="text-right font-mono">
                {Number(n).toLocaleString()} <span className="text-xs text-stone-500">{unit}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Daily">
        <Table
          head={["Day", "Views", "Visitors", "Bldg views", "Searches", "No match", "Badge", "Shares", "Accounts", "Email", "Watches"]}
          rows={d.daily.map((r) => [
            fmtDay(r.day), r.page_views, r.visitors, r.building_views, r.searches, r.no_result_searches,
            r.badge_clicks, r.shares, r.new_accounts, r.new_email_accounts, r.watch_adds,
          ])}
        />
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Where visitors come from" note="First external source of each visitor-day.">
          <Table head={["Source", "Visitor-days"]} rows={d.sources.map((s) => [s.source, s.visitor_days])} />
        </Section>
        <Section title="Clicks">
          <Table
            head={["Event", "What", "Clicks", "Visitors"]}
            rows={d.clicks.map((c) => [c.name.replace("_", " "), c.what ?? "", c.clicks, c.visitors])}
          />
        </Section>
      </div>

      <Section title="Most visited buildings">
        <BuildingTable rows={d.top_viewed} />
      </Section>
      <Section title="Most watched buildings" note="3+ watchers often means neighbors organizing.">
        <BuildingTable rows={d.top_watched} />
      </Section>

      <Section
        title="People"
        note={`${d.totals.accounts} accounts (${d.totals.email_accounts} with email). Organizer = watching 3+ buildings. Emails are personal data: don't export or share.`}
      >
        <Table
          head={["Email", "Type", "Joined", "Last seen", "Views", "Buildings", "Watching", ""]}
          rows={d.people.map((p) => [
            p.email ?? <span className="text-stone-400">guest</span>,
            p.admin ? "admin" : p.guest ? "guest" : "email",
            fmtDate(p.created_at),
            p.last_seen ? fmtDate(p.last_seen, true) : "",
            p.page_views,
            p.buildings_viewed,
            p.watching,
            p.organizer ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900">organizer</span> : "",
          ])}
        />
      </Section>

      <Section
        title="Dropped values"
        note={
          dropped
            ? `${dropped.total.toLocaleString()} values Stoop discarded or replaced (${dropped.new_7d.toLocaleString()} first seen in the last 7 days). Whole rows the feed rejects are in ingest_rejects instead. Placeholder BINs are expected; new reasons are worth a look.`
            : undefined
        }
      >
        {droppedError || !dropped ? (
          <p className="text-sm text-red-700">Couldn&apos;t load dropped values: {droppedError?.message}</p>
        ) : (
          <div className="space-y-6">
            <Table
              head={["Source", "Column", "Reason", "Values", "Times seen", "New (7d)", "Last seen"]}
              rows={dropped.summary.map((s) => [
                s.source, s.column_name, s.reason, s.values, s.seen,
                s.new_7d ? <New key="n" n={s.new_7d} /> : "",
                fmtDate(s.last_seen, true),
              ])}
            />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Most recent {dropped.recent.length}</h3>
              <Table
                head={["Building", "Column", "Dropped", "Kept", "Reason", "Source", "Seen", "Last seen", ""]}
                rows={dropped.recent.map((r) => [
                  r.address ? (
                    <Link key="b" href={`/building/${r.building_id}`} className="underline">
                      {titleCase(r.address)}, {titleCase(r.borough ?? "")}
                    </Link>
                  ) : (
                    String(r.building_id)
                  ),
                  r.column_name,
                  <code key="d" className="font-mono text-xs">{r.dropped_value}</code>,
                  r.kept_value ? <code key="k" className="font-mono text-xs">{r.kept_value}</code> : <span key="k" className="text-stone-400">none</span>,
                  r.reason,
                  r.source,
                  r.times_seen,
                  fmtDate(r.last_seen, true),
                  r.is_new ? <New key="n" /> : "",
                ])}
              />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function New({ n }: { n?: number }) {
  return (
    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900">
      {n ? `${n} new` : "new"}
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-sm text-stone-600 dark:text-stone-400">{label}</div>
      <div className="mt-1 text-xs text-stone-500">{sub}</div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-xs text-stone-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="text-sm text-stone-500">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs text-stone-500 dark:bg-stone-900">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`whitespace-nowrap px-3 py-2 ${typeof c === "number" ? "text-right font-mono" : ""}`}>
                  {typeof c === "number" ? c.toLocaleString() : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuildingTable({ rows }: { rows: Building[] }) {
  return (
    <Table
      head={["Building", "Views", "Viewers", "Shares", "Watchers", "New watchers"]}
      rows={rows.map((b) => [
        <Link key={b.building_id} href={`/building/${b.building_id}`} className="underline">
          {titleCase(b.address)}, {titleCase(b.borough)}
        </Link>,
        b.views, b.viewers, b.shares, b.watchers, b.new_watchers,
      ])}
    />
  );
}
