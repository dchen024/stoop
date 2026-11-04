import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentSeason, titleCase } from "@/lib/format";
import { MeActions } from "@/components/me-actions";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/me");

  const season = currentSeason();
  const [{ data: watching }] = await Promise.all([
    supabase
      .from("watchlist")
      .select("building_id, relationship, created_at, buildings(address, borough, nta, building_stats(season, complaints_total, complaints_open, heat_days))")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My buildings</h1>
          <p className="text-sm text-stone-500">
            {user.is_anonymous ? (
              <>
                Signed in as a guest.{" "}
                <Link href="/login?next=/me" className="underline">
                  Add your email
                </Link>{" "}
                to keep your list.
              </>
            ) : (
              <>Signed in as {user.email}</>
            )}
          </p>
        </div>
        <MeActions />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Watching</h2>
        {(watching ?? []).length === 0 ? (
          <p className="text-stone-500">
            Not watching anything yet. <Link href="/" className="underline">Search for your building</Link> and tap
            &ldquo;Watch this building&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {(watching ?? []).map((w) => {
              const s = w.buildings?.building_stats?.find((x) => x.season === season);
              return (
                <li key={w.building_id}>
                  <Link href={`/building/${w.building_id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-orange-50 dark:hover:bg-stone-800">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{titleCase(w.buildings?.address)}</span>
                      <span className="block truncate text-sm text-stone-500">
                        {titleCase(w.buildings?.nta)} · {titleCase(w.buildings?.borough)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <span className="font-semibold">{s?.complaints_total ?? 0}</span> this season
                      {(s?.complaints_open ?? 0) > 0 && <span className="block text-red-700 dark:text-red-400">{s?.complaints_open} open</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </div>
  );
}
