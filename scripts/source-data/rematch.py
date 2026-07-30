#!/usr/bin/env python3
"""
Re-match pass, 2026-07-30.

(a) The 8 `NOT FOUND` rows -- re-run findPlace now that Elvet has a postcode, to
    find out whether each hard 0 is a real absence from Google or a search miss.
(b) The 4 highest-scoring suspect rows -- dump the FULL candidate list, not just
    the winner, so a human can see whether the right business exists under a
    different place_id or whether the matched candidate is all there is.

Replicates findPlace/classifyMatch from publicAudit.ts:263-308 exactly, including
the 5km locationBias and maxResultCount 5. Reads GOOGLE_PLACES_API_KEY from env.
"""
import csv, json, os, re, ssl, sys, time, urllib.request, urllib.error
import certifi

SSL_CTX = ssl.create_default_context(cafile=certifi.where())
REPO = '/Users/liam/chocka-app'
HERE = os.path.dirname(os.path.abspath(__file__))
PLACES_BASE = 'https://places.googleapis.com/v1'
KEY = os.environ.get('GOOGLE_PLACES_API_KEY', '').strip()
if not KEY:
    sys.exit('GOOGLE_PLACES_API_KEY not set')

# ── exact ports of publicAudit.ts:176-227 ────────────────────────────────────
TRADE = re.compile(r'\b(ltd|limited|llp|plc|co|company|the|uk|flooring|floors|carpets?)\b')

def norm(s):
    s = s.lower().replace('&', ' and ')
    s = TRADE.sub(' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()

def norm_pc(s):
    return re.sub(r'[^A-Z0-9]', '', (s or '').upper())

def similarity(a, b):
    ta = {t for t in norm(a).split(' ') if t}
    tb = {t for t in norm(b).split(' ') if t}
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)

def classify(row_name, row_pc, cand_name, cand_addr):
    sim = similarity(row_name, cand_name)
    na, nb = norm(row_name), norm(cand_name)
    substring = bool(na) and (na in nb or nb in na)
    name_strong = sim >= 0.6 or substring
    pc = norm_pc(row_pc)
    pc_hit = bool(pc) and pc in norm_pc(cand_addr)
    conf = 'high' if (name_strong and pc_hit) else ('review' if (name_strong or pc_hit) else 'not_found')
    why = f'jaccard {sim:.2f}'
    if substring and sim < 0.6:
        why += f' + SUBSTRING({na!r} vs {nb!r})'
    if nb == '':
        why += ' [candidate normalises to EMPTY]'
    return conf, name_strong, pc_hit, why

# ── scorePlace, ported from publicAudit.ts so re-scores are comparable ───────
def score_rating(rating):
    """publicAudit.ts:71-75 -- 35 pts, ((r-3)/2)*35, clamped."""
    if not rating or rating <= 0:
        return 0.0
    return max(0.0, min(35.0, ((rating - 3) / 2) * 35))

def score_reviews(n):
    """publicAudit.ts:78-87 -- 40 pts, banded."""
    n = n or 0
    for threshold, pts in ((200, 40), (100, 36), (50, 30), (25, 24), (10, 16), (1, 8)):
        if n >= threshold:
            return pts
    return 0

def score_place(rating, reviews, photos, has_website, has_hours, status):
    """publicAudit.ts:145-157 -- round(rating + reviews + completeness).
    Completeness is 6.25 per part: hours, website, >=5 photos, OPERATIONAL."""
    parts = [has_hours, has_website, (photos or 0) >= 5, status == 'OPERATIONAL']
    completeness = sum(1 for p in parts if p) * (25 / 4)
    return round(score_rating(rating) + score_reviews(reviews) + completeness)

def band_for(score, found):
    """publicAudit.ts:106-112."""
    if not found:
        return 'Invisible'
    if score >= 80: return 'Strong'
    if score >= 60: return 'OK'
    if score >= 40: return 'Needs work'
    return 'At risk'

def search_text(name, postcode, lat=None, lng=None):
    body = {
        'textQuery': f'{name}, {postcode}',
        'languageCode': 'en',
        'regionCode': 'GB',
        'maxResultCount': 5,
    }
    if lat is not None and lng is not None:
        body['locationBias'] = {'circle': {'center': {'latitude': lat, 'longitude': lng},
                                          'radius': 5000}}
    req = urllib.request.Request(
        f'{PLACES_BASE}/places:searchText',
        data=json.dumps(body).encode(),
        headers={
            'X-Goog-Api-Key': KEY,
            'Content-Type': 'application/json',
            'X-Goog-FieldMask': ('places.id,places.displayName,places.formattedAddress,'
                                 'places.location,places.businessStatus,places.rating,'
                                 'places.userRatingCount,places.websiteUri,places.photos,'
                                 'places.regularOpeningHours'),
        },
        method='POST',
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
                return json.load(r).get('places', [])
        except urllib.error.HTTPError as e:
            body_txt = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(0.8 * 2 ** attempt); continue
            return {'__error': f'HTTP {e.code}: {body_txt}'}
        except Exception as e:
            if attempt < 2:
                time.sleep(0.8 * 2 ** attempt); continue
            return {'__error': str(e)}

# ── data ─────────────────────────────────────────────────────────────────────
ck = json.load(open(f'{REPO}/scripts/source-data/.score-checkpoint.json'))
locs = {r['id']: r for r in csv.DictReader(
    open(f'{REPO}/scripts/source-data/retailers-locations.csv', encoding='utf-8'))}

# Corrections established 2026-07-30 (recorded in MATCH_VERIFICATION.md, not
# applied to the CSV). Supply them here so the re-match uses good input.
PC_OVERRIDE = {'29891': 'DH1 5QU'}

SUSPECTS = ['Floor Store U.K', 'Amtico Flooring Installations Limited',
            'The Floor Studio', 'Carpet Cuts']

targets = []
for rid, row in ck.items():
    if row.get('matchConfidence') == 'NOT FOUND':
        targets.append((rid, row, 'not-found-rematch'))
    elif row['name'] in SUSPECTS:
        targets.append((rid, row, 'suspect-handcheck'))
targets.sort(key=lambda t: (t[2], t[1]['name']))

out = []
for rid, row, bucket in targets:
    loc = locs.get(rid, {})
    pc = PC_OVERRIDE.get(rid, loc.get('postcode', ''))
    lat = float(loc['latitude']) if loc.get('latitude') else None
    lng = float(loc['longitude']) if loc.get('longitude') else None

    print('=' * 100)
    print(f"[{bucket}]  {row['name']}   (was: {row.get('matchConfidence')}, score {row.get('score')})")
    print(f"  row: {loc.get('full_address','?')}")
    print(f"  query: {row['name']}, {pc}" + ('   <-- postcode supplied by correction' if rid in PC_OVERRIDE else ''))
    if row.get('placeId'):
        print(f"  originally matched place_id: {row['placeId']}")

    res = search_text(row['name'], pc, lat, lng)
    rec = {'id': rid, 'bucket': bucket, 'row_name': row['name'], 'row_postcode': pc,
           'orig_confidence': row.get('matchConfidence'), 'orig_score': row.get('score'),
           'orig_place_id': row.get('placeId', ''), 'candidates': []}

    if isinstance(res, dict) and '__error' in res:
        print(f"  ERROR: {res['__error']}")
        rec['error'] = res['__error']
        out.append(rec); continue
    if not res:
        print('  NO CANDIDATES RETURNED  -> genuine absence from Places for this query')
        out.append(rec); continue

    for i, p in enumerate(res, 1):
        cname = (p.get('displayName') or {}).get('text', '')
        caddr = p.get('formattedAddress', '')
        conf, ns, pch, why = classify(row['name'], pc, cname, caddr)
        rating = p.get('rating')
        revs = p.get('userRatingCount', 0) or 0
        photos = len(p.get('photos') or [])
        site = bool(p.get('websiteUri'))
        hours = bool(p.get('regularOpeningHours'))
        status = p.get('businessStatus')
        rescore = score_place(rating, revs, photos, site, hours, status)
        flag = ' <== SAME AS ORIGINAL MATCH' if p.get('id') == row.get('placeId') else ''
        print(f"   {i}. {cname}{flag}")
        print(f"      {caddr}")
        print(f"      {status}  rating={rating} reviews={revs} photos={photos} site={site} hours={hours}")
        print(f"      -> {conf.upper():9} name_arm={ns} pc_arm={pch}  ({why})   rescore={rescore} [{band_for(rescore, True)}]")
        rec['candidates'].append({
            'rank': i, 'place_id': p.get('id'), 'name': cname, 'address': caddr,
            'business_status': p.get('businessStatus'), 'rating': rating,
            'reviews': revs, 'photos': photos, 'has_website': site,
            'classify': conf, 'name_arm': ns, 'postcode_arm': pch, 'why': why,
            'has_hours': hours, 'rescore_estimate': rescore,
            'rescore_band': band_for(rescore, True),
            'is_original_match': p.get('id') == row.get('placeId'),
        })
    out.append(rec)
    print()
    time.sleep(0.15)

json.dump(out, open(f'{HERE}/rematch.json', 'w'), indent=2)
print('=' * 100)
print(f'wrote {HERE}/rematch.json  ({len(out)} rows)')
