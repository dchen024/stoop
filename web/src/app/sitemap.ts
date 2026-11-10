import type { MetadataRoute } from "next";
import { currentSeason } from "@/lib/format";
import { SITE_URL } from "@/lib/site";

// Every building with a complaint this season gets a page in search results:
// "<address> complaints" searches are Stoop's main free source of new visitors.
export const revalidate = 86400;

const PAGE = 5000; // PostgREST max_rows

async function buildingPages(): Promise<{ building_id: number; refreshed_at: string }[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  const out: { building_id: number; refreshed_at: string }[] = [];
  for (let from = 0; from < 45_000; from += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/building_stats?season=eq.${currentSeason()}&complaints_total=gt.0&select=building_id,refreshed_at&order=building_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) break;
    const rows = (await res.json()) as { building_id: number; refreshed_at: string }[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const fixed: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/status`, lastModified: now, changeFrequency: "hourly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.1 },
  ];
  const buildings = await buildingPages();
  return [
    ...fixed,
    ...buildings.map((b) => ({
      url: `${SITE_URL}/building/${b.building_id}`,
      lastModified: new Date(b.refreshed_at),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
