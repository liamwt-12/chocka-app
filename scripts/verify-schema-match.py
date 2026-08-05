#!/usr/bin/env python3
"""
Diff the staging schema against production, object by object. READ-ONLY on both.

WHY IT EXISTS SEPARATELY FROM THE DUMP
    The dump reconstructs DDL from pg_catalog rather than using Postgres's own
    serialiser, so "it applied without error" is not evidence that it applied
    *correctly*. A missing default, a nullable column that should be NOT NULL, or
    a policy with a subtly different USING clause would all apply cleanly and
    leave staging quietly unlike production — which is worse than no staging at
    all, because you would then trust a migration test that proved nothing.

    So the check is a comparison of the two live databases, not of the SQL file.

WHAT IT COMPARES
    tables · columns (type, nullability, default) · constraints · indexes ·
    RLS flags · policies · functions · app-owned triggers

    Exit code 0 when identical, 1 when not, so it can gate a migration workflow.

Usage:  python3 scripts/verify-schema-match.py
"""
import json, ssl, subprocess, sys, urllib.request

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

API = 'https://api.supabase.com/v1'
PROD = 'emilonrdyljbydtgrvof'      # MapBoost
STAGING = 'pauwvdntclmxlcettfgc'   # chocka-staging


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
    with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as r:
        body = json.load(r)
    if isinstance(body, dict) and body.get('message'):
        raise RuntimeError(body['message'])
    return body


# Each probe returns a set of comparable strings. Comparing rendered strings
# rather than structures keeps the diff output readable — you see the exact
# object that differs, not a nested dict.
PROBES = {
    'tables': ("""
        select c.relname as k from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r'
    """, lambda r: r['k']),

    'columns': ("""
        select c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)
               ||case when a.attnotnull then ' NOT NULL' else '' end
               ||coalesce(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),'') as k
        from pg_attribute a
        join pg_class c on c.oid=a.attrelid
        join pg_namespace n on n.oid=c.relnamespace
        left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
    """, lambda r: r['k']),

    'constraints': ("""
        select c.relname||' '||con.conname||' '||pg_get_constraintdef(con.oid) as k
        from pg_constraint con
        join pg_class c on c.oid=con.conrelid
        join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public'
    """, lambda r: r['k']),

    'indexes': ("""
        select indexdef as k from pg_indexes where schemaname='public'
    """, lambda r: r['k']),

    'rls': ("""
        select c.relname||' rls='||c.relrowsecurity as k
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r'
    """, lambda r: r['k']),

    'policies': ("""
        select tablename||' '||policyname||' '||cmd||' '||array_to_string(roles,',')
               ||' USING '||coalesce(qual,'-')||' CHECK '||coalesce(with_check,'-') as k
        from pg_policies where schemaname='public'
    """, lambda r: r['k']),

    'functions': ("""
        select p.proname||' '||md5(pg_get_functiondef(p.oid)) as k
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    """, lambda r: r['k']),

    'app_triggers': ("""
        select pg_get_triggerdef(t.oid) as k
        from pg_trigger t
        join pg_proc p on p.oid=t.tgfoid
        join pg_namespace fn on fn.oid=p.pronamespace
        where not t.tgisinternal and fn.nspname='public'
    """, lambda r: r['k']),
}


def main():
    failures = 0
    print(f'{"object":<14} {"prod":>6} {"staging":>8}   result')
    print('-' * 62)
    detail = []

    for name, (sql, key) in PROBES.items():
        p = {key(r) for r in query(PROD, sql)}
        s = {key(r) for r in query(STAGING, sql)}
        missing = p - s      # in production, absent from staging
        extra = s - p        # in staging, absent from production
        ok = not missing and not extra
        if not ok:
            failures += 1
        print(f'{name:<14} {len(p):>6} {len(s):>8}   {"match" if ok else "DIFFERS"}')
        for m in sorted(missing):
            detail.append(f'  [{name}] MISSING FROM STAGING: {m}')
        for e in sorted(extra):
            detail.append(f'  [{name}] ONLY IN STAGING:      {e}')

    if detail:
        print('\n'.join([''] + detail))

    print('-' * 62)
    if failures:
        print(f'{failures} object type(s) differ — staging does NOT match production')
        sys.exit(1)
    print('staging matches production across every object type checked')


if __name__ == '__main__':
    main()
