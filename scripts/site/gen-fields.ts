// Writes site/_data/fields.json: for each county the hosted registry serves, which fact groups it holds and for what
// share of its parcels, and its roll years with the value type and files of each (packages/tools/src/fields.ts). The
// pages (/coverage/, the market pages, the Texas county pages), coverage.json and llms.txt read it.
//
// From the registry files a pack was built from (read only; the counties are those of site/_data/hosted.json, and
// each county's parcel count must equal the pack's):
//   node --experimental-strip-types --conditions=factlot-source scripts/site/gen-fields.ts <name>=<registry.db>...
// A pack whose manifest carries `fields` gives the same file through gen-hosted.ts <pack dir>.
//   node --experimental-strip-types --conditions=factlot-source scripts/site/gen-fields.ts --check
// fails when fields.json does not hold exactly the hosted counties with their parcel counts.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FACT_GROUPS,
  FACT_GROUP_LABELS,
  computeRegistryFields,
  configureRegistry,
  type CountyFields,
  type FactGroup,
  type GroupShare,
  type RollYear,
} from "../../packages/tools/src/index.ts";

import type { HostedData } from "./gen-hosted.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const FIELDS_DATA = "site/_data/fields.json";

export interface FieldsCounty {
  fips: string;
  name: string;
  state: string;
  parcels: number;
  as_of: string;
  /** The part of the county loaded, for a county loaded in part. */
  area?: string;
  groups: Record<FactGroup, GroupShare>;
  roll_years: (Omit<RollYear, "files"> & {
    files: Omit<
      RollYear["files"][number],
      "market_value" | "appraised_value"
    >[];
  })[];
}

export interface FieldsData {
  about: string;
  pack_built_at: string;
  groups: { key: FactGroup; label: string }[];
  counties: FieldsCounty[];
}

/** fields.json's content: the hosted counties of `hosted`, each with its field availability. */
export function fieldsData(
  fields: CountyFields[],
  hosted: HostedData,
): FieldsData {
  const by = new Map(fields.map((f) => [f.region.slice(3), f]));
  const partial = new Map(hosted.partial.map((p) => [p.fips, p.area]));
  const problems: string[] = [];
  const counties = hosted.counties.map((c) => {
    const f = by.get(c.fips);
    if (!f) {
      problems.push(`${c.fips} (${c.name}): no field availability`);
      return undefined;
    }
    if (f.parcels !== c.parcels)
      problems.push(
        `${c.fips} (${c.name}): ${f.parcels} parcels in the registry file, ${c.parcels} in the pack`,
      );
    const out: FieldsCounty = {
      fips: c.fips,
      name: c.name,
      state: c.state,
      parcels: c.parcels,
      as_of: c.as_of,
      ...(partial.has(c.fips) ? { area: partial.get(c.fips)! } : {}),
      groups: f.groups,
      roll_years: f.roll_years.map((y) => ({
        ...y,
        files: y.files.map((f) => ({
          source_id: f.source_id,
          filename: f.filename,
          as_of: f.as_of,
          read_on: f.read_on,
          dated: f.dated,
          roll: f.roll,
          parcels: f.parcels,
        })),
      })),
    };
    return out;
  });
  if (problems.length) throw new Error(problems.join("\n"));
  return {
    about:
      "Which fact groups each county the hosted registry serves holds, for what share of its parcels, and which roll years with the value type and files of each. Computed from the registry files by packages/tools/src/fields.ts (scripts/site/gen-fields.ts); a parcel counts for a group when the file holds at least one fact of the group for it. Owners of record are organisations only: natural persons are never stored.",
    pack_built_at: hosted.pack_built_at,
    groups: FACT_GROUPS.map((key) => ({
      key,
      label: FACT_GROUP_LABELS[key],
    })),
    counties: counties as FieldsCounty[],
  };
}

export function writeFieldsData(data: FieldsData): void {
  writeFileSync(join(root, FIELDS_DATA), `${JSON.stringify(data, null, 2)}\n`);
  spawnSync("npx", ["prettier", "--write", FIELDS_DATA], {
    cwd: root,
    stdio: "ignore",
  });
}

/** What is wrong with fields.json against hosted.json (empty: it describes exactly the hosted counties). */
export function fieldsDifferences(
  data: FieldsData,
  hosted: HostedData,
): string[] {
  const out: string[] = [];
  const have = new Map(data.counties.map((c) => [c.fips, c]));
  for (const c of hosted.counties) {
    const f = have.get(c.fips);
    if (!f) out.push(`${c.fips} (${c.name}) is hosted and has no row`);
    else if (f.parcels !== c.parcels || f.as_of !== c.as_of)
      out.push(
        `${c.fips} (${c.name}): ${f.parcels} parcels as of ${f.as_of}, hosted ${c.parcels} as of ${c.as_of}`,
      );
    have.delete(c.fips);
  }
  for (const fips of have.keys())
    out.push(`${fips} has a row and is not hosted`);
  return out;
}

function main(argv: string[]): void {
  const hosted = JSON.parse(
    readFileSync(join(root, "site/_data/hosted.json"), "utf8"),
  ) as HostedData;
  if (argv.includes("--check")) {
    const data = JSON.parse(
      readFileSync(join(root, FIELDS_DATA), "utf8"),
    ) as FieldsData;
    const d = fieldsDifferences(data, hosted);
    if (d.length) {
      console.error(`${FIELDS_DATA}:\n${d.join("\n")}`);
      process.exit(1);
    }
    return;
  }
  const files = argv.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.error(
      "usage: gen-fields.ts <name>=<registry.db>... | --check  (see the comment at the top)",
    );
    process.exit(2);
  }
  const hostedFips = new Set(hosted.counties.map((c) => c.fips));
  const fields: CountyFields[] = [];
  for (const arg of files) {
    const path = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
    const t = Date.now();
    configureRegistry(path);
    try {
      const f = computeRegistryFields().counties.filter((c) =>
        hostedFips.has(c.region.slice(3)),
      );
      fields.push(...f);
      console.log(
        `${arg.split("=")[0]}: ${f.length} hosted counties (${Math.round((Date.now() - t) / 1000)} s)`,
      );
    } finally {
      configureRegistry(undefined);
    }
  }
  const data = fieldsData(fields, hosted);
  writeFieldsData(data);
  console.log(`${FIELDS_DATA}: ${data.counties.length} counties`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
