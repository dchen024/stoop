"use client";

import { useState } from "react";
import { track } from "@/lib/analytics/client";

// Uses the phone's share sheet when there is one, otherwise copies the link.
export function ShareButton({ buildingId, title }: { buildingId: number; title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/building/${buildingId}?utm_source=share`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Housing complaints at ${title}, from NYC's official records`, url });
        track({ name: "share", props: { method: "native" }, buildingId });
      } catch {
        // dismissed
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track({ name: "share", props: { method: "copy" }, buildingId });
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <button
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-900"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M10 13V3m0 0L6 7m4-4 4 4M4 11v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
