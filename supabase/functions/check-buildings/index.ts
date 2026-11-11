// check-buildings: check each building's identifiers against NYC City Planning's data.
//
// Called hourly by pg_cron (see the 2026-11-10 building_checks migration). HPD's feed
// leaves some buildings without a BIN, and gives a few a BBL that is not a real tax lot.
// Each run takes the buildings that are due (public.buildings_to_check) and asks:
//   * PLUTO, by BBL: is this a real lot, and which community board and council district?
//   * The Property Address Directory (through GeoSearch), by address, for buildings
//     without a BIN: does this exact address exist, and what BIN and BBL does it have?
// public.save_building_checks() stores the answers and writes back only the ones that
// agree with what we have. Best effort: a lookup that fails is skipped and retried later.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { addressMatch, type GeoFeature, plutoBbl } from "./match.ts";

const PLUTO = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2/search";
const BATCH = 2000;
const LOTS_PER_REQUEST = 100;
const ADDRESSES_PER_RUN = 200;
const GEO_CONCURRENCY = 4;
const DEADLINE_MS = 120_000; // edge functions are cut off at 150 s wall clock

type Due = {
  building_id: number;
  borough: string;
  house_number: string;
  street_name: string;
  bbl: string | null;
  check_lot: boolean;
  check_address: boolean;
};

type Check = {
  building_id: number;
  lot_bbl?: string;
  lot_found?: boolean;
  lot_cd?: number | null;
  lot_council?: number | null;
  geo_status?: "match" | "no_bin" | "no_match";
  geo_bin?: string | null;
  geo_bbl?: string | null;
};

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

  const started = Date.now();
  const left = () => DEADLINE_MS - (Date.now() - started);

  const { data: due, error } = await db.rpc("buildings_to_check", { p_limit: BATCH });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const checks = new Map<number, Check>();
  const check = (id: number) => checks.get(id) ?? checks.set(id, { building_id: id }).get(id)!;
  const errors: string[] = [];

  // PLUTO: one request per 100 distinct BBLs. A BBL missing from the answer is not a lot.
  const byBbl = new Map<string, Due[]>();
  for (const d of (due ?? []) as Due[]) {
    if (d.check_lot && d.bbl) byBbl.set(d.bbl, [...(byBbl.get(d.bbl) ?? []), d]);
  }
  const bbls = [...byBbl.keys()];
  for (let i = 0; i < bbls.length && left() > 30_000; i += LOTS_PER_REQUEST) {
    const chunk = bbls.slice(i, i + LOTS_PER_REQUEST);
    const params = new URLSearchParams({
      "$select": "bbl,cd,council",
      "$where": `bbl in (${chunk.map((b) => `'${b}'`).join(",")})`,
      "$limit": "1000",
    });
    try {
      const res = await fetch(`${PLUTO}?${params}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`PLUTO ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const lots = new Map<string, { cd?: string; council?: string }>();
      for (const lot of await res.json()) lots.set(plutoBbl(lot.bbl), lot);
      for (const bbl of chunk) {
        const lot = lots.get(bbl);
        for (const d of byBbl.get(bbl)!) {
          Object.assign(check(d.building_id), {
            lot_bbl: bbl,
            lot_found: !!lot,
            lot_cd: lot?.cd ? Number(lot.cd) : null,
            lot_council: lot?.council ? Number(lot.council) : null,
          });
        }
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  // GeoSearch: one request per address, a few at a time.
  const addresses = ((due ?? []) as Due[]).filter((d) => d.check_address).slice(0, ADDRESSES_PER_RUN);
  let next = 0;
  const worker = async () => {
    while (next < addresses.length && left() > 15_000) {
      const d = addresses[next++];
      const params = new URLSearchParams({ text: `${d.house_number} ${d.street_name}, ${d.borough}`, size: "5" });
      try {
        const res = await fetch(`${GEOSEARCH}?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`GeoSearch ${res.status}`);
        const { features } = (await res.json()) as { features?: GeoFeature[] };
        Object.assign(check(d.building_id), addressMatch(d, features ?? []));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: GEO_CONCURRENCY }, worker));

  let saved = null;
  if (checks.size) {
    const { data, error: saveError } = await db.rpc("save_building_checks", { p_rows: [...checks.values()] });
    if (saveError) return Response.json({ error: saveError.message, lookup_errors: errors }, { status: 500 });
    saved = data;
  }
  const { data: aliases, error: aliasError } = await db.rpc("refresh_building_aliases");
  if (aliasError) errors.push(`aliases: ${aliasError.message}`);

  return Response.json({
    due: due?.length ?? 0,
    lots_checked: [...checks.values()].filter((c) => c.lot_found !== undefined).length,
    addresses_checked: [...checks.values()].filter((c) => c.geo_status).length,
    ...saved,
    aliases_added: aliases ?? 0,
    lookup_errors: [...new Set(errors)].slice(0, 5),
  });
});
