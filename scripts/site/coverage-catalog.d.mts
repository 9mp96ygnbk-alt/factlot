export const CATALOG_URL: string;
export const ID_SYSTEMS: Record<string, string>;
export const ID_EXAMPLES: Record<
  string,
  {
    external_id: string;
    state_fips: string;
    county_fips: string;
    apn: string;
    note: string;
  }
>;
export function sourceFamily(id: string): string;
export function resolveSource(
  id: string,
  configs: Map<string, Record<string, string>>,
): Record<string, string> | undefined;
export function loadSourceConfigs(
  root: string,
): Map<string, Record<string, string>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCoverageCatalog(input: any): any;
