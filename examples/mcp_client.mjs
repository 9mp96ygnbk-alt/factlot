// FactLot as a remote MCP server, from the official MCP TypeScript SDK.
//
//   npm install @modelcontextprotocol/sdk
//   node examples/mcp_client.mjs
/* global URL */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(
  `${process.env.FACTLOT_API_URL ?? "https://api.factlot.com"}/mcp`,
);
const headers = process.env.FACTLOT_API_KEY
  ? { authorization: `Bearer ${process.env.FACTLOT_API_KEY}` }
  : undefined;

const client = new Client({ name: "factlot-example", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(url, { requestInit: { headers } }),
);

const { tools } = await client.listTools();
console.log(
  `${tools.length} tools, for example: ${tools
    .slice(0, 5)
    .map((t) => t.name)
    .join(", ")}`,
);

const result = await client.callTool({
  name: "calc_irr",
  arguments: { cash_flows: [-100, 10, 10, 110] },
});
const answer = JSON.parse(result.content[0].text);
console.log(
  `IRR ${answer.value.irr_periodic} via ${answer.formula.id}@${answer.formula.version}`,
);
await client.close();
