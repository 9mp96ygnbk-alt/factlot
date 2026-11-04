"""SEC EDGAR Exhibit 21 (subsidiaries of the registrant, filed with a Form 10-K) → ``entity.parent`` links.

A 10-K's Exhibit 21 lists the registrant's subsidiaries with their jurisdictions of organisation (the layout is not
standardised: an HTML table with a name column and a jurisdiction column, a list of "Name (Delaware)" lines, or
lines grouped under jurisdiction headings). ``read_subsidiaries`` parses what it can read with confidence and
counts the rest; this adapter never fetches (the run script downloads each exhibit once, within the SEC's fair
access rate).

A subsidiary is linked to a registry entity only when **the normalized name is exactly one registered entity's
normalized legal name** (``normalize_name``) **and the exhibit's jurisdiction is that entity's registration state or the
state of formation the registry records for it**. Everything else (a name found in no loaded registry, a foreign
jurisdiction, no jurisdiction, several same-name entities, an entity that has ended) is counted and left alone.
The link is ``inferred``: ``entity.parent`` on the subsidiary (value: the registrant, the exhibit line, the filing, the
rule) and a ``controls`` relationship from the registrant, both citing the exhibit's snapshot, with a confidence of
0.9 when the exhibit's jurisdiction is the state whose registry holds the entity (state registries keep names
unique) and 0.85 when it is only the state of formation the registry records for a foreign registration.

"Subsidiary" is the registrant's own word and covers direct and indirect subsidiaries, so ``entity.parent`` names the
registrant that lists the entity, not necessarily its immediate parent. Many registrants omit minor subsidiaries
(Item 601(b)(21)), and some list only significant ones. The registrant becomes an entity (``fl:entity:us-sec:<CIK>``)
with its legal name, CIK and state of incorporation as the SEC records them.

Usage: ``python -m factlot.registry.adapters.sec_exhibit21 ex21.htm registry.db --cik 104169 --name "Walmart Inc."
--state DE --accession 0000104169-26-000013 --form 10-K --filed 2026-03-14 --report-date 2026-01-31``
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable, Iterator

from ..normalize import STATES, entity_standing, entity_state, normalize_name
from ..store import EntityParent, IngestStats, Registry, Source

US_STATES = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar", "california": "ca", "colorado": "co",
    "connecticut": "ct", "delaware": "de", "district of columbia": "dc", "florida": "fl", "georgia": "ga", "hawaii": "hi",
    "idaho": "id", "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks", "kentucky": "ky", "louisiana": "la",
    "maine": "me", "maryland": "md", "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
    "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv", "new hampshire": "nh", "new jersey": "nj",
    "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
    "oregon": "or", "pennsylvania": "pa", "puerto rico": "pr", "rhode island": "ri", "south carolina": "sc",
    "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut", "vermont": "vt", "virginia": "va",
    "washington": "wa", "west virginia": "wv", "wisconsin": "wi", "wyoming": "wy",
}
# Postal abbreviations are accepted only when the whole cell is one ("DE", "TX"); "OR", "IN", "ME" and the like are
# ordinary words in names.
POSTAL = {v: v for v in US_STATES.values()}
FOREIGN_NAMES = (
    "canada", "ontario", "quebec", "british columbia", "alberta", "manitoba", "nova scotia", "new brunswick",
    "saskatchewan", "england", "wales", "england and wales", "scotland", "northern ireland", "united kingdom", "uk",
    "ireland", "netherlands", "the netherlands", "germany", "france", "spain", "italy", "portugal", "belgium",
    "luxembourg", "switzerland", "austria", "sweden", "norway", "denmark", "finland", "poland", "czech republic",
    "hungary", "romania", "greece", "turkey", "israel", "russia", "cyprus", "malta", "mexico", "brazil", "argentina",
    "chile", "colombia", "peru", "panama", "costa rica", "bermuda", "cayman islands", "british virgin islands",
    "bahamas", "barbados", "jersey", "guernsey", "isle of man", "gibraltar", "china", "hong kong", "macau", "taiwan",
    "japan", "korea", "south korea", "india", "singapore", "malaysia", "thailand", "indonesia", "philippines",
    "vietnam", "australia", "new zealand", "south africa", "nigeria", "egypt", "saudi arabia",
    "united arab emirates", "uae", "qatar", "kuwait", "bahrain", "curacao", "aruba", "marshall islands", "liberia",
    "mauritius", "seychelles", "luxembourg", "guam", "u.s. virgin islands", "us virgin islands", "virgin islands",
)
_JUR_WORDS = re.compile(
    r"\b(?:limited liability company|limited liability partnership|limited partnership|business trust|statutory trust|"
    r"corporation|company|trust|partnership|llc|lp|llp|inc|incorporated|ltd|limited|entity|domestic|foreign|"
    r"organized|incorporated|formed|registered|under the laws of|in|of the|state of|commonwealth of|the)\b")

# Words that mark a cell as a header, a title or prose rather than a subsidiary.
_HEADER = re.compile(
    r"^(?:exhibit\b|name\b|names\b|subsidiar|legal entity|entity name|jurisdiction|state of|state or|"
    r"country of|place of|ownership|percent|%|as of\b|list of\b|schedule\b|the following|note\b|\*|\(?continued|"
    r"ex-21|incorporation|organization|formation|domicile)", re.I)


def jurisdiction_of(text: str) -> tuple[str, str | None] | None:
    """``(raw jurisdiction, state postal code or None)`` when ``text`` is only a jurisdiction, else None.

    Accepts "Delaware", "State of Delaware", "Delaware limited liability company", "DE", "U.S. - Texas",
    "England and Wales"; a US state resolves to its postal code, any other recognised place to None."""
    raw = " ".join(text.replace("\xa0", " ").split()).strip(" :;,.-–—")
    # Dates of organisation and a country tag after the state: "Delaware, U.S.", "California, October 11, 1984",
    # "Maryland (6/28/2005)".
    raw = _DATE_TAIL.sub("", raw).strip(" :;,.-–—")
    raw = re.sub(r"(?i)[,(\s]+(?:u\.?s\.?a?\.?|united states)\)?$", "", raw).strip(" :;,.-–—")
    if not raw or len(raw) > 60:
        return None
    low = re.sub(r"^(?:u\.?s\.?a?\.?|united states)\s*[-–—,:/]\s*", "", raw.lower()).replace(".", "")
    if low in POSTAL and raw.isupper() and len(raw) == 2:
        return raw, low
    core = " ".join(_JUR_WORDS.sub(" ", low).split())
    if core in US_STATES:
        return raw, US_STATES[core]
    if core in FOREIGN_NAMES or low in FOREIGN_NAMES:
        return raw, None
    return None


_MONTHS = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
           r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
_DATE_TAIL = re.compile(rf"(?i)\s*[,(\[]?\s*(?:\d{{1,2}}/\d{{1,2}}/\d{{2,4}}|{_MONTHS}\.?\s+\d{{1,2}},?\s+\d{{4}}|{_MONTHS}\.?\s+\d{{4}}"
                        r"|\d{4})\s*[)\]]?$")
# "The state of incorporation or organization of each subsidiary is Virginia, except as noted below".
_DEFAULT_JUR = re.compile(r"(?i)(?:state|jurisdiction)\s+of\s+(?:incorporation|organi[sz]ation|formation)[^.]{0,80}?\bis\s+"
                          r"(?P<j>[A-Za-z ]+?)\s*(?:,|\(|\.|$)")


# --- reading the document -----------------------------------------------------------------------------

_BLOCK = frozenset({"p", "div", "br", "li", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "center", "ul", "ol"})


class _Rows(HTMLParser):
    """HTML to rows: a ``<tr>`` is one row of cell texts; text outside a table is one single-cell row per block."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._loose: list[str] = []
        self._depth = 0
        self._skip = 0

    def _flush_loose(self) -> None:
        text = " ".join("".join(self._loose).split())
        self._loose = []
        if text:
            self.rows.append([text])

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag in ("script", "style", "head"):
            self._skip += 1
        elif tag == "table":
            self._flush_loose()
            self._depth += 1
        elif tag == "tr" and self._depth:
            self._end_row()
            self._row = []
        elif tag in ("td", "th") and self._depth:
            self._end_cell()
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append("\n")
        elif tag in _BLOCK and not self._depth:
            self._flush_loose()

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "head"):
            self._skip = max(0, self._skip - 1)
        elif tag in ("td", "th") and self._depth:
            self._end_cell()
        elif tag == "tr" and self._depth:
            self._end_row()
        elif tag == "table" and self._depth:
            self._end_row()
            self._depth -= 1
        elif tag in _BLOCK and not self._depth:
            self._flush_loose()

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._cell is not None:
            self._cell.append(data)
        elif not self._depth:
            self._loose.append(data)

    def _end_cell(self) -> None:
        if self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell))
        self._cell = None

    def _end_row(self) -> None:
        self._end_cell()
        if self._row:
            cells = [c for c in self._row]
            if any(c.strip() for c in cells):
                self.rows.append(cells)
        self._row = None

    def close(self) -> None:
        super().close()
        self._end_row()
        self._flush_loose()


def rows_of(path: str | Path) -> list[list[str]]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    if "<" not in text[:2000] and "<TABLE" not in text.upper():  # plain text exhibit: one row per line
        return [[line.strip()] for line in text.splitlines() if line.strip()]
    p = _Rows()
    p.feed(text)
    p.close()
    return p.rows


@dataclass
class Subsidiary:
    name: str
    jurisdiction: str | None  # as the exhibit writes it
    state: str | None  # postal code, lower case, for a US state
    line: int  # 1-based index of the row


@dataclass
class ParseStats:
    rows: int = 0
    subsidiaries: int = 0
    with_jurisdiction: int = 0
    us_state: int = 0
    foreign: int = 0
    no_jurisdiction: int = 0


_TRAIL = re.compile(
    r"^(?P<name>.+?)\s*(?:[,(\[]\s*|\s+[-–—]\s+|\s*[|:]\s*)(?:a\s+|an\s+|the\s+)?(?P<jur>[A-Za-z .'&]+?)"
    r"(?:\s+(?:limited liability company|limited liability partnership|limited partnership|corporation|statutory trust|"
    r"business trust|trust|partnership|company|entity))?\s*[)\]]?\s*$", re.I)
_BAD_NAME = re.compile(r"^[\d\W]*$")


def _clean(s: str) -> str:
    s = s.replace("\xa0", " ").replace("​", "")
    s = re.sub(r"[‘’]", "'", s)
    return " ".join(s.split()).strip(" *†‡§")


def _split_trailing_jurisdiction(text: str) -> tuple[str, str] | None:
    """"Name, LLC (Delaware)" → ("Name, LLC", "Delaware"); "Name - Texas" → ("Name", "Texas")."""
    m = _TRAIL.match(text)
    while m:
        jur = jurisdiction_of(m["jur"].strip())
        if jur is not None and len(m["name"]) >= 2:
            return m["name"].strip(" ,"), m["jur"].strip()
        break
    return None


def read_subsidiaries(path: str | Path) -> tuple[list[Subsidiary], ParseStats]:
    """Subsidiaries listed in an Exhibit 21 file, with the jurisdiction the exhibit gives, and what could not be read."""
    stats = ParseStats()
    out: list[Subsidiary] = []
    current: tuple[str, str | None] | None = None  # jurisdiction heading in force
    default: tuple[str, str | None] | None = None  # "the state of incorporation of each subsidiary is Virginia, except ..."
    in_dba = False  # after "Also Doing Business As:": trade names follow, not subsidiaries
    for n, cells in enumerate(rows_of(path), 1):
        stats.rows += 1
        lines = [[_clean(x) for x in c.split("\n") if _clean(x)] for c in cells]
        lines = [c for c in lines if c]
        if not lines:
            continue
        # A multi-cell row whose cells hold the same number of lines is a name column beside a jurisdiction column.
        width = len(lines[0])
        if len(lines) > 1 and width > 1 and all(len(c) == width for c in lines):
            records = [[c[i] for c in lines] for i in range(width)]
        else:
            records = [[" ".join(c) for c in lines]]
        for rec in records:
            rec = [x for x in rec if x and not re.fullmatch(r"[\d.,%\s-]+|\(?\d+(\.\d+)?%\)?", x)]
            if not rec:
                continue
            first = rec[0]
            if re.match(r"(?i)ex-21", first):
                continue
            if re.match(r"(?i)also doing business", first):
                in_dba = True
                continue
            # "Incorporated State: Delaware" on the line after a name gives that name's jurisdiction.
            if (m := re.match(r"(?i)(?:incorporated|organi[sz]ed|formed|state of incorporation|jurisdiction)[^:]{0,30}:\s*(.+)$", first)):
                if (j := jurisdiction_of(m[1])) is not None and out and out[-1].jurisdiction is None:
                    last = out[-1]
                    out[-1] = Subsidiary(last.name, j[0], j[1], last.line)
                    stats.no_jurisdiction -= 1
                    stats.with_jurisdiction += 1
                    stats.us_state += bool(j[1])
                    stats.foreign += not j[1]
                continue
            if re.match(r"(?i)business name\s*:", first):
                continue
            if (m := _DEFAULT_JUR.search(first)) and (j := jurisdiction_of(m["j"])) is not None and j[1]:
                default = j
                continue
            if len(rec) == 1:
                only = jurisdiction_of(first)
                if only is not None:  # a jurisdiction heading
                    current = only
                    continue
                head = re.sub(r"^(?:organized|incorporated|formed|domestic|foreign|entities|subsidiaries)\b.*?\b(?:in|under|of)\s+",
                              "", first, flags=re.I)
                if head != first and (j := jurisdiction_of(head)) is not None:
                    current = j
                    continue
            if _HEADER.match(first) or len(first) > 160 or _BAD_NAME.match(first) or len(first) < 3:
                continue
            if re.search(r":$", first) or re.match(r"(?i)(?:qualified in|also doing business|d/?b/?a\b|\(?f/?k/?a\b)", first):
                continue
            if re.search(r"(?i)\b(?:pursuant to|omitted|significant subsidiar|regulation s-k)", first) or (
                    first.endswith(".") and len(first.split()) > 8):
                continue  # prose
            name, jur = first, None
            if len(rec) > 1:
                for cell in rec[1:]:
                    j = jurisdiction_of(cell)
                    if j is not None:
                        jur = j
                        break
            else:
                split = _split_trailing_jurisdiction(first)
                if split:
                    name = split[0]
                    jur = jurisdiction_of(split[1])
                elif current is not None and not in_dba:
                    jur = current
            if _HEADER.match(name) or re.fullmatch(r"(?i)total.*", name):
                continue
            if in_dba:
                if jur is None:
                    continue
                in_dba = False
            if jur is None and default is not None:
                jur = default
            stats.subsidiaries += 1
            if jur is None:
                stats.no_jurisdiction += 1
            else:
                stats.with_jurisdiction += 1
                if jur[1]:
                    stats.us_state += 1
                else:
                    stats.foreign += 1
            out.append(Subsidiary(name, jur[0] if jur else None, jur[1] if jur else None, n))
    return out, stats


# --- matching to registry entities ------------------------------------------------------------------------

BASIS_REGISTRY_STATE = ("the exhibit's subsidiary name equals this entity's legal name after normalization (case, "
                        "punctuation and entity-type suffixes dropped), and the exhibit gives the state whose registry "
                        "holds the entity as its jurisdiction")
BASIS_FORMATION_STATE = ("the exhibit's subsidiary name equals this entity's legal name after normalization, and the "
                         "exhibit's jurisdiction is the state of formation the registry records for this foreign registration")
CONFIDENCE_REGISTRY_STATE = 0.9
CONFIDENCE_FORMATION_STATE = 0.85


@dataclass
class MatchStats:
    subsidiaries: int = 0
    foreign_or_unknown_jurisdiction: int = 0
    not_in_registry: int = 0
    jurisdiction_differs: int = 0
    ambiguous: int = 0
    entity_ended: int = 0
    matched: int = 0
    matched_registry_state: int = 0
    matched_formation_state: int = 0
    duplicate: int = 0
    registrant_itself: int = 0


def match_subsidiaries(reg: Registry, subs: Iterable[Subsidiary],
                       registrant: str | None = None) -> Iterator[tuple[Subsidiary, str, float, str, str]]:
    """``(subsidiary, entity URN, confidence, basis, rule)`` for each subsidiary that matches exactly one entity; the
    counts are left on ``match_subsidiaries.stats`` of the last run."""
    stats = match_subsidiaries.stats = MatchStats()  # type: ignore[attr-defined]
    seen: set[str] = set()
    own = normalize_name(registrant) if registrant else None
    for sub in subs:
        stats.subsidiaries += 1
        if own and normalize_name(sub.name) == own:  # a title line, or the registrant listed among its own subsidiaries
            stats.registrant_itself += 1
            continue
        if not sub.state:
            stats.foreign_or_unknown_jurisdiction += 1
            continue
        candidates = reg._exact_entities(normalize_name(sub.name))  # noqa: SLF001 - same package
        if not candidates:
            stats.not_in_registry += 1
            continue
        fits: dict[str, str] = {}
        for urn in candidates:
            if entity_state(urn) == sub.state:
                fits[urn] = "registry_state"
            elif reg._state_of_formation(urn) == sub.state:  # noqa: SLF001
                fits[urn] = "formation_state"
        if not fits:
            stats.jurisdiction_differs += 1
            continue
        if len(fits) > 1:
            live = [u for u in fits if entity_standing(reg._status(u)) != "ended"]  # noqa: SLF001
            if len(live) != 1:
                stats.ambiguous += 1
                continue
            fits = {live[0]: fits[live[0]]}
        (urn, rule), = fits.items()
        if entity_standing(reg._status(urn)) == "ended":  # noqa: SLF001
            stats.entity_ended += 1
            continue
        if urn in seen:
            stats.duplicate += 1
            continue
        seen.add(urn)
        stats.matched += 1
        if rule == "registry_state":
            stats.matched_registry_state += 1
            yield sub, urn, CONFIDENCE_REGISTRY_STATE, BASIS_REGISTRY_STATE, rule
        else:
            stats.matched_formation_state += 1
            yield sub, urn, CONFIDENCE_FORMATION_STATE, BASIS_FORMATION_STATE, rule


# --- driver ---------------------------------------------------------------------------------------------------


def source_for(cik: str | int, name: str) -> Source:
    """One source per registrant, so the registrant's next 10-K replaces its earlier list."""
    return Source(
        source_id=f"sec-edgar-ex21-{int(cik)}",
        publisher="U.S. Securities and Exchange Commission (EDGAR), filed by the registrant",
        title=f"Form 10-K Exhibit 21, subsidiaries of {name}",
        url=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={int(cik):010d}&type=10-K",
        state_fips="00",
        county_fips=None,
        license="Public filing on www.sec.gov. SEC website policy: information presented on sec.gov is public information "
                "and may be copied or further distributed without the SEC's permission (review record sec-edgar-exhibit-21).",
        ai_use="unknown",
        redistribution="permitted",
        attribution=f"U.S. Securities and Exchange Commission, EDGAR; filing by {name}",
        terms_reviewed="2026-11-04",
    )


@dataclass
class Filing:
    cik: str | int
    name: str
    state_of_incorporation: str | None
    accession: str
    form: str
    filed: str
    report_date: str
    exhibit_type: str = "EX-21"
    url: str | None = None


@dataclass
class Exhibit21Stats:
    parse: ParseStats = field(default_factory=ParseStats)
    match: MatchStats = field(default_factory=MatchStats)
    ingest: IngestStats | None = None
    jurisdictions: Counter = field(default_factory=Counter)


def build(path: str | Path, db_path: str | Path, filing: Filing, *, retrieved_at: str | None = None) -> Exhibit21Stats:
    """Ingest one registrant's Exhibit 21 into a registry that already holds entity registries."""
    out = Exhibit21Stats()
    subs, out.parse = read_subsidiaries(path)
    for s in subs:
        out.jurisdictions[s.state or "other"] += 1
    source = source_for(filing.cik, filing.name)
    reg = Registry(db_path)
    try:
        reg.add_source(source)
        snap = reg.add_snapshot(source.source_id, path, filing.report_date, retrieved_at)
        cik10 = f"{int(filing.cik):010d}"
        parent_state = (filing.state_of_incorporation or "").strip().lower() or None
        if parent_state not in STATES:
            parent_state = None
        records = []
        for sub, urn, confidence, basis, rule in match_subsidiaries(reg, subs, filing.name):
            value = {
                "parent": {"name": filing.name, "cik": cik10, "urn": f"fl:entity:us-sec:{cik10}"},
                "relationship": "subsidiary of the registrant, direct or indirect, as listed in Exhibit 21 to its Form "
                                f"{filing.form}",
                "listed_as": {"name": sub.name, "jurisdiction": sub.jurisdiction},
                "filing": {"form": filing.form, "accession": filing.accession, "filed": filing.filed,
                           "report_date": filing.report_date, "exhibit": filing.exhibit_type},
                "match": {"rule": rule, "registry_jurisdiction_state": entity_state(urn)},
            }
            records.append(EntityParent(filing.name, cik10, parent_state.upper() if parent_state else None, urn, confidence,
                                        basis, value, f"{filing.accession} {Path(path).name} line {sub.line}"))
        out.match = match_subsidiaries.stats  # type: ignore[attr-defined]
        out.ingest = reg.ingest_entity_parents(records, snap, full_roll=True)
        return out
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.sec_exhibit21", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs=2, metavar=("EXHIBIT21", "REGISTRY_DB"))
    ap.add_argument("--cik", required=True)
    ap.add_argument("--name", required=True, help="the registrant's name as the SEC records it")
    ap.add_argument("--state", help="the registrant's state of incorporation (two letters)")
    ap.add_argument("--accession", required=True)
    ap.add_argument("--form", default="10-K")
    ap.add_argument("--filed", required=True)
    ap.add_argument("--report-date", required=True, help="period end of the 10-K, YYYY-MM-DD")
    ap.add_argument("--exhibit-type", default="EX-21")
    args = ap.parse_args(argv)
    filing = Filing(args.cik, args.name, args.state, args.accession, args.form, args.filed, args.report_date, args.exhibit_type)
    stats = build(args.files[0], args.files[1], filing)
    print(json.dumps(asdict(stats), indent=2, default=dict))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
