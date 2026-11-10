"use client";

import { track } from "@/lib/analytics/client";

const pill =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors";

export function Badges() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <a
        href="https://supabase.com/?utm_source=stoop&utm_medium=badge"
        target="_blank"
        rel="noopener"
        onClick={() => track({ name: "badge_click", props: { badge: "supabase" } })}
        className={`${pill} border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Built with Supabase
      </a>
      <a
        href="https://sodabase.io/?utm_source=stoop&utm_medium=badge"
        target="_blank"
        rel="noopener"
        onClick={() => track({ name: "badge_click", props: { badge: "sodabase" } })}
        className={`${pill} border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200`}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        Data quality monitored by Sodabase
      </a>
    </div>
  );
}
