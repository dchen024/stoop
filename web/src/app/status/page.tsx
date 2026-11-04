import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data health · Stoop" };

const SYNC_EVERY_MIN = 15;

export default async function StatusPage() {
  const supabase = await createClient();
  const [{ data: fresh }, { data: runs }, { count: complaints }, { count: buildings }, { count: missingBbl }, { count: missingBin }] =
    await Promise.all([
      supabase.from("data_freshness").select("*").single(),
      supabase
        .from("ingest_runs")
        .select("id, status, started_at, finished_at, rows_fetched, rows_upserted, rows_rejected, newest_source_update, error")
        .order("started_at", { ascending: false })
        .limit(12),
      supabase.from("complaints").select("*", { count: "exact", head: true }),
      supabase.from("buildings").select("*", { count: "exact", head: true }),
      supabase.from("buildings").select("*", { count: "exact", head: true }).is("bbl", null),
      supabase.from("buildings").select("*", { count: "exact", head: true }).is("bin", null),
    ]);

  const recent = runs ?? [];
  const lastOk = fresh?.last_successful_sync ? new Date(fresh.last_successful_sync) : null;
  const minsSinceSync = lastOk ? (Date.now() - lastOk.getTime()) / 60000 : Infinity;
  const healthy = minsSinceSync <= SYNC_EVERY_MIN * 2 + 5;
  const totals = recent.reduce(
    (t, r) => ({ fetched: t.fetched + r.rows_fetched, upserted: t.upserted + r.rows_upserted, rejected: t.rejected + r.rows_rejected }),
    { fetched: 0, upserted: 0, rejected: 0 },
  );
  const failed = recent.filter((r) => r.status === "failed").length;

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
          value={healthy ? "Healthy" : "Delayed"}
          tone={healthy ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}
          note={`Last successful sync ${timeAgo(fresh?.last_successful_sync)}. Checks every ${SYNC_EVERY_MIN} min.`}
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
        <h2 className="text-lg font-semibold">Recent syncs</h2>
        <p className="text-sm text-stone-500">
          Last {recent.length} runs: {totals.fetched.toLocaleString()} rows read, {totals.upserted.toLocaleString()} written,{" "}
          {totals.rejected.toLocaleString()} rejected, {failed} failed. Re-reading unchanged rows writes nothing.
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
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.started_at, true)}</td>
                    <td className="px-4 py-2">
                      <span
                        title={r.error ?? undefined}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.status === "succeeded"
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                            : r.status === "failed"
                              ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        }`}
                      >
                        {r.status}
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
            We record the city&apos;s publish time and our own sync time separately, so a slow city feed is never mistaken for a
            broken pipeline. A crashed sync is marked failed and the next one resumes where it left off.
          </Check>
          <Check title="Watched by Sodabase">
            10 recurring rules (valid statuses, unique IDs, coordinates in NYC, counts that add up) plus freshness and volume monitors on
            every table.
          </Check>
          <Check title="Fixed at the source">
            Sodabase flagged 99 buildings missing a BBL. The city feed omits it on some rows, so the pipeline now derives it from
            block and lot and fills BINs from HPD&apos;s building registry. Missing BBL: <strong>{missingBbl ?? 0}</strong>.
            Missing BIN: <strong>{missingBin ?? 0}</strong> (not published by the city for those buildings).
          </Check>
        </ul>
      </section>
    </div>
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
