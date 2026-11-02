"""Calendar arithmetic on ISO ``YYYY-MM-DD`` dates (mirrors @factlot/calc dates)."""

from __future__ import annotations

import calendar
from datetime import date, timedelta


def add_months(iso: str, months: int) -> str:
    """Add calendar months, clamping to month end; day-of-month always comes from ``iso``."""
    d = date.fromisoformat(iso)
    total = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(total, 12)
    day = min(d.day, calendar.monthrange(year, month0 + 1)[1])
    return date(year, month0 + 1, day).isoformat()


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days
