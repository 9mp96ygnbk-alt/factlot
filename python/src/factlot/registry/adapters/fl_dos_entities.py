"""Florida Division of Corporations (Sunbiz) corporate data file → ``EntityRecord``.

The Division publishes its corporate database as fixed-length ASCII text files on its public SFTP
server (``sftp.floridados.gov``, published public login): a full quarterly file
(``doc/quarterly/cor/cordata.zip``, about 1.8 GB, ten members split by the last digit of the
document number) and daily files (``doc/cor/YYYYMMDDc.txt``) of the records filed or changed that
day. Both use the same layout.

Layout (the publisher's "Corporate File Definitions", dos.sunbiz.org/data-definitions/cor.html,
read 2026-11-02): 1440-character records, 1-based start positions and lengths:

    1/12 Corporation Number (document number)   13/192 Corporation Name
    205/1 Status: A active, I inactive           206/15 Filing Type (DOMP, DOMNP, FORP, FORNP,
                                                        DOMLP, FORLP, FLAL, FORL, NPREG, TRUST, AGENT)
    221/42 Address 1   263/42 Address 2   305/28 City   333/2 State   335/10 Zip   345/2 Country
                                                        (principal address)
    347/42 Mail Address 1 ... 471/2 Mail Country        (mailing address, same shape)
    473/8 File Date (YYYYMMDD)   481/14 FEI Number   495/1 more-than-six-officers flag
    496/8 Last Transaction Date   504/2 State Country (state or country of formation)
    506..544 annual-report years and dates   545..668 registered agent   669..1436 six officers

Registered-agent and officer fields are not read: they are mostly natural persons. The FEI
(federal employer identification) number is not loaded either; ``taxpayer_number`` stays unset.
State of formation: ``FL`` for the Florida filing types (DOMP, DOMNP, DOMLP, FLAL); for foreign
types the publisher's two-character State Country field when it is a US state code; otherwise
unknown. The mailing address is kept, falling back to the principal address.

``read_entities`` accepts a ``.txt`` file, a ``.zip`` (every ``.txt`` member), or a directory of
either (sorted). Usage:
``python -m factlot.registry.adapters.fl_dos_entities cordata.zip registry.db --as-of 2026-10-07``
"""

from __future__ import annotations

import argparse
import io
import json
import zipfile
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import EntityRecord, IngestStats, Registry, Source

JURISDICTION = "us-fl"
RECORD_LENGTH = 1440

SOURCE = Source(
    source_id="fl-dos-entities",
    publisher="Florida Department of State, Division of Corporations",
    title="Corporate data file (Sunbiz data downloads, public SFTP)",
    url="https://dos.fl.gov/sunbiz/other-services/data-downloads/",
    state_fips="12",
    license="Public record (Fla. Stat. ch. 119); the Division offers the downloads 'as is' for informational purposes, no licence stated",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed by the publisher; public record
    attribution="Florida Department of State, Division of Corporations",
    terms_reviewed="2026-11-02",
)

# Publisher's Status codes.
STATUS = {"A": "active", "I": "inactive"}

# Publisher's Filing Type codes (the layout page's own table).
FILING_TYPES = {
    "DOMP": "Domestic Profit", "DOMNP": "Domestic Non-Profit", "FORP": "Foreign Profit",
    "FORNP": "Foreign Non-Profit", "DOMLP": "Domestic Limited Partnership",
    "FORLP": "Foreign Limited Partnership", "FLAL": "Florida Limited Liability Co.",
    "FORL": "Foreign Limited Liability Co.", "NPREG": "Non-Profit, Registration",
    "TRUST": "Declaration of Trust", "AGENT": "Designation of Registered Agent",
}
FLORIDA_FORMED = frozenset({"DOMP", "DOMNP", "DOMLP", "FLAL"})

# Country codes seen in the real file that do not name a foreign country: "US" (also "Us"), "UN",
# which the publisher does not define (it appears on US addresses), and US state codes typed into
# the country field ("FL"). None of these is appended to an address.
_NOT_A_FOREIGN_COUNTRY = frozenset({"US", "UN"})

US_STATE_CODES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY "
    "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split()
)

# (start, length) per the publisher's layout, 1-based.
FIELDS = {
    "document_number": (1, 12), "name": (13, 192), "status": (205, 1), "filing_type": (206, 15),
    "address_1": (221, 42), "address_2": (263, 42), "city": (305, 28), "state": (333, 2), "zip": (335, 10),
    "country": (345, 2),
    "mail_address_1": (347, 42), "mail_address_2": (389, 42), "mail_city": (431, 28), "mail_state": (459, 2),
    "mail_zip": (461, 10), "mail_country": (471, 2),
    "file_date": (473, 8), "fei_number": (481, 14), "last_transaction_date": (496, 8), "state_country": (504, 2),
}


def parse_record(line: str) -> dict[str, str]:
    """Split one fixed-length record into the fields above (stripped). Short lines are padded."""
    if len(line) < RECORD_LENGTH:
        line = line.ljust(RECORD_LENGTH)
    return {k: line[s - 1:s - 1 + n].strip() for k, (s, n) in FIELDS.items()}


def _address(r: dict[str, str], prefix: str) -> str | None:
    line1 = r.get(f"{prefix}address_1", "")
    line2 = r.get(f"{prefix}address_2", "")
    city = r.get(f"{prefix}city", "")
    state_zip = " ".join(x for x in (r.get(f"{prefix}state", ""), r.get(f"{prefix}zip", "")) if x)
    country = r.get(f"{prefix}country", "").upper()
    parts = [line1, line2, city, state_zip]
    if country and country not in _NOT_A_FOREIGN_COUNTRY and country not in US_STATE_CODES:
        parts.append(country)
    return ", ".join(x for x in parts if x) or None


def state_of_formation(filing_type: str, state_country: str) -> str | None:
    if filing_type in FLORIDA_FORMED:
        return "FL"
    code = state_country.upper()
    return code if code in US_STATE_CODES else None


def _members(path: str | Path) -> Iterator[tuple[str, io.TextIOBase]]:
    """Yield (member name, text stream) for a .txt file, each .txt member of a .zip, or a directory of either."""
    p = Path(path)
    if p.is_dir():
        for child in sorted(p.iterdir()):
            if child.suffix.lower() in (".txt", ".zip"):
                yield from _members(child)
    elif p.suffix.lower() == ".zip":
        with zipfile.ZipFile(p) as z:
            for name in sorted(z.namelist()):
                if name.lower().endswith(".txt"):
                    with z.open(name) as raw:
                        yield name, io.TextIOWrapper(raw, encoding="latin-1", newline="")
    else:
        with open(p, encoding="latin-1", newline="") as f:
            yield p.name, f


def read_records(path: str | Path) -> Iterator[tuple[str, dict[str, str]]]:
    """Yield (member name, parsed record) for every non-blank record."""
    for name, stream in _members(path):
        for line in stream:
            line = line.rstrip("\r\n")
            if line.strip():
                yield name, parse_record(line)


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per record. Records without a document number are yielded
    without a registry number, which the registry counts as skipped."""
    for member, r in read_records(path):
        number = r["document_number"]
        yield EntityRecord(
            legal_name=r["name"],
            registry_jurisdiction=JURISDICTION,
            registry_number=number or None,
            taxpayer_number=None,
            state_of_formation=state_of_formation(r["filing_type"], r["state_country"]),
            mailing_address=_address(r, "mail_") or _address(r, ""),
            status=STATUS.get(r["status"].upper()),
            locator=f"{member} document {number}" if number else None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          link: bool = True) -> tuple[IngestStats, dict[str, int]]:
    """Ingest one archived file into a registry file, then (by default) link parcel owners to entities."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        stats = reg.ingest_entities(read_entities(snapshot_path), snap)
        links = reg.link_owners() if link else {}
        return stats, links
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.fl_dos_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="cordata.zip, a daily YYYYMMDDc.txt, or a directory of them, as archived")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="file date, YYYY-MM-DD (the SFTP listing's modification date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
