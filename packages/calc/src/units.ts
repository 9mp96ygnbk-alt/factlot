import { z } from "zod";

/**
 * What a lease's area and $/SF rates are measured in. Square feet by default; data-center
 * leases price per kW or MW of critical load, ground and yard leases per acre, residential
 * per unit, hotels per key or room, and parking per space. The unit changes labels, step
 * text, and warnings only: every number is computed exactly as for square feet.
 */
export const LeaseUnit = z.enum([
  "sf",
  "kw",
  "mw",
  "unit",
  "acre",
  "key",
  "room",
  "space",
]);
export type LeaseUnit = z.output<typeof LeaseUnit>;

export const LEASE_UNIT_DESCRIPTION =
  "What area_sf and the per-SF fields measure: sf (default, square feet), kw or mw (data-center critical load), unit (apartment or other unit), acre (ground or yard lease), key or room (hotel), or space (parking). Every number is computed exactly as for square feet; the unit changes labels, steps, and warnings and adds unit and rate_unit to the result. Fields keep their _sf and _psf names: with unit kw, area_sf holds kW and starting_rent_psf_annual holds $/kW/yr. Omit for square feet.";

export interface UnitLabels {
  /** Quantity label in formulas, e.g. "SF", "kW", "acres". */
  qty: string;
  /** Per-unit label in formulas and warnings, e.g. "SF" in "$/SF/yr", "kW" in "$/kW/yr". */
  per: string;
  /** Step unit for an annual rate, e.g. "USD/sf/yr", "USD/kW/yr". */
  rate: string;
}

const LABELS: Record<LeaseUnit, UnitLabels> = {
  sf: { qty: "SF", per: "SF", rate: "USD/sf/yr" },
  kw: { qty: "kW", per: "kW", rate: "USD/kW/yr" },
  mw: { qty: "MW", per: "MW", rate: "USD/MW/yr" },
  unit: { qty: "units", per: "unit", rate: "USD/unit/yr" },
  acre: { qty: "acres", per: "acre", rate: "USD/acre/yr" },
  key: { qty: "keys", per: "key", rate: "USD/key/yr" },
  room: { qty: "rooms", per: "room", rate: "USD/room/yr" },
  space: { qty: "spaces", per: "space", rate: "USD/space/yr" },
};

/** Labels for `unit`; square feet when it is absent, so existing output text is unchanged. */
export function unitLabels(unit: LeaseUnit | undefined): UnitLabels {
  return LABELS[unit ?? "sf"];
}

/** The warning that says how a non-SF unit was read, or undefined for square feet. */
export function unitWarning(unit: LeaseUnit | undefined): string | undefined {
  if (unit === undefined || unit === "sf") return undefined;
  const l = LABELS[unit];
  const base = `Unit is ${unit}: area_sf was read as ${l.qty} and every *_psf rate as $/${l.per}/yr; results are in ${l.rate}. Field names keep _sf and _psf.`;
  switch (unit) {
    case "kw":
    case "mw":
      return `${base} Data-center rents are often quoted per ${l.per} per month: starting_rent_psf_annual must be annual (monthly × 12). Power, cooling (PUE) and other pass-throughs are not priced unless added as costs.`;
    case "acre":
      return `${base} Confirm whether the ground or yard lease measures gross or usable acres.`;
    case "unit":
      return `${base} For an apartment rent roll with concessions and occupancy, use calc_multifamily_rent_roll.`;
    default:
      return base;
  }
}
