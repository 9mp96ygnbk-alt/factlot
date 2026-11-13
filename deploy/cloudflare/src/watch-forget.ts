/**
 * Delete everything watch lists hold for one subscription: its lists, subjects, fingerprints,
 * changes and alert addresses (its Durable Object's storage), the stop- and confirmation-link
 * records in KV, and its entry in the check's index. Run when the subscription is cancelled (billing.ts, on the Stripe
 * webhook) and by the check when it finds the subscription's keys cancelled or gone. For a
 * subscription that never used watch lists it creates no subscription object; it removes the
 * subscription from the index every time, so a forget that failed half-way is finished by the next.
 */
import type { Env } from "./types.ts";

/** KV record of an alert's stop link: `watchstop:<alert id>` holds the subscription id. */
export const STOP_KV_PREFIX = "watchstop:";
/** KV record of a pending address's confirmation link: `watchconfirm:<pending id>`. */
export const CONFIRM_KV_PREFIX = "watchconfirm:";

export async function forgetWatch(
  env: Env,
  subscription: string,
): Promise<boolean> {
  if (!env.WATCH || !subscription) return false;
  const r = await env.WATCH.sub<{
    forgotten: boolean;
    alert_id: string | null;
    pending_id: string | null;
  }>(subscription, "forget");
  if (r.alert_id) await env.KEYS.delete(`${STOP_KV_PREFIX}${r.alert_id}`);
  if (r.pending_id)
    await env.KEYS.delete(`${CONFIRM_KV_PREFIX}${r.pending_id}`);
  // Always: a forget that failed half-way must not leave the subscription in the index.
  await env.WATCH.index("unregister", { owner: `sub:${subscription}` });
  return r.forgotten;
}
