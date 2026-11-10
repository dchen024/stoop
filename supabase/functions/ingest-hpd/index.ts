// ingest-hpd: pull new and changed HPD complaints from NYC Open Data into Stoop.
//
// Called every 15 minutes by pg_cron (see migrations). HPD republishes once a day,
// so most runs find nothing new. That is fine: every run is still recorded in
// public.ingest_runs, which is how the app shows "synced 4 min ago, city data as of ...".
//
// This function only fetches. Each page goes to public.enqueue_hpd_page(), which
// puts it on the hpd_ingest queue in 500-row batches and saves the position it
// reached, in one transaction. pg_cron runs public.drain_hpd_queue() every minute to
// validate and write the batches, retrying any that fail (see the 2026-11-10
// migration). A big daily batch is still read over several runs if it has to be.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SOURCE = "https://data.cityofnewyork.us/resource/ygpa-z7cr.json";
const REGISTRY = "https://data.cityofnewyork.us/resource/kj4p-ruqc.json"; // HPD Buildings Subject to HPD Jurisdiction
const SEASON_START = "2026-10-01T00:00:00";
const PAGE = 2000;
const PAGE_BUDGET_MS = 95_000; // don't start a page after this; the run ends "partial" and the next one continues
const HARD_DEADLINE_MS = 135_000; // edge functions are cut off at 150 s wall clock
const RETRY_DELAYS_MS = [2_000, 5_000];

type Cursor = { updatedAt: string; rowId: string | null };

class UpstreamError extends Error {}

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
    .single<{ run_id: number; watermark_from: string; cursor_row_id: string | null }>();
  if (beginError || !run) {
    return Response.json({ error: beginError?.message ?? "no run" }, { status: 500 });
  }

  const started = Date.now();
  const left = () => HARD_DEADLINE_MS - (Date.now() - started);
  const totals = { fetched: 0, queuedBatches: 0 }; // rows are written by drain_hpd_queue()
  let cursor: Cursor = { updatedAt: socrataTime(run.watermark_from), rowId: run.cursor_row_id };
  let caughtUp = false;

  try {
    while (Date.now() - started < PAGE_BUDGET_MS) {
      const params = new URLSearchParams({
        "$select": ":*, *",
        "$where": `received_date >= '${SEASON_START}' AND ${after(cursor)}`,
        "$order": ":updated_at, :id",
        "$limit": String(PAGE),
      });
      const rows = await fetchJson(`${SOURCE}?${params}`, left);
      if (!Array.isArray(rows)) throw new UpstreamError("NYC Open Data returned a non-array page");
      if (rows.length === 0) {
        caughtUp = true;
        break;
      }

      const { data, error } = await db.rpc("enqueue_hpd_page", { p_run_id: run.run_id, p_rows: rows });
      if (error) throw new Error(error.message);
      totals.fetched += data.fetched;
      totals.queuedBatches += data.queued_batches;

      const last = rows[rows.length - 1];
      cursor = { updatedAt: socrataTime(last[":updated_at"]), rowId: last[":id"] };
      if (rows.length < PAGE) {
        caughtUp = true;
        break;
      }
    }

    const remaining = caughtUp ? 0 : await countRemaining(cursor, left);
    const registry = await enrichFromRegistry(db, left);
    await finish(db, run.run_id, {
      status: caughtUp ? "succeeded" : "partial",
      rowsRemaining: remaining,
      ...registry,
    });
    return Response.json({ run_id: run.run_id, caught_up: caughtUp, rows_remaining: remaining, ...totals, ...registry });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const status = e instanceof UpstreamError ? "upstream_down" : "failed";
    await finish(db, run.run_id, { status, error: message });
    return Response.json({ run_id: run.run_id, status, error: message, ...totals }, { status: 500 });
  }
});

// Socrata compares :updated_at against a floating timestamp (no zone suffix).
function socrataTime(iso: string): string {
  return new Date(iso).toISOString().replace("Z", "");
}

// Rows strictly after the saved position, in Socrata's own (:updated_at, :id) order.
function after(c: Cursor): string {
  const ts = `:updated_at > '${c.updatedAt}'`;
  return c.rowId ? `(${ts} OR (:updated_at = '${c.updatedAt}' AND :id > '${c.rowId.replaceAll("'", "''")}'))` : ts;
}

// Retries 5xx, 429 and network errors while there is time left; anything else is not the city's fault.
async function fetchJson(url: string, left: () => number): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (left() < delay + 15_000) break;
      await new Promise((r) => setTimeout(r, delay));
    }
    const appToken = Deno.env.get("SOCRATA_APP_TOKEN");
    let res: Response;
    try {
      res = await fetch(url, {
        headers: appToken ? { "X-App-Token": appToken } : {},
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(30_000, left() - 5_000))),
      });
    } catch (e) {
      lastError = `NYC Open Data unreachable: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
    if (res.ok) return await res.json();
    lastError = `NYC Open Data ${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (res.status < 500 && res.status !== 429) throw new Error(lastError);
  }
  throw new UpstreamError(`${lastError} (after ${RETRY_DELAYS_MS.length + 1} tries)`);
}

// Best effort: how far behind we are, for the status page. Null if the city doesn't answer in time.
async function countRemaining(c: Cursor, left: () => number): Promise<number | null> {
  if (left() < 10_000) return null;
  const params = new URLSearchParams({
    "$select": "count(*) as n",
    "$where": `received_date >= '${SEASON_START}' AND ${after(c)}`,
  });
  try {
    const res = await fetch(`${SOURCE}?${params}`, { signal: AbortSignal.timeout(Math.min(15_000, left() - 5_000)) });
    if (!res.ok) return null;
    const [{ n }] = await res.json();
    return Number(n);
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function finish(db: any, runId: number, f: {
  status: "succeeded" | "partial" | "upstream_down" | "failed";
  error?: string;
  rowsRemaining?: number | null;
  enriched?: number | null;
  registryError?: string | null;
}) {
  const { error } = await db.rpc("finish_ingest_run", {
    p_run_id: runId,
    p_status: f.status,
    p_error: f.error ?? null,
    p_rows_remaining: f.rowsRemaining ?? null,
    p_enriched: f.enriched ?? null,
    p_registry_error: f.registryError ?? null,
  });
  if (error) console.error(`finish_ingest_run(${runId}) failed: ${error.message}`);
}

// The complaint feed omits BIN (and sometimes BBL) for some buildings; HPD's building
// registry has them. Best effort: fills only missing values, never blocks the sync,
// but a failed lookup is recorded so the status page can show it.
// deno-lint-ignore no-explicit-any
async function enrichFromRegistry(db: any, left: () => number): Promise<{ enriched: number | null; registryError: string | null }> {
  const { data: missing } = await db
    .from("buildings")
    .select("building_id")
    .or("bin.is.null,bbl.is.null")
    .limit(500);
  if (!missing?.length || left() < 10_000) return { enriched: null, registryError: null };
  let enriched = 0;
  for (let i = 0; i < missing.length; i += 100) {
    if (left() < 10_000) break;
    const ids = missing.slice(i, i + 100).map((m: { building_id: number }) => m.building_id).join(",");
    const params = new URLSearchParams({
      "$select": "buildingid,bin,block,lot",
      "$where": `buildingid in (${ids})`,
      "$limit": "1000",
    });
    try {
      const res = await fetch(`${REGISTRY}?${params}`, { signal: AbortSignal.timeout(Math.min(15_000, left() - 5_000)) });
      if (!res.ok) return { enriched, registryError: `Registry ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const { data, error } = await db.rpc("enrich_buildings_from_registry", { p_rows: await res.json() });
      if (error) return { enriched, registryError: `Registry write failed: ${error.message}` };
      enriched += data ?? 0;
    } catch (e) {
      return { enriched, registryError: `Registry unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { enriched, registryError: null };
}
