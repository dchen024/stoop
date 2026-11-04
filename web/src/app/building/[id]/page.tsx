import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildingCommunity } from "@/components/building-community";
import { createClient } from "@/lib/supabase/server";
import { OUTCOME, currentSeason, fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buildingId = Number(id);
  if (!Number.isSafeInteger(buildingId)) notFound();

  const supabase = await createClient();
  const season = currentSeason();

  const [{ data: building }, { data: stats }, { data: complaints }, { data: categoryRows }, { data: reports }] = await Promise.all([
    supabase.from("buildings").select("*").eq("building_id", buildingId).maybeSingle(),
    supabase.from("building_stats").select("*").eq("building_id", buildingId).eq("season", season).maybeSingle(),
    supabase
      .from("complaints")
      .select(
        "problem_id, complaint_id, apartment, category, subcategory, problem_code, problem_status, received_at, status_changed_at, status_descriptions(closure_reason)",
      )
      .eq("building_id", buildingId)
      .order("received_at", { ascending: false })
      .limit(500),
    supabase.from("categories").select("name").order("name"),
    supabase
      .from("resident_reports")
      .select("id, user_id, category, description, apartment, status, created_at")
      .eq("building_id", buildingId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!building) notFound();

  const rows = complaints ?? [];
  const byCategory = new Map<string, number>();
  for (const c of rows) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = categories[0]?.[1] ?? 1;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-stone-500 hover:underline">
          ← Search another building
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{titleCase(building.address)}</h1>
        <p className="text-stone-600 dark:text-stone-400">
          {titleCase(building.nta)} · {titleCase(building.borough)} {building.postcode}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card value={stats?.complaints_total ?? 0} label="complaints this season" />
        <Card value={stats?.heat_days ?? 0} label="days without heat reported" accent />
        <Card value={stats?.complaints_open ?? 0} label="still open" />
        <Card value={stats?.no_access_closures ?? 0} label="closed, inspector couldn't get in" />
      </section>

      <BuildingCommunity
        buildingId={buildingId}
        categories={(categoryRows ?? []).map((c) => c.name)}
        initialReports={reports ?? []}
      />

      {categories.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What people are reporting</h2>
          <ul className="space-y-2">
            {categories.map(([cat, n]) => (
              <li key={cat} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_3rem]">
                <span className="truncate">{titleCase(cat)}</span>
                <span className="h-2.5 rounded-full bg-stone-200 dark:bg-stone-800">
                  <span
                    className={`block h-2.5 rounded-full ${cat === "HEAT/HOT WATER" ? "bg-orange-600" : "bg-stone-500"}`}
                    style={{ width: `${Math.max(4, (n / maxCat) * 100)}%` }}
                  />
                </span>
                <span className="text-right font-mono">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Complaint history</h2>
        {rows.length === 0 ? (
          <p className="text-stone-500">No official complaints on file this season.</p>
        ) : (
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {rows.slice(0, 100).map((c) => {
              const outcome = OUTCOME[c.status_descriptions?.closure_reason ?? (c.problem_status === "OPEN" ? "still_open" : "other")];
              return (
                <li key={c.problem_id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {titleCase(c.problem_code ?? c.category)}
                      {c.subcategory && <span className="text-stone-500"> · {titleCase(c.subcategory)}</span>}
                    </div>
                    <div className="text-sm text-stone-500">
                      {fmtDate(c.received_at, true)}
                      {c.apartment && ` · Apt ${c.apartment}`} · {titleCase(c.category)}
                    </div>
                  </div>
                  <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${outcome.tone}`}>
                    {outcome.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className={`text-2xl font-bold sm:text-3xl ${accent ? "text-orange-700 dark:text-orange-400" : ""}`}>{value}</div>
      <div className="text-sm leading-snug text-stone-500">{label}</div>
    </div>
  );
}
