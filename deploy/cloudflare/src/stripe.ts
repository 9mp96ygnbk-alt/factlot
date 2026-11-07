/**
 * Minimal Stripe client over fetch (form-encoded REST), plus webhook signature verification.
 * No SDK: the Workers bundle stays small and every call is visible here.
 */
const API = "https://api.stripe.com/v1";

export class StripeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Params = Record<string, string | number | boolean | undefined>;

export function formEncode(params: Params): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) out.append(k, String(v));
  return out.toString();
}

export interface CallOptions {
  /** Abort the call after this long (default 10 s). */
  timeoutMs?: number;
}

export interface StripeClient {
  get(
    path: string,
    params?: Params,
    opts?: CallOptions,
  ): Promise<Record<string, unknown>>;
  post(
    path: string,
    params?: Params,
    opts?: CallOptions,
  ): Promise<Record<string, unknown>>;
}

export function stripeClient(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): StripeClient {
  const call = async (
    method: "GET" | "POST",
    path: string,
    params: Params = {},
    opts: CallOptions = {},
  ) => {
    const query = method === "GET" ? formEncode(params) : "";
    const res = await fetchImpl(`${API}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: method === "POST" ? formEncode(params) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const err = body.error as { message?: string; type?: string } | undefined;
      // Stripe's message names the problem (bad price, portal not configured); it never echoes the key.
      throw new StripeError(res.status, err?.message ?? `Stripe ${res.status}`);
    }
    return body;
  };
  return {
    get: (path, params, opts) => call("GET", path, params, opts),
    post: (path, params, opts) => call("POST", path, params, opts),
  };
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
}

/**
 * Verify a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=...]`) against the raw body.
 * Rejects timestamps more than `toleranceSeconds` from `nowSeconds` (replay protection).
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  let t: number | undefined;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") t = Number(v);
    else if (k?.trim() === "v1" && v) sigs.push(v.trim());
  }
  if (t === undefined || !Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  return sigs.some((s) => constantTimeEqual(s, expected));
}
