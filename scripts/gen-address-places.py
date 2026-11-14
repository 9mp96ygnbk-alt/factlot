"""Generate the city and ZIP code tables registry_search_address uses to name the counties a place lies in.

    python3 scripts/gen-address-places.py [REGISTRY.db ...]
    python3 scripts/gen-address-places.py --census DIR --retrieved YYYY-MM-DD

With --census, a folder holding the US Census Bureau files named in CENSUS_FILES and the date they were retrieved
(recorded as given, so a rerun on the same files writes the same tables), rewrites
spec/registry/zip-counties.tsv (each ZIP Code Tabulation Area and the counties holding at least ZCTA_MIN_SHARE of
its land, or its largest part) and spec/registry/census-place-counties.tsv (each place, incorporated or census
designated, by state and by its name without its legal description, with every county it lies in), recording the
files' source, vintage, retrieval date and hash in their headers. The Census files are works of the US government
and in the public domain.

With registry files, rewrites spec/registry/address-places.tsv from the situs addresses of their parcels: for each
state, city and ZIP code a parcel label names, the counties (5-digit FIPS, from the parcel URNs) holding at least
MIN_PARCELS of its parcels and at least MIN_SHARE of them, then the other counties holding any of its parcels (so that
a miss never says a place lies only in counties the registry does not hold when one it holds has a parcel labelled
with it). A city or ZIP code with no county of the first kind is kept only when the Census tables know it. Only the
city or ZIP code and the county are kept, never an address. Then writes the TypeScript and Python tables from the TSV; both are tested against it, so regenerate
rather than edit them.

A city is the last comma part of a label after its ZIP code and state ("1 MAIN ST, HOUSTON, TX 77002", "633 W 5TH ST,
LOS ANGELES CA 90071"): one to five words of letters, and not a state code ("1 MAIN ST, TX TX"). A label without a
comma gives its ZIP code only. A ZIP code is
the 5 digits ending the label.
"""

from __future__ import annotations

import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TSV = ROOT / "spec" / "registry" / "address-places.tsv"
ZIP_TSV = ROOT / "spec" / "registry" / "zip-counties.tsv"
PLACE_TSV = ROOT / "spec" / "registry" / "census-place-counties.tsv"
TS_TEMPLATE = ROOT / "scripts" / "address_places.ts.tmpl"
PY_TEMPLATE = ROOT / "scripts" / "address_places.py.tmpl"
CENSUS_FILES = {
    "zcta": ("tab20_zcta520_county20_natl.txt",
             "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
             "US Census Bureau, 2020 ZIP Code Tabulation Area (ZCTA5) to County Relationship File"),
    "place": ("national_place_by_county2020.txt",
              "https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt",
              "US Census Bureau, 2020 Census FIPS Codes for Places by County"),
}
ZCTA_MIN_SHARE = 0.05
# The legal or statistical description a Census place name ends with ("San Antonio city", "Spring CDP"), after
# "(balance)": lower case (or CDP) in the Census files, so a name's own capitalised word stays ("Carson City",
# "Texas City city"). The earliest match wins, so "Juneau city and borough" loses "city and borough".
_PLACE_BALANCE = re.compile(r"\s+\(balance\)$")
_PLACE_SUFFIX = re.compile(r"\s+(?:city and borough|consolidated government|metropolitan government|unified government|"
                           r"metro government|metro township|urban county|zona urbana|comunidad|city|town|village|"
                           r"borough|CDP|municipality|township|corporation|plantation|government)$")
TS_OUT = ROOT / "packages" / "tools" / "src" / "address_places.ts"
PY_OUT = ROOT / "python" / "src" / "factlot" / "registry" / "address_places.py"
MIN_PARCELS = 3
MIN_SHARE = 0.05

STATE_BY_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
    "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
    "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR",
}
_WORDS = re.compile(r"[^A-Z0-9]+")
_ZIP_AFTER_COMMA = re.compile(r"(?:^|[^0-9A-Z_])([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")
_STATE_ZIP_TAIL = re.compile(r"\s[A-Z]{2}\s+([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")


def label_zip(label: str) -> str | None:
    s = label.upper().strip()
    m = _ZIP_AFTER_COMMA.search(s.split(",", 1)[1]) if "," in s else _STATE_ZIP_TAIL.search(s)
    return m.group(1) if m else None


def label_city(label: str) -> str | None:
    """The city a label names after its street line, or None (see the module docstring)."""
    s = label.upper()
    if "," not in s:
        return None
    parts = [w for w in ([x for x in _WORDS.split(p) if x] for p in s.split(",")[1:]) if w]
    while parts and parts[-1][-1].isdigit():
        parts[-1].pop()
        if not parts[-1]:
            parts.pop()
    if parts and parts[-1][-1] in STATE_BY_FIPS.values():
        parts[-1].pop()
        if not parts[-1]:
            parts.pop()
    w = parts[-1] if parts else []
    if not w or len(w) > 5 or not all(re.fullmatch(r"[A-Z]+", x) for x in w):
        return None
    if len(w) == 1 and w[0] in STATE_BY_FIPS.values():
        return None
    return " ".join(w)


def write_tsv(dbs: list[str]) -> None:
    counts: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for path in dbs:
        db = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
        for urn, label in db.execute("SELECT urn, label FROM subjects WHERE kind = 'parcel' AND label IS NOT NULL"):
            m = re.match(r"fl:parcel:us-([0-9]{2})([0-9]{3}):", urn)
            if not m or m.group(1) not in STATE_BY_FIPS:
                continue
            st, county = STATE_BY_FIPS[m.group(1)], m.group(1) + m.group(2)
            for key in (label_city(label), label_zip(label)):
                if key:
                    counts[(st, key)][county] += 1
        db.close()
    census = {(st, key) for st, key, _ in _rows(PLACE_TSV)} | {z for z, _ in _rows(ZIP_TSV)}
    rows = []
    for (st, key), c in sorted(counts.items()):
        total = sum(c.values())
        kept = sorted(f for f, n in c.items() if n >= MIN_PARCELS and n / total >= MIN_SHARE)
        rest = sorted(f for f in c if f not in kept)
        if kept or (st, key) in census or key in census:
            rows.append(f"{st}\t{key}\t{' '.join(kept)}\t{' '.join(rest)}")
    names = ", ".join("/".join(Path(d).parts[-2:]) for d in dbs)
    head = ("# Counties holding the parcels of each city and ZIP code that registry parcel labels name "
            "(scripts/gen-address-places.py): state, city or ZIP code, 5-digit county FIPS codes holding at least "
            f"{MIN_PARCELS} of the place's parcels and {MIN_SHARE:.0%} of them, the other counties holding any of "
            "them (either list may be empty).\n"
            f"# Built from {len(dbs)} registry files ({names}); a place with no county of the first kind is kept "
            "only when the Census tables know it.\n")
    TSV.write_text(head + "\n".join(rows) + "\n", "utf-8")


def _census_head(kind: str, folder: Path, what: str, retrieved: str) -> str:
    import hashlib
    name, url, title = CENSUS_FILES[kind]
    digest = hashlib.sha256((folder / name).read_bytes()).hexdigest()
    return (f"# {what} (scripts/gen-address-places.py --census).\n"
            f"# Source: {title} ({name}), {url}; a work of the US government, in the public domain.\n"
            f"# Vintage 2020; retrieved {retrieved}; sha256 {digest}.\n")


def place_key(name: str) -> str:
    """A Census place name as an address query names the city: "(balance)" and then one legal description left out,
    never more, upper case, words of letters and digits ("St. Louis city" is "ST LOUIS", "Salt Lake City city" is
    "SALT LAKE CITY", "Carson City" stays "CARSON CITY")."""
    n = _PLACE_SUFFIX.sub("", _PLACE_BALANCE.sub("", name), count=1)
    return " ".join(w for w in _WORDS.split(n.upper()) if w)


def write_census(folder: Path, retrieved: str) -> None:
    import csv
    land: dict[str, dict[str, int]] = defaultdict(dict)
    with open(folder / CENSUS_FILES["zcta"][0], encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f, delimiter="|"):
            if r["GEOID_ZCTA5_20"]:
                land[r["GEOID_ZCTA5_20"]][r["GEOID_COUNTY_20"]] = int(r["AREALAND_PART"] or 0)
    rows = []
    for z in sorted(land):
        parts = land[z]
        total = sum(parts.values()) or 1
        top = max(parts.values())
        kept = sorted(c for c, a in parts.items() if a == top or a / total >= ZCTA_MIN_SHARE)
        rows.append(f"{z}\t{' '.join(kept)}")
    head = _census_head("zcta", folder, "Counties holding each ZIP Code Tabulation Area: ZCTA, 5-digit county FIPS "
                        f"codes (those holding at least {ZCTA_MIN_SHARE:.0%} of its land, or its largest part)", retrieved)
    ZIP_TSV.write_text(head + "\n".join(rows) + "\n", "utf-8")
    fips = {v: k for k, v in STATE_BY_FIPS.items()}
    places: dict[tuple[str, str], set[str]] = defaultdict(set)
    with open(folder / CENSUS_FILES["place"][0], encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f, delimiter="|"):
            key = place_key(r["PLACENAME"])
            if key and r["STATE"] in fips:
                places[(r["STATE"], key)].add(r["STATEFP"] + r["COUNTYFP"])
    rows = [f"{st}\t{key}\t{' '.join(sorted(c))}" for (st, key), c in sorted(places.items())]
    head = _census_head("place", folder, "Counties each place lies in: state, the place's name as a query names it "
                        "(its legal description left out; places of one name in a state together), 5-digit county "
                        "FIPS codes", retrieved)
    PLACE_TSV.write_text(head + "\n".join(rows) + "\n", "utf-8")


def _rows(path: Path) -> list[list[str]]:
    return [ln.split("\t") for ln in path.read_text("utf-8").splitlines() if ln and not ln.startswith("#")]


def _zip_data() -> str:
    """ZCTAs ascending, each the difference from the one before and, when they change, its counties."""
    out, prev, last = [], 0, None
    for z, counties in _rows(ZIP_TSV):
        out.append(str(int(z) - prev) if counties == last else f"{int(z) - prev}:{counties}")
        prev, last = int(z), counties
    return ",".join(out)


def _place_data() -> str:
    """One line per state: STATE=name:county codes|..., each county by its last 3 digits."""
    by: dict[str, list[str]] = defaultdict(list)
    for st, key, counties in _rows(PLACE_TSV):
        by[st].append(f"{key}:{' '.join(c[2:] for c in counties.split(' '))}")
    return "\n".join(f"{st}={'|'.join(items)}" for st, items in by.items())


def _source() -> str:
    lines = ZIP_TSV.read_text("utf-8").splitlines()[1:3] + PLACE_TSV.read_text("utf-8").splitlines()[1:3]
    return " ".join(ln[2:] for ln in lines)


def write_tables() -> None:
    lines = [ln for ln in TSV.read_text("utf-8").splitlines() if ln and not ln.startswith("#")]
    body = "\n".join(lines)
    zips, places, source = _zip_data(), _place_data(), _source()
    ts_fips = ", ".join(f'{st}: "{f}"' for f, st in STATE_BY_FIPS.items())
    py_fips = ", ".join(f'"{st}": "{f}"' for f, st in STATE_BY_FIPS.items())
    for template, out, fips in ((TS_TEMPLATE, TS_OUT, ts_fips), (PY_TEMPLATE, PY_OUT, py_fips)):
        text = template.read_text("utf-8")
        for k, v in (("@LABELS@", _js_string(body)), ("@ZIPS@", _js_string(zips)), ("@PLACES@", _js_string(places)),
                     ("@SOURCE@", _js_string(source)), ("@FIPS@", fips)):
            text = text.replace(k, v)
        out.write_text(text, "utf-8")


def _js_string(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--census":
        if len(sys.argv) != 5 or sys.argv[3] != "--retrieved" or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}",
                                                                                   sys.argv[4]):
            sys.exit("usage: gen-address-places.py --census DIR --retrieved YYYY-MM-DD")
        write_census(Path(sys.argv[2]), sys.argv[4])
    elif len(sys.argv) > 1:
        write_tsv(sys.argv[1:])
    write_tables()
