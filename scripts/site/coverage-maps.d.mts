export interface Inset {
  id: string;
  name: string;
  view: [number, number, number, number];
  states: string[];
  labels: [string, string, string][];
}
export interface InsetCounty {
  fips: string;
  cls: string;
  title: string;
  href?: string;
}
export const INSETS: Inset[];
export function box(d: string): {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};
export function insetSvg(
  geo: unknown,
  inset: Inset,
  counties: InsetCounty[],
  o?: { width?: number; idPrefix?: string; refs?: boolean },
): string;
export function miniMapSvg(geo: unknown, hostedFips: string[]): string;
