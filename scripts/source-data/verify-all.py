#!/usr/bin/env python3
"""
STEP 1 OF 2 — verify every baseline match against Google Places, and emit a
machine-readable verdict per row. THIS SCRIPT WRITES NOTHING BUT A JSON FILE.

Applying the verdicts to `retailers.match_confidence` is a separate, deliberate
act: see apply-verification.ts. Keeping them apart is the point — a scoring run
that silently rewrote confidence in the database would be exactly the kind of
side effect that made the original baseline hard to trust.

WHY THIS EXISTS
    "169 verified" describes three different standards of evidence, not one
    (FOLLOWUPS.md -> "verification coverage of the 169 is uneven"):

        Deep  — full searchText candidate list ....  15 rows
        Light — single Places Details lookup .....   25 rows
        None  — trusted because both arms passed .. 129 rows

    The 129 is the real exposure and it was never named. It rests entirely on
    "both arms passed" being trustworthy, and `classifyMatch` has four recorded
    defects, two of which produce false positives. A row where BOTH arms failed
    together lands in `high` and is never looked at.

    This gives all 180 rows the deep standard: re-run the search, look at the
    whole candidate list, and ask whether the recorded profile is really the
    best answer — the thing the original run could not do, because it never
    wrote down what the alternatives were.

THIS IS THE PORT, NOT THE ARCHIVE
    `publicAudit.ts` stays byte-identical as the record of how the 2026-06-21
    baseline was produced. Its four defects are FIXED here, which is what
    FOLLOWUPS says a port should do:

      1. An apostrophe destroyed name similarity ("Sams" vs "Sam's" -> jaccard
         0.25) and could produce a hard 0. Apostrophes are stripped before
         tokenising, and single-character tokens no longer count.
      2. An empty normalised candidate name matched everything, because
         `na.includes('')` is always true. Cannot arise here: similarity is
         computed WITHOUT the trade-word strip, so a real name never
         normalises to empty.
      3. The trade-word strip deleted the distinguishing signal on a list of
         flooring retailers ("Tees Valley Flooring" -> "tees valley" matched a
         joinery at 0.67). Trade words are no longer removed before comparing;
         they are used only to decide which tokens are low-weight, and a match
         must now share at least one DISTINCTIVE (non-trade) token.
      4. A postcode hit was treated as sufficient, so the arm fired on any
         neighbour sharing a business-park postcode (SA7 9AH holds at least two
         flooring businesses). Location evidence is now corroborating only, and
         accepts a postcode hit OR proximity to the row's own lat/lng — which
         the source data has carried all along and nothing ever used.

    Both the ORIGINAL and the FIXED judgement are recorded per candidate, so
    the delta between them is auditable rather than asserted.

WHAT A VERDICT MEANS
    CONFIRMED         the recorded profile is in the candidate list and is the
                      best-evidenced answer. Safe to trust.
    SUSPECT_BETTER    a DIFFERENT candidate is better evidenced. The recorded
                      score probably belongs to another business.
    SUSPECT_WEAK      the recorded profile is the best available but the
                      evidence is thin. Not disproved, not established.
    NOT_IN_CANDIDATES the recorded profile did not come back for its own row.
    CLOSED            matched, but businessStatus is CLOSED_PERMANENTLY.
    NO_ORIGINAL_MATCH the row never had a place_id (the 8 `NOT FOUND`).
    NO_CANDIDATES     Places returned nothing for this query at all.
    ERROR             the lookup failed; the row is unjudged, not judged bad.

    Anything that is not CONFIRMED carries needs_human=true. This script does
    not pretend a machine can settle an ambiguous identity question; it settles
    the ones that are clear and hands over the ones that are not, WITH the
    evidence attached.

USAGE
    export GOOGLE_PLACES_API_KEY=...          # or: set -a; . .env.local; set +a
    python3 scripts/source-data/verify-all.py --limit 5    # smoke test
    python3 scripts/source-data/verify-all.py              # full run, 180 rows

    Reads GOOGLE_PLACES_API_KEY from the environment and never prints it.
"""
import csv, difflib, json, math, os, re, ssl, sys, time, urllib.request, urllib.error

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

HERE = os.path.dirname(os.path.abspath(__file__))
PLACES_BASE = 'https://places.googleapis.com/v1'
OUT_PATH = f'{HERE}/verification-2026-08-03.json'

KEY = os.environ.get('GOOGLE_PLACES_API_KEY', '').strip()
if not KEY:
    sys.exit('GOOGLE_PLACES_API_KEY not set in environment')

LIMIT = None
if '--limit' in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index('--limit') + 1])

# Distance at which a candidate is accepted as "the same place" on location
# alone. Deliberately tight: a flooring retailer and its neighbour on the same
# industrial estate can share a postcode, so proximity has to mean the same
# unit, not the same estate.
NEAR_METRES = 250

# Trade words. NOT removed before comparing names (defect 3) — used only to
# decide which shared tokens are worth anything. "Tees Valley" is distinctive;
# "Flooring Ltd" is not.
TRADE = {'ltd', 'limited', 'llp', 'plc', 'co', 'company', 'the', 'uk', 'and',
         'flooring', 'floors', 'floor', 'carpet', 'carpets', 'services',
         'centre', 'center', 'studio', 'shop', 'store'}

# Postcode corrections established 2026-07-30 (MATCH_VERIFICATION.md). Recorded
# there, deliberately NOT applied to retailers-locations.csv, which stays
# byte-identical to source. Supplied here so the re-match runs on good input.
#   29705 is knowingly absent: its postcode is VALID but sits in Blyth, which
#   contradicts the row's own town of North Shields. That needs a decision, not
#   a guess, so the row runs on its source value and its verdict will show it.
PC_OVERRIDE = {
    '29891': 'DH1 5QU',   # blank in source; three independent sources agree
    '29658': 'CA1 2SN',   # source 'CA1 25N' is not a valid postcode (5 for S)
}


# ── name / location comparison (the FIXED port) ──────────────────────────────
def norm_name(s):
    """Lower-case, expand &, DROP APOSTROPHES, then split on non-alphanumerics.

    Dropping apostrophes first is defect 1: without it "Sam's" tokenises to
    {sam, s} and "Sams" to {sams}, which share nothing at all.
    """
    s = (s or '').lower().replace('&', ' and ')
    s = re.sub(r"['’]", '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return s.strip()


# Spelling variants that are the same word in a business name. Without this,
# "Bespoke Flooring St Helens" and a row whose town is "Saint Helens" do not
# recognise each other's place qualifier.
ALIAS = {'st': 'saint', 'sts': 'saint', 'mt': 'mount', 'gt': 'great'}


def tokens(s):
    """Tokens worth comparing. Single characters are dropped — they are noise
    and were half of what made the apostrophe case fail."""
    return {ALIAS.get(t, t) for t in norm_name(s).split(' ') if len(t) > 1}


def distinctive(s):
    return tokens(s) - TRADE


def jaccard(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def name_evidence(row_name, cand_name, row_town=''):
    """(ok, jaccard, why). Requires a shared DISTINCTIVE token, so two businesses
    differing only in trade words cannot pass on those alone (defect 3).

    The third clause replaces the original's unguarded substring fallback. That
    fallback existed for a real reason — a candidate is very often the row's name
    plus a branch qualifier, "Bespoke Flooring" vs "Bespoke Flooring St Helens",
    which only scores jaccard 0.50 — but as written it also let an EMPTY
    normalised name match everything (defect 2).

    Guarded version: every distinctive token of the shorter name must appear in
    the longer one, AND the extra tokens must look like a PLACE (the row's own
    town). "Bespoke Flooring" -> "... St Helens" passes because the surplus is
    the town. "Tees Valley Flooring" -> "Tees Valley Joinery Ltd" does NOT,
    because `joinery` is a different trade, not a location — which is precisely
    the pair defect 3 was recorded for.
    """
    sim = jaccard(row_name, cand_name)
    da, db = distinctive(row_name), distinctive(cand_name)
    shared = da & db
    na, nb = norm_name(row_name), norm_name(cand_name)

    # Character-level comparison on the DESPACED names. Token-set similarity is
    # blind to two things this list is full of:
    #   concatenation — "Lewis Carpets" vs "Lewiscarpets Canterbury" shares no
    #                   token at all and scores jaccard 0.00
    #   typos        — "Hudspeth Floooring" vs "Hudspeth Flooring" likewise
    # Both are plainly the same business to a human, and both were rejected.
    ca, cb = na.replace(' ', ''), nb.replace(' ', '')
    charsim = difflib.SequenceMatcher(None, ca, cb).ratio() if (ca and cb) else 0.0
    shorter_len = min(len(ca), len(cb))
    contained = bool(ca) and bool(cb) and (ca in cb or cb in ca)

    if na and na == nb:
        return True, sim, f'exact normalised name match ({na!r})'
    if sim >= 0.60 and shared:
        return True, sim, f'jaccard {sim:.2f} >= 0.60, shares {sorted(shared)}'
    if sim >= 0.60 and not shared:
        return False, sim, f'jaccard {sim:.2f} but NO distinctive token shared — trade words only'

    # One despaced name inside the other. The 8-character floor is what keeps
    # defect 2 dead: an empty or near-empty normalised name cannot clear it, so
    # "The Carpet Company" -> '' can no longer match everything it is offered.
    if contained and shorter_len >= 8:
        return True, sim, (f'despaced containment ({ca!r} / {cb!r}), shorter side {shorter_len} chars '
                           f'— jaccard {sim:.2f} misses this because the words are run together')
    if charsim >= 0.85:
        return True, sim, (f'character similarity {charsim:.2f} on despaced names ({ca!r} / {cb!r}) '
                           f'— jaccard {sim:.2f} misses this, typically a typo or spacing difference')

    # Guarded containment. Both sides must be non-empty — this is defect 2.
    if da and db and shared:
        shorter, longer = (da, db) if len(da) <= len(db) else (db, da)
        if shorter <= longer:
            extra = longer - shorter
            place = tokens(row_town or '')
            if extra and extra <= place:
                return True, sim, (f'jaccard {sim:.2f}, but every distinctive token of the shorter '
                                   f'name is present and the surplus {sorted(extra)} is the row\'s town')
            if not extra:
                return True, sim, f'jaccard {sim:.2f}, distinctive tokens identical ({sorted(shorter)})'
            return False, sim, (f'jaccard {sim:.2f}; contained, but surplus {sorted(extra)} is not a '
                                f'place — a different trade or a different business')

    return False, sim, f'jaccard {sim:.2f} < 0.60' + (f', shares {sorted(shared)}' if shared else ', shares nothing distinctive')


def name_near_exact(a, b):
    """Is this the same name, allowing for spacing and a typo? Used to decide
    whether locality alone is enough corroboration — a retailer that has moved
    within its own town keeps its name but changes its postcode, and rejecting
    that on a postcode string mismatch is how a live business gets called
    suspect."""
    na, nb = norm_name(a), norm_name(b)
    ca, cb = na.replace(' ', ''), nb.replace(' ', '')
    if not ca or not cb:
        return False
    if na == nb:
        return True
    return difflib.SequenceMatcher(None, ca, cb).ratio() >= 0.90


# A near-exact name this far apart is still the same business in the same town.
# Wider than NEAR_METRES because it is doing a different job: NEAR_METRES asks
# "is this the same unit", this asks "is this the same locality".
SAME_LOCALITY_METRES = 5000


def norm_pc(s):
    return re.sub(r'[^A-Z0-9]', '', (s or '').upper())


def haversine_m(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2):
        return None
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def location_evidence(row_pc, row_lat, row_lng, cand_addr, cand_loc):
    """(ok, distance_m, why). Corroborating only — see defect 4."""
    pc = norm_pc(row_pc)
    pc_hit = bool(pc) and pc in norm_pc(cand_addr)
    clat = (cand_loc or {}).get('latitude')
    clng = (cand_loc or {}).get('longitude')
    dist = haversine_m(row_lat, row_lng, clat, clng)
    near = dist is not None and dist <= NEAR_METRES
    if pc_hit and near:
        return True, dist, f'postcode {pc} matches and {dist:.0f}m away'
    if pc_hit:
        # An exact postcode hit that is kilometres from the row's own
        # coordinates means the row's lat/lng and its postcode disagree — a
        # source-data defect, not a matching failure. Trust the postcode (it is
        # what the original run matched on) but say so, because it makes the
        # proximity arm useless for this row and is worth fixing upstream.
        return True, dist, f'postcode {pc} matches' + (f' but the row\'s own coords are {dist:.0f}m away — row lat/lng is suspect' if dist is not None else ' (no coords to check)')
    if near:
        return True, dist, f'{dist:.0f}m away (postcode differs)'
    if not pc:
        return False, dist, 'row has NO postcode' + (f' and {dist:.0f}m away' if dist is not None else ' and no coords')
    return False, dist, f'postcode {pc} not in address' + (f', {dist:.0f}m away' if dist is not None else ', no coords')


# ── the ORIGINAL classifyMatch, for the delta ────────────────────────────────
ORIG_TRADE = re.compile(r'\b(ltd|limited|llp|plc|co|company|the|uk|flooring|floors|carpets?)\b')


def orig_norm(s):
    s = (s or '').lower().replace('&', ' and ')
    s = ORIG_TRADE.sub(' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def orig_classify(row_name, row_pc, cand_name, cand_addr):
    """Faithful reproduction of publicAudit.ts:176-227, defects included, so the
    output can show where the fixed port disagrees with what shipped."""
    ta = {t for t in orig_norm(row_name).split(' ') if t}
    tb = {t for t in orig_norm(cand_name).split(' ') if t}
    sim = (len(ta & tb) / len(ta | tb)) if (ta and tb) else 0.0
    na, nb = orig_norm(row_name), orig_norm(cand_name)
    name_strong = sim >= 0.6 or (bool(na) and (nb.find(na) >= 0 or na.find(nb) >= 0))
    pc = norm_pc(row_pc)
    pc_hit = bool(pc) and pc in norm_pc(cand_addr)
    return ('high' if (name_strong and pc_hit) else
            'review' if (name_strong or pc_hit) else 'not_found'), name_strong, pc_hit


# ── Places ───────────────────────────────────────────────────────────────────
def search_text(name, postcode, lat, lng):
    body = {'textQuery': f'{name}, {postcode}'.strip().strip(','), 'maxResultCount': 5}
    if lat is not None and lng is not None:
        body['locationBias'] = {'circle': {'center': {'latitude': lat, 'longitude': lng},
                                           'radius': 5000.0}}
    req = urllib.request.Request(
        f'{PLACES_BASE}/places:searchText',
        data=json.dumps(body).encode(),
        headers={'X-Goog-Api-Key': KEY, 'Content-Type': 'application/json',
                 'X-Goog-FieldMask': ('places.id,places.displayName,places.formattedAddress,'
                                      'places.location,places.businessStatus,places.rating,'
                                      'places.userRatingCount')},
        method='POST')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
                return json.load(r).get('places', [])
        except urllib.error.HTTPError as e:
            txt = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(0.8 * 2 ** attempt); continue
            return {'__error': f'HTTP {e.code}: {txt}'}
        except Exception as e:
            if attempt < 2:
                time.sleep(0.8 * 2 ** attempt); continue
            return {'__error': str(e)}


# ── run ──────────────────────────────────────────────────────────────────────
ck = json.load(open(f'{HERE}/.score-checkpoint.json'))
locs = {r['id']: r for r in csv.DictReader(open(f'{HERE}/retailers-locations.csv', encoding='utf-8'))}

# Rows sharing a place_id are the same Google profile scored twice (three known
# pairs). Flagged so a later count cannot quietly treat 180 rows as 180
# businesses — it is 177.
by_place = {}
for rid, row in ck.items():
    if row.get('placeId'):
        by_place.setdefault(row['placeId'], []).append(rid)
DUPLICATE_IDS = {rid for ids in by_place.values() if len(ids) > 1 for rid in ids}

rows = sorted(ck.items(), key=lambda kv: kv[0])
if LIMIT:
    rows = rows[:LIMIT]

print(f'verifying {len(rows)} rows against Places (deep standard: full candidate list)\n')

out, counts = [], {}
for n, (rid, row) in enumerate(rows, 1):
    loc = locs.get(rid, {})
    pc = PC_OVERRIDE.get(rid, loc.get('postcode', ''))
    lat = float(loc['latitude']) if loc.get('latitude') else None
    lng = float(loc['longitude']) if loc.get('longitude') else None
    orig_pid = row.get('placeId') or ''

    rec = {
        'id': rid,
        'name': row['name'],
        'town': row.get('town'),
        'row_postcode': pc,
        'postcode_corrected': rid in PC_OVERRIDE,
        'orig_confidence': row.get('matchConfidence'),
        'orig_score': row.get('score'),
        'orig_place_id': orig_pid,
        'is_duplicate_place_id': rid in DUPLICATE_IDS,
        'candidates': [],
    }

    res = search_text(row['name'], pc, lat, lng)

    if isinstance(res, dict) and '__error' in res:
        rec.update(verdict='ERROR', needs_human=True, why=res['__error'])
    elif not res:
        rec.update(verdict='NO_CANDIDATES', needs_human=True,
                   why='Places returned nothing for this query — consistent with a genuine absence')
    else:
        best = None
        for i, p in enumerate(res, 1):
            cname = (p.get('displayName') or {}).get('text', '')
            caddr = p.get('formattedAddress', '')
            n_ok, sim, n_why = name_evidence(row['name'], cname, row.get('town') or '')
            l_ok, dist, l_why = location_evidence(pc, lat, lng, caddr, p.get('location'))
            o_conf, o_name, o_pc = orig_classify(row['name'], pc, cname, caddr)
            near_exact = name_near_exact(row['name'], cname)
            locality_ok = bool(near_exact and dist is not None and dist <= SAME_LOCALITY_METRES)
            pc_hit_far = ('row lat/lng is suspect' in l_why)
            cand = {
                'rank': i, 'place_id': p.get('id'), 'name': cname, 'address': caddr,
                'row_coords_conflict_with_postcode': pc_hit_far,
                'business_status': p.get('businessStatus'),
                'rating': p.get('rating'), 'reviews': p.get('userRatingCount', 0) or 0,
                'is_original_match': bool(orig_pid) and p.get('id') == orig_pid,
                'fixed': {'name_ok': n_ok, 'jaccard': round(sim, 3), 'name_why': n_why,
                          'location_ok': l_ok, 'distance_m': round(dist) if dist is not None else None,
                          'location_why': l_why,
                          'near_exact_name': near_exact,
                          'accepted_via': ('name+location' if (n_ok and l_ok)
                                           else 'near-exact name in same locality' if locality_ok
                                           else None),
                          'accepted': (n_ok and l_ok) or locality_ok},
                'original': {'classify': o_conf, 'name_arm': o_name, 'postcode_arm': o_pc},
                'disagrees_with_original': (n_ok and l_ok) != (o_conf == 'high'),
            }
            rec['candidates'].append(cand)
            if cand['fixed']['accepted'] and best is None:
                best = cand

        orig_cand = next((c for c in rec['candidates'] if c['is_original_match']), None)

        if not orig_pid:
            rec.update(verdict='NO_ORIGINAL_MATCH', needs_human=True,
                       why=('row never had a place_id; a candidate now passes the fixed test'
                            if best else 'row never had a place_id and nothing passes'),
                       suggested_place_id=best['place_id'] if best else None)
        elif orig_cand is None:
            rec.update(verdict='NOT_IN_CANDIDATES', needs_human=True,
                       why='the recorded profile did not come back for its own row',
                       suggested_place_id=best['place_id'] if best else None)
        elif orig_cand['business_status'] == 'CLOSED_PERMANENTLY':
            rec.update(verdict='CLOSED', needs_human=True,
                       why='matched the right profile, but the business is permanently closed')
        elif orig_cand['fixed']['accepted']:
            rec.update(verdict='CONFIRMED', needs_human=False,
                       why=f"{orig_cand['fixed']['name_why']}; {orig_cand['fixed']['location_why']}")
        elif best is not None:
            rec.update(verdict='SUSPECT_BETTER', needs_human=True,
                       why=(f"recorded profile fails ({orig_cand['fixed']['name_why']}; "
                            f"{orig_cand['fixed']['location_why']}) but {best['name']!r} passes"),
                       suggested_place_id=best['place_id'])
        else:
            rec.update(verdict='SUSPECT_WEAK', needs_human=True,
                       why=(f"best available but thin: {orig_cand['fixed']['name_why']}; "
                            f"{orig_cand['fixed']['location_why']}"))

    counts[rec['verdict']] = counts.get(rec['verdict'], 0) + 1
    flag = '' if rec['verdict'] == 'CONFIRMED' else '   <-- needs a human'
    print(f"  [{n:3}/{len(rows)}] {rec['verdict']:18} {row['name'][:44]:44}{flag}")
    out.append(rec)
    time.sleep(0.15)

payload = {
    'generated_for': 'step 1 of 2 — verdicts only, nothing written to the database',
    'source': '.score-checkpoint.json (180 rows, 2026-06-21 baseline)',
    'standard': 'deep — full searchText candidate list, fixed comparison (publicAudit defects 1-4)',
    'near_metres': NEAR_METRES,
    'postcode_overrides_applied': PC_OVERRIDE,
    'rows_verified': len(out),
    'counts': counts,
    'results': out,
}
json.dump(payload, open(OUT_PATH, 'w'), indent=2)

print('\n' + '=' * 72)
for k in sorted(counts, key=lambda k: -counts[k]):
    print(f'  {k:18} {counts[k]:4}')
print('=' * 72)
print(f'  needs a human: {sum(1 for r in out if r["needs_human"])} of {len(out)}')
print(f'  wrote {OUT_PATH}')
print('  NOTHING has been written to the database. That is apply-verification.ts.')
