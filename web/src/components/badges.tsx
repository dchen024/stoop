"use client";

import { track } from "@/lib/analytics/client";

// Logos are the official, unmodified files: Supabase's icon from supabase.com/brand-assets
// and Sodabase's site icon from sodabase.io (web/public/brand).
const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-500 dark:hover:bg-stone-800";

export function Badges() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <a
        href="https://supabase.com/?utm_source=stoop&utm_medium=badge"
        target="_blank"
        rel="noopener"
        onClick={() => track({ name: "badge_click", props: { badge: "supabase" } })}
        className={pill}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/supabase-icon.svg" alt="" width={14} height={14} className="h-3.5 w-3.5" />
        Built with <span className="font-semibold">Supabase</span>
      </a>
      <a
        href="https://sodabase.io/?utm_source=stoop&utm_medium=badge"
        target="_blank"
        rel="noopener"
        onClick={() => track({ name: "badge_click", props: { badge: "sodabase" } })}
        className={pill}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/sodabase-icon.svg" alt="" width={14} height={14} className="h-3.5 w-3.5" />
        Data quality monitored by <span className="font-semibold">Sodabase</span>
      </a>
    </div>
  );
}
