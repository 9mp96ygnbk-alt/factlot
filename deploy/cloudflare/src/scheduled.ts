/**
 * The Worker's scheduled jobs, dispatched on the cron trigger's string (worker.ts). None is
 * configured; wrangler.jsonc has both as commented examples.
 *
 *   WATCH_CRON       the watch-list check (watch-check.ts; does nothing unless WATCH_LISTS_ENABLED)
 *   LIFECYCLE_CRON   the lifecycle sweep (lifecycle.ts; does nothing unless LIFECYCLE_EMAILS_ENABLED)
 *
 * Any other cron string runs both. Each job is caught on its own, so one failing or hanging never
 * stops the other; the caller hands each to its own waitUntil.
 */
export const WATCH_CRON = "*/15 * * * *";
export const LIFECYCLE_CRON = "0 * * * *";

export interface ScheduledJobs {
  watch(): Promise<unknown>;
  lifecycle(): Promise<unknown>;
}

const log = (msg: string) => (err: unknown) => {
  console.error(
    JSON.stringify({
      msg,
      error: err instanceof Error ? err.name : typeof err,
    }),
  );
};

/** The jobs for one trigger, each already guarded by its own catch. */
export function scheduledJobs(
  cron: string | undefined,
  jobs: ScheduledJobs,
): Promise<unknown>[] {
  const out: Promise<unknown>[] = [];
  const guard = (run: () => Promise<unknown>, msg: string) => {
    try {
      out.push(run().catch(log(msg)));
    } catch (err) {
      log(msg)(err);
    }
  };
  if (cron !== LIFECYCLE_CRON) guard(jobs.watch, "watch check failed");
  if (cron !== WATCH_CRON) guard(jobs.lifecycle, "lifecycle sweep failed");
  return out;
}
