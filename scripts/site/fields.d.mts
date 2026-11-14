import type { FieldsCounty, FieldsData } from "./gen-fields.ts";

export function noOwnerPlaces(fields: unknown, hosted: unknown): string[];
export function fieldsLead(fields: unknown, hosted: unknown): string;
export function fieldsSentences(fields: unknown, hosted: unknown): string;
export const SHORT: Record<string, string>;
export const TOWN_LIST_SOURCES: Set<string>;
export const ALL_BUT_MAX: number;
export function partText(n: number, total: number): string;
export function cellText(n: number, total: number): string;
export function combinedCounts(counties: FieldsCounty[]): {
  total: number;
  counts: Record<string, number>;
};
export function townListYears(county: FieldsCounty): boolean;
export function rollYearsText(county: FieldsCounty): string;
export function placeFieldsText(
  name: string,
  counties: FieldsCounty[],
  labels: Record<string, string>,
): string;
export function hostedFieldsTable(data: FieldsData): string;
export const NOT_SERVED: Set<string>;
export function servedFields(data: FieldsData): FieldsData;
