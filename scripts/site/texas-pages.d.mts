export const esc: (s: unknown) => string;
export const OTHER_DISTRICTS: string[];
export function countyTitle(c: unknown): string;
export function countyDescription(c: unknown): string;
export function countyBody(
  c: unknown,
  template: string,
  hasExample: boolean,
): string;
export function exampleTitle(c: unknown): string;
export function exampleDescription(c: unknown): string;
export function exampleBody(c: unknown, e: unknown, template: string): string;
export function otherDistrictsTable(): string;
