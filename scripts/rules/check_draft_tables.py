"""Compare the draft rules-pack reference tables with official files a maintainer downloaded.

The SDK tables are tested against spec/vectors/rules/drafts/*.tables.json. This script checks that file against
the official text, so a maintainer verifying a pack does not have to compare hundreds of numbers by eye:

    python3 scripts/rules/check_draft_tables.py nyc    path/to/1_RCNY_103-14.pdf
    python3 scripts/rules/check_draft_tables.py wa     path/to/WAC_194-50-150.htm
    python3 scripts/rules/check_draft_tables.py boston path/to/BERDO_ordinance.pdf

Download the files yourself from the URLs in docs/rules/<pack>.md. PDFs need `pdftotext` (poppler) on PATH.
Prints every difference and exits 1 if there is one. A clean run checks the numbers only: still read the text.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

REF = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "rules" / "drafts"


def pdf_lines(path: str) -> list[str]:
    out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, check=True).stdout
    return out.splitlines()


def name_value_table(lines: list[str], start: str, end: str) -> dict[str, str]:
    """Rows of `name   value` between a line matching `start` and one matching `end`; wrapped names are joined."""
    i = next(n for n, line in enumerate(lines) if re.search(start, line))
    while not re.search(r"ESPM Property Type|^\s*Fuel\s{2,}", lines[i]):
        i += 1
    out, pending = {}, ""
    for line in lines[i + 1:]:
        if re.search(end, line):
            break
        s = line.strip()
        if not s or "ESPM Property Type" in s or s == "tCO2e per sf" or "Emissions Coefficient" in s \
                or s.startswith("(tCO2e") or re.match(r"^Fuel\s{2,}Emissions", s):
            continue
        m = re.match(r"^(.*?)\s{2,}([0-9][0-9.]*)$", s)
        if m:
            out[" ".join(f"{pending} {m.group(1)}".split())] = m.group(2)
            pending = ""
        else:
            pending = f"{pending} {s}".strip()
    return out


def nyc(path: str) -> list[str]:
    lines = pdf_lines(path)
    ref = json.loads((REF / "nyc_ll97.tables.json").read_text("utf-8"))
    got = {
        "2024-2029": name_value_table(lines, r"^\s*\(i\) Except as provided in subparagraph \(ii\)",
                                      r"^\(ii\) For purposes of reporting for calendar years 2024 and 2025"),
        "2030-2034": name_value_table(lines, r"^\(iii\) For the purposes of reporting for calendar years 2030",
                                      r"^\s*\(iv\) For the purposes of reporting for calendar years 2035"),
    }
    fuels = name_value_table(lines, r"be calculated as generating the following amounts of tCO", r"^\s*b\.\s+Exceptions")
    diffs = []
    for period, table in got.items():
        want = {r["property_type"]: r[period] for r in ref["emissions_factors_tco2e_per_sf"]}
        diffs += [f"{period} {k}: official {table.get(k)} vs reference {want.get(k)}"
                  for k in sorted(set(table) | set(want)) if table.get(k) != want.get(k)]
    want = {r["label"]: r["2024-2034"] for r in ref["other_fuels_tco2e_per_kbtu"]}
    diffs += [f"fuel {k}: official {fuels.get(k)} vs reference {want.get(k)}"
              for k in sorted(set(fuels) | set(want)) if fuels.get(k) != want.get(k)]
    text = " ".join(" ".join(lines).split())
    for coef in ("0.000145 tCO 2e per kWh", "0.00005311 tCO2e per kBtu", "0.0000432 tCO2e per kBtu",
                 "0.00007421 tCO2e per kBtu", "0.00007529 tCO2e per kBtu", "multiplied by $268"):
        if coef.replace(" ", "") not in text.replace(" ", ""):
            diffs.append(f"text not found: {coef}")
    return diffs


class _Tables(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self.depth = 0
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.tables.append([])
        elif self.depth == 1 and tag == "tr":
            self.row = []
        elif self.depth == 1 and tag == "td":
            self.cell = []

    def handle_endtag(self, tag):
        if self.depth == 1 and tag == "td" and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif self.depth == 1 and tag == "tr" and self.row is not None:
            self.tables[-1].append(self.row)
            self.row = None
        elif tag == "table":
            self.depth -= 1

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def wa(path: str) -> list[str]:
    src = Path(path).read_text("utf-8", errors="replace")
    p = _Tables()
    p.feed(src)
    flat = re.sub(r"<(?!table)[^>]+>", "", src)

    def rows_after(heading: str) -> dict[int, list[str]]:
        m = re.search(heading, flat)
        if not m:
            raise SystemExit(f"heading not found: {heading}")
        table = p.tables[flat[:m.end()].count("<table")]
        return {int(r[0]): r for r in table if r and re.fullmatch(r"\d{1,3}", r[0])}

    t2 = rows_after(r"Table 7-2a Building Activity Site Energy Targets \(EUIt1\) \(I-P Units\)")
    t3 = rows_after(r"Table 7-3 Building Operating Shifts Normalization Factor")
    ref = json.loads((REF / "wa_cbps.tables.json").read_text("utf-8"))
    diffs = []
    if sorted(t2) != list(range(1, 114)) or sorted(t3) != list(range(1, 114)):
        diffs.append("the official tables do not have rows 1-113")
    for a in ref["activities"]:
        n = a["no"]
        r2, r3 = t2.get(n, []), t3.get(n, [])
        names = [r2[1], r2[2].replace("*", ""), r2[3]] if len(r2) > 3 else []
        if names != [a["type"], a["subtype"], a["detail"]]:
            diffs.append(f"row {n} name: official {names} vs reference {[a['type'], a['subtype'], a['detail']]}")
        e = [a["eui_target_1"]["4C"], a["eui_target_1"]["5B"]]
        if [x or None for x in r2[-2:]] != e:
            diffs.append(f"row {n} EUIt1: official {r2[-2:]} vs reference {e}")
        s = [a["shift_factor"][k] for k in ("50_or_less", "51_to_167", "168")] if a["shift_factor"] else [None] * 3
        if [x or None for x in r3[-3:]] != s:
            diffs.append(f"row {n} shift factors: official {r3[-3:]} vs reference {s}")
    return diffs


def boston(path: str) -> list[str]:
    ref = json.loads((REF / "boston_berdo.tables.json").read_text("utf-8"))
    labels = {"College/University": "College/ University", "Manufacturing/Industrial": "Manufacturing/"}
    rows = {}
    for line in pdf_lines(path):
        m = re.match(r"^\s*(\S.*?)\s{2,}([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s*$", line)
        if m:
            rows[m.group(1)] = list(m.groups()[1:])
    periods = ["2025-2029", "2030-2034", "2035-2039", "2040-2044", "2045-2049", "2050-"]
    diffs = []
    for r in ref["standards_kgco2e_per_sf"]:
        got = rows.get(labels.get(r["label"], r["label"]))
        want = [r[p] for p in periods]
        if got != want:
            diffs.append(f"{r['label']}: official {got} vs reference {want}")
    if len(rows) != len(ref["standards_kgco2e_per_sf"]):
        diffs.append(f"official Table 1 has {len(rows)} rows, reference has {len(ref['standards_kgco2e_per_sf'])}")
    return diffs


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("nyc", "wa", "boston"):
        print(__doc__)
        return 2
    diffs = {"nyc": nyc, "wa": wa, "boston": boston}[sys.argv[1]](sys.argv[2])
    for d in diffs:
        print(d)
    print(f"{len(diffs)} difference(s)")
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
