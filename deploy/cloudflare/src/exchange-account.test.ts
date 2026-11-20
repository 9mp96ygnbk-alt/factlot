// Which callers may send a package for real: only a full FactLot account key (paid fl_live_ or
// email-verified fl_free_). A guest key, a connection without an account key and an anonymous
// caller send in test mode, and the answer's reason says a full account key is needed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exchangeAccountId, exchangeTestReason } from "./exchange-account.ts";
import type { PaidCaller } from "./router.ts";

const paid = (over: Record<string, unknown> = {}, active = true): PaidCaller =>
  ({
    hash: "a".repeat(64),
    active,
    record: { subscription: "sub_1", plan: "pro", ...over },
  }) as unknown as PaidCaller;

describe("exchange account: who can send for real", () => {
  it("a paid key is an account", async () => {
    assert.match((await exchangeAccountId(paid(), undefined))!, /^acct_/);
    assert.equal(exchangeTestReason(paid()), undefined);
  });

  it("an email-verified free key is an account", async () => {
    const id = await exchangeAccountId(undefined, {
      email_hash: "e".repeat(64),
    });
    assert.match(id!, /^acct_free_/);
  });

  it("a guest key is not, and the reason names the full account key", async () => {
    const guest = paid({ guest: true });
    assert.equal(await exchangeAccountId(guest, undefined), undefined);
    const reason = exchangeTestReason(guest)!;
    assert.match(reason, /guest key/);
    assert.match(reason, /full FactLot account key/);
  });

  it("a guest key does not become an account through a free key either", async () => {
    // A guest key is checked first: it never takes the free-key path.
    assert.equal(
      await exchangeAccountId(paid({ guest: true }), {
        email_hash: "e".repeat(64),
      }),
      undefined,
    );
  });

  it("an inactive paid key, no key, and a free OAuth connection (no key, no account) are not accounts", async () => {
    assert.equal(
      await exchangeAccountId(paid({}, false), undefined),
      undefined,
    );
    assert.equal(await exchangeAccountId(undefined, undefined), undefined);
    assert.equal(exchangeTestReason(undefined), undefined);
  });
});
