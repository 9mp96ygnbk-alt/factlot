export const CO_DISCLAIMER: string;
export const DENVER_NOTICE: string;
export interface Market {
  slug: string;
  place: string;
  db: string;
  name: string;
  title: string;
  sources: string[];
  sample: string;
  sampleUrnPrefix: string;
  entity?: { jurisdiction: string; name: string };
  idName: string;
  idText: string;
  limits: string[];
  notices?: string[];
}
export const MARKETS: Market[];
export function hostedMarkets(hosted: unknown): Market[];
export function marketTitle(m: Market): string;
export function marketDescription(m: Market, hosted: unknown): string;
export function marketBody(
  m: Market,
  d: unknown,
  hosted: unknown,
  template: string,
  fieldsText?: string,
): string;
export function marketLinks(hosted: unknown): string;
export function sourceNotices(hosted: unknown): string;
export function marketCard(d: unknown): string;
