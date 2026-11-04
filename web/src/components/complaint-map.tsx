"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "@/components/complaint-map-inner";

// Leaflet touches `window`, so the map only renders in the browser.
const Inner = dynamic(() => import("@/components/complaint-map-inner"), {
  ssr: false,
  loading: () => <div className="h-[360px] w-full animate-pulse bg-stone-200 sm:h-[460px] dark:bg-stone-800" />,
});

export function ComplaintMap({ points, category = null }: { points: MapPoint[]; category?: string | null }) {
  // `isolate` keeps Leaflet's z-indexed panes below the header's alerts dropdown.
  return (
    <div className="isolate overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
      <Inner points={points} category={category} />
    </div>
  );
}
