"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ALERT_SELECT, alertTitle, type AlertRow } from "@/lib/alerts";
import { fmtDate, titleCase } from "@/lib/format";

const outline =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900";

export function UserNav() {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  if (!user) {
    return (
      <Link href="/login" className={outline}>
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link href="/me" className={outline}>
        My buildings
      </Link>
      <AlertsBell userId={user.id} />
    </div>
  );
}

function AlertsBell({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [{ count }, { data }] = await Promise.all([
      supabase.from("alerts").select("*", { count: "exact", head: true }).is("read_at", null),
      supabase.from("alerts").select(ALERT_SELECT).order("created_at", { ascending: false }).limit(8),
    ]);
    setUnread(count ?? 0);
    setAlerts((data as AlertRow[]) ?? []);
  }, [supabase]);

  // Count + list on load and on every route change (opening an alert marks it read).
  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  // Alerts are created by database triggers; Realtime (with RLS) pushes only this user's rows.
  useEffect(() => {
    const channel = supabase
      .channel(`alerts-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `user_id=eq.${userId}` }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, refresh]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  async function markAllRead() {
    setUnread(0);
    setAlerts((prev) => prev?.map((a) => (a.read_at ? a : { ...a, read_at: new Date().toISOString() })) ?? null);
    await supabase.from("alerts").update({ read_at: new Date().toISOString() }).is("read_at", null);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Alerts, ${unread} unread`}
        className={`${outline} relative w-9 justify-center px-0`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-[var(--background)]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
            <span className="text-sm font-semibold">Alerts</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-orange-700 hover:underline dark:text-orange-400">
                Mark all read
              </button>
            )}
          </div>
          {alerts === null ? (
            <p className="px-4 py-6 text-center text-sm text-stone-500">Loading…</p>
          ) : alerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-stone-500">
              No alerts yet. Watch a building to get notified about new and closed complaints.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-stone-100 overflow-y-auto dark:divide-stone-800">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/alerts/${a.id}`}
                    className={`flex gap-3 px-4 py-3 hover:bg-orange-50 dark:hover:bg-stone-800 ${a.read_at ? "" : "bg-orange-50/60 dark:bg-orange-950/30"}`}
                  >
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.read_at ? "bg-transparent" : "bg-orange-600"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{alertTitle(a)}</span>
                        <span className="shrink-0 text-xs text-stone-500">{fmtDate(a.created_at, true)}</span>
                      </span>
                      <span className="block truncate text-sm text-stone-600 dark:text-stone-400">
                        {titleCase(a.buildings?.address)} ·{" "}
                        {a.complaints
                          ? titleCase(a.complaints.problem_code ?? a.complaints.category)
                          : titleCase(a.resident_reports?.category)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/alerts"
            className="block border-t border-stone-200 px-4 py-2.5 text-center text-sm font-medium text-orange-700 hover:bg-stone-50 dark:border-stone-800 dark:text-orange-400 dark:hover:bg-stone-800"
          >
            See all alerts
          </Link>
        </div>
      )}
    </div>
  );
}
