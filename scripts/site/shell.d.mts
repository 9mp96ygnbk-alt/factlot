export const REPO: string;
export const CONTACT: string;
export const NAV: [string, string][];
export const TRUST: [string, string][];
export const PLACES: [string, string][];
export const FONT_SANS: string;
export const FONT_MONO: string;
export const MARK: string;
export function headLinks(base?: string): string;
export function siteHeader(o?: {
  base?: string;
  current?: string;
  brandHref?: string;
  nav?: [string, string][];
}): string;
export function siteFooter(o?: { base?: string; stories?: boolean }): string;
