#!/usr/bin/env python3
"""
Dummy run launcher: STAGING ONLY.

Runs scripts/dummy-run/dummy-run.staging.ts (the real route handlers, with
Google, the AI model, email and SMS all faked) against the staging database,
and proves afterwards that staging is exactly as it was found.

    /usr/local/bin/python3.14 scripts/dummy-run/run.py [--out <results.json>]
    /usr/local/bin/python3.14 scripts/dummy-run/run.py --clean

--clean is for after a run that was killed partway (Ctrl-C, a crash). A killed
run cannot tidy up after itself, and the next ordinary run would then refuse to
start because staging is no longer empty. --clean skips the checks, deletes
only the labelled TEST rows and their files, and reports what is left.

What it does, in order:
  1. Refuses unless the target is the staging project.
  2. Snapshots staging: the schema (the same six probes the migration scripts
     use), an exact row count of every table, the tenants rows, and the number
     of files in storage.
  3. Refuses unless staging has NO users and NO retailers. The run creates and
     deletes its own clearly labelled TEST rows; an empty start is what makes
     "delete all test data" checkable, and guarantees no real row is in reach.
  4. Runs the dummy run. The staging service key is fetched from the Supabase
     Management API (with the same keychain token the migration scripts use),
     handed to that one process through its environment, and never printed or
     written anywhere. Every other secret the app needs is random and made up
     for this run.
  5. Snapshots again and prints every difference. No difference means every
     piece of test data is gone and nothing else changed.

Nothing here can reach production: the project is checked by reference, and
the run itself blocks every outbound request except to the staging database.
"""
import hashlib, importlib.util, json, os, secrets, subprocess, sys, base64, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


stg = load('stg', os.path.join(ROOT, 'scripts', 'apply-migration-to-staging.py'))
prod = load('prodtool', os.path.join(ROOT, 'scripts', 'apply-migration-to-production.py'))
STAGING = 'pauwvdntclmxlcettfgc'
assert stg.STAGING == STAGING, 'staging reference mismatch: refusing to run'


def q(sql):
    return stg.query(STAGING, sql)


def snapshot():
    schema = {name: sorted(r['k'] for r in q(sql)) for name, sql in prod.PROBES.items()}
    tables = [r['k'] for r in q(prod.PROBES['tables'])]
    counts = {}
    for t in sorted(tables):
        counts[t] = q(f'select count(*) as n from public."{t}"')[0]['n']
    tenants = q("select md5(coalesce(string_agg(t::text, '|' order by slug), '')) as h from public.tenants t")[0]['h']
    files = q("select count(*) as n from storage.objects")[0]['n']
    buckets = q("select md5(coalesce(string_agg(b.id || b.public::text, '|' order by b.id), '')) as h from storage.buckets b")[0]['h']
    return {'schema': schema, 'counts': counts, 'tenants_hash': tenants, 'storage_files': files, 'buckets_hash': buckets}


def diff(a, b):
    out = []
    for probe in a['schema']:
        gone = sorted(set(a['schema'][probe]) - set(b['schema'][probe]))
        new = sorted(set(b['schema'][probe]) - set(a['schema'][probe]))
        for x in gone: out.append(f'schema [{probe}] REMOVED: {x}')
        for x in new: out.append(f'schema [{probe}] ADDED: {x}')
    for t in sorted(set(a['counts']) | set(b['counts'])):
        if a['counts'].get(t) != b['counts'].get(t):
            out.append(f"rows in {t}: {a['counts'].get(t)} before, {b['counts'].get(t)} after")
    for k in ('tenants_hash', 'buckets_hash', 'storage_files'):
        if a[k] != b[k]:
            out.append(f'{k}: {a[k]} before, {b[k]} after')
    return out


def staging_service_key():
    """The staging service key, for the child process only. Never printed, never stored."""
    req = urllib.request.Request(
        f'{stg.API}/projects/{STAGING}/api-keys?reveal=true',
        headers={'Authorization': f'Bearer {stg.token()}', 'User-Agent': 'chocka-app-schema-tools/1.0'},
    )
    with urllib.request.urlopen(req, timeout=60, context=stg.SSL_CTX) as r:
        keys = json.load(r)
    for k in keys:
        if k.get('name') == 'service_role' and k.get('api_key'):
            return k['api_key']
    for k in keys:
        if k.get('type') == 'secret' and k.get('api_key'):
            return k['api_key']
    sys.exit('Could not find a staging service key through the Management API.')


def rnd(n=32):
    return secrets.token_hex(n)


def main():
    out_path = None
    if '--out' in sys.argv:
        out_path = os.path.abspath(sys.argv[sys.argv.index('--out') + 1])

    clean_only = '--clean' in sys.argv
    print(f'target: chocka-staging ({STAGING})')
    print('snapshot before …')
    before = snapshot()
    if not clean_only and (before['counts'].get('users', 0) != 0 or before['counts'].get('retailers', 0) != 0):
        sys.exit(f"REFUSED: staging is not empty (users={before['counts'].get('users')}, retailers={before['counts'].get('retailers')}). "
                 'The dummy run only starts from an empty staging, so that no real row can be touched. '
                 'If the last run was killed partway, run this again with --clean.')

    # Only what node needs to start, not the whole shell environment: nothing
    # from this machine's other projects should be within the run's reach.
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'NVM_DIR', 'NVM_BIN', 'TERM') if k in os.environ}
    if clean_only: env['DUMMY_RUN_CLEAN_ONLY'] = '1'
    env.update({
        'NEXT_PUBLIC_SUPABASE_URL': f'https://{STAGING}.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY': staging_service_key(),
        # Everything below is made up for this run and thrown away after it.
        'SECRET_ENCRYPTION_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
        'CANCEL_HASH_SECRET': rnd(), 'SESSION_SECRET': rnd(), 'CRON_SECRET': rnd(), 'ADMIN_PASSWORD': rnd(16),
        'STELLAR_APP_URL': 'http://stellar.localhost:3000',
        'NEXT_PUBLIC_APP_URL': 'http://localhost:3000',
        # Placeholders: every call these would authorise is intercepted and faked.
        'ANTHROPIC_API_KEY': 'dummy-run-not-a-key', 'GOOGLE_CLIENT_ID': 'dummy-run', 'GOOGLE_CLIENT_SECRET': 'dummy-run',
        'GOOGLE_PLACES_API_KEY': 'dummy-run', 'RESEND_API_KEY': 'dummy-run', 'TWILIO_ACCOUNT_SID': 'dummy-run',
        'TWILIO_AUTH_TOKEN': 'dummy-run', 'TWILIO_PHONE_NUMBER': '+440000000000',
        'DUMMY_RUN_STAGING_HOST': f'{STAGING}.supabase.co',
        'DUMMY_RUN_OUT': out_path or '',
    })
    # The run turns these on and off itself, to prove both states.
    for flag in ('SHOP_PHOTOS', 'SHOP_PHOTOS_TO_LISTING', 'TARKETT_CONSOLE_ENABLED', 'EARLY_POST_PREVIEW_EMAILS', 'ANTHROPIC_MODEL'):
        env.pop(flag, None)

    print('running the dummy run …\n')
    code = subprocess.run(['npx', 'vitest', 'run', '--config', 'scripts/dummy-run/vitest.config.ts'], cwd=ROOT, env=env).returncode
    del env

    print('\nsnapshot after …')
    after = snapshot()
    changes = diff(before, after)
    if clean_only:
        left = {t: n for t, n in after['counts'].items() if n and t != 'tenants'}
        print('clean-up finished. ' + ('Rows still present (not TEST data, so not touched): ' + json.dumps(left) if left else 'Staging is empty again apart from the two tenant rows.') + f" Files in storage: {after['storage_files']}.")
        sys.exit(0 if not left and after['storage_files'] == 0 else 1)
    if changes:
        print('STAGING IS NOT AS IT WAS FOUND:')
        for c in changes: print('  ' + c)
    else:
        print('staging is exactly as it was found: schema identical across all six probes, every table has the same number of rows, '
              'tenants unchanged, storage unchanged.')
    if out_path and os.path.exists(out_path):
        data = json.load(open(out_path))
        data['stagingBefore'] = {'counts': before['counts'], 'storage_files': before['storage_files']}
        data['stagingDifferencesAfter'] = changes
        json.dump(data, open(out_path, 'w'), indent=1)
    sys.exit(1 if (code != 0 or changes) else 0)


if __name__ == '__main__':
    main()
