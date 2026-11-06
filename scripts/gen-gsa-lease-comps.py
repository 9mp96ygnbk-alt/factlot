"""Generate the bundled GSA lease comps that lease_comp_search reads (no registry database needed).

    python3 scripts/gen-gsa-lease-comps.py [October-2026-External.xlsx factlot-lease-comps-gsa-2026-11-04.db.gz]

With the two files, rewrites python/src/factlot/data/gsa_lease_comps.tsv from them: every row of the GSA
file is parsed by the registry adapter (factlot.registry.adapters.gsa_leases.parse_lease, the code that built
the release), so the bundled comps are the release's comps; the GSA file adds the columns the release does
not store as facts (latitude, longitude, current annual rent). The released database is the cross-check:
its snapshot must be this GSA file (same SHA-256), and every bundled comp, landlord and record locator must
equal the release's, or the script stops. The release's .db.gz must match the SHA256SUMS file beside it.
Then writes the TypeScript copy (packages/tools/src/data/gsa_lease_comps.ts) from the TSV; a test in each
language checks the two copies are the same bytes, so regenerate rather than edit them.

Without arguments, only the TypeScript copy is rewritten from the TSV.

Source: U.S. General Services Administration, Lease Inventory (monthly external file),
https://www.gsa.gov/real-estate/real-estate-services/leasing-overview, a US federal government work in the
public domain (GSA asks to be cited). Landlords are kept only where the repo's is_organization rule says the
lessor is an organisation; a natural person's name is never written.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "src"))

from factlot.ids import FactLotIdError, building_id  # noqa: E402
from factlot.registry.adapters import gsa_leases, xlsx_reader  # noqa: E402
from factlot.registry.counties import county_fips  # noqa: E402
from factlot.registry.normalize import is_organization  # noqa: E402

TSV = ROOT / "python" / "src" / "factlot" / "data" / "gsa_lease_comps.tsv"
TS_OUT = ROOT / "packages" / "tools" / "src" / "data" / "gsa_lease_comps.ts"
COLUMNS = ("lease", "row", "location", "street", "city", "state", "zip", "county_fips", "latitude", "longitude",
           "landlord", "rentable_sf", "commencement_date", "expiration_date", "term_months", "early_termination_date",
           "annual_rent_usd", "rent_psf_yr", "property_type", "expense_basis", "comp_type", "renewal_options_left")
CAVEAT = ("These are leases in which the federal government (GSA, for an agency) is the tenant, not market comps for "
          "private tenants. The rent is the lease's current annual rent in GSA's file, not the starting rent; the file "
          "gives no escalations, free rent, tenant improvement allowance or commissions. GSA leases are often full "
          "service and follow GSA's own lease form and requirements (security, build-out standards, termination "
          "rights): adjust before using one for a private tenant, and never mix them silently into market comps.")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def num(x: float) -> str:
    """A number as the TSV writes it: up to two decimals, no trailing zeros."""
    r = round(float(x), 2)
    return str(int(r)) if r.is_integer() else repr(r)


def coordinate(v, lo: float, hi: float) -> str:
    if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi and v != 0:
        return repr(float(v))
    return ""


def clean(s: str | None) -> str:
    s = s or ""
    for bad in ("\t", "\n", "\r", "\\", "`", "${"):
        if bad in s:
            raise ValueError(f"unexpected {bad!r} in {s!r}")
    return s


def read_release(gz: Path, workdir: Path) -> dict:
    sums = gz.parent / "SHA256SUMS"
    gz_sha = sha256(gz)
    if sums.exists():
        listed = {line.split()[1]: line.split()[0] for line in sums.read_text().splitlines() if line.strip()}
        if listed.get(gz.name) != gz_sha:
            sys.exit(f"{gz.name}: sha256 {gz_sha} is not the one SHA256SUMS lists")
    db_path = workdir / gz.name.removesuffix(".gz")
    with gzip.open(gz, "rb") as src, db_path.open("wb") as dst:
        shutil.copyfileobj(src, dst)
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    snap = db.execute("SELECT document_id, retrieved_at, as_of, filename FROM snapshots WHERE source_id = ?",
                      (gsa_leases.SOURCE_ID,)).fetchall()
    if len(snap) != 1:
        sys.exit(f"the release holds {len(snap)} GSA snapshots; expected one")
    src = db.execute("SELECT publisher, title, url, license, attribution FROM sources WHERE source_id = ?",
                     (gsa_leases.SOURCE_ID,)).fetchone()
    facts: dict[str, dict] = {}
    for subject, predicate, value_json, locator in db.execute(
            "SELECT subject, predicate, value_json, locator FROM current_facts WHERE predicate IN "
            "('lease.comp', 'lease.landlord')"):
        rec = facts.setdefault(subject, {})
        rec[predicate] = json.loads(value_json)
        rec["locator"] = locator
    db.close()
    return {"gz_sha": gz_sha, "release": gz.name.removeprefix("factlot-").removesuffix(".db.gz"),
            "snapshot": snap[0], "source": src, "facts": facts}


def write_tsv(xlsx: Path, gz: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        rel = read_release(gz, Path(tmp))
    document_id, retrieved_at, as_of, filename = rel["snapshot"]
    if document_id != f"fl:document:sha256-{sha256(xlsx)}":
        sys.exit(f"{xlsx.name} is not the file the release was built from ({document_id})")
    publisher, title, landing, license_, _ = rel["source"]

    raw_rows = list(xlsx_reader.rows(xlsx))
    header = [str(h).strip() if h is not None else "" for h in raw_rows[0]]
    lat_i, lon_i, rent_i = header.index("Latitude"), header.index("Longitude"), header.index("Current Annual Rent")

    out, seen = [], set()
    dropped = not_in_release = 0
    for n, rec in gsa_leases.rows(xlsx):
        lease, _ = gsa_leases.parse_lease(n, rec, as_of)
        if lease is None or lease.comp is None:
            continue
        urn = gsa_leases.lease_urn(lease.number)
        released = rel["facts"].get(urn, {})
        c = lease.comp
        if released.get("lease.comp") != c:
            sys.exit(f"{lease.number}: the comp differs from the release's")
        locator = f"row {lease.row} lease {lease.number} location {lease.location}"
        if released.get("locator") != locator:
            sys.exit(f"{lease.number}: locator {locator!r} differs from the release's {released.get('locator')!r}")
        # The landlord is written only when the release stored it (as an organisation) AND the repo's
        # is_organization still says it is one: a later rule change can drop a name, never add one.
        landlord = released.get("lease.landlord", "")
        if landlord and landlord != lease.lessor:
            sys.exit(f"{lease.number}: landlord differs from the release's")
        if landlord and not is_organization(landlord):
            dropped += 1
            landlord = ""
        elif not landlord and lease.lessor and is_organization(lease.lessor):
            not_in_release += 1
        raw = raw_rows[n - 1]
        fips = county_fips(lease.state, lease.county_name)
        # lease_comp_search computes the building ID from these columns, as the adapter did.
        building = None
        if fips and lease.zip5:
            try:
                building = building_id(fips[0], fips[1], lease.zip5, lease.street).urn
            except FactLotIdError:
                pass
        if building != c.get("building"):
            sys.exit(f"{lease.number}: building {building} differs from the comp's {c.get('building')}")
        row = {
            "lease": lease.number, "row": str(lease.row), "location": lease.location, "street": lease.street,
            "city": lease.city, "state": lease.state, "zip": lease.zip5 or "",
            "county_fips": "".join(fips) if fips else "",
            "latitude": coordinate(raw[lat_i] if lat_i < len(raw) else None, -90, 90),
            "longitude": coordinate(raw[lon_i] if lon_i < len(raw) else None, -180, 180),
            "landlord": landlord, "rentable_sf": num(c["area_sf"]), "commencement_date": c["commencement_date"],
            "expiration_date": c["expiration_date"], "term_months": str(c["term_months"]),
            "early_termination_date": c.get("early_termination_date", ""),
            "annual_rent_usd": num(raw[rent_i]), "rent_psf_yr": num(c["current_rent_psf_yr"]),
            "property_type": c.get("property_type", ""), "expense_basis": c.get("expense_basis", ""),
            "comp_type": c["comp_type"],
            "renewal_options_left": str(c["renewal_options"]["count"]) if "renewal_options" in c else "",
        }
        out.append("\t".join(clean(row[k]) for k in COLUMNS))
        seen.add(urn)
    missing = {u for u, f in rel["facts"].items() if "lease.comp" in f} - seen
    if missing:
        sys.exit(f"{len(missing)} comps in the release were not rebuilt from the file, e.g. {sorted(missing)[:3]}")

    meta = {
        "source": f"{publisher}, {title}",
        "landing_page": landing,
        "file_url": f"https://www.gsa.gov/system/files/{filename}",
        "document_id": document_id,
        "as_of": as_of,
        "retrieved_at": retrieved_at.replace("+00:00", "Z"),
        "license": "Public domain in the United States: a work of the US federal government (17 U.S.C. 105)",
        "terms": license_,
        "attribution": "Source: U.S. General Services Administration, Lease Inventory (GSA asks to be cited)",
        "release": rel["release"],
        "release_file": f"factlot-{rel['release']}.db.gz",
        "release_sha256": rel["gz_sha"],
        "rows": str(len(out)),
        "caveat": CAVEAT,
    }
    lines = [
        "# GSA lease comps bundled with FactLot (lease_comp_search). Generated by scripts/gen-gsa-lease-comps.py; "
        "do not edit.",
        *[f"# {k}: {clean(v)}" for k, v in meta.items()],
        "\t".join(COLUMNS),
        *out,
    ]
    TSV.parent.mkdir(parents=True, exist_ok=True)
    TSV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(out)} comps -> {TSV.relative_to(ROOT)} (GSA file {document_id}, release {rel['release']} "
          f"sha256 {rel['gz_sha']}); landlords: {sum(1 for r in out if r.split(chr(9))[10])} kept, {dropped} the "
          f"release kept that is_organization now rejects (dropped), {not_in_release} is_organization now accepts "
          "that the release dropped (left out)")


def write_ts() -> None:
    text = TSV.read_text(encoding="utf-8")
    meta = dict(line[2:].split(": ", 1) for line in text.splitlines() if line.startswith("# ") and ": " in line)
    ts = [
        "// Generated by scripts/gen-gsa-lease-comps.py from python/src/factlot/data/gsa_lease_comps.tsv; do not edit.",
        f"// {meta['source']}, {meta['file_url']}",
        f"// {meta['document_id']}; as of {meta['as_of']}; retrieved {meta['retrieved_at']}; public domain.",
        "",
        "/** The bundled GSA lease comps: the same bytes as python/src/factlot/data/gsa_lease_comps.tsv (typed string so the declaration file stays small). */",
        f"export const GSA_LEASE_COMPS_TSV: string = `{text}`;",
        "",
    ]
    TS_OUT.parent.mkdir(parents=True, exist_ok=True)
    TS_OUT.write_text("\n".join(ts), encoding="utf-8")
    print(f"{meta['rows']} comps -> {TS_OUT.relative_to(ROOT)}")


def main() -> None:
    if len(sys.argv) == 3:
        write_tsv(Path(sys.argv[1]), Path(sys.argv[2]))
    elif len(sys.argv) != 1:
        sys.exit(__doc__)
    write_ts()


if __name__ == "__main__":
    main()
