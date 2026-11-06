#!/usr/bin/env python3
"""Write docs/registry/coverage-matrix.md and coverage-matrix.json.

    python3 scripts/registry/gen_coverage_matrix.py
    python3 scripts/registry/gen_coverage_matrix.py --check
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "src"))

from factlot.registry.acceptance import disk_failures, structural_failures  # noqa: E402
from factlot.registry.matrix import build, write  # noqa: E402


def main(argv: list[str]) -> int:
    if "--check" in argv:
        matrix = build(ROOT)
        problems = structural_failures(matrix) + disk_failures(ROOT, matrix)
        if problems:
            for item in problems:
                print(f"FAIL {item}")
            return 1
        print("ok     docs/registry/coverage-matrix.md")
        print("ok     docs/registry/coverage-matrix.json")
        return 0
    matrix = write(ROOT)
    print(f"wrote coverage matrix ({matrix['pipeline']['verified_sources_parcels']} verified-source rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
