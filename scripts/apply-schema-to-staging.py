#!/usr/bin/env python3
"""
Apply the captured production schema to the STAGING project, and nothing else.

This is the only script in the repo that issues DDL, so it is built to make
hitting the wrong database difficult rather than merely unlikely:

  * The target ref is a hardcoded allowlist of one. A ref that is not
    `chocka-staging` is refused before a connection is opened.
  * Production's ref is separately blocklisted by name, so even editing the
    allowlist does not silently arm it.
  * It refuses to run against a project whose `public` schema already has tables,
    unless --reset is passed, so a re-run cannot half-overwrite something.

Usage:
    python3 scripts/apply-schema-to-staging.py            # apply, refuse if not empty
    python3 scripts/apply-schema-to-staging.py --reset    # drop public and rebuild
"""
import json, ssl, subprocess, sys, urllib.request

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

API = 'https://api.supabase.com/v1'
SCHEMA_FILE = 'supabase/schema/production-baseline.sql'

# ── the guard ───────────────────────────────────────────────────────────────
# One permitted destination. Not a default, not an argument — a constant.
STAGING_REF = 'pauwvdntclmxlcettfgc'   # chocka-staging
PRODUCTION_REF = 'emilonrdyljbydtgrvof'  # MapBoost — NEVER a destination

FORBIDDEN = {
    PRODUCTION_REF: 'MapBoost (PRODUCTION — real retailers, real credentials)',
    'vxycdhyembwufoqfoqsg': 'chocka index',
    'fcuiuzoauxqswzpfgitp': 'claimtrack',
    'hrzsrsvkhlwjsavguhys': 'again',
    'bzzpyqwsuqnswwvbuksh': 'Padel Manual',
    'mctzqyenjmmxgdvrrsyr': 'night notes',
    'wwcplabllbaqmampldaz': 'owed',
    'regisgyebbupmxkzcfnn': 'hauscope',
}


def assert_writable(ref: str) -> None:
    if ref in FORBIDDEN:
        sys.exit(f'REFUSED: {ref} is {FORBIDDEN[ref]}. This script only ever writes to staging.')
    if ref != STAGING_REF:
        sys.exit(f'REFUSED: {ref} is not the staging project ({STAGING_REF}).')


def token() -> str:
    raw = subprocess.run(
        ['security', 'find-generic-password', '-s', 'Supabase CLI', '-w'],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if raw.startswith('go-keyring-base64:'):
        import base64
        return base64.b64decode(raw.split(':', 1)[1]).decode()
    return raw


def query(ref: str, sql: str, write: bool = False):
    if write:
        assert_writable(ref)
    req = urllib.request.Request(
        f'{API}/projects/{ref}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={
            'Authorization': f'Bearer {token()}',
            'Content-Type': 'application/json',
            # See dump-production-schema.py — urllib's default UA gets a
            # Cloudflare 1010 rejection that looks like an auth failure.
            'User-Agent': 'chocka-app-schema-tools/1.0',
        },
    )
    with urllib.request.urlopen(req, timeout=180, context=SSL_CTX) as r:
        body = json.load(r)
    if isinstance(body, dict) and body.get('message'):
        raise RuntimeError(body['message'])
    return body


def table_count(ref: str) -> int:
    rows = query(ref, "select count(*) n from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace "
                      "where nsp.nspname='public' and c.relkind='r'")
    return int(rows[0]['n'])


def main():
    reset = '--reset' in sys.argv
    ref = STAGING_REF
    assert_writable(ref)

    existing = table_count(ref)
    if existing and not reset:
        sys.exit(f'REFUSED: staging already has {existing} table(s) in public. '
                 f'Re-run with --reset to drop and rebuild.')

    if reset and existing:
        print(f'dropping public ({existing} tables) on staging …')
        query(ref, 'drop schema public cascade; create schema public; '
                   'grant usage on schema public to anon, authenticated, service_role; '
                   'grant all on schema public to postgres;', write=True)

    sql = open(SCHEMA_FILE, encoding='utf-8').read()
    print(f'applying {SCHEMA_FILE} ({len(sql.splitlines())} lines) to {ref} …')
    query(ref, sql, write=True)
    print(f'done — staging now has {table_count(ref)} tables in public')


if __name__ == '__main__':
    main()
