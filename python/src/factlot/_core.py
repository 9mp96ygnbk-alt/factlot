"""Shared primitives: errors, rounding, traces, and input validation."""

from __future__ import annotations

import math
import re
from datetime import date
from decimal import ROUND_HALF_UP, Context, Decimal
from typing import Any

_MISSING: Any = object()


class CalcInputError(ValueError):
    """Raised when calculator input is invalid. ``issues`` lists ``{path, message}`` entries."""

    def __init__(self, message: str, issues: list[dict[str, str]] | None = None) -> None:
        super().__init__(message)
        self.issues = issues or []


ROUNDING_SIGNIFICANT_DIGITS = 15
_SIG = Context(prec=ROUNDING_SIGNIFICANT_DIGITS, rounding=ROUND_HALF_UP)


def round_(x: float, dp: int = 2) -> float:
    """Round the way a person with a spreadsheet expects (identical to @factlot/calc ``round``).

    1. reduce |x| to 15 significant digits from its exact binary value, ties up;
    2. round that decimal half away from zero to ``dp`` places.

    95.58 * 245051 / 12 == 1951831.2149999999 -> 1951831.21500000 -> 1951831.22
    """
    if not math.isfinite(x):
        raise CalcInputError(f"cannot round non-finite value {x}")
    d = _SIG.plus(Decimal(abs(float(x))))
    # A value with no more than dp decimals at 15 significant digits is already rounded (TypeScript
    # returns it as is). quantize would need more than the context's 28 digits for |x| >= 1e26.
    r = float(d) if d.as_tuple().exponent >= -dp else float(d.quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP))
    return -r if x < 0 and r != 0 else r


def reduce_noise(x: float) -> float:
    """Reduce x to 15 significant digits, ties away from zero (identical to @factlot/calc ``reduceNoise``).

    Use before a floor or comparison: 0.57 * 10_000_000 == 5699999.999999999 -> 5700000.0
    """
    if not math.isfinite(x):
        raise CalcInputError(f"cannot reduce non-finite value {x}")
    return float(_SIG.plus(Decimal(float(x))))


def pow_int(base: float, n: int) -> float:
    """base**n for integer n by exponentiation by squaring (identical to @factlot/calc ``powInt``).

    Only IEEE-754 multiply/divide are used, so results are bit-identical across SDKs and platforms.
    """
    if n < 0:
        return ieee_div(1.0, pow_int(base, -n))
    result = 1.0
    x = float(base)
    e = n
    while e > 0:
        if e % 2 == 1:
            result *= x
        x *= x
        e //= 2
    return result


def ieee_div(a: float, b: float) -> float:
    """a / b with IEEE-754 semantics, as in TypeScript: x / ±0 is ±inf (nan for 0 / 0 or nan / 0).

    Python raises ``ZeroDivisionError`` instead, for example when ``pow_int`` underflows to 0.0
    near a rate of -100%; every division that can see such a value goes through here.
    """
    try:
        return a / b
    except ZeroDivisionError:
        if a == 0 or math.isnan(a):
            return math.nan
        return math.copysign(math.inf, a) * math.copysign(1.0, b)


def nth_root(c: float, n: int) -> float:
    """Positive n-th root of c > 0 by Newton's method (identical to @factlot/calc ``nthRoot``).

    Only IEEE-754 +, -, *, / and ``pow_int`` are used; iteration starts at or above the root and
    stops at the first step that fails to decrease, so every SDK lands on the same bits.
    """
    if not c > 0 or n < 1:
        raise CalcInputError(f"nth_root requires c > 0 and integer n >= 1, got {c}, {n}")
    x = float(c) if c >= 1 else 1.0
    for _ in range(200):
        nxt = x - (pow_int(x, n) - c) / (n * pow_int(x, n - 1))
        if not nxt < x:
            break
        x = nxt
    return x


def sign(x: float) -> int:
    return (x > 0) - (x < 0)


def fmt_money(x: float) -> str:
    return f"${round_(x, 2):,.2f}"


def fmt_pct(x: float, dp: int = 2) -> str:
    v = round_(x * 100, dp)
    return f"{int(v) if v == int(v) else v}%"


def num_str(x: float) -> str:
    """Format a number the way JavaScript's String(number) does for common values."""
    return str(int(x)) if float(x).is_integer() and abs(x) < 1e21 else repr(float(x))


class Trace:
    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []
        self.warnings: list[str] = []

    def step(self, label: str, value: Any, formula: str | None = None, unit: str | None = None) -> Any:
        s: dict[str, Any] = {"label": label, "value": value}
        if formula is not None:
            s["formula"] = formula
        if unit is not None:
            s["unit"] = unit
        self.steps.append(s)
        return value

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def result(self, formula_id: str, version: int, value: Any) -> dict[str, Any]:
        return {
            "value": value,
            "formula": {"id": formula_id, "version": version},
            "steps": self.steps,
            "warnings": self.warnings,
        }


# --- validation -------------------------------------------------------------------------

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def fail(path: str, message: str) -> None:
    raise CalcInputError(f"invalid input: {path or '(root)'}: {message}", [{"path": path, "message": message}])


def obj(value: Any, path: str = "") -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(path, "expected object")
    return value


def _join(path: str, key: str | int) -> str:
    return f"{path}.{key}" if path else str(key)


def number(
    d: dict[str, Any],
    key: str,
    path: str = "",
    *,
    default: Any = _MISSING,
    optional: bool = False,
    integer: bool = False,
    gt: float | None = None,
    ge: float | None = None,
    lt: float | None = None,
    le: float | None = None,
) -> Any:
    p = _join(path, key)
    if key not in d or d[key] is None:
        if default is not _MISSING:
            return default
        if optional:
            return None
        fail(p, "required")
    v = d[key]
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        fail(p, "expected finite number")
    if integer and not float(v).is_integer():
        fail(p, "expected integer")
    if gt is not None and not v > gt:
        fail(p, f"must be > {gt}")
    if ge is not None and not v >= ge:
        fail(p, f"must be >= {ge}")
    if lt is not None and not v < lt:
        fail(p, f"must be < {lt}")
    if le is not None and not v <= le:
        fail(p, f"must be <= {le}")
    return int(v) if integer else v


def boolean(d: dict[str, Any], key: str, path: str = "", *, default: bool) -> bool:
    if key not in d or d[key] is None:
        return default
    if not isinstance(d[key], bool):
        fail(_join(path, key), "expected boolean")
    return d[key]


def string(d: dict[str, Any], key: str, path: str = "", *, optional: bool = False, min_len: int = 0,
           max_len: int | None = None) -> Any:
    p = _join(path, key)
    if key not in d or d[key] is None:
        if optional:
            return None
        fail(p, "required")
    if not isinstance(d[key], str) or len(d[key]) < min_len:
        fail(p, "expected non-empty string" if min_len else "expected string")
    if max_len is not None and len(d[key]) > max_len:
        fail(p, f"expected at most {max_len} characters")
    return d[key]


def enum(d: dict[str, Any], key: str, options: tuple[str, ...], path: str = "", *, default: Any = _MISSING) -> str:
    p = _join(path, key)
    if key not in d or d[key] is None:
        if default is not _MISSING:
            return default
        fail(p, "required")
    if d[key] not in options:
        fail(p, f"expected one of {', '.join(options)}")
    return d[key]


def iso_date(d: dict[str, Any], key: str, path: str = "") -> str:
    p = _join(path, key)
    v = string(d, key, path)
    m = _DATE.match(v)
    try:
        if not m:
            raise ValueError
        date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        fail(p, "expected a valid YYYY-MM-DD date")
    return v


def array(d: dict[str, Any], key: str, path: str = "", *, default: Any = _MISSING, min_len: int = 0, max_len: int | None = None) -> list[Any]:
    p = _join(path, key)
    if key not in d or d[key] is None:
        if default is not _MISSING:
            return list(default)
        fail(p, "required")
    v = d[key]
    if not isinstance(v, list):
        fail(p, "expected array")
    if len(v) < min_len:
        fail(p, f"expected at least {min_len} items")
    if max_len is not None and len(v) > max_len:
        fail(p, f"expected at most {max_len} items")
    return v


def join(path: str, key: str | int) -> str:
    return _join(path, key)


# --- structural input limits (identical to @factlot/tools INPUT_LIMITS / inputShapeIssue) -------

INPUT_LIMITS = {
    "max_depth": 32,  # deepest nesting of objects and arrays; the arguments object is level 1
    "max_nodes": 200_000,  # values of any kind in one call's arguments
    "max_array_items": 10_000,  # items in any one array
    "max_string_length": 16 * 1024 * 1024,  # characters in any one string (code points here)
}


def input_shape_issue(value: Any, limits: dict[str, int] | None = None) -> dict[str, str] | None:
    """The first structural limit ``value`` breaks as ``{path, message}``, or None.

    Iterative, keys in sorted order, items in order, stopping at the first problem: the same walk
    as TypeScript, so both SDKs report the same issue.
    """
    lim = limits or INPUT_LIMITS
    stack: list[tuple[Any, str, int]] = [(value, "", 1)]
    nodes = 0
    while stack:
        v, path, depth = stack.pop()
        nodes += 1
        if nodes > lim["max_nodes"]:
            return {"path": "", "message": f"more than {lim['max_nodes']} values"}
        if isinstance(v, str):
            if len(v) > lim["max_string_length"]:
                return {"path": path, "message": f"string longer than {lim['max_string_length']} characters"}
            continue
        if not isinstance(v, (dict, list, tuple)):
            continue
        if depth > lim["max_depth"]:
            return {"path": path, "message": f"nested deeper than {lim['max_depth']} levels"}
        if isinstance(v, (list, tuple)):
            if len(v) > lim["max_array_items"]:
                return {"path": path, "message": f"more than {lim['max_array_items']} items"}
            for i in range(len(v) - 1, -1, -1):
                stack.append((v[i], _join(path, i), depth + 1))
            continue
        keys = sorted(str(k) for k in v)
        for k in reversed(keys):
            stack.append((v[k] if k in v else None, _join(path, k), depth + 1))
    return None
