// Pure helpers for check-buildings, kept apart so they can be tested without the network.

export type GeoFeature = {
  properties?: {
    housenumber?: string;
    street?: string;
    borough?: string;
    addendum?: { pad?: { bin?: string; bbl?: string } };
  };
};

type Address = { house_number: string; street_name: string; borough: string };

const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// PLUTO returns BBLs as decimals ("2032530224.00000000").
export function plutoBbl(raw: unknown): string {
  return String(raw ?? "").split(".")[0];
}

// GeoSearch ranks fuzzy matches too ("1 East 34 St" comes back as 34 East 34 St), so only
// a result with the same house number, street and borough counts. NYC writes "none
// assigned" as a placeholder BIN (1000000, 2000000, ...): the address exists, no BIN does.
export function addressMatch(a: Address, features: GeoFeature[]) {
  const hit = features.find((f) =>
    norm(f.properties?.housenumber) === norm(a.house_number) &&
    norm(f.properties?.street) === norm(a.street_name) &&
    norm(f.properties?.borough) === norm(a.borough)
  );
  if (!hit) return { geo_status: "no_match" as const, geo_bin: null, geo_bbl: null };
  const pad = hit.properties?.addendum?.pad ?? {};
  const bin = /^[1-5][0-9]{6}$/.test(pad.bin ?? "") && !/^[1-5]000000$/.test(pad.bin!) ? pad.bin! : null;
  const bbl = /^[1-5][0-9]{9}$/.test(pad.bbl ?? "") ? pad.bbl! : null;
  return { geo_status: bin ? "match" as const : "no_bin" as const, geo_bin: bin, geo_bbl: bbl };
}
