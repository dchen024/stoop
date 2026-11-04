import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildingCommunity } from "@/components/building-community";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/categories";
import { OUTCOME, currentSeason, fmtDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ c?: string }>;

export default async function BuildingPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const buildingId = Number(id);
  if (!Number.isSafeInteger(buildingId)) notFound();

  const supabase = await createClient();
  const season = currentSeason();

  const [{ data: building }, { data: complaints }, { data: categoryRows }, { data: reports }] = await Promise.all([
    supabase.from("buildings").select("*").eq("building_id", buildingId).maybeSingle(),
    supabase
      .from("complaints")
      .select(
        "problem_id, complaint_id, apartment, category, subcategory, problem_code, problem_status, received_at, status_changed_at, season, status_descriptions(closure_reason)",
      )
      .eq("building_id", buildingId)
      .eq("season", season)
      .order("received_at", { ascending: false })
      .limit(1000),
    supabase.from("categories").select("name").order("name"),
    supabase
      .from("resident_reports")
      .select("id, user_id, category, description, apartment, status, created_at")
      .eq("building_id", buildingId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (!building) notFound();

  const all = complaints ?? [];
  const byCategory = new Map<string, number>();
  for (const c of all) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = categories[0]?.[1] ?? 1;

  // The issue the user arrived with (from the home page filter or map), if this building has any.
  const knownCategory = (categoryRows ?? []).some((c) => c.name === sp.c) ? sp.c! : null;
  const selected = knownCategory;
  const rows = selected ? all.filter((c) => c.category === selected) : all;

  const nyDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const days = new Set(rows.map((c) => nyDay(c.received_at))).size;
  const open = rows.filter((c) => c.problem_status === "OPEN").length;
  const noAccess = rows.filter((c) => c.status_descriptions?.closure_reason === "no_access").length;
  const isHeat = selected === "HEAT/HOT WATER";

  const href = (c: string | null) => `/building/${buildingId}${c ? `?c=${encodeURIComponent(c)}` : ""}`;
  const backHref = selected ? `/?c=${encodeURIComponent(selected)}` : "/";

  return (
    <div className="space-y-8">
      <div>
        <Link href={backHref} className="text-sm text-stone-500 hover:underline">
          ← {selected ? `Back to ${categoryLabel(selected).toLowerCase()} across NYC` : "Search another building"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{titleCase(building.address)}</h1>
        <p className="text-stone-600 dark:text-stone-400">
          {titleCase(building.nta)} · {titleCase(building.borough)} {building.postcode}
        </p>
      </div>

      <nav aria-label="Filter by issue" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip href={href(null)} active={!selected}>
          All issues <span className="ml-1.5 text-xs opacity-70">{all.length}</span>
        </Chip>
        {categories.map(([cat, n]) => (
          <Chip key={cat} href={href(cat)} active={selected === cat}>
            {categoryLabel(cat)} <span className="ml-1.5 text-xs opacity-70">{n}</span>
          </Chip>
        ))}
        {selected && !byCategory.has(selected) && (
          <Chip href={href(selected)} active>
            {categoryLabel(selected)} <span className="ml-1.5 text-xs opacity-70">0</span>
          </Chip>
        )}
      </nav>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card value={rows.length} label={selected ? `${categoryLabel(selected)} complaints this season` : "complaints this season"} />
        <Card value={days} label={isHeat ? "days without heat reported" : "days with a complaint"} accent />
        <Card value={open} label="still open" />
        <Card value={noAccess} label="closed, inspector couldn't get in" />
      </section>

      <BuildingCommunity
        buildingId={buildingId}
        categories={(categoryRows ?? []).map((c) => c.name)}
        initialReports={reports ?? []}
        selectedCategory={selected}
      />

      {!selected && categories.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What people are reporting</h2>
          <ul className="space-y-1">
            {categories.map(([cat, n]) => (
              <li key={cat}>
                <Link
                  href={href(cat)}
                  scroll={false}
                  className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-orange-50 sm:grid-cols-[14rem_1fr_3rem] dark:hover:bg-stone-900"
                >
                  <span className="truncate">{categoryLabel(cat)}</span>
                  <span className="h-2.5 rounded-full bg-stone-200 dark:bg-stone-800">
                    <span
                      className={`block h-2.5 rounded-full ${cat === "HEAT/HOT WATER" ? "bg-orange-600" : "bg-stone-500"}`}
                      style={{ width: `${Math.max(4, (n / maxCat) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono">{n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Complaint history{selected && <span className="font-normal text-stone-500">: {categoryLabel(selected)}</span>}
        </h2>
        {rows.length === 0 ? (
          <p className="text-stone-500">
            No {selected ? `${categoryLabel(selected).toLowerCase()} ` : ""}complaints on file this season.
            {selected && (
              <>
                {" "}
                <Link href={href(null)} scroll={false} className="underline">
                  See all issues
                </Link>
              </>
            )}
          </p>
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
                      {c.apartment && c.apartment !== "BLDG" && ` · Apt ${c.apartment}`}
                      {!selected && ` · ${categoryLabel(c.category)}`}
                    </div>
                  </div>
                  <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${outcome.tone}`}>{outcome.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 100 && <p className="text-xs text-stone-500">Showing the latest 100 of {rows.length}.</p>}
      </section>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium ${
        active
          ? "border-orange-700 bg-orange-700 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-orange-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
      }`}
    >
      {children}
    </Link>
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
