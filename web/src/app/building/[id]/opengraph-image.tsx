import { ImageResponse } from "next/og";
import { currentSeason, titleCase } from "@/lib/format";

// The preview card when a building link is shared (iMessage, WhatsApp, Slack, X...).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Housing complaints at this building, from NYC's official records";

async function get<T>(path: string): Promise<T | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/vnd.pgrst.object+json" },
      next: { revalidate: 3600 },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const ok = Number.isSafeInteger(id);
  const b = ok ? await get<{ address: string; borough: string; postcode: string | null }>(
    `buildings?building_id=eq.${id}&select=address,borough,postcode`,
  ) : null;
  const s = ok ? await get<{ complaints_total: number; complaints_open: number; heat_days: number }>(
    `building_stats?building_id=eq.${id}&season=eq.${currentSeason()}&select=complaints_total,complaints_open,heat_days`,
  ) : null;

  const stat = (value: number, label: string, accent = false) => (
    <div style={{ display: "flex", flexDirection: "column", padding: "24px 32px", borderRadius: 24, background: "#fff", border: "2px solid #e7e5e4", minWidth: 250 }}>
      <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: accent ? "#c2410c" : "#1c1917" }}>{value}</div>
      <div style={{ display: "flex", fontSize: 28, color: "#78716c" }}>{label}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#fafaf9", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: "#c2410c" }}>Stoop</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 800, color: "#1c1917", lineHeight: 1.1 }}>
            {b ? titleCase(b.address) : "Know what's going on in your building"}
          </div>
          {b && <div style={{ display: "flex", fontSize: 36, color: "#57534e", marginTop: 12 }}>{`${titleCase(b.borough)} ${b.postcode ?? ""}`}</div>}
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {s ? (
            <>
              {stat(s.complaints_total, "complaints this season")}
              {stat(s.complaints_open, "still open", true)}
              {stat(s.heat_days, "days without heat")}
            </>
          ) : (
            <div style={{ display: "flex", fontSize: 32, color: "#57534e" }}>Official NYC housing complaints, updated every 15 minutes</div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
