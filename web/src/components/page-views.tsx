"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/client";

// Records page views for navigation inside the app. The first page of a visit is a full
// load, which the middleware already records server-side, so it's skipped here.
export function PageViews() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    track({ name: "page_view" });
  }, [pathname]);
  return null;
}
