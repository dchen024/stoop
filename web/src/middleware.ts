import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { buildingIdFromPath, externalReferrerHost, recordEvent } from "@/lib/analytics/server";

// Refresh the Supabase session cookie on every request so Server Components see a valid user,
// and record page views server-side (so ad blockers don't hide them).
export async function middleware(request: NextRequest, event: NextFetchEvent) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();

  if (isPageView(request)) {
    const path = request.nextUrl.pathname;
    const q = request.nextUrl.searchParams;
    event.waitUntil(
      recordEvent(
        request.headers,
        {
          name: "page_view",
          path,
          buildingId: buildingIdFromPath(path),
          userId: data.user?.id ?? null,
          utm: { source: q.get("utm_source"), medium: q.get("utm_medium"), campaign: q.get("utm_campaign") },
        },
        externalReferrerHost(request.headers, request.nextUrl.hostname),
      ),
    );
  }
  return response;
}

// A full page load (not a prefetch, API call or auth redirect). Navigation inside the
// app is recorded by <PageViews /> in the browser, since Next.js may serve it from prefetched data.
function isPageView(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/admin") || path.startsWith("/monitoring")) {
    return false;
  }
  const h = request.headers;
  const prefetch =
    h.has("next-router-prefetch") ||
    h.get("purpose") === "prefetch" ||
    (h.get("sec-purpose") ?? "").includes("prefetch") ||
    h.has("x-middleware-prefetch");
  if (prefetch) return false;
  if (h.get("rsc") === "1") return false;
  const dest = h.get("sec-fetch-dest");
  return dest ? dest === "document" : (h.get("accept") ?? "").includes("text/html");
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*opengraph-image.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
