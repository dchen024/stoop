import type { Database } from "@/lib/database.types";

type ClosureReason = Database["public"]["Enums"]["closure_reason"];

/** Heat season N runs Oct 1, N through May 31, N+1 (keyed by its start year, NY time). */
export function currentSeason(now = new Date()): number {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return ny.getMonth() >= 9 ? ny.getFullYear() : ny.getFullYear() - 1;
}

export const OUTCOME: Record<ClosureReason, { label: string; tone: string }> = {
  still_open: { label: "Still open", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  violation_issued: { label: "Violation issued", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  reported_fixed: { label: "Closed: reported fixed", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  no_access: { label: "Closed: inspector couldn't get in", tone: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200" },
  no_violation: { label: "Closed: no violation found", tone: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200" },
  other: { label: "Closed", tone: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200" },
};

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\/(\w)/g, (_, c) => "/" + c.toUpperCase());
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}
