#!/usr/bin/env node
// FactLot remote connector. Environment:
//   PORT (default 8787), HOST (default 0.0.0.0)
//   FACTLOT_API_KEY      optional; require `Authorization: Bearer <key>` on /mcp and /v1
//   FACTLOT_PUBLIC_URL   optional; public base URL for OpenAPI `servers`
import { createFactLotServer } from "./index.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const opts: { apiKey?: string; publicUrl?: string } = {};
if (process.env.FACTLOT_API_KEY) opts.apiKey = process.env.FACTLOT_API_KEY;
if (process.env.FACTLOT_PUBLIC_URL)
  opts.publicUrl = process.env.FACTLOT_PUBLIC_URL;

const server = createFactLotServer(opts);
server.listen(port, host, () => {
  console.log(
    `FactLot connector listening on http://${host}:${port} (MCP: /mcp, REST: /v1, OpenAPI: /openapi.json)`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
