#!/usr/bin/env python3
"""One-off backfill of HPD complaints into Stoop, through the same SQL path the
edge function uses (begin_ingest_run -> ingest_hpd_batch -> finish_ingest_run).

Runs from a laptop because a full season (~95k rows) is longer than an edge
function invocation should be. Needs DATABASE_URL in .env.local and psql on PATH.

    python3 scripts/backfill.py
"""
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

SOURCE = "https://data.cityofnewyork.us/resource/ygpa-z7cr.json"
SEASON_START = "2026-10-01T00:00:00"
PAGE = 5000
PSQL = os.environ.get("PSQL", "/opt/homebrew/opt/postgresql@17/bin/psql")


def load_env(path=".env.local"):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v
    return env


DB = load_env()["DATABASE_URL"]


def psql(sql: str) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write(sql)
        path = f.name
    try:
        out = subprocess.run(
            [PSQL, DB, "-v", "ON_ERROR_STOP=1", "-Atq", "-f", path],
            capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"},
        )
    finally:
        os.unlink(path)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:500])
    return out.stdout.strip()


def fetch(watermark: str, offset: int):
    params = {
        "$select": ":*, *",
        "$where": f"received_date >= '{SEASON_START}' AND :updated_at > '{watermark}'",
        "$order": ":updated_at, :id",
        "$limit": str(PAGE),
        "$offset": str(offset),
    }
    url = f"{SOURCE}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:  # Socrata 503s under load; back off and retry
            if attempt == 3:
                raise
            print(f"  fetch retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


def main():
    run_id, watermark = psql("select run_id || '|' || watermark_from from public.begin_ingest_run('hpd_complaints');").split("|")
    # Socrata wants a floating timestamp: drop the offset, keep milliseconds.
    wm = watermark.replace(" ", "T").split("+")[0]
    print(f"run {run_id}: rows with :updated_at > {wm}")
    offset, totals, t0 = 0, {"fetched": 0, "upserted": 0, "rejected": 0}, time.time()
    try:
        while True:
            rows = fetch(wm, offset)
            if not rows:
                break
            tag = "j" + secrets.token_hex(6)
            res = json.loads(psql(f"select public.ingest_hpd_batch({run_id}, ${tag}${json.dumps(rows)}${tag}$::jsonb);"))
            for k in totals:
                totals[k] += res[k]
            print(f"  offset {offset:>6}: {res}  ({time.time() - t0:.0f}s)")
            if len(rows) < PAGE:
                break
            offset += PAGE
        psql(f"select public.finish_ingest_run({run_id});")
    except Exception as e:
        psql(f"select public.finish_ingest_run({run_id}, $e${str(e)[:500]}$e$);")
        raise
    print(f"done: {totals} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
