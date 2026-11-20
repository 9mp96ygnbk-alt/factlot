/**
 * Who is calling fact_package_send, for the Record. A package is real only when the caller has a
 * FactLot account key, so every real package traces to an accountable account. This gives the
 * Record a stable account id and never the key:
 *
 *   paid key (and a paid OAuth connection): a hash of the subscription, shared by its keys
 *   free key (email-confirmed): a hash of the address's salted email hash, kept across key rotation
 *   guest key (and a connection signed in with one): no account. A guest is someone outside the
 *     subscription (a reviewer), so nothing they send may count as the subscription's reliance.
 *   anything else (no key, a free OAuth connection that shares a meter by address): no account
 */
import { hashKey, meterSubject } from "./keys.ts";
import type { PaidCaller } from "./router.ts";

export async function exchangeAccountId(
  paid: PaidCaller | undefined,
  freeKey: { email_hash: string } | undefined,
): Promise<string | undefined> {
  if (paid?.record.guest) return undefined;
  if (paid?.active)
    return `acct_${(await hashKey(`exchange:${meterSubject(paid.record, paid.hash)}`)).slice(0, 32)}`;
  if (freeKey)
    return `acct_free_${(await hashKey(`exchange:${freeKey.email_hash}`)).slice(0, 32)}`;
  return undefined;
}

/** Why a call with this caller is sent in test mode, when the reason is the key itself. */
export function exchangeTestReason(
  paid: PaidCaller | undefined,
): string | undefined {
  return paid?.record.guest
    ? "the call came with a guest key (a key given to someone outside the subscription, such as a reviewer), and a full FactLot account key (a paid fl_live_ key or an email-verified fl_free_ key) is needed to send for real; a guest key sends test packages only"
    : undefined;
}
