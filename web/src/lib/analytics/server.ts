// Server-side event recording (middleware page views and the /api/events route).
// Writes through public.record_event() with the service role, which hashes the IP and
// user agent with a daily salt and never stores them. Works in Edge and Node runtimes.

export type EventName = "page_view" | "search" | "search_no_result" | "badge_click" | "outbound_click" | "share";

export type EventInput = {
  name: EventName;
  path?: string | null;
  buildingId?: number | null;
  userId?: string | null;
  props?: Record<string, string | number | boolean>;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
};

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|go-http|node-fetch|axios|vercel-screenshot|sentry/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT.test(userAgent);
}

function device(ua: string): "mobile" | "tablet" | "desktop" {
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return "mobile";
  return "desktop";
}

function env(): "production" | "preview" | "development" {
  const v = process.env.VERCEL_ENV;
  return v === "production" || v === "preview" ? v : "development";
}

// A referrer from our own site is internal navigation, not a source.
export function externalReferrerHost(headers: Headers, ownHost: string | null): string | null {
  const ref = headers.get("referer");
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    return host && host !== ownHost?.replace(/^www\./, "") ? host : null;
  } catch {
    return null;
  }
}

export function buildingIdFromPath(path: string): number | null {
  const m = /^\/building\/(\d{1,12})(?:\/|$)/.exec(path);
  return m ? Number(m[1]) : null;
}

export async function recordEvent(headers: Headers, e: EventInput, referrerHost: string | null = null): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ua = headers.get("user-agent");
  if (!url || !key || isBot(ua)) return "skipped";

  const ip = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || headers.get("x-real-ip") || "";
  const city = headers.get("x-vercel-ip-city");
  const body = {
    p_name: e.name,
    p_ip: ip,
    p_user_agent: ua,
    p_env: env(),
    p_path: e.path ?? null,
    p_building_id: e.buildingId ?? null,
    p_user_id: e.userId ?? null,
    p_referrer_host: referrerHost,
    p_utm_source: e.utm?.source ?? null,
    p_utm_medium: e.utm?.medium ?? null,
    p_utm_campaign: e.utm?.campaign ?? null,
    p_device: device(ua!),
    p_city: city ? decodeURIComponent(city) : null,
    p_region: headers.get("x-vercel-ip-country-region"),
    p_country: headers.get("x-vercel-ip-country"),
    p_props: e.props ?? {},
  };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/record_event`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? String(await res.json()) : `http_${res.status}`;
  } catch {
    return "error"; // analytics must never break a page
  }
}
