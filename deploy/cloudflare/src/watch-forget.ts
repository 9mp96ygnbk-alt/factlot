/**
 * Delete everything watch lists hold for one subscription: its lists, subjects, fingerprints,
 * changes and alert address (its Durable Object's storage), the stop-link record in KV, and its
 * entry in the check's index. Run when the subscription is cancelled (billing.ts, on the Stripe
 * webhook) and by the check when it finds the subscription's keys cancelled or gone. Safe to run
 * for a subscription that never used watch lists: it creates nothing.
 */
import type { Env } from "./types.ts";

/** KV record of an alert's stop link: `watchstop:<alert id>` holds the subscription id. */
export const STOP_KV_PREFIX = "watchstop:";

export async function forgetWatch(
  env: Env,
  subscription: string,
): Promise<boolean> {
  if (!env.WATCH || !subscription) return false;
  const r = await env.WATCH.sub<{
    forgotten: boolean;
    alert_id: string | null;
  }>(subscription, "forget");
  if (r.alert_id) await env.KEYS.delete(`${STOP_KV_PREFIX}${r.alert_id}`);
  if (r.forgotten)
    await env.WATCH.index("unregister", { owner: `sub:${subscription}` });
  return r.forgotten;
}
