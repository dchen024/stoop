// Records interaction events sent by the browser (lib/analytics/client.ts).
// Same-origin only, small bodies, known event names and props only; the database adds
// a per-visitor rate limit (60/min). Always answers 204 so it can't be used as an oracle.
import { createClient } from "@/lib/supabase/server";
import { buildingIdFromPath, recordEvent, type EventInput } from "@/lib/analytics/server";

const NO_CONTENT = new Response(null, { status: 204 });
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

function parse(raw: unknown): EventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p = (r.props && typeof r.props === "object" ? r.props : {}) as Record<string, unknown>;
  const path = str(r.path, 300);
  const buildingId = int(r.buildingId);
  switch (r.name) {
    case "page_view":
      // In-app navigation; full page loads are recorded by the middleware.
      return path?.startsWith("/") && !path.startsWith("/admin") ? { name: "page_view", path, buildingId: buildingIdFromPath(path) } : null;
    case "badge_click":
      return p.badge === "supabase" || p.badge === "sodabase" ? { name: "badge_click", path, props: { badge: p.badge } } : null;
    case "outbound_click": {
      const target = str(p.target, 50);
      return target ? { name: "outbound_click", path, props: { target } } : null;
    }
    case "share":
      return (p.method === "native" || p.method === "copy") && buildingId
        ? { name: "share", path, buildingId, props: { method: p.method } }
        : null;
    case "search": {
      const query = str(p.query, 100);
      return query ? { name: "search", path, buildingId, props: { query, results: int(p.results) ?? 0 } } : null;
    }
    case "search_no_result": {
      const query = str(p.query, 100);
      return query ? { name: "search_no_result", path, props: { query } } : null;
    }
    default:
      return null;
  }
}

export async function POST(request: Request) {
  // Browsers send these on same-origin requests; anything else is not our page.
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (site ? site !== "same-origin" : !origin || new URL(origin).host !== host) return NO_CONTENT;

  const text = await request.text();
  if (text.length > 2_000) return NO_CONTENT;
  let event: EventInput | null = null;
  try {
    event = parse(JSON.parse(text));
  } catch {
    return NO_CONTENT;
  }
  if (!event) return NO_CONTENT;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  await recordEvent(request.headers, { ...event, userId: data.user?.id ?? null });
  return NO_CONTENT;
}
