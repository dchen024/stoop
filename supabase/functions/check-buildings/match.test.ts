// deno test supabase/functions/check-buildings/match.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { addressMatch, plutoBbl } from "./match.ts";

const feature = (housenumber: string, street: string, borough: string, bin: string, bbl: string) => ({
  properties: { housenumber, street, borough, addendum: { pad: { bin, bbl } } },
});

Deno.test("exact address match returns the city's BIN and BBL", () => {
  const got = addressMatch(
    { house_number: "60-14", street_name: "BEACH CHANNEL DRIVE", borough: "QUEENS" },
    [feature("60-14", "BEACH CHANNEL DRIVE", "Queens", "4624214", "4160130001")],
  );
  assertEquals(got, { geo_status: "match", geo_bin: "4624214", geo_bbl: "4160130001" });
});

Deno.test("a fuzzy neighbour is not a match", () => {
  const got = addressMatch(
    { house_number: "1", street_name: "EAST 34 STREET", borough: "MANHATTAN" },
    [feature("34", "EAST 34 STREET", "Manhattan", "1017092", "1008630067")],
  );
  assertEquals(got.geo_status, "no_match");
});

Deno.test("same address in another borough is not a match", () => {
  const got = addressMatch(
    { house_number: "100", street_name: "BROADWAY", borough: "BROOKLYN" },
    [feature("100", "BROADWAY", "Manhattan", "1001026", "1000477501")],
  );
  assertEquals(got.geo_status, "no_match");
});

Deno.test("placeholder BIN means the address exists but has no BIN", () => {
  const got = addressMatch(
    { house_number: "3057", street_name: "SEDGWICK  AVENUE", borough: "BRONX" },
    [feature("3057", "SEDGWICK AVENUE", "Bronx", "2000000", "2032530224")],
  );
  assertEquals(got, { geo_status: "no_bin", geo_bin: null, geo_bbl: "2032530224" });
});

Deno.test("PLUTO's decimal BBL is trimmed", () => {
  assertEquals(plutoBbl("2032530224.00000000"), "2032530224");
});
