#!/usr/bin/env python3
"""Regenerate the reconciliation workbooks in this folder.

    python3 examples/reconciliation/build.py            # write every .xlsx (refuses if any Difference is not 0)
    python3 examples/reconciliation/build.py office     # one workbook
    python3 examples/reconciliation/build.py --check    # build in memory, verify, compare with the files on disk

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

CASES = ["office", "industrial", "retail", "multifamily", "hotel", "lender", "lease_accounting"]


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


def main(argv: list[str]) -> int:
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
