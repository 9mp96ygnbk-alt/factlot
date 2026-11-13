import type { FieldsCounty, FieldsData } from "./gen-fields.ts";

export const FIELDS_LEAD: string;
export const FIELDS_SENTENCES: string;
export const SHORT: Record<string, string>;
export function cellText(share: number): string;
export function combinedShares(
  counties: FieldsCounty[],
): Record<string, number>;
export function rollYearsText(county: FieldsCounty): string;
export function placeFieldsText(
  name: string,
  counties: FieldsCounty[],
  labels: Record<string, string>,
): string;
export function hostedFieldsTable(data: FieldsData): string;
