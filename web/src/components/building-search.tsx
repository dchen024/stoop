"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { titleCase } from "@/lib/format";

type Result = {
  building_id: number;
  address: string;
  borough: string;
  postcode: string | null;
  complaints_this_season: number;
  open_complaints: number;
};

export function BuildingSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await createClient().rpc("search_buildings", { q: term, max_results: 8 });
      if (id === seq.current) {
        setResults((data as Result[]) ?? []);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <label htmlFor="address" className="sr-only">
        Search a building address
      </label>
      <input
        id="address"
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder="Your address, e.g. 76 St Nicholas Pl"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base shadow-sm outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-600/20 dark:border-stone-700 dark:bg-stone-900"
      />
      {q.trim().length >= 3 && (
        <ul className="mt-2 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {loading && results.length === 0 && <li className="px-4 py-3 text-sm text-stone-500">Searching…</li>}
          {!loading && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-stone-500">
              No complaints on file this season for that address, or try a different spelling.
            </li>
          )}
          {results.map((r) => (
            <li key={r.building_id}>
              <Link
                href={`/building/${r.building_id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-orange-50 dark:hover:bg-stone-800"
              >
                <span>
                  <span className="font-medium">{titleCase(r.address)}</span>
                  <span className="block text-sm text-stone-500">
                    {titleCase(r.borough)} {r.postcode}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <span className="font-semibold">{r.complaints_this_season}</span> this season
                  {r.open_complaints > 0 && (
                    <span className="block text-red-700 dark:text-red-400">{r.open_complaints} open</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
