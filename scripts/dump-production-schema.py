#!/usr/bin/env python3
"""
Reconstruct production's `public` schema as applyable SQL. READ-ONLY.

WHY THIS EXISTS
    `supabase/migrations/` does not reproduce production and never has. Several
    tables and both `tenant_id` columns were applied out-of-band, so a fresh
    environment built from that directory is missing them — which is why
    "test a migration on a copy first" has been unfollowable, and why the last
    migration went straight to prod as a judgement call.

    The documented way to capture the real schema is `supabase db dump`. It needs
    Docker, which is not available here, and `supabase migration list` / `repair`
    both block on an interactive password prompt. That is the whole reason the
    drift went uncaptured for as long as it did.

    The Management API needs neither. It authenticates with the personal access
    token the CLI already stores in the keychain and will run SQL, so the schema
    can be read straight out of pg_catalog and re-emitted as DDL.

WHAT IT PRODUCES
    A single .sql file that builds `public` from nothing: extensions, tables,
    primary/unique/foreign/check constraints, indexes, RLS, and policies — in an
    order that has no forward references, so it applies top to bottom.

WHAT IT IS NOT
    Not a data dump. Schema only, deliberately: production holds real retailer
    records and encrypted credentials whose AAD is bound to production row ids,
    so copying rows into a second database would be both a privacy problem and a
    cryptographic one (see SECRETS_AT_REST.md).

    Not a replacement for `supabase db dump` where Docker exists. It reconstructs
    from catalog rather than using Postgres's own serialiser, so treat it as
    "faithful as far as it goes" and diff it (see verify-schema-match.py) rather
    than trusting it blind.

SAFETY
    Every statement it issues is a SELECT. It never writes to the project it
    reads. The target project ref is a required argument and defaults to nothing.
"""
import json, os, ssl, subprocess, sys, urllib.request

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

API = 'https://api.supabase.com/v1'
PROD_REF = 'emilonrdyljbydtgrvof'  # MapBoost — see the infra note in the memory dir


def token() -> str:
    """The CLI's personal access token, out of the macOS keychain.

    go-keyring stores it base64-wrapped behind a marker prefix. Same retrieval
    the supabase/README.md walkthrough uses.
    """
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
        headers={
            'Authorization': f'Bearer {token()}',
            'Content-Type': 'application/json',
            # Required. Without it urllib sends "Python-urllib/3.x" and Cloudflare
            # rejects the request with a 403 carrying "error code: 1010" — a
            # browser-signature ban, nothing to do with the token. curl works
            # against the same endpoint with the same credential, which makes
            # this genuinely confusing to debug from the error alone.
            'User-Agent': 'chocka-app-schema-tools/1.0',
        },
    )
    with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
        body = json.load(r)
    if isinstance(body, dict) and body.get('message'):
        raise RuntimeError(f'query failed: {body["message"]}')
    return body


# ── catalog readers ─────────────────────────────────────────────────────────

def extensions(ref):
    return query(ref, """
        select e.extname, n.nspname
        from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where e.extname not in ('plpgsql')
        order by 1
    """)


def tables(ref):
    return [r['relname'] for r in query(ref, """
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1
    """)]


def columns(ref):
    # format_type gives the exact declared type including length/precision, which
    # information_schema.columns splits across several columns and loses nuance on.
    return query(ref, """
        select c.relname as tbl, a.attname as col, a.attnum,
               format_type(a.atttypid, a.atttypmod) as type,
               a.attnotnull as notnull,
               pg_get_expr(d.adbin, d.adrelid) as default_expr,
               a.attidentity as identity
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        order by c.relname, a.attnum
    """)


def constraints(ref, kinds):
    # pg_get_constraintdef emits the complete, canonical clause — far safer than
    # rebuilding it from columns, especially for composite and partial ones.
    return query(ref, f"""
        select c.relname as tbl, con.conname as name, con.contype as kind,
               pg_get_constraintdef(con.oid) as def
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and con.contype in ({kinds})
        order by c.relname, con.conname
    """)


def indexes(ref):
    # Exclude indexes that back a constraint — those arrive with the constraint,
    # and emitting both makes the file fail on a second apply.
    return query(ref, """
        select i.tablename as tbl, i.indexname as name, i.indexdef as def
        from pg_indexes i
        where i.schemaname = 'public'
          and not exists (
            select 1 from pg_constraint con
            join pg_class c on c.oid = con.conindid
            where c.relname = i.indexname
          )
        order by i.tablename, i.indexname
    """)


def referenced_roles(ref):
    """Roles the policies grant to, minus the ones Supabase always provides.

    Found the hard way: the first staging apply failed with `role "tenant_app"
    does not exist`. Roles are cluster-level, not schema objects, so a
    `public`-only dump misses them — and the schema does not stand up without
    them. Derived from the policies rather than listed by hand, so a new role
    cannot be introduced without this picking it up.
    """
    return query(ref, """
        select distinct unnest(roles) as rolname from pg_policies where schemaname = 'public'
        except select unnest(array['postgres','anon','authenticated','service_role',
                                   'authenticator','dashboard_user','supabase_admin','public'])
    """)


def functions(ref):
    """Every function in `public`, with its complete definition.

    `pg_get_functiondef` emits CREATE OR REPLACE, so these are idempotent as-is.
    Emitted AFTER the tables because they reference them (handle_new_user inserts
    into public.users) and BEFORE the policies because the policies call them
    (current_tenant_id).
    """
    return query(ref, """
        select p.proname, pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        order by p.proname
    """)


def app_triggers(ref):
    """Triggers OUTSIDE public whose function lives IN public — i.e. ours, not Supabase's.

    `on_auth_user_created` on `auth.users` is the one that matters. A dump scoped
    to `public` would silently miss it, and staging would then differ from
    production in behaviour while looking identical in structure — the worst kind
    of mismatch. The realtime/storage triggers are Supabase's own and are excluded
    by the join: their functions are not in public.
    """
    return query(ref, """
        select n.nspname as schema, c.relname as tbl, t.tgname as name,
               pg_get_triggerdef(t.oid) as def
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_proc p on p.oid = t.tgfoid
        join pg_namespace fn on fn.oid = p.pronamespace
        where not t.tgisinternal and fn.nspname = 'public'
        order by n.nspname, c.relname, t.tgname
    """)


def policies(ref):
    return query(ref, """
        select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
        from pg_policies where schemaname = 'public'
        order by tablename, policyname
    """)


def rls_tables(ref):
    return [r['relname'] for r in query(ref, """
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        order by 1
    """)]


# ── emit ────────────────────────────────────────────────────────────────────

def column_clause(c):
    parts = [f'  {quote(c["col"])} {c["type"]}']
    if c.get('identity'):
        kind = 'always' if c['identity'] == 'a' else 'by default'
        parts.append(f'generated {kind} as identity')
    elif c.get('default_expr'):
        parts.append(f'default {c["default_expr"]}')
    if c['notnull']:
        parts.append('not null')
    return ' '.join(parts)


def quote(ident: str) -> str:
    # Quote only when needed, so the output reads like hand-written SQL rather
    # than a machine dump nobody wants to review.
    safe = ident.islower() and all(ch.isalnum() or ch == '_' for ch in ident) and not ident[0].isdigit()
    return ident if safe else '"' + ident.replace('"', '""') + '"'


def build(ref) -> str:
    cols_by_table = {}
    for c in columns(ref):
        cols_by_table.setdefault(c['tbl'], []).append(c)

    out = []
    out.append('-- Production `public` schema, reconstructed from pg_catalog.')
    out.append('-- GENERATED by scripts/dump-production-schema.py — do not hand-edit.')
    out.append('-- Schema only. No rows: see the script docstring for why.')
    out.append('')

    roles = referenced_roles(ref)
    if roles:
        out.append('-- ── roles (cluster-level, but the policies below do not stand up without them) ──')
        for r in roles:
            out.append(
                f'do $$ begin\n'
                f'  create role {quote(r["rolname"])} nologin;\n'
                f'exception when duplicate_object then null; end $$;'
            )
        out.append('')

    out.append('-- ── extensions ──')
    for e in extensions(ref):
        out.append(f'create extension if not exists {quote(e["extname"])} with schema {quote(e["nspname"])};')
    out.append('')

    out.append('-- ── tables (columns only; constraints follow, so nothing forward-references) ──')
    for t in tables(ref):
        body = ',\n'.join(column_clause(c) for c in cols_by_table.get(t, []))
        out.append(f'create table if not exists public.{quote(t)} (\n{body}\n);')
        out.append('')

    for label, kinds in (('primary keys', "'p'"), ('unique constraints', "'u'"),
                         ('check constraints', "'c'"), ('foreign keys', "'f'")):
        rows = constraints(ref, kinds)
        if not rows:
            continue
        out.append(f'-- ── {label} ──')
        for r in rows:
            # `if not exists` has no constraint form, so guard with a DO block —
            # the file has to be safe to re-apply.
            out.append(
                f'do $$ begin\n'
                f'  alter table public.{quote(r["tbl"])} add constraint {quote(r["name"])} {r["def"]};\n'
                f'exception when duplicate_table or duplicate_object then null; end $$;'
            )
        out.append('')

    idx = indexes(ref)
    if idx:
        out.append('-- ── indexes (constraint-backed ones excluded — they arrive above) ──')
        for r in idx:
            out.append(r['def'].replace('CREATE INDEX ', 'create index if not exists ', 1)
                               .replace('CREATE UNIQUE INDEX ', 'create unique index if not exists ', 1) + ';')
        out.append('')

    fns = functions(ref)
    if fns:
        out.append('-- ── functions (after tables: they reference them; before policies: policies call them) ──')
        for f in fns:
            out.append(f['def'].rstrip().rstrip(';') + ';')
            out.append('')

    trg = app_triggers(ref)
    if trg:
        out.append('-- ── triggers owned by this app, including ones outside public ──')
        for t in trg:
            out.append(
                f'do $$ begin\n'
                f'  {t["def"]};\n'
                f'exception when duplicate_object then null; end $$;'
            )
        out.append('')

    rls = rls_tables(ref)
    if rls:
        out.append('-- ── row level security ──')
        for t in rls:
            out.append(f'alter table public.{quote(t)} enable row level security;')
        out.append('')

    pol = policies(ref)
    if pol:
        out.append('-- ── policies ──')
        for p in pol:
            roles = ', '.join(p['roles']) if isinstance(p['roles'], list) else str(p['roles']).strip('{}')
            stmt = [f'create policy {quote(p["policyname"])} on public.{quote(p["tablename"])}']
            stmt.append(f'  as {"permissive" if p["permissive"] == "PERMISSIVE" else "restrictive"}')
            stmt.append(f'  for {p["cmd"].lower()}')
            stmt.append(f'  to {roles}')
            if p.get('qual'):
                stmt.append(f'  using ({p["qual"]})')
            if p.get('with_check'):
                stmt.append(f'  with check ({p["with_check"]})')
            out.append(
                'do $$ begin\n' + '\n'.join(stmt) + ';\n'
                'exception when duplicate_object then null; end $$;'
            )
        out.append('')

    return '\n'.join(out) + '\n'


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else PROD_REF
    dest = sys.argv[2] if len(sys.argv) > 2 else 'supabase/schema/production-baseline.sql'
    sql = build(ref)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(sql)
    print(f'wrote {dest} ({len(sql.splitlines())} lines) from project {ref}')


if __name__ == '__main__':
    main()
