import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIFECYCLE_CRON, WATCH_CRON, scheduledJobs } from "./scheduled.ts";

describe("scheduled jobs", () => {
  it("dispatch on the cron string, each caught on its own", async () => {
    const ran: string[] = [];
    const jobs = {
      watch: async () => void ran.push("watch"),
      lifecycle: async () => {
        ran.push("lifecycle");
        throw new Error("boom");
      },
    };
    const orig = console.error;
    console.error = () => {};
    try {
      await Promise.all(scheduledJobs(WATCH_CRON, jobs));
      assert.deepEqual(ran, ["watch"]);
      await Promise.all(scheduledJobs(LIFECYCLE_CRON, jobs));
      assert.deepEqual(ran, ["watch", "lifecycle"]);
      ran.length = 0;
      const all = scheduledJobs("0 * * * *", {
        watch: () => {
          throw new Error("sync");
        },
        lifecycle: jobs.lifecycle,
      });
      await Promise.all(all);
      assert.deepEqual(ran, ["lifecycle"]);
    } finally {
      console.error = orig;
    }
  });
});
