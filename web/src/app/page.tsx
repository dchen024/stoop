import Link from "next/link";
import { BuildingSearch } from "@/components/building-search";
import { createClient } from "@/lib/supabase/server";
import { currentSeason, fmtDate, timeAgo, titleCase } from "@/lib/format";

export const revalidate = 300;

export default async function Home() {
  const supabase = await createClient();
  const season = currentSeason();

  const [total, open, heat, coldest, freshness] = await Promise.all([
    supabase.from("complaints").select("*", { count: "exact", head: true }).eq("season", season),
    supabase.from("complaints").select("*", { count: "exact", head: true }).eq("season", season).eq("problem_status", "OPEN"),
    supabase.from("complaints").select("*", { count: "exact", head: true }).eq("season", season).eq("category", "HEAT/HOT WATER"),
    supabase
      .from("building_stats")
      .select("building_id, heat_days, heat_complaints, complaints_open, buildings(address, borough, nta)")
      .eq("season", season)
      .order("heat_days", { ascending: false })
      .order("heat_complaints", { ascending: false })
      .limit(10),
    supabase.from("data_freshness").select("*").single(),
  ]);

  const seasonDays = Math.max(1, Math.floor((Date.now() - new Date(`${season}-10-01T04:00:00Z`).getTime()) / 86400000));

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Know what&apos;s going on in your building.</h1>
        <p className="max-w-2xl text-stone-600 dark:text-stone-400">
          Every official housing complaint New Yorkers file with the city (no heat, leaks, pests, broken locks), plus
          reports from your neighbors. Look up where you live, or where you&apos;re about to sign a lease.
        </p>
        <BuildingSearch />
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Complaints this heat season" value={total.count} />
        <Stat label="No heat / hot water" value={heat.count} accent />
        <Stat label="Still open right now" value={open.count} />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Coldest buildings this season</h2>
          <span className="text-sm text-stone-500">days with a heat complaint, of {seasonDays}</span>
        </div>
        <ol className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {(coldest.data ?? []).map((row, i) => (
            <li key={row.building_id}>
              <Link
                href={`/building/${row.building_id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-orange-50 dark:hover:bg-stone-800"
              >
                <span className="w-6 shrink-0 text-right font-mono text-sm text-stone-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{titleCase(row.buildings?.address)}</span>
                  <span className="block truncate text-sm text-stone-500">
                    {titleCase(row.buildings?.nta)} · {titleCase(row.buildings?.borough)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-lg font-bold text-orange-700 dark:text-orange-400">{row.heat_days}</span>
                  <span className="text-sm text-stone-500"> days</span>
                  <span className="block text-xs text-stone-500">{row.heat_complaints} complaints</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-stone-500">
        Synced {timeAgo(freshness.data?.last_successful_sync)} · city data as of{" "}
        {fmtDate(freshness.data?.city_last_updated, true)} · newest complaint {fmtDate(freshness.data?.newest_complaint, true)}
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className={`text-3xl font-bold ${accent ? "text-orange-700 dark:text-orange-400" : ""}`}>
        {(value ?? 0).toLocaleString()}
      </div>
      <div className="text-sm text-stone-500">{label}</div>
    </div>
  );
}
