export interface RestEntry {
  tool: string;
  title: string;
  method: "POST";
  path: string;
  required: string[];
  fields?: string;
  paid?: true;
  example: unknown;
}
export const MAX_EXAMPLE_CHARS: number;
export const KEY_NOTE: string;
export const REPORT_ROUTE: { tool: string; path: string };
export function vectorInputs(root: string, tool: string): unknown[];
export function restReference(
  data: { tools: { tool: string; example?: unknown; fields?: string }[] },
  deps: {
    catalog: {
      name: string;
      title: string;
      path: string;
      input_schema?: { required?: string[] };
    }[];
    reportSchema: unknown;
    vectors: (tool: string) => unknown[];
    validate: (tool: string, body: unknown) => string | undefined;
    paidTools?: ReadonlySet<string>;
  },
): RestEntry[];
export function paidToolsOf(
  paidOnly: {
    id: string;
    what: string;
    free: string;
    tools: string[];
    arg?: string;
  }[],
): Set<string>;
export function restReferenceHtml(entries: RestEntry[], api?: string): string;
export function restReferenceJson(
  entries: RestEntry[],
  api?: string,
): {
  openapi: string;
  note: string;
  routes: (Omit<RestEntry, "title" | "paid"> & {
    url: string;
    needs?: string;
  })[];
};
