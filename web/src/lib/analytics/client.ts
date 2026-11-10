// Fire-and-forget events from the browser: in-app page views (full page loads are
// recorded by the middleware), clicks, shares and searches. See /api/events for validation.

type ClientEvent =
  | { name: "page_view" }
  | { name: "badge_click"; props: { badge: "supabase" | "sodabase" } }
  | { name: "outbound_click"; props: { target: string } }
  | { name: "share"; props: { method: "native" | "copy" }; buildingId: number }
  | { name: "search"; props: { query: string; results: number }; buildingId?: number }
  | { name: "search_no_result"; props: { query: string } };

export function track(event: ClientEvent) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ ...event, path: window.location.pathname });
  try {
    // text/plain keeps sendBeacon a simple request; the route parses it as JSON.
    if (navigator.sendBeacon?.("/api/events", new Blob([body], { type: "text/plain" }))) return;
  } catch {
    // fall through
  }
  fetch("/api/events", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
}
