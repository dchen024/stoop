"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDate, titleCase } from "@/lib/format";
import { ALERT_SELECT as SELECT, KIND_LABEL, type AlertRow } from "@/lib/alerts";


export function AlertList({ userId, initial }: { userId: string; initial: AlertRow[] }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertRow[]>(initial);
  const unread = alerts.filter((a) => !a.read_at).length;

  // New alerts stream in live (created by DB triggers, delivered by Realtime under RLS).
  useEffect(() => {
    const channel = supabase
      .channel(`alert-list-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts", filter: `user_id=eq.${userId}` },
        async (payload) => {
          const { data } = await supabase.from("alerts").select(SELECT).eq("id", (payload.new as { id: number }).id).single();
          if (data) setAlerts((prev) => (prev.some((a) => a.id === data.id) ? prev : [data as AlertRow, ...prev]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  async function markRead(ids: number[]) {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setAlerts((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, read_at: now } : a)));
    // Users can only update read_at (column grant) and only on their own rows (RLS).
    await supabase.from("alerts").update({ read_at: now }).in("id", ids);
    router.refresh();
  }

  if (alerts.length === 0) {
    return (
      <p className="text-stone-500">
        No alerts yet. Watch a building and you&apos;ll see new complaints and neighbor reports here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-stone-500">{unread} unread</span>
        {unread > 0 && (
          <button
            onClick={() => markRead(alerts.filter((a) => !a.read_at).map((a) => a.id))}
            className="rounded-xl border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-900"
          >
            Mark all read
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li
            key={a.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
              a.read_at
                ? "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
                : "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40"
            }`}
          >
            <span
              aria-hidden
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${a.read_at ? "bg-transparent" : "bg-orange-600"}`}
            />
            <Link href={`/alerts/${a.id}`} className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{KIND_LABEL[a.kind]}</span>
                <span className="shrink-0 text-stone-500">{fmtDate(a.created_at, true)}</span>
              </div>
              <div className="text-sm">
                {titleCase(a.buildings?.address)}:{" "}
                {a.complaints
                  ? titleCase(a.complaints.problem_code ?? a.complaints.category)
                  : `${titleCase(a.resident_reports?.category)}, “${a.resident_reports?.description ?? ""}”`}
              </div>
            </Link>
            {!a.read_at && (
              <button
                onClick={() => markRead([a.id])}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-stone-600 hover:bg-orange-100 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
