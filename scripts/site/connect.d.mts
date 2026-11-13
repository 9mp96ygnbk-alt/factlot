export interface ConnectPath {
  id: string;
  name: string;
  you_get: string;
  transport: string;
  url: string | null;
  auth: { free: string | null; key: string | null; oauth: string | null };
  steps: string[];
  snippet?: { format: string; text: string };
  install_links?: {
    label: string;
    kind: string;
    name: string;
    config: unknown;
    url: string;
  }[];
  guide: string;
  verification: { docs: string; exercised: string };
}
export interface ConnectData {
  name: string;
  description: string;
  version: string;
  mcp_url: string;
  signin_url: string;
  release_assets: { standalone_mcp: string; claude_desktop_extension: string };
  surfaces: { id: string; name: string; paths: ConnectPath[] }[];
}
export function cursorLink(name: string, config: unknown): string;
export function vscodeLink(
  scheme: string,
  name: string,
  config: unknown,
): string;
export function connectData(raw: unknown, version: string): ConnectData;
export function connectJson(raw: unknown, version: string): string;
export function connectBody(raw: unknown, version: string): string;
export function connectFigure(raw: unknown, version: string): string;
