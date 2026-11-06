import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, RUN_STATUS, SOURCE_STATE, timeAgo } from "@/lib/format";
import type { Database } from "@/lib/database.types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data health · Stoop" };

const SYNC_EVERY_MIN = 15;
const TABLE_ROWS = 12;

type Source = Database["public"]["Views"]["source_status"]["Row"];

export default async function StatusPage() {
  const supabase = await createClient();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: fresh }, { data: sources }, { data: runs }, { count: complaints }, { count: buildings }, { count: missingBbl }, { count: missingBin }] =
    await Promise.all([
      supabase.from("data_freshness").select("*").single(),
      supabase.from("source_status").select("*"),
      supabase
        .from("ingest_runs")
        .select("id, status, started_at, finished_at, rows_fetched, rows_upserted, rows_rejected, rows_remaining, error")
        .gte("started_at", dayAgo)
        .order("started_at", { ascending: false })
        .limit(200),
      supabase.from("complaints").select("*", { count: "exact", head: true }),
      supabase.from("buildings").select("*", { count: "exact", head: true }),
      supabase.from("buildings").select("*", { count: "exact", head: true }).is("bbl", null),
      supabase.from("buildings").select("*", { count: "exact", head: true }).is("bin", null),
    ]);

  const day = runs ?? [];
  const recent = day.slice(0, TABLE_ROWS);
  const complaintsSource = sources?.find((s) => s.source === "hpd_complaints");
  const pipeline = SOURCE_STATE[complaintsSource?.state ?? "stalled"] ?? SOURCE_STATE.stalled;
  const totals = day.reduce(
    (t, r) => ({ fetched: t.fetched + r.rows_fetched, upserted: t.upserted + r.rows_upserted, rejected: t.rejected + r.rows_rejected }),
    { fetched: 0, upserted: 0, rejected: 0 },
  );
  const byStatus = (s: string) => day.filter((r) => r.status === s).length;
  const outcomes = [
    [byStatus("succeeded"), "caught up"],
    [byStatus("partial"), "partial"],
    [byStatus("upstream_down"), "city API down"],
    [byStatus("failed"), "failed"],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Data health</h1>
        <p className="mt-1 max-w-2xl text-stone-600 dark:text-stone-400">
          Stoop mirrors NYC HPD&apos;s housing complaint data. Here is how fresh it is, what the pipeline has done recently,
          and the checks that keep bad data out.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Pipeline"
          value={pipeline.label}
          tone={
            complaintsSource?.state === "healthy"
              ? "text-emerald-700 dark:text-emerald-400"
              : complaintsSource?.state === "catching_up" || complaintsSource?.state === "upstream_down"
                ? "text-amber-700 dark:text-amber-400"
                : "text-red-700 dark:text-red-400"
          }
          note={`Last caught up ${timeAgo(fresh?.last_successful_sync)}. Checks every ${SYNC_EVERY_MIN} min.`}
        />
        <Tile
          label="City data as of"
          value={fmtDate(fresh?.city_last_updated, true)}
          note="HPD republishes once a day. Between publishes there is nothing new to fetch."
        />
        <Tile
          label="Records"
          value={`${(complaints ?? 0).toLocaleString()}`}
          note={`complaints across ${(buildings ?? 0).toLocaleString()} buildings this heat season`}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Data sources</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(sources ?? []).map((s) => (
            <SourceCard key={s.source} s={s} />
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent syncs</h2>
        <p className="text-sm text-stone-500">
          Last 24 hours: {day.length} runs{outcomes ? ` (${outcomes})` : ""}. {totals.fetched.toLocaleString()} rows read,{" "}
          {totals.upserted.toLocaleString()} written, {totals.rejected.toLocaleString()} rejected. Re-reading unchanged rows writes
          nothing, and a run that runs out of time saves its place for the next one.
        </p>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="border-b border-stone-200 text-stone-500 dark:border-stone-800">
              <tr>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 text-right font-medium">Read</th>
                <th className="px-4 py-2 text-right font-medium">Written</th>
                <th className="px-4 py-2 text-right font-medium">Rejected</th>
                <th className="px-4 py-2 text-right font-medium">Took</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {recent.map((r) => {
                const secs = r.finished_at ? Math.max(0, (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : null;
                const st = RUN_STATUS[r.status] ?? RUN_STATUS.failed;
                const title = r.error ?? (r.status === "partial" && r.rows_remaining != null ? `${r.rows_remaining.toLocaleString()} rows left for the next run` : undefined);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.started_at, true)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span title={title} className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{r.rows_fetched.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.rows_upserted.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.rows_rejected.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{secs === null ? "–" : secs < 60 ? `${secs.toFixed(1)}s` : `${(secs / 60).toFixed(1)}m`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How bad data is kept out</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Check title="Validated before it lands">
            Every row is checked in one database transaction: IDs numeric, borough real, required fields present. Rows that fail go to a
            private quarantine table with the reason, never into the app.
          </Check>
          <Check title="Constraints the database enforces">
            BBL and BIN formats, coordinates inside NYC, open ≤ total, a closed report must have a resolved date. Bad values are
            impossible to store, not just unlikely.
          </Check>
          <Check title="No duplicates, no going backwards">
            Each complaint is keyed by HPD&apos;s problem ID. An older city update can never overwrite a newer one, so re-running a sync
            is always safe.
          </Check>
          <Check title="Freshness you can see">
            We record the city&apos;s publish time and our own sync time separately, and an outage of the city&apos;s API is shown
            as one, not as a broken pipeline. Every page of a sync saves its place in the same transaction as its rows, so an
            interrupted sync resumes exactly where it stopped.
          </Check>
          <Check title="Watched by Sodabase">
            10 recurring rules (valid statuses, unique IDs, coordinates in NYC, counts that add up) plus freshness and volume monitors on
            every table.
          </Check>
          <Check title="Fixed at the source">
            Sodabase flagged buildings missing a BBL and a BIN. The city feed omits them on some rows, so the pipeline derives
            BBL from block and lot, treats the city&apos;s placeholder BINs (1000000, 2000000, …) as missing, and fills real BINs
            from HPD&apos;s building registry. Missing BBL: <strong>{missingBbl ?? 0}</strong>. Missing BIN:{" "}
            <strong>{missingBin ?? 0}</strong> (not published by the city for those buildings).
          </Check>
        </ul>
      </section>
    </div>
  );
}

function SourceCard({ s }: { s: Source }) {
  const st = SOURCE_STATE[s.state ?? "stalled"] ?? SOURCE_STATE.stalled;
  const streak = s.streak_runs && s.streak_runs > 1 ? `${s.streak_runs} runs in a row since ${fmtDate(s.streak_since, true)}` : null;
  let detail: string;
  if (s.source === "hpd_registry") {
    detail =
      s.state === "idle"
        ? "Fills BIN and BBL the complaint feed leaves out. Not called yet: no buildings are missing them."
        : s.state === "upstream_down"
          ? `Fills BIN and BBL the complaint feed leaves out. The last lookup failed ${timeAgo(s.last_run_at)}; it is retried every sync and never blocks it.`
          : `Fills BIN and BBL the complaint feed leaves out. Last lookup worked ${timeAgo(s.last_contact_at)}.`;
  } else {
    switch (s.state) {
      case "healthy":
        detail = `Up to date as of ${timeAgo(s.last_run_at)}.`;
        break;
      case "catching_up":
        detail = `Working through a new city batch${s.rows_remaining != null ? `: about ${s.rows_remaining.toLocaleString()} rows left` : ""}. Each sync continues where the last one stopped.`;
        break;
      case "upstream_down":
        detail = `NYC Open Data is not answering${streak ? ` (${streak})` : ""}. What we already have is intact; syncing resumes on its own when the city is back.`;
        break;
      case "failing":
        detail = `Our sync is erroring${streak ? ` (${streak})` : ""}. The city's API is answering, so this needs a fix on our side.`;
        break;
      default:
        detail = `No sync has finished since ${fmtDate(s.last_run_at, true)}. The scheduler or the sync function may be down.`;
    }
  }
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{s.label}</div>
          <div className="font-mono text-xs text-stone-500">{s.endpoint}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>{st.label}</span>
      </div>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{detail}</p>
      {s.source === "hpd_complaints" && (
        <p className="mt-1 text-sm text-stone-500">
          Synced through the city&apos;s {fmtDate(s.synced_through, true)} update · last successful contact {timeAgo(s.last_contact_at)}
        </p>
      )}
      {s.state !== "healthy" && s.last_error && (
        <p className="mt-2 break-words rounded-md bg-stone-100 px-2 py-1 font-mono text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {s.last_error}
        </p>
      )}
    </li>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</div>
      <div className="mt-1 text-sm text-stone-500">{note}</div>
    </div>
  );
}

function Check({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center gap-2 font-semibold">
        <span aria-hidden className="text-emerald-600">✓</span> {title}
      </div>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{children}</p>
    </li>
  );
}
