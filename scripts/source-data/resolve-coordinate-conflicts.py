#!/usr/bin/env python3
"""
Resolve the 37 rows whose postcode and lat/lng disagree in the source data.
THIS SCRIPT WRITES NOTHING BUT A JSON FILE.

WHY THIS EXISTS
    `verify-all.py` added a proximity arm and, as a by-product, found 37 rows
    where the row's postcode matches the Google candidate's address while the
    row's own lat/lng sits more than 250m away. Those two fields disagree in
    the source. It changed no verdict — the postcode is what the original run
    matched on — but it means proximity cannot serve as an independent second
    signal for those rows, which was the whole reason for wanting lat/lng
    imported onto `retailers` in the first place.

    "Fix it upstream" was the recorded intent. Upstream is Tarkett's store
    locator, which we do not control, so what can actually be done is to
    establish WHICH of the two fields is wrong, on evidence, and record the
    correction.

THE METHOD, AND WHY IT IS NOT CIRCULAR
    The obvious move — overwrite each row's lat/lng with the coordinates of the
    Google business it matched — would be worthless. Proximity is wanted as an
    INDEPENDENT check on the match; deriving the coordinates from the match
    makes the check tautological, and it would then confirm every match forever,
    including the wrong ones.

    So the ground truth here is the postcode itself, geocoded by postcodes.io
    (ONS/Ordnance Survey open data, no key, no Google involvement). The chain:

      1. The row's postcode P appears verbatim in the matched candidate's
         Google-formatted address — that is what `pc_hit` means in verify-all.
         So the matched business is at P according to Google's own address text.
      2. postcodes.io independently places P at a centroid.
      3. If the row's own lat/lng is far from that centroid, the row's lat/lng
         contradicts the row's own postcode — with no reference to Google's
         coordinates at any point.

    Two independent sources agreeing on the postcode, against one field that
    agrees with neither, is what makes this a verdict rather than a guess.

WHAT IT WRITES, AND WHAT IT DELIBERATELY DOES NOT
    Output is `coordinate-conflicts-2026-08-05.json` only.

    `retailers-locations.csv` is NOT modified. It stays byte-identical to the
    vendor export apart from the documented privacy scrub, exactly as the three
    postcode defects in FOLLOWUPS are "recorded but not applied". Overwriting it
    would destroy the record of what Tarkett actually published and make the
    file unreproducible from source. The corrected coordinates live in the
    artefact, ready for the lat/lng import if that is ever decided on.

    Nothing here touches the database. `retailers` has no coordinate columns at
    all — that import is a separate, still-undecided question.

    Reads no credentials. postcodes.io needs no key.
"""
import csv, json, math, os, re, ssl, urllib.request

import certifi
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

HERE = os.path.dirname(os.path.abspath(__file__))
VERIFICATION = f'{HERE}/verification-2026-08-03.json'
LOCATIONS = f'{HERE}/retailers-locations.csv'
OUT_PATH = f'{HERE}/coordinate-conflicts-2026-08-05.json'

# The same threshold verify-all.py used to raise the conflict, reused rather
# than re-chosen so "the 37" means the same thing in both files.
NEAR_METRES = 250

POSTCODES_IO = 'https://api.postcodes.io/postcodes'


def haversine_m(lat1, lng1, lat2, lng2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def tidy_postcode(pc):
    """Collapse whitespace and upper-case. Does NOT repair a malformed postcode.

    One row needs more than tidying: `29705` carries `NE24 5 SU`, with a space
    inside the inward code. postcodes.io rejects it as written and accepts
    `NE24 5SU`, so the space is closed for the LOOKUP only — the source string
    is reported unchanged in the output. That row has its own open question in
    FOLLOWUPS (NE24 is Blyth, not North Shields, and looks copied from the other
    branch of the same business), which this script does not attempt to settle.
    """
    return re.sub(r'\s+', ' ', (pc or '').strip().upper())


def lookup_postcodes(postcodes):
    """Bulk-geocode via postcodes.io. Returns {query: {lat, lng, quality} | None}."""
    out = {}
    # The bulk endpoint caps at 100 per request; 37 fits in one, but chunk anyway
    # so this does not quietly truncate if the conflict set ever grows.
    uniq = sorted(set(postcodes))
    for i in range(0, len(uniq), 100):
        chunk = uniq[i:i + 100]
        req = urllib.request.Request(
            POSTCODES_IO,
            data=json.dumps({'postcodes': chunk}).encode(),
            headers={'Content-Type': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
            body = json.load(r)
        for item in body['result']:
            res = item['result']
            out[item['query']] = (
                {'latitude': res['latitude'], 'longitude': res['longitude'],
                 'quality': res.get('quality'), 'admin_district': res.get('admin_district')}
                if res else None
            )
    return out


def main():
    verification = json.load(open(VERIFICATION, encoding='utf-8'))
    overrides = verification['postcode_overrides_applied']
    locations = {r['id']: r for r in csv.DictReader(open(LOCATIONS, encoding='utf-8'))}

    # The conflict set, taken from the verification artefact rather than
    # recomputed, so this cannot silently disagree with the 37 that FOLLOWUPS
    # and verify-all.py both refer to.
    conflicts = []
    for row in verification['results']:
        flagged = [c for c in row['candidates'] if c.get('row_coords_conflict_with_postcode')]
        if not flagged:
            continue
        # Prefer the candidate the original run actually matched — that is the
        # one whose postcode agreement is load-bearing for the recorded score.
        cand = next((c for c in flagged if c.get('is_original_match')), None) or flagged[0]
        conflicts.append((row, cand))

    # The two postcode typos verify-all.py already corrected are honoured here
    # too; geocoding `CA1 25N` would fail and geocoding the raw blank would be
    # meaningless.
    queries = {}
    for row, _ in conflicts:
        queries[row['id']] = tidy_postcode(overrides.get(row['id'], row['row_postcode']))

    # 29705's stray inward-code space, for the lookup only. See tidy_postcode.
    lookup_key = {rid: q.replace('NE24 5 SU', 'NE24 5SU') for rid, q in queries.items()}
    centroids = lookup_postcodes(lookup_key.values())

    results = []
    for row, cand in conflicts:
        rid = row['id']
        src = locations[rid]
        row_lat, row_lng = float(src['latitude']), float(src['longitude'])
        centroid = centroids.get(lookup_key[rid])

        rec = {
            'id': rid,
            'name': row['name'],
            'town': row['town'],
            'source_postcode': row['row_postcode'],
            'postcode_used': queries[rid],
            'postcode_corrected_upstream': rid in overrides,
            'source_latitude': row_lat,
            'source_longitude': row_lng,
            'matched_candidate': {
                'name': cand['name'],
                'address': cand['address'],
                'distance_from_source_coords_m': cand['fixed']['distance_m'],
            },
            'verification_verdict': row['verdict'],
        }

        if not centroid:
            rec['resolution'] = 'UNRESOLVED'
            rec['why'] = 'postcodes.io could not geocode this postcode'
            results.append(rec)
            continue

        d = haversine_m(row_lat, row_lng, centroid['latitude'], centroid['longitude'])
        rec['postcode_centroid'] = centroid
        rec['distance_source_coords_to_own_postcode_m'] = round(d)

        # The verdict. Note what is being compared: the row's lat/lng against
        # the row's OWN postcode. Google is not an input.
        if d > NEAR_METRES:
            rec['resolution'] = 'LATLNG_IS_WRONG'
            rec['why'] = (
                f"the row's own coordinates are {d:.0f}m from its own postcode "
                f"{queries[rid]}, and the matched business carries that postcode "
                f"in its Google address — two independent sources place this "
                f"business at the postcode, so the lat/lng is the field at fault"
            )
            rec['corrected_latitude'] = centroid['latitude']
            rec['corrected_longitude'] = centroid['longitude']
            rec['correction_source'] = 'postcodes.io centroid of the row postcode'
        else:
            # Flagged by verify-all, but the row's two fields actually agree.
            # The >250m gap there was to GOOGLE'S pin, which sits wherever
            # Google places a business rather than at the postcode centroid —
            # a retail park or a large unit will do this legitimately.
            rec['resolution'] = 'NOT_A_SOURCE_CONFLICT'
            rec['why'] = (
                f"the row's coordinates are {d:.0f}m from its own postcode, within "
                f"the {NEAR_METRES}m threshold — the source fields agree with each "
                f"other, and the gap flagged by verify-all.py is to Google's pin, "
                f"not evidence of a defect in this row"
            )

        results.append(rec)

    results.sort(key=lambda r: -(r.get('distance_source_coords_to_own_postcode_m') or 0))

    counts = {}
    for r in results:
        counts[r['resolution']] = counts.get(r['resolution'], 0) + 1

    out = {
        'generated_for': 'resolving the 37 postcode/lat-lng conflicts found by verify-all.py',
        'source': 'verification-2026-08-03.json + retailers-locations.csv',
        'ground_truth': 'postcodes.io (ONS/OS open data) — deliberately NOT the matched Google candidate, see the module docstring',
        'near_metres': NEAR_METRES,
        'applied_to_csv': False,
        'applied_to_database': False,
        'rows': len(results),
        'counts': counts,
        'results': results,
    }
    json.dump(out, open(OUT_PATH, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

    print(f'{len(results)} conflict rows resolved -> {OUT_PATH}')
    for k in sorted(counts):
        print(f'  {k}: {counts[k]}')


if __name__ == '__main__':
    main()
