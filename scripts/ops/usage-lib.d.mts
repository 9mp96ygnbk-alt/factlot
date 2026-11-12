export const CALLER_ORDER: string[];
export function shiftDay(date: string, n: number): string;
export function parseRecords(values: string[]): unknown[];
export function windowDays(
  today: string,
  days?: number,
): { yesterday: string; week: string[] };
export interface Summary {
  days: string[];
  requests: {
    total: number;
    by_surface: Record<string, number>;
    site_pages: Record<string, number>;
    rest_routes: Record<string, number>;
    by_status: Record<string, number>;
  };
  mcp_calls: Record<string, number>;
  lookups: {
    total: number;
    by_tool: Record<string, number>;
    by_region: Record<string, number>;
    by_caller: Record<string, number>;
  };
  distinct_callers: Record<string, number>;
  active_paid_keys: number;
  quota_exhausted: Record<string, number>;
  plan_required: Record<string, number>;
  history_notes: number;
  checkout_starts_by_interval: Record<string, number>;
  checkout_completions: Record<string, number>;
  reports: Record<string, number>;
  model_calls: Record<string, number>;
  overflow: number;
}
export interface Report {
  today: string;
  yesterday: string;
  week: { from: string; to: string; days: string[] };
  yesterday_summary: Summary | undefined;
  week_summary: Summary | undefined;
}
export function summarize(
  records: unknown[],
  days: string[],
): Summary | undefined;
export function buildReport(
  records: unknown[],
  today: string,
  days?: number,
): Report;
export function formatReport(report: Report): string;
