#!/usr/bin/env python3
"""Regenerate the reconciliation workbooks in this folder.

    python3 examples/reconciliation/build.py            # write every .xlsx (refuses if any Difference is not 0)
    python3 examples/reconciliation/build.py office     # one workbook
    python3 examples/reconciliation/build.py --check    # build in memory, verify, compare with the files on disk
    python3 examples/reconciliation/build.py tx_unequal_appraisal --input args.json --out evidence.xlsx
                                                        # your own calc_tx_unequal_appraisal arguments

Python standard library only. FactLot runs from this repository (python/src), no install needed.
"""

from __future__ import annotations

import importlib
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common import check  # noqa: E402

CASES = ["office", "industrial", "retail", "multifamily", "hotel", "lender", "lease_accounting", "tx_unequal_appraisal"]


def build_one(name: str):
    mod = importlib.import_module(name)
    wb, rec = mod.build()
    check(wb, rec)  # evaluates every formula and raises unless all rows match
    return mod.FILENAME, wb, rec


def members(path_or_parts) -> dict[str, bytes]:
    if isinstance(path_or_parts, str):
        with zipfile.ZipFile(path_or_parts) as z:
            return {n: z.read(n) for n in z.namelist()}
    return {n: d.encode("utf-8") for n, d in path_or_parts}


def build_from_input(name: str, input_path: str, out_path: str) -> int:
    """Build one workbook from a JSON file of tool arguments (only modules whose build() takes args)."""
    import json

    mod = importlib.import_module(name)
    with open(input_path, encoding="utf-8") as f:
        args = json.load(f)
    wb, rec = mod.build(args)
    check(wb, rec)
    wb.save(out_path)
    print(f"wrote    {out_path}: {rec.count} rows, all differences 0")
    return 0


def main(argv: list[str]) -> int:
    if "--input" in argv:
        i = argv.index("--input")
        names = [a for a in argv[:i] if not a.startswith("--")]
        if len(names) != 1 or "--out" not in argv:
            print("usage: build.py <workbook> --input args.json --out file.xlsx", file=sys.stderr)
            return 2
        return build_from_input(names[0], argv[i + 1], argv[argv.index("--out") + 1])
    check_only = "--check" in argv
    names = [a for a in argv if not a.startswith("--")] or CASES
    status = 0
    for name in names:
        fname, wb, rec = build_one(name)
        path = os.path.join(HERE, fname)
        if check_only:
            if not os.path.exists(path):
                print(f"MISSING  {fname}")
                status = 1
            elif members(path) != members(wb.parts()):
                print(f"STALE    {fname} (run build.py to regenerate)")
                status = 1
            else:
                print(f"ok       {fname}: {rec.count} rows, all differences 0")
        else:
            wb.save(path)
            print(f"wrote    {fname}: {rec.count} rows, all differences 0")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
