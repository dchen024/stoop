// ingest-hpd: pull new and changed HPD complaints from NYC Open Data into Stoop.
//
// Called every 15 minutes by pg_cron (see migrations). HPD republishes once a day,
// so most runs find nothing new. That is fine: every run is still recorded in
// public.ingest_runs, which is how the app shows "synced 4 min ago, city data as of ...".
//
// All validation and writes happen in public.ingest_hpd_batch() (one transaction
// per page), so this function only fetches and forwards.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SOURCE = "https://data.cityofnewyork.us/resource/ygpa-z7cr.json";
const REGISTRY = "https://data.cityofnewyork.us/resource/kj4p-ruqc.json"; // HPD Buildings Subject to HPD Jurisdiction
const SEASON_START = "2026-10-01T00:00:00";
const PAGE = 2500;
const DEADLINE_MS = 120_000; // stay under the edge function wall-clock limit

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: run, error: beginError } = await db
    .rpc("begin_ingest_run", { p_source: "hpd_complaints" })
    .single<{ run_id: number; watermark_from: string }>();
  if (beginError || !run) {
    return Response.json({ error: beginError?.message ?? "no run" }, { status: 500 });
  }

  // Socrata compares :updated_at against a floating timestamp (no zone suffix).
  const watermark = new Date(run.watermark_from).toISOString().replace("Z", "");
  const started = Date.now();
  const totals = { fetched: 0, upserted: 0, rejected: 0 };

  try {
    for (let offset = 0; ; offset += PAGE) {
      // Never mark a half-read batch as succeeded: rows in one daily batch share a
      // timestamp, so a partial "success" would move the watermark past the rest.
      if (Date.now() - started > DEADLINE_MS) {
        throw new Error(`deadline reached at offset ${offset}; next run resumes from ${watermark}`);
      }

      const params = new URLSearchParams({
        "$select": ":*, *",
        "$where": `received_date >= '${SEASON_START}' AND :updated_at > '${watermark}'`,
        "$order": ":updated_at, :id",
        "$limit": String(PAGE),
        "$offset": String(offset),
      });
      const appToken = Deno.env.get("SOCRATA_APP_TOKEN");
      const res = await fetch(`${SOURCE}?${params}`, {
        headers: appToken ? { "X-App-Token": appToken } : {},
      });
      if (!res.ok) throw new Error(`NYC Open Data ${res.status}: ${(await res.text()).slice(0, 200)}`);

      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;

      const { data, error } = await db.rpc("ingest_hpd_batch", { p_run_id: run.run_id, p_rows: rows });
      if (error) throw new Error(error.message);
      totals.fetched += data.fetched;
      totals.upserted += data.upserted;
      totals.rejected += data.rejected;

      if (rows.length < PAGE) break;
    }

    const enriched = await enrichFromRegistry(db);
    await db.rpc("finish_ingest_run", { p_run_id: run.run_id });
    return Response.json({ run_id: run.run_id, watermark_from: run.watermark_from, ...totals, enriched });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.rpc("finish_ingest_run", { p_run_id: run.run_id, p_error: message.slice(0, 500) });
    return Response.json({ run_id: run.run_id, error: message, ...totals }, { status: 500 });
  }
});

// The complaint feed omits BIN (and sometimes BBL) for some buildings; HPD's building
// registry has them. Best effort: fills only missing values, never blocks the sync.
// deno-lint-ignore no-explicit-any
async function enrichFromRegistry(db: any): Promise<number> {
  const { data: missing } = await db
    .from("buildings")
    .select("building_id")
    .or("bin.is.null,bbl.is.null")
    .limit(500);
  let enriched = 0;
  for (let i = 0; missing && i < missing.length; i += 100) {
    const ids = missing.slice(i, i + 100).map((m: { building_id: number }) => m.building_id).join(",");
    const params = new URLSearchParams({
      "$select": "buildingid,bin,block,lot",
      "$where": `buildingid in (${ids})`,
      "$limit": "1000",
    });
    const res = await fetch(`${REGISTRY}?${params}`);
    if (!res.ok) break;
    const { data } = await db.rpc("enrich_buildings_from_registry", { p_rows: await res.json() });
    enriched += data ?? 0;
  }
  return enriched;
}
