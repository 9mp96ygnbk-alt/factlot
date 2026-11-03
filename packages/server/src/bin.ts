#!/usr/bin/env node
// FactLot remote connector. Environment:
//   PORT (default 8787), HOST (default 0.0.0.0)
//   FACTLOT_API_KEY                 optional; one shared key (name "default")
//   FACTLOT_API_KEYS                optional; "key1:tenant-a,key2:tenant-b"
//   FACTLOT_API_KEYS_FILE           optional; JSON array of {key, name, rate_limit_per_minute?}
//   FACTLOT_ADMIN_KEY               optional; enables GET /v1/usage
//   FACTLOT_RATE_LIMIT_PER_MINUTE   optional; default per-key limit, 0 = unlimited
//   FACTLOT_USAGE_LOG               optional; append one JSON line per metered call to this file
//   FACTLOT_LOG                     optional; "json" for one JSON line per request on stdout
//   FACTLOT_PUBLIC_URL              optional; public base URL for OpenAPI `servers`
// Any key configured makes /mcp and /v1/* require `Authorization: Bearer <key>`.
import { createFactLotServer, keyPrefix, optionsFromEnv } from "./index.ts";
import type { FactLotServerOptions } from "./index.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
let opts: FactLotServerOptions;
try {
  opts = optionsFromEnv(process.env);
} catch (err) {
  console.error(
    `factlot-server: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

const server = createFactLotServer(opts);
server.listen(port, host, () => {
  const keys = (opts.apiKeys ?? []).map((k) => ({
    name: k.name,
    prefix: keyPrefix(k.key),
    rate_limit_per_minute: k.rateLimitPerMinute ?? opts.rateLimitPerMinute ?? 0,
  }));
  if (opts.log === "json") {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        msg: "listening",
        host,
        port,
        auth: keys.length > 0 ? "bearer" : "none",
        keys,
        rate_limit_per_minute: opts.rateLimitPerMinute ?? 0,
        usage_log: opts.usageLog ?? null,
        usage_endpoint: Boolean(opts.adminKey),
      }),
    );
    return;
  }
  console.log(
    `FactLot connector listening on http://${host}:${port} (MCP: /mcp, REST: /v1, OpenAPI: /openapi.json)`,
  );
  if (keys.length > 0)
    console.log(
      `auth: bearer, keys: ${keys.map((k) => `${k.name} (${k.prefix})`).join(", ")}`,
    );
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
