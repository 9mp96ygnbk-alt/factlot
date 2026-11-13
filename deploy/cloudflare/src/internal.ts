/**
 * Requests this Worker builds for its inner handler (@factlot/server, run under the runtime's
 * node:http server by worker.ts), rather than passing through the client's request, which carries
 * the Host Cloudflare routed. A Request built inside a Worker has no Host header, and the inner
 * handler's MCP transport needs one: the MCP SDK's StreamableHTTPServerTransport.handleRequest
 * converts the request with @hono/node-server's getRequestListener, whose newRequest throws
 * "Missing host header" when there is no Host and no default hostname, and the listener answers
 * that with an empty 400 (handleRequestError). FactLot's REST routes build their URLs without it,
 * so only /mcp is affected, but every request built for the inner handler is made here, with the
 * Host of the URL it is addressed to, so none can miss it.
 */
export function innerRequest(
  url: string | URL,
  init: RequestInit = {},
): Request {
  const target = new URL(url);
  const headers = new Headers(init.headers);
  headers.set("host", target.host);
  return new Request(target, { ...init, headers });
}
