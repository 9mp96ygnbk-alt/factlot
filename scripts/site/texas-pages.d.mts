export const esc: (s: unknown) => string;
export const OTHER_DISTRICTS: string[];
export function countyTitle(c: unknown): string;
export function countyDescription(c: unknown): string;
export function countyBody(
  c: unknown,
  template: string,
  hasExample: boolean,
  fieldsText?: string,
): string;
export function exampleTitle(c: unknown): string;
export function exampleDescription(c: unknown): string;
export function exampleBody(c: unknown, e: unknown, template: string): string;
export function otherDistrictsTable(): string;
export function countWord(n: number): string;
export function hubHostedTable(counties: unknown[]): string;
export function hubRollSentence(counties: unknown[]): string;
export function hubCountyLinks(
  counties: unknown[],
  exampleSlugs: string[],
): string;
export function tryTexasLinks(
  counties: unknown[],
  exampleSlugs: string[],
): string;
export function valueCountyCount(counties: unknown[]): string;
export function hubExampleLinks(
  counties: unknown[],
  exampleSlugs: string[],
): string;
