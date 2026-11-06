import Link from "next/link";
import { BuildingSearch } from "@/components/building-search";
import { ComplaintMap } from "@/components/complaint-map";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/categories";
import { currentSeason, fmtDate, SOURCE_STATE, timeAgo, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string; open?: string; sort?: string }>;

const SORTS = [
  { key: "complaints", label: "Most complaints" },
  { key: "open", label: "Most open" },
  { key: "days", label: "Most days" },
] as const;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const season = currentSeason();

  const { data: summary } = await supabase.rpc("category_summary");
  const cats = summary ?? [];
  const selected = cats.find((c) => c.category === sp.c)?.category ?? null;
  const openOnly = sp.open !== "0";
  const sort = SORTS.find((x) => x.key === sp.sort)?.key ?? "complaints";

  const [top, points, freshness, feed] = await Promise.all([
    supabase.rpc("top_buildings", { p_category: selected ?? undefined, p_limit: 10, p_sort: sort }),
    supabase.rpc("map_buildings", { p_category: selected ?? undefined, p_open_only: openOnly, p_limit: 3000 }),
    supabase.from("data_freshness").select("*").single(),
    supabase.from("source_status").select("state").eq("source", "hpd_complaints").maybeSingle(),
  ]);
  const feedState = feed.data?.state ?? "healthy";

  const row = selected ? cats.find((c) => c.category === selected) : null;
  const totals = row ?? {
    complaints: cats.reduce((n, c) => n + c.complaints, 0),
    open_complaints: cats.reduce((n, c) => n + c.open_complaints, 0),
    buildings: null as number | null,
  };
  const maxCat = Math.max(1, ...cats.map((c) => c.complaints));
  const label = categoryLabel(selected);
  const href = (c: string | null, open = openOnly, s: string = sort) => {
    const q = new URLSearchParams();
    if (c) q.set("c", c);
    if (!open) q.set("open", "0");
    if (s !== "complaints") q.set("sort", s);
    const qs = q.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Know what&apos;s going on in your building.</h1>
        <p className="max-w-2xl text-stone-600 dark:text-stone-400">
          Every official housing complaint New Yorkers file with the city, plus reports from your neighbors. Look up
          where you live, or where you&apos;re about to sign a lease.
        </p>
        <BuildingSearch />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Explore the city this season</h2>
          <p className="text-sm text-stone-500">Since Oct 1, {season}. Pick an issue to filter everything below.</p>
        </div>
        <nav aria-label="Filter by issue" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip href={href(null)} active={!selected}>
            All issues
          </Chip>
          {cats.map((c) => (
            <Chip key={c.category} href={href(c.category)} active={selected === c.category}>
              {categoryLabel(c.category)}
              <span className="ml-1.5 text-xs opacity-70">{c.complaints.toLocaleString()}</span>
            </Chip>
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={`${label}: complaints`} value={totals.complaints} />
          <Stat label="Still open right now" value={totals.open_complaints} accent />
          <Stat
            label={totals.buildings === null ? "Issue categories tracked" : "Buildings affected"}
            value={totals.buildings ?? cats.length}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">
            Map: {label}
            <span className="ml-2 text-sm font-normal text-stone-500">{(points.data ?? []).length >= 3000 ? "top 3,000" : (points.data ?? []).length.toLocaleString()} buildings</span>
          </h2>
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm dark:border-stone-700">
            <Link scroll={false} href={href(selected, true)} className={`px-3 py-1.5 ${openOnly ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : ""}`}>
              Open now
            </Link>
            <Link scroll={false} href={href(selected, false)} className={`px-3 py-1.5 ${!openOnly ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : ""}`}>
              All season
            </Link>
          </div>
        </div>
        <ComplaintMap points={points.data ?? []} category={selected} />
        <p className="text-xs text-stone-500">
          Circle size = complaints this season. Red = has open complaints. Tap a circle to open the building.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Most-reported buildings: {label}</h2>
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm dark:border-stone-700">
            {SORTS.map((x) => (
              <Link
                key={x.key}
                scroll={false}
                href={href(selected, openOnly, x.key)}
                className={`px-3 py-1.5 ${sort === x.key ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : ""}`}
              >
                {x.label}
              </Link>
            ))}
          </div>
        </div>
        <ol className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {(top.data ?? []).map((b, i) => (
            <li key={b.building_id}>
              <Link href={`/building/${b.building_id}${selected ? `?c=${encodeURIComponent(selected)}` : ""}`} className="flex items-center gap-3 px-4 py-3 hover:bg-orange-50 dark:hover:bg-stone-800">
                <span className="w-6 shrink-0 text-right font-mono text-sm text-stone-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{titleCase(b.address)}</span>
                  <span className="block truncate text-sm text-stone-500">
                    {titleCase(b.nta)} · {titleCase(b.borough)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-lg font-bold text-orange-700 dark:text-orange-400">
                    {sort === "open" ? b.open_complaints : sort === "days" ? b.complaint_days : b.complaints}
                  </span>
                  <span className="text-sm text-stone-500">{sort === "open" ? " open" : sort === "days" ? " days" : " complaints"}</span>
                  <span className="block text-xs text-stone-500">
                    {[
                      sort !== "complaints" && `${b.complaints} complaints`,
                      sort !== "open" && `${b.open_complaints} open`,
                      sort !== "days" && `${b.complaint_days} days`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {!selected && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What New Yorkers are reporting</h2>
          <ul className="space-y-2">
            {cats.map((c) => (
              <li key={c.category}>
                <Link
                  href={href(c.category)}
                  className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-orange-50 sm:grid-cols-[15rem_1fr_6rem] dark:hover:bg-stone-900"
                >
                  <span className="truncate">{categoryLabel(c.category)}</span>
                  <span className="h-2.5 rounded-full bg-stone-200 dark:bg-stone-800">
                    <span className="block h-2.5 rounded-full bg-orange-600" style={{ width: `${Math.max(2, (c.complaints / maxCat) * 100)}%` }} />
                  </span>
                  <span className="text-right font-mono">
                    {c.complaints.toLocaleString()}
                    <span className="block text-xs text-red-700 dark:text-red-400">{c.open_complaints.toLocaleString()} open</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-stone-500">
        {feedState !== "healthy" && (
          <Link href="/status" className={`mr-2 rounded-full px-2 py-0.5 font-medium ${SOURCE_STATE[feedState]?.tone ?? ""}`}>
            City feed: {SOURCE_STATE[feedState]?.label ?? feedState}
          </Link>
        )}
        Synced {timeAgo(freshness.data?.last_successful_sync)} · city data as of {fmtDate(freshness.data?.city_last_updated, true)} ·
        newest complaint {fmtDate(freshness.data?.newest_complaint, true)}
      </p>
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

function Stat({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className={`text-3xl font-bold ${accent ? "text-red-700 dark:text-red-400" : ""}`}>{(value ?? 0).toLocaleString()}</div>
      <div className="text-sm text-stone-500">{label}</div>
    </div>
  );
}
