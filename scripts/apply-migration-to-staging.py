#!/usr/bin/env python3
"""
Apply ONE migration to STAGING, and record it in staging's migration history.

WHY THIS EXISTS
    apply-migration-to-production.py refuses unless staging is already ahead —
    that is guard 4, and it is what makes "test on staging first" structural
    rather than a thing someone remembers. But nothing in the repo actually
    applied a migration TO staging, so the rule pointed at a step that had no
    tool. On 2026-08-05 that step was done by hand; this is the tool, so the next
    one is not.

    apply-schema-to-staging.py is a different job: it rebuilds staging wholesale
    from the captured production baseline. Use that to reset staging, this to add
    one migration on top.

THE GUARDS
    1. The file must live in supabase/migrations/, named <14-digit>_<name>.sql.
    2. STAGING is a hardcoded allowlist of one, and production is separately
       blocklisted by ref — the same shape as apply-schema-to-staging.py, so that
       editing one constant cannot silently arm this at the real database.
    3. --confirm is required to apply. Without it you get the statement list and
       nothing happens.

WHY THIS DOES NOT RECORD MIGRATION HISTORY (unlike the production script)
    Staging has no `supabase_migrations` schema at all — confirmed 2026-08-17,
    it does not exist. That is a consequence of how staging is built:
    apply-schema-to-staging.py restores `supabase/schema/production-baseline.sql`,
    which is a schema DUMP and carries no history, rather than replaying
    migrations.

    So there is no history here to keep truthful, and creating one now would make
    things worse rather than better: recording only this migration would assert
    "one migration has been applied" against a schema that reflects six. A
    partial history is more misleading than an absent one, because it looks
    authoritative.

    This is safe precisely because staging's correctness is checked structurally
    rather than historically. The production script snapshots both databases
    across six probes — tables, columns, constraints, indexes, policies,
    functions — and refuses unless staging is strictly ahead beforehand (guard 4)
    and identical afterwards (guard 5). Those compare the schema itself, which is
    the thing that actually has to match. Production keeps its history because
    `db push` reads it; staging is a schema mirror, not a history mirror.

    Consequence worth knowing: there is no "already applied" check here. Re-running
    is harmless for an idempotent migration (`if not exists`, guarded DO blocks) and
    errors loudly for one that is not — which is the correct signal either way.

Usage:
    python3 scripts/apply-migration-to-staging.py 20260817120000_managed_access.sql
    python3 scripts/apply-migration-to-staging.py 20260817120000_managed_access.sql --confirm
"""
import json, os, re, ssl, subprocess, sys, urllib.request

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

API = 'https://api.supabase.com/v1'
MIGRATIONS_DIR = 'supabase/migrations'

# ── the guard ───────────────────────────────────────────────────────────────
# One permitted destination. Not a default, not an argument — a constant.
STAGING = 'pauwvdntclmxlcettfgc'      # chocka-staging
PRODUCTION = 'emilonrdyljbydtgrvof'   # MapBoost — NEVER a destination here

FORBIDDEN = {
    PRODUCTION: 'MapBoost (PRODUCTION — real retailers, real credentials)',
    'vxycdhyembwufoqfoqsg': 'chocka index',
}


def token() -> str:
    raw = subprocess.run(
        ['security', 'find-generic-password', '-s', 'Supabase CLI', '-w'],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if raw.startswith('go-keyring-base64:'):
        import base64
        return base64.b64decode(raw.split(':', 1)[1]).decode()
    return raw


def query(ref: str, sql: str):
    if ref in FORBIDDEN:
        sys.exit(f'REFUSED: {ref} is {FORBIDDEN[ref]}. This script only writes to staging.')
    if ref != STAGING:
        sys.exit(f'REFUSED: {ref} is not the staging project.')
    req = urllib.request.Request(
        f'{API}/projects/{ref}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {token()}', 'Content-Type': 'application/json',
                 'User-Agent': 'chocka-app-schema-tools/1.0'},
    )
    with urllib.request.urlopen(req, timeout=180, context=SSL_CTX) as r:
        body = json.load(r)
    if isinstance(body, dict) and body.get('message'):
        raise RuntimeError(body['message'])
    return body


def split_statements(sql: str):
    """Identical rules to the production script — see its docstring for why.

    Coarse and correct beats fine-grained and wrong: a dollar-quoted body or an
    explicit transaction is stored whole rather than split on semicolons that may
    live inside a DO block.
    """
    if '$$' in sql or re.search(r'\bbegin\b', sql, re.I):
        body = '\n'.join(l for l in sql.splitlines() if not l.strip().startswith('--')).strip()
        return [body] if body else []
    out = []
    for chunk in re.split(r';\s*(?:\n|$)', sql):
        body = '\n'.join(l for l in chunk.splitlines() if not l.strip().startswith('--')).strip()
        if body:
            out.append(body + ';')
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit('Usage: apply-migration-to-staging.py <migration.sql> [--confirm]')
    fname = os.path.basename(args[0])
    path = os.path.join(MIGRATIONS_DIR, fname)

    # Guard 1 — a real migration file, not arbitrary SQL.
    if not os.path.exists(path):
        sys.exit(f'REFUSED: {path} does not exist. Only files in {MIGRATIONS_DIR} can be applied.')
    m = re.match(r'^(\d{14})_(.+)\.sql$', fname)
    if not m:
        sys.exit(f'REFUSED: {fname} is not <14-digit-version>_<name>.sql')
    version, name = m.group(1), m.group(2)

    sql = open(path, encoding='utf-8').read()

    statements = split_statements(sql)
    print(f'migration : {fname}')
    print(f'version   : {version}')
    print(f'target    : chocka-staging ({STAGING})')
    print(f'statements: {len(statements)}')

    if '--confirm' not in sys.argv:
        print('\n(dry run — pass --confirm to apply)')
        return

    # Wrapped in a transaction so a multi-statement migration cannot half-apply
    # and leave staging in a state that is neither before nor after.
    print('\napplying to STAGING …')
    query(STAGING, f"""
        begin;
        {sql}
        commit;
    """)
    print('applied (history deliberately not written — see the module docstring)')
    print(f'\n✓ {version} applied to staging.')
    print('  Next: python3 scripts/apply-migration-to-production.py '
          f'{fname} --confirm')


if __name__ == '__main__':
    main()
