/**
 * lease_comp_search: search the GSA lease comps bundled with FactLot, offline.
 *
 * The 6,994 comps of the release lease-comps-gsa-2026-11-04 (U.S. General Services Administration,
 * Lease Inventory, October 2026 file) ship as ./data/gsa_lease_comps.ts, one TSV row per comp, written
 * by scripts/gen-gsa-lease-comps.py from the GSA file and checked against the release. The text is
 * parsed on the first search, so loading the package costs nothing. Every answer carries the citation
 * (GSA file, its SHA-256 document ID, retrieval date, licence, the row of each comp) and the caveat
 * that the federal government is the tenant: these are not market comps for private tenants.
 * python/src/factlot/comps_search.py is the same code in Python; spec/vectors/lease_comp_search.json
 * pins both.
 */
import { createHash } from "node:crypto";

import { IsoDate, round } from "@factlot/calc";
import { FactLotIdError, buildingId } from "@factlot/id";
import { z } from "zod";

import { GSA_LEASE_COMPS_TSV } from "./data/gsa_lease_comps.ts";
import { ToolInputError } from "./documents.ts";

type Producer = { name: string; version: string };

const EARTH_RADIUS_MILES = 3958.8;
const SORTS = [
  "commencement_desc",
  "commencement_asc",
  "expiration_asc",
  "expiration_desc",
  "rent_psf_desc",
  "rent_psf_asc",
  "rentable_sf_desc",
  "rentable_sf_asc",
  "distance_asc",
] as const;
const SUMMARY_LABEL =
  "Statistics of the GSA leases that match the filters (the federal government is the tenant): current rent per rentable SF per year from GSA's file, not starting rents and not market rents.";
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const INT_COLUMNS = new Set(["row", "term_months", "renewal_options_left"]);
const NUM_COLUMNS = new Set([
  "latitude",
  "longitude",
  "rentable_sf",
  "annual_rent_usd",
  "rent_psf_yr",
]);

export const LeaseCompSearchInput = z.object({
  state: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional()
    .describe('Two-letter state or territory code, e.g. "TX".'),
  county_fips: z
    .string()
    .regex(/^[0-9]{5}$/)
    .optional()
    .describe(
      '5-digit county FIPS code (state + county), e.g. "48201" for Harris County, Texas. Connecticut uses its planning regions (09110 to 09190).',
    ),
  city: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'City as GSA writes it, matched whole and ignoring case, e.g. "Houston".',
    ),
  zip: z
    .string()
    .regex(/^[0-9]{5}(-[0-9]{4})?$/)
    .optional()
    .describe('5-digit ZIP code (ZIP+4 accepted), e.g. "77002".'),
  near: z
    .object({
      latitude: z.number().min(-90).max(90).describe("Latitude, degrees."),
      longitude: z.number().min(-180).max(180).describe("Longitude, degrees."),
      radius_miles: z
        .number()
        .gt(0)
        .max(500)
        .describe("Radius in miles (at most 500)."),
    })
    .optional()
    .describe(
      "Comps within a radius of a point, by great-circle distance to the coordinates GSA's file gives for each lease (FactLot geocodes nothing; give the point's coordinates yourself). Comps without coordinates are left out and counted in warnings.",
    ),
  min_rentable_sf: z
    .number()
    .min(0)
    .optional()
    .describe("Smallest lease rentable area, SF."),
  max_rentable_sf: z
    .number()
    .min(0)
    .optional()
    .describe("Largest lease rentable area, SF."),
  commencement_from: IsoDate.optional().describe(
    "Earliest lease commencement (effective) date, YYYY-MM-DD.",
  ),
  commencement_to: IsoDate.optional().describe(
    "Latest lease commencement (effective) date, YYYY-MM-DD.",
  ),
  min_rent_psf_yr: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Lowest current rent, USD per rentable SF per year (GSA's current annual rent divided by the RSF).",
    ),
  max_rent_psf_yr: z
    .number()
    .min(0)
    .optional()
    .describe("Highest current rent, USD per rentable SF per year."),
  property_type: z
    .enum(["office", "industrial", "other"])
    .optional()
    .describe(
      "office, industrial (GSA warehouse) or other (GSA special space): the largest use in the lease.",
    ),
  expense_basis: z
    .enum(["full_service", "not_full_service"])
    .optional()
    .describe("full_service (GSA fully serviced) or not_full_service."),
  sort: z
    .enum(SORTS)
    .optional()
    .describe(
      "Order of results: distance_asc (the default with near; needs near), commencement_desc (the default otherwise), commencement_asc, expiration_asc, expiration_desc, rent_psf_desc, rent_psf_asc, rentable_sf_desc, rentable_sf_asc. Ties go by GSA lease number.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe(
      "Maximum comps returned (1–200, default 25); the summary covers every match.",
    ),
});
type Input = z.output<typeof LeaseCompSearchInput>;

type Row = {
  lease: string;
  row: number;
  location: string;
  street: string;
  city: string;
  state: string;
  zip: string | null;
  county_fips: string | null;
  latitude: number | null;
  longitude: number | null;
  landlord: string | null;
  rentable_sf: number;
  commencement_date: string;
  expiration_date: string;
  term_months: number;
  early_termination_date: string | null;
  annual_rent_usd: number;
  rent_psf_yr: number;
  property_type: string | null;
  expense_basis: string | null;
  comp_type: string;
  renewal_options_left: number | null;
};

let parsed: { meta: Record<string, string>; rows: Row[] } | undefined;

/** The bundled file's metadata and rows, parsed once on first use. */
function data(): { meta: Record<string, string>; rows: Row[] } {
  if (parsed) return parsed;
  const meta: Record<string, string> = {};
  let columns: string[] | undefined;
  const rows: Row[] = [];
  for (const line of GSA_LEASE_COMPS_TSV.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# ")) {
      const at = line.indexOf(": ");
      if (at >= 0) meta[line.slice(2, at)] = line.slice(at + 2);
      continue;
    }
    const cells = line.split("\t");
    if (!columns) {
      columns = cells;
      continue;
    }
    const row: Record<string, string | number | null> = {};
    columns.forEach((key, i) => {
      const cell = cells[i] ?? "";
      row[key] =
        cell === ""
          ? null
          : INT_COLUMNS.has(key) || NUM_COLUMNS.has(key)
            ? Number(cell)
            : cell;
    });
    rows.push(row as unknown as Row);
  }
  parsed = { meta, rows };
  return parsed;
}

function base32(bytes: Uint8Array, length: number): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** The release's lease ID: ten zeros, then 16 base-32 characters of SHA-256(`gsa-lease-number:<number>`). */
export function gsaLeaseUrn(leaseNumber: string): string {
  const digest = createHash("sha256")
    .update(`gsa-lease-number:${leaseNumber}`)
    .digest();
  return `fl:lease:${"0".repeat(10)}${base32(digest, 16)}`;
}

/** The citation every lease_comp_search answer carries. */
export function gsaLeaseCompsCitation(): Record<string, unknown> {
  const { meta } = data();
  return {
    source: meta.source,
    landing_page: meta.landing_page,
    file_url: meta.file_url,
    document_id: meta.document_id,
    as_of: meta.as_of,
    retrieved_at: meta.retrieved_at,
    license: meta.license,
    terms: meta.terms,
    attribution: meta.attribution,
    release: meta.release,
    release_file: meta.release_file,
    release_sha256: meta.release_sha256,
    rights: { ai_use: "permitted", redistribution: "permitted" },
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance (haversine, mean Earth radius 3,958.8 miles), rounded to 0.01 mile. */
function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dlat = rad(lat2 - lat1);
  const dlon = rad(lon2 - lon1);
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlon / 2) ** 2;
  return round(
    2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a))),
    2,
  );
}

/** Linear interpolation between closest ranks (the spreadsheet PERCENTILE.INC rule). */
function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function stats(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0]!,
    p25: round(percentile(s, 0.25), 2),
    median: round(percentile(s, 0.5), 2),
    p75: round(percentile(s, 0.75), 2),
    max: s[s.length - 1]!,
  };
}

function building(row: Row): string | null {
  if (row.county_fips === null || row.zip === null) return null;
  try {
    return buildingId({
      stateFips: row.county_fips.slice(0, 2),
      countyFips: row.county_fips.slice(2),
      zip: row.zip,
      street: row.street,
    }).urn;
  } catch (err) {
    if (err instanceof FactLotIdError) return null;
    throw err;
  }
}

function result(
  row: Row,
  distance: number | null,
  documentId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    comp_id: gsaLeaseUrn(row.lease),
    gsa_lease_number: row.lease,
    address: row.street,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county_fips: row.county_fips,
    latitude: row.latitude,
    longitude: row.longitude,
    building: building(row),
    landlord: row.landlord,
    tenant_type: "government_federal",
    rentable_sf: row.rentable_sf,
    commencement_date: row.commencement_date,
    expiration_date: row.expiration_date,
    term_months: row.term_months,
    early_termination_date: row.early_termination_date,
    annual_rent_usd: row.annual_rent_usd,
    rent_psf_yr: row.rent_psf_yr,
    property_type: row.property_type,
    expense_basis: row.expense_basis,
    comp_type: row.comp_type,
    renewal_options_left: row.renewal_options_left,
  };
  if (distance !== null) out.distance_miles = distance;
  out.source = {
    document_id: documentId,
    section: `row ${row.row} lease ${row.lease} location ${row.location}`,
  };
  return out;
}

const cmp = (a: string | number, b: string | number) =>
  a < b ? -1 : a > b ? 1 : 0;

type Match = { row: Row; distance: number | null };

function comparator(sort: (typeof SORTS)[number]) {
  const field = sort.slice(0, sort.lastIndexOf("_"));
  const sign = sort.endsWith("_desc") ? -1 : 1;
  const value = (m: Match): string | number =>
    field === "distance"
      ? (m.distance ?? 0)
      : field === "commencement"
        ? m.row.commencement_date
        : field === "expiration"
          ? m.row.expiration_date
          : field === "rent_psf"
            ? m.row.rent_psf_yr
            : m.row.rentable_sf;
  return (x: Match, y: Match) =>
    sign * cmp(value(x), value(y)) || cmp(x.row.lease, y.row.lease);
}

export function searchLeaseComps(
  v: Input,
  producer: Producer,
): Record<string, unknown> {
  const issues: { path: string; message: string }[] = [];
  if (
    v.min_rentable_sf !== undefined &&
    v.max_rentable_sf !== undefined &&
    v.min_rentable_sf > v.max_rentable_sf
  )
    issues.push({
      path: "max_rentable_sf",
      message: "is below min_rentable_sf",
    });
  if (
    v.min_rent_psf_yr !== undefined &&
    v.max_rent_psf_yr !== undefined &&
    v.min_rent_psf_yr > v.max_rent_psf_yr
  )
    issues.push({
      path: "max_rent_psf_yr",
      message: "is below min_rent_psf_yr",
    });
  if (
    v.commencement_from !== undefined &&
    v.commencement_to !== undefined &&
    v.commencement_from > v.commencement_to
  )
    issues.push({
      path: "commencement_to",
      message: "is before commencement_from",
    });
  const near = v.near;
  const sort = v.sort ?? (near ? "distance_asc" : "commencement_desc");
  if (sort === "distance_asc" && !near)
    issues.push({
      path: "sort",
      message: "distance_asc needs near (latitude, longitude, radius_miles)",
    });
  if (issues.length) throw new ToolInputError(issues);
  const state = v.state?.toUpperCase();
  const city =
    v.city === undefined
      ? undefined
      : v.city.trim().split(/\s+/).join(" ").toUpperCase();
  const zip5 = v.zip?.slice(0, 5);

  const { meta, rows } = data();
  const matched: Match[] = [];
  let noCoordinates = 0;
  for (const row of rows) {
    if (state !== undefined && row.state !== state) continue;
    if (v.county_fips !== undefined && row.county_fips !== v.county_fips)
      continue;
    if (city !== undefined && row.city.toUpperCase() !== city) continue;
    if (zip5 !== undefined && row.zip !== zip5) continue;
    if (v.property_type !== undefined && row.property_type !== v.property_type)
      continue;
    if (v.expense_basis !== undefined && row.expense_basis !== v.expense_basis)
      continue;
    if (v.min_rentable_sf !== undefined && row.rentable_sf < v.min_rentable_sf)
      continue;
    if (v.max_rentable_sf !== undefined && row.rentable_sf > v.max_rentable_sf)
      continue;
    if (v.min_rent_psf_yr !== undefined && row.rent_psf_yr < v.min_rent_psf_yr)
      continue;
    if (v.max_rent_psf_yr !== undefined && row.rent_psf_yr > v.max_rent_psf_yr)
      continue;
    if (
      v.commencement_from !== undefined &&
      row.commencement_date < v.commencement_from
    )
      continue;
    if (
      v.commencement_to !== undefined &&
      row.commencement_date > v.commencement_to
    )
      continue;
    let distance: number | null = null;
    if (near) {
      if (row.latitude === null || row.longitude === null) {
        noCoordinates++;
        continue;
      }
      distance = distanceMiles(
        near.latitude,
        near.longitude,
        row.latitude,
        row.longitude,
      );
      if (distance > near.radius_miles) continue;
    }
    matched.push({ row, distance });
  }
  matched.sort(comparator(sort));

  const warnings: string[] = [];
  if (near && noCoordinates)
    warnings.push(
      `${noCoordinates} comps that pass the other filters have no coordinates in GSA's file and were left out of the radius search`,
    );
  if (!matched.length)
    warnings.push(
      "no GSA lease matches these filters; the file covers federal leases only, so an empty result says nothing about the private market",
    );
  const types: Record<string, number> = {};
  for (const { row } of matched) {
    const t = row.property_type ?? "unstated";
    types[t] = (types[t] ?? 0) + 1;
  }
  const citation = gsaLeaseCompsCitation();
  const documentId = String(citation.document_id);
  return {
    dataset: `GSA lease comps, release ${meta.release} (${meta.rows} comps)`,
    caveat: meta.caveat,
    total_matches: matched.length,
    returned: Math.min(v.limit, matched.length),
    sort,
    results: matched
      .slice(0, v.limit)
      .map((m) => result(m.row, m.distance, documentId)),
    summary: {
      label: SUMMARY_LABEL,
      count: matched.length,
      rent_psf_yr: stats(matched.map((m) => m.row.rent_psf_yr)),
      rentable_sf: stats(matched.map((m) => m.row.rentable_sf)),
      property_types: Object.fromEntries(
        Object.keys(types)
          .sort()
          .map((k) => [k, types[k]]),
      ),
    },
    warnings,
    citation,
    provenance: {
      method: "public_record",
      producer,
      sources: [
        {
          document_id: documentId,
          uri: citation.file_url,
          title: citation.source,
        },
      ],
    },
  };
}
