export const PLACES: {
  key: string;
  state?: string;
  fips?: string[];
}[];
export function andList(xs: string[]): string;
export function groupPlaces(
  counties: {
    fips: string;
    name: string;
    state: string;
    parcels: number;
    buildings: number;
    as_of: string;
  }[],
): {
  key: string;
  counties: string[];
  names: string[];
  parcels: number;
  buildings: number;
  as_of: string;
}[];
export function placesText(data: unknown): string;
export function tableText(data: unknown): string;
export function totalsText(data: unknown): string;
export function withheldText(data: unknown): string;
export function llmsHostedLine(
  data: unknown,
  freeLookupsPerDay: number,
): string;
export function blockText(id: string, data: unknown): string;
export const HOSTED_FILES: string[];
export function renderHosted(
  text: string,
  data: unknown,
  freeLookupsPerDay: number,
): { text: string; found: number };
export function hostedDifferences(
  text: string,
  data: unknown,
  freeLookupsPerDay: number,
): string[];
