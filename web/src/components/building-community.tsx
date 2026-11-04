"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import type { Database } from "@/lib/database.types";

type Report = Pick<
  Database["public"]["Tables"]["resident_reports"]["Row"],
  "id" | "user_id" | "category" | "description" | "apartment" | "status" | "created_at"
>;

export function BuildingCommunity({
  buildingId,
  categories,
  initialReports,
  selectedCategory = null,
}: {
  buildingId: number;
  categories: string[];
  initialReports: Report[];
  selectedCategory?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [watching, setWatching] = useState(false);
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loginHref = `/login?next=${encodeURIComponent(`/building/${buildingId}${selectedCategory ? `?c=${selectedCategory}` : ""}`)}`;
  const shown = selectedCategory ? reports.filter((r) => r.category === selectedCategory) : reports;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      if (data.user) {
        const { count } = await supabase
          .from("watchlist")
          .select("*", { count: "exact", head: true })
          .eq("building_id", buildingId);
        setWatching((count ?? 0) > 0);
      }
    });
  }, [supabase, buildingId]);

  // New resident reports for this building appear live (Realtime, RLS-filtered).
  useEffect(() => {
    const channel = supabase
      .channel(`reports-${buildingId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "resident_reports", filter: `building_id=eq.${buildingId}` },
        (payload) => {
          const r = payload.new as Report;
          setReports((prev) => (prev.some((p) => p.id === r.id) ? prev : [r, ...prev]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, buildingId]);

  async function toggleWatch() {
    if (!user) return;
    setBusy(true);
    const { error } = watching
      ? await supabase.from("watchlist").delete().eq("building_id", buildingId)
      : await supabase.from("watchlist").insert({ building_id: buildingId });
    if (!error) setWatching(!watching);
    setBusy(false);
  }

  async function submitReport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const { data, error } = await supabase
      .from("resident_reports")
      .insert({
        building_id: buildingId,
        category: String(form.get("category")),
        description: String(form.get("description")).trim(),
        apartment: String(form.get("apartment") || "").trim() || null,
      })
      .select("id, user_id, category, description, apartment, status, created_at")
      .single();
    setBusy(false);
    if (error) {
      setError(error.message.includes("description") ? "Add a little more detail (at least 10 characters)." : error.message);
      return;
    }
    setReports((prev) => (prev.some((p) => p.id === data.id) ? prev : [data, ...prev]));
    setShowForm(false);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">From residents</h2>
        <div className="flex gap-2">
          {user ? (
            <>
              <button
                onClick={toggleWatch}
                disabled={busy}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold sm:flex-none ${
                  watching
                    ? "border border-orange-700 text-orange-800 dark:text-orange-300"
                    : "bg-orange-700 text-white hover:bg-orange-800"
                }`}
              >
                {watching ? "Watching ✓" : "Watch this building"}
              </button>
              <button
                onClick={() => setShowForm((s) => !s)}
                className="flex-1 rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 sm:flex-none dark:border-stone-700 dark:hover:bg-stone-900"
              >
                Report a problem
              </button>
            </>
          ) : (
            <Link
              href={loginHref}
              className="w-full rounded-xl bg-orange-700 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-orange-800 sm:w-auto"
            >
              Watch or report a problem
            </Link>
          )}
        </div>
      </div>

      {showForm && user && (
        <form
          onSubmit={submitReport}
          className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
            <label className="block text-sm">
              <span className="font-medium">What&apos;s wrong?</span>
              <select
                name="category"
                required
                defaultValue={selectedCategory ?? "HEAT/HOT WATER"}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-950"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Apt (optional)</span>
              <input
                name="apartment"
                maxLength={20}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-950"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium">Details</span>
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              placeholder="e.g. No heat on floors 3–5 since Monday night"
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-950"
            />
          </label>
          <p className="text-xs text-stone-500">
            Shown publicly as an unverified resident report. To get an inspector out, also file with{" "}
            <a className="underline" href="https://portal.311.nyc.gov/" target="_blank" rel="noreferrer">
              311
            </a>
            .
          </p>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
          >
            Post report
          </button>
        </form>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-stone-500">No resident reports yet. Neighbors who watch this building get alerted when you post one.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3 dark:border-stone-700 dark:bg-stone-900"
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{categoryLabel(r.category)}</span>
                <span className="text-stone-500">
                  {fmtDate(r.created_at, true)}
                  {r.apartment && ` · Apt ${r.apartment}`}
                </span>
              </div>
              <p className="mt-1">{r.description}</p>
              <p className="mt-1 text-xs text-stone-500">
                Resident report, unverified{r.user_id === user?.id && " · yours"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
