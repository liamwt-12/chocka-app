#!/usr/bin/env python3
"""
Apply ONE migration to production, and record it in the migration history.

WHY THIS EXISTS RATHER THAN `supabase db push`
    `db push` opens a direct Postgres connection and therefore prompts for the
    database password interactively — which makes it unusable from a script, and
    is a large part of why this repo's schema history drifted in the first place
    (see supabase/README.md). The Management API needs no password.

    What it must NOT become is a way to apply schema out-of-band. Production's
    `supabase_migrations.schema_migrations` was repaired on 2026-07-30 precisely
    because things had been applied without being recorded, and `db push` was
    untrustworthy as a result. So this script records the version exactly as
    `db push` would. History stays truthful; `db push` stays trustworthy.

THE GUARDS, in order

    1. The file must live in supabase/migrations/. No ad-hoc SQL.
    2. --confirm is required. Nothing happens by accident.
    3. The version must not already be recorded.
    4. PRE: staging must be a strict superset of production — every schema
       difference must be "only in staging". If production has objects staging
       lacks, the two have diverged and this stops.
    5. POST: staging and production must MATCH EXACTLY afterwards.

    Guard 5 is the important one and it is what makes "test on staging first" a
    rule the tooling enforces rather than one a person remembers. If the
    migration was never applied to staging, production ends up ahead, the diff is
    non-empty, and this exits non-zero having told you so.

    Row counts on every public table are captured before and after, and any
    change is reported. A schema migration that moves a row count is not a schema
    migration.

Usage:
    python3 scripts/apply-migration-to-production.py 20260805120000_retailer_retention.sql --confirm
"""
import json, os, re, ssl, subprocess, sys, urllib.request

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

API = 'https://api.supabase.com/v1'
PRODUCTION = 'emilonrdyljbydtgrvof'   # MapBoost
STAGING = 'pauwvdntclmxlcettfgc'      # chocka-staging
MIGRATIONS_DIR = 'supabase/migrations'


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


# Same probes the standalone verifier uses. Duplicated deliberately: this script
# must not depend on another file being importable to know whether it is safe.
PROBES = {
    'tables': "select c.relname as k from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
    'columns': """select c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)
                    ||case when a.attnotnull then ' NOT NULL' else '' end
                    ||coalesce(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),'') as k
                  from pg_attribute a join pg_class c on c.oid=a.attrelid
                  join pg_namespace n on n.oid=c.relnamespace
                  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
                  where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped""",
    'constraints': """select c.relname||' '||con.conname||' '||pg_get_constraintdef(con.oid) as k
                      from pg_constraint con join pg_class c on c.oid=con.conrelid
                      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'""",
    'indexes': "select indexdef as k from pg_indexes where schemaname='public'",
    'policies': """select tablename||' '||policyname||' '||cmd||' USING '||coalesce(qual,'-') as k
                   from pg_policies where schemaname='public'""",
    'functions': "select p.proname||' '||md5(pg_get_functiondef(p.oid)) as k from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
}


def split_statements(sql: str):
    """Split a migration into the statement list `schema_migrations` records.

    This is a RECORD of what ran, not something that gets replayed — but an
    inaccurate record is worse than an obviously coarse one, so:

    * Comment lines are stripped from each statement, and chunks that are
      entirely comments are dropped. Getting this wrong the first time recorded
      `statements = {}` on 20260805120000: every chunk began with a comment line,
      so a `startswith('--')` filter discarded all of them.
    * If the file contains a dollar-quoted body or an explicit transaction, the
      whole file is stored as ONE statement rather than split on semicolons that
      may live inside a function or a DO block. Coarse and correct beats
      fine-grained and wrong.
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


def snapshot(ref):
    return {name: {r['k'] for r in query(ref, sql)} for name, sql in PROBES.items()}


def diff(a, b):
    """Objects in `a` but not `b`, per probe."""
    return {name: sorted(a[name] - b[name]) for name in a if a[name] - b[name]}


def row_counts(ref):
    rows = query(ref, """
        select relname, n_live_tup from pg_stat_user_tables
        where schemaname='public' order by relname
    """)
    return {r['relname']: r['n_live_tup'] for r in rows}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit('Usage: apply-migration-to-production.py <migration.sql> --confirm')
    fname = os.path.basename(args[0])
    path = os.path.join(MIGRATIONS_DIR, fname)

    # Guard 1 — must be a real migration file, not arbitrary SQL.
    if not os.path.exists(path):
        sys.exit(f'REFUSED: {path} does not exist. Only files in {MIGRATIONS_DIR} can be applied.')
    m = re.match(r'^(\d{14})_(.+)\.sql$', fname)
    if not m:
        sys.exit(f'REFUSED: {fname} is not <14-digit-version>_<name>.sql')
    version, name = m.group(1), m.group(2)

    sql = open(path, encoding='utf-8').read()

    # Guard 3 — not already recorded.
    recorded = {r['version'] for r in query(PRODUCTION, 'select version from supabase_migrations.schema_migrations')}
    if version in recorded:
        sys.exit(f'REFUSED: {version} is already recorded as applied to production.')

    print(f'migration : {fname}')
    print(f'version   : {version}')

    # Guard 4 — staging must be ahead of production, never behind.
    print('\nchecking staging is ahead of production …')
    prod_before, stg = snapshot(PRODUCTION), snapshot(STAGING)
    only_in_prod = diff(prod_before, stg)
    only_in_stg = diff(stg, prod_before)

    if only_in_prod:
        print('REFUSED: production has objects staging does not. They have diverged:')
        for k, v in only_in_prod.items():
            for item in v:
                print(f'  [{k}] only in PRODUCTION: {item}')
        sys.exit(1)

    if not only_in_stg:
        print('REFUSED: staging and production already match — there is nothing this migration '
              'would add that staging has proven. Apply it to staging first.')
        sys.exit(1)

    print('  staging is ahead by:')
    for k, v in only_in_stg.items():
        for item in v:
            print(f'    [{k}] {item}')

    if '--confirm' not in sys.argv:
        print('\n(dry run — pass --confirm to apply)')
        return

    counts_before = row_counts(PRODUCTION)

    # Apply and record in one transaction: a migration that runs but is not
    # recorded is exactly the drift this script exists to avoid.
    statements = split_statements(sql)
    payload = json.dumps(statements).replace("'", "''")
    print(f'\napplying {len(statements)} statement(s) to PRODUCTION …')
    query(PRODUCTION, f"""
        begin;
        {sql}
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values ('{version}', '{name}', array(select json_array_elements_text('{payload}'::json)));
        commit;
    """)
    print('applied and recorded')

    # Guard 5 — the post-condition that makes staging-first structural.
    print('\nverifying production now matches staging …')
    prod_after = snapshot(PRODUCTION)
    residual = {**diff(prod_after, stg), **diff(stg, prod_after)}
    if residual:
        print('WARNING: production and staging still differ after applying:')
        for k, v in residual.items():
            for item in v:
                print(f'  [{k}] {item}')
        sys.exit(1)
    print('  identical across every probe')

    counts_after = row_counts(PRODUCTION)
    moved = {t: (counts_before.get(t), counts_after.get(t))
             for t in set(counts_before) | set(counts_after)
             if counts_before.get(t) != counts_after.get(t)}
    if moved:
        print('\nWARNING: row counts changed — a schema migration should not move data:')
        for t, (b, a) in moved.items():
            print(f'  {t}: {b} -> {a}')
    else:
        print('  row counts unchanged on every table')

    print(f'\n✓ {version} applied to production and recorded in schema_migrations')


if __name__ == '__main__':
    main()
