/**
 * Requests this Worker builds for its inner handler (@factlot/server, run under the runtime's
 * node:http server by worker.ts). That server follows Node's requireHostHeader rule and answers an
 * empty 400 to a request with no Host header, and a Request built inside a Worker has none. So a
 * request built for the inner handler (rather than passed through from the client, which carries
 * the Host Cloudflare routed) is made here, with the Host of the URL it is addressed to.
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
