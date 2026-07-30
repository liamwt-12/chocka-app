#!/usr/bin/env python3
"""
Re-verify the scored.csv match-confidence buckets against Google Places.

For every row that needs a human glance (the 36 `review` rows and the 5 `high`
rows whose normalised name is <= 3 chars), re-fetch the recorded place_id and
recompute BOTH arms of classifyMatch, recording which one actually matched --
the thing the original run never wrote down.

Reads GOOGLE_PLACES_API_KEY from the environment. Never prints it.
Writes results to verify_matches.json in this directory.
"""
import csv, json, os, re, ssl, sys, time, urllib.request, urllib.error

# This Homebrew Python has no system CA bundle wired up, so urllib fails TLS
# verification against googleapis.com. Use certifi's bundle explicitly rather
# than disabling verification.
import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

REPO = '/Users/liam/chocka-app'
HERE = os.path.dirname(os.path.abspath(__file__))
PLACES_BASE = 'https://places.googleapis.com/v1'
KEY = os.environ.get('GOOGLE_PLACES_API_KEY', '').strip()
if not KEY:
    sys.exit('GOOGLE_PLACES_API_KEY not set in environment')


# ── exact ports of publicAudit.ts:176-227 ────────────────────────────────────
TRADE = re.compile(r'\b(ltd|limited|llp|plc|co|company|the|uk|flooring|floors|carpets?)\b')

def normalise_name(s):
    s = s.lower().replace('&', ' and ')
    s = TRADE.sub(' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return s.strip()

def normalise_postcode(s):
    return re.sub(r'[^A-Z0-9]', '', (s or '').upper())

def name_similarity(a, b):
    ta = {t for t in normalise_name(a).split(' ') if t}
    tb = {t for t in normalise_name(b).split(' ') if t}
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)

def name_strong(row_name, cand_name):
    """Returns (bool, why) -- which clause of nameStrong fired."""
    sim = name_similarity(row_name, cand_name)
    na, nb = normalise_name(row_name), normalise_name(cand_name)
    if sim >= 0.6:
        return True, f'jaccard {sim:.2f} >= 0.60'
    if na and (nb.find(na) >= 0 or na.find(nb) >= 0):
        direction = 'candidate contains row' if nb.find(na) >= 0 else 'row contains candidate'
        return True, f'SUBSTRING ({direction}: {na!r} vs {nb!r}), jaccard only {sim:.2f}'
    return False, f'jaccard {sim:.2f} < 0.60, no substring'

def postcode_matches(row_pc, cand_addr):
    pc = normalise_postcode(row_pc)
    if not pc:
        return False, 'row has NO postcode -- arm structurally dead'
    hit = pc in normalise_postcode(cand_addr)
    return hit, ('postcode %s found in address' % pc) if hit else ('postcode %s NOT in address' % pc)


# ── Places Details ───────────────────────────────────────────────────────────
def place_details(place_id):
    req = urllib.request.Request(
        f'{PLACES_BASE}/places/{place_id}',
        headers={
            'X-Goog-Api-Key': KEY,
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,businessStatus',
        },
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(0.8 * 2 ** attempt)
                continue
            return {'__error': f'HTTP {e.code}: {body}'}
        except Exception as e:
            if attempt < 2:
                time.sleep(0.8 * 2 ** attempt)
                continue
            return {'__error': str(e)}


# ── load data ────────────────────────────────────────────────────────────────
ck = json.load(open(f'{REPO}/scripts/source-data/.score-checkpoint.json'))
locs = {r['id']: r for r in csv.DictReader(
    open(f'{REPO}/scripts/source-data/retailers-locations.csv', encoding='utf-8'))}

targets = []
for rid, row in ck.items():
    conf = row.get('matchConfidence')
    short = len(normalise_name(row['name'])) <= 3
    if conf == 'review':
        targets.append((rid, row, 'review'))
    elif conf == 'high' and short:
        targets.append((rid, row, 'high-shortname'))

targets.sort(key=lambda t: (t[2], t[1]['name']))
print(f'targets: {len(targets)}  '
      f"({sum(1 for t in targets if t[2]=='review')} review, "
      f"{sum(1 for t in targets if t[2]=='high-shortname')} high-shortname)", flush=True)

results = []
for i, (rid, row, bucket) in enumerate(targets, 1):
    loc = locs.get(rid, {})
    pc = loc.get('postcode', '')
    pid = row.get('placeId') or ''
    rec = {
        'id': rid, 'bucket': bucket, 'row_name': row['name'], 'town': row['town'],
        'row_postcode': pc, 'place_id': pid,
        'orig_confidence': row.get('matchConfidence'), 'orig_score': row.get('score'),
        'reviews': row.get('reviews'),
    }
    if not pid:
        rec['verdict'] = 'NO_PLACE_ID'
        results.append(rec); continue

    d = place_details(pid)
    if '__error' in d:
        rec['verdict'] = 'FETCH_ERROR'; rec['error'] = d['__error']
        results.append(rec)
        print(f"  [{i}/{len(targets)}] {row['name'][:32]:32} FETCH_ERROR {d['__error'][:60]}", flush=True)
        continue

    cand_name = (d.get('displayName') or {}).get('text', '')
    cand_addr = d.get('formattedAddress', '')
    ns, ns_why = name_strong(row['name'], cand_name)
    pm, pm_why = postcode_matches(pc, cand_addr)

    rec.update({
        'cand_name': cand_name, 'cand_address': cand_addr,
        'business_status': d.get('businessStatus'),
        'name_arm': ns, 'name_why': ns_why,
        'postcode_arm': pm, 'postcode_why': pm_why,
        'recomputed': 'high' if (ns and pm) else ('review' if (ns or pm) else 'not_found'),
    })
    if ns and pm:
        rec['which_arm'] = 'BOTH'
    elif ns:
        rec['which_arm'] = 'NAME_ONLY'
    elif pm:
        rec['which_arm'] = 'POSTCODE_ONLY'
    else:
        rec['which_arm'] = 'NEITHER'
    results.append(rec)
    print(f"  [{i}/{len(targets)}] {row['name'][:30]:30} -> {rec['which_arm']:14} "
          f"cand={cand_name[:34]}", flush=True)
    time.sleep(0.12)

out = f'{HERE}/verify_matches.json'
json.dump(results, open(out, 'w'), indent=2)
print(f'\nwrote {out}  ({len(results)} rows)')
