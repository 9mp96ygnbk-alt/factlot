// fact_package_send and fact_package_status, against a fake exchange (no network).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  configureExchange,
  runTool,
  runToolAsync,
  runWithExchangeCaller,
} from "./index.ts";

afterEach(() => configureExchange({}));

type Json = Record<string, unknown>;
const pages = [
  "Tenant's Proportionate Share is 8.00% of Operating Expenses.\nOperating Expenses shall not include capital expenditures, including the replacement of the roof.",
];
const SHA = "a".repeat(64);

function makePackage(): { pkg: Json; ids: string[] } {
  const v = runTool("doc_verify_facts", {
    document: { pages, sha256: SHA, title: "Synthetic lease" },
    as_of: "2026-11-19",
    candidates: [
      {
        predicate: "lease.pro_rata_share",
        value: 0.08,
        quote: "Tenant's Proportionate Share is 8.00%",
        page: 1,
      },
      {
        predicate: "lease.cam_exclusion",
        value: "capital expenditures, including the replacement of the roof",
        quote:
          "shall not include capital expenditures, including the replacement of the roof",
        page: 1,
      },
    ],
  });
  assert.ok(v.ok);
  const facts = (v.result as { verified: { fact: Json }[] }).verified.map(
    (x) => x.fact,
  );
  assert.equal(facts.length, 2);
  const made = runTool("fact_package_create", {
    facts,
    title: "Synthetic",
    created_at: "2026-11-19T12:00:00Z",
  });
  assert.ok(made.ok);
  return {
    pkg: (made.result as { package: Json }).package,
    ids: facts.map((f) => f.id as string),
  };
}

const baseInput = (pkg: Json, ids: string[]): Json => ({
  package: pkg,
  kind: "expense_reconciliation",
  title: "2025 reconciliation (synthetic)",
  subject: { label: "Suite 400 (synthetic)" },
  from: {
    organisation: "Tenant Co",
    person: "Pat Tenant",
    email: "pat@example.invalid",
  },
  to: {
    organisation: "Landlord Co",
    person: "Lee Landlord",
    email: "lee@example.invalid",
  },
  items: [
    {
      key: "share",
      label: "Tenant's share",
      value: "8.00%",
      position: "accept_theirs",
      their_value: "8.00%",
      fact_ids: [ids[0]],
    },
    {
      key: "roof",
      label: "Roof",
      value: 0,
      unit: "USD",
      position: "state_ours",
      their_value: 20000,
      fact_ids: [ids[1]],
    },
  ],
  approved_by: "Pat Tenant",
  approval_confirmed: true,
});

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Json;
}
function fakeExchange(
  reply: (b: Json) => { status?: number; json: unknown } | "throw",
  seen: Seen[] = [],
) {
  const f = (async (
    url: string,
    init: { headers: Record<string, string>; body: string },
  ) => {
    const body = JSON.parse(init.body) as Json;
    seen.push({ url, headers: init.headers, body });
    const r = reply(body);
    if (r === "throw") throw new Error("network down");
    return { status: r.status ?? 200, json: async () => r.json };
  }) as unknown as typeof fetch;
  return { f, seen };
}
const sentOk = (sandbox: boolean) => () => ({
  json: {
    ok: true,
    result: {
      id: "11111111-2222-3333-4444-555555555555",
      digest: "d".repeat(64),
      package_root: "r".repeat(64),
      status: "sent",
      sandbox,
      owner_token: "ownertoken1",
      counterparty_token: "countertoken2",
      reliances_recorded: [{ item: "share", reliance_id: 1 }],
    },
  },
});

test("refuses without approval_confirmed or approved_by, and calls nothing", async () => {
  const { pkg, ids } = makePackage();
  const { f, seen } = fakeExchange(sentOk(true));
  configureExchange({ fetch: f });
  for (const patch of [
    { approval_confirmed: false },
    { approved_by: "" },
    { approved_by: undefined },
    { approval_confirmed: undefined },
  ]) {
    const out = await runToolAsync("fact_package_send", {
      ...baseInput(pkg, ids),
      ...patch,
    });
    assert.equal(out.ok, false, JSON.stringify(patch));
  }
  const noConfirm = await runToolAsync("fact_package_send", {
    ...baseInput(pkg, ids),
    approval_confirmed: false,
  });
  assert.ok(
    !noConfirm.ok &&
      /nothing is sent without approval/.test(noConfirm.error.message),
  );
  assert.equal(seen.length, 0);
});

test("refuses a package that fails verification, an unknown fact id, a missing counterparty figure", async () => {
  const { pkg, ids } = makePackage();
  const { f, seen } = fakeExchange(sentOk(true));
  configureExchange({ fetch: f });
  const tampered = structuredClone(pkg) as { facts: Json[] };
  tampered.facts[0]!.value = 0.09;
  const a = await runToolAsync(
    "fact_package_send",
    baseInput(tampered as Json, ids),
  );
  assert.ok(
    !a.ok &&
      a.error.error === "InputError" &&
      /leaf hashes|merkle|digest/i.test(JSON.stringify(a.error.issues)),
  );
  const input = baseInput(pkg, ids) as { items: Json[] };
  input.items[0]!.fact_ids = ["flf_not_in_package"];
  const b = await runToolAsync("fact_package_send", input);
  assert.ok(
    !b.ok && /not a fact in the package/.test(JSON.stringify(b.error.issues)),
  );
  const input2 = baseInput(pkg, ids) as { items: Json[] };
  delete input2.items[1]!.their_value;
  const c = await runToolAsync("fact_package_send", input2);
  assert.ok(
    !c.ok && /counterparty's figure/.test(JSON.stringify(c.error.issues)),
  );
  const same = baseInput(pkg, ids) as { to: Json };
  same.to.organisation = "tenant co";
  const d = await runToolAsync("fact_package_send", same);
  assert.ok(
    !d.ok && /different organisation/.test(JSON.stringify(d.error.issues)),
  );
  assert.equal(seen.length, 0);
});

test("sends through the public endpoint; the token is added only when configured", async () => {
  const { pkg, ids } = makePackage();
  const one = fakeExchange(sentOk(true));
  configureExchange({
    fetch: one.f,
    url: "https://exchange.test/fn",
    siteUrl: "https://site.test/",
  });
  const sandboxOut = await runToolAsync("fact_package_send", {
    ...baseInput(pkg, ids),
    subject: { label: "Suite 400", record_id: "par_87EYYZCFGTZEB" },
  });
  assert.ok(sandboxOut.ok);
  const r = sandboxOut.result as Json;
  assert.equal(one.seen[0]!.url, "https://exchange.test/fn");
  assert.equal(one.seen[0]!.headers.authorization, undefined);
  assert.equal(one.seen[0]!.body.action, "send");
  assert.equal(one.seen[0]!.body.approval_confirmed, true);
  assert.deepEqual(
    (one.seen[0]!.body.subject as Json).ref,
    "par_87EYYZCFGTZEB",
  );
  assert.equal(r.recorded_as, "sandbox");
  assert.equal(
    r.link_for_counterparty,
    "https://site.test/#/r/11111111-2222-3333-4444-555555555555/countertoken2",
  );
  assert.equal(
    r.status_link_for_sender,
    "https://site.test/#/r/11111111-2222-3333-4444-555555555555/ownertoken1",
  );
  assert.deepEqual((r.recorded as Json).items_awaiting_answer, ["roof"]);
  assert.equal((r.recorded as Json).counts_in_the_measure, false);
  assert.equal(r.test_mode, true);

  // A token without a known account is still a test: the token is not forwarded.
  const noAcct = fakeExchange(sentOk(true));
  configureExchange({ fetch: noAcct.f, token: "cre_testtoken" });
  const t = await runToolAsync("fact_package_send", baseInput(pkg, ids));
  assert.ok(t.ok);
  assert.equal(noAcct.seen[0]!.headers.authorization, undefined);
  assert.equal(noAcct.seen[0]!.body.sender_account, undefined);
  assert.equal((t.result as Json).test_mode, true);
  assert.match(
    (t.result as Json).message as string,
    /^TEST MODE: .*no full FactLot account key came with the call, and a full FactLot account key .* is needed to send for real/,
  );
  // Nothing at all is forwarded: no Authorization header, no sender account.
  assert.equal(noAcct.seen[0]!.body.sender_account, undefined);

  // A guest key: the host gives no account and its reason; the token is not forwarded.
  const guest = fakeExchange(sentOk(true));
  configureExchange({ fetch: guest.f, token: "cre_testtoken" });
  const g = await runWithExchangeCaller(
    { testReason: "the call came with a guest key" },
    () => runToolAsync("fact_package_send", baseInput(pkg, ids)),
  );
  assert.ok(g.ok);
  assert.equal(guest.seen[0]!.headers.authorization, undefined);
  assert.equal(guest.seen[0]!.body.sender_account, undefined);
  assert.equal((g.result as Json).recorded_as, "sandbox");
  assert.match(
    (g.result as Json).message as string,
    /^TEST MODE: .*because the call came with a guest key\. The counterparty can still open the link and answer\.$/,
  );

  // An account without the application token (local or self-hosted) is a test too.
  const noTok = fakeExchange(sentOk(true));
  configureExchange({ fetch: noTok.f });
  const u = await runWithExchangeCaller({ accountId: "acct_abc12345" }, () =>
    runToolAsync("fact_package_send", baseInput(pkg, ids)),
  );
  assert.ok(u.ok);
  assert.equal(noTok.seen[0]!.headers.authorization, undefined);
  assert.equal(noTok.seen[0]!.body.sender_account, undefined);
  assert.match(
    (u.result as Json).message as string,
    /^TEST MODE: .*not connected to the hosted FactLot record/,
  );

  // Token and account together: forwarded, and the answer says it was for real.
  const real = fakeExchange(sentOk(false));
  configureExchange({ fetch: real.f, token: "cre_testtoken" });
  const realOut = await runWithExchangeCaller(
    { accountId: "acct_abc12345" },
    () => runToolAsync("fact_package_send", baseInput(pkg, ids)),
  );
  assert.ok(realOut.ok);
  assert.equal(real.seen[0]!.headers.authorization, "Bearer cre_testtoken");
  assert.equal(real.seen[0]!.body.sender_account, "acct_abc12345");
  const rr = realOut.result as Json;
  assert.equal(rr.recorded_as, "real");
  assert.equal(rr.test_mode, false);
  assert.match(
    rr.message as string,
    /^SENT FOR REAL: the FactLot record recorded 1 reliance now/,
  );
  assert.ok(!JSON.stringify(rr).includes("cre_testtoken"));
});

test("test: true sends a test whatever key the caller holds; false is the same as left out", async () => {
  const { pkg, ids } = makePackage();
  const full = { accountId: "acct_abc12345" };
  const send = (caller: Json | undefined, extra: Json, sandbox: boolean) => {
    const fake = fakeExchange(sentOk(sandbox));
    configureExchange({ fetch: fake.f, token: "cre_testtoken" });
    const run = () =>
      runToolAsync("fact_package_send", { ...baseInput(pkg, ids), ...extra });
    return (caller ? runWithExchangeCaller(caller, run) : run()).then((o) => {
      assert.ok(o.ok, JSON.stringify(o));
      return { r: o.result as Json, seen: fake.seen[0]! };
    });
  };

  // A full key with test: true. Neither the application token nor the account travels, so the
  // record can only take it as a test; the answer says TEST MODE and why.
  const t = await send(full, { test: true }, true);
  assert.equal(t.seen.headers.authorization, undefined);
  assert.equal(t.seen.body.sender_account, undefined);
  assert.equal(t.seen.body.test, undefined); // the switch itself is not sent on
  assert.equal(t.r.recorded_as, "sandbox");
  assert.equal(t.r.test_mode, true);
  assert.equal((t.r.recorded as Json).counts_in_the_measure, false);
  assert.match(
    t.r.message as string,
    /^TEST MODE: this package was sent in test mode\. It does not count in the FactLot record's measure and records no real reliance, because the sender asked for a test \(test: true\)/,
  );
  assert.ok(!JSON.stringify(t.r).includes("acct_abc12345"));

  // The same full key without test, and with test: false: forwarded and real, byte for byte alike.
  const omitted = await send(full, {}, false);
  const off = await send(full, { test: false }, false);
  for (const x of [omitted, off]) {
    assert.equal(x.seen.headers.authorization, "Bearer cre_testtoken");
    assert.equal(x.seen.body.sender_account, "acct_abc12345");
    assert.equal(x.r.recorded_as, "real");
    assert.equal(x.r.test_mode, false);
    assert.match(x.r.message as string, /^SENT FOR REAL/);
  }
  assert.deepEqual(off.r, omitted.r);
  assert.deepEqual(off.seen.body, omitted.seen.body);

  // A guest key and no key are tests with or without the switch; without it their answers are as before.
  const guest = { testReason: "the call came with a guest key" };
  const g0 = await send(guest, {}, true);
  const g1 = await send(guest, { test: false }, true);
  assert.deepEqual(g1.r, g0.r);
  assert.match(
    g0.r.message as string,
    /because the call came with a guest key\./,
  );
  const n0 = await send(undefined, {}, true);
  const n1 = await send(undefined, { test: false }, true);
  assert.deepEqual(n1.r, n0.r);
  assert.match(
    n0.r.message as string,
    /no full FactLot account key came with the call/,
  );
  for (const x of [
    await send(guest, { test: true }, true),
    await send(undefined, { test: true }, true),
  ]) {
    assert.equal(x.seen.headers.authorization, undefined);
    assert.equal(x.seen.body.sender_account, undefined);
    assert.equal(x.r.test_mode, true);
    assert.match(
      x.r.message as string,
      /^TEST MODE: .*the sender asked for a test/,
    );
  }

  // If a record ever answered "not a test" to a withheld account, the answer says so and never "TEST MODE".
  const odd = await send(full, { test: true }, false);
  assert.equal(odd.seen.body.sender_account, undefined);
  assert.equal(odd.r.test_mode, false);
  assert.match(odd.r.message as string, /^NOT RECORDED AS A TEST/);

  // test must be a boolean.
  configureExchange({ fetch: fakeExchange(sentOk(true)).f });
  const bad = await runToolAsync("fact_package_send", {
    ...baseInput(pkg, ids),
    test: "yes",
  });
  assert.equal(bad.ok, false);
});

test("platform refusals are input errors; an unreachable or failing platform is ExchangeUnavailable", async () => {
  const { pkg, ids } = makePackage();
  configureExchange({
    fetch: fakeExchange(() => ({
      status: 400,
      json: {
        ok: false,
        error: "the two parties must be different organisations",
      },
    })).f,
  });
  const a = await runToolAsync("fact_package_send", baseInput(pkg, ids));
  assert.ok(
    !a.ok &&
      a.error.error === "InputError" &&
      /different organisations/.test(a.error.message),
  );
  configureExchange({ fetch: fakeExchange(() => "throw").f });
  const b = await runToolAsync("fact_package_send", baseInput(pkg, ids));
  assert.ok(
    !b.ok &&
      b.error.error === "ExchangeUnavailable" &&
      /nothing was sent/.test(b.error.message),
  );
  configureExchange({
    fetch: fakeExchange(() => ({
      status: 500,
      json: { ok: false, error: "something went wrong" },
    })).f,
  });
  const c = await runToolAsync("fact_package_send", baseInput(pkg, ids));
  assert.ok(!c.ok && c.error.error === "ExchangeUnavailable");
});

test("fact_package_status reads the sender's link and summarises the answers", async () => {
  const view = {
    ok: true,
    result: {
      id: "11111111-2222-3333-4444-555555555555",
      title: "T",
      status: "disputed",
      sandbox: true,
      to: { organisation: "Landlord Co" },
      package_root: "r",
      integrity: "ok",
      responded_at: "2026-11-19T00:00:00Z",
      reliances: [],
      items: [
        {
          key: "share",
          label: "Share",
          position: "accept_theirs",
          value: "8%",
          their_value: "8%",
          response: null,
        },
        {
          key: "roof",
          label: "Roof",
          position: "state_ours",
          value: 0,
          their_value: 20000,
          response: {
            decision: "confirm",
            note: null,
            responded_by_name: "Lee",
            responded_at: "x",
          },
        },
        {
          key: "fee",
          label: "Fee",
          position: "state_ours",
          value: 1,
          their_value: 2,
          response: {
            decision: "dispute",
            note: "amended",
            responded_by_name: "Lee",
            responded_at: "x",
          },
        },
        {
          key: "late",
          label: "Late",
          position: "state_ours",
          value: 1,
          their_value: 2,
          response: null,
        },
      ],
    },
  };
  const { f, seen } = fakeExchange(() => ({ json: view }));
  configureExchange({ fetch: f, token: "cre_must_not_be_sent" });
  const out = await runToolAsync("fact_package_status", {
    status_link:
      "https://site.test/#/r/11111111-2222-3333-4444-555555555555/ownertoken1",
  });
  assert.ok(out.ok);
  const r = out.result as Json;
  assert.equal(r.agreed, 1);
  assert.equal(r.disputed, 1);
  assert.equal(r.awaiting_answer, 1);
  assert.deepEqual(seen[0]!.body, {
    action: "status",
    id: "11111111-2222-3333-4444-555555555555",
    token: "ownertoken1",
  });
  assert.equal(
    seen[0]!.headers.authorization,
    undefined,
    "status is read with the link only",
  );
  const bad = await runToolAsync("fact_package_status", {
    status_link: "https://site.test/nope",
  });
  assert.ok(!bad.ok && bad.error.error === "InputError");
  const none = await runToolAsync("fact_package_status", {});
  assert.ok(!none.ok);
});

test("fact_package_status returns the signer, the signature record and each relying-party link", async () => {
  const hash = "d".repeat(64);
  const view = {
    ok: true,
    result: {
      id: "11111111-2222-3333-4444-555555555555",
      title: "T",
      status: "confirmed",
      sandbox: true,
      to: { organisation: "Tenant Co" },
      package_root: "r",
      integrity: "ok",
      responded_at: "2026-11-19T00:00:00Z",
      reliances: [],
      items: [],
      signature: {
        signed: true,
        signer_name: "Tess Tenant",
        signer_title: "Controller",
        signer_organisation: "Tenant Co",
        signed_at: "2026-11-19T10:00:00.000Z",
        signed_line:
          "Signed electronically by Tess Tenant, Controller, November 19, 2026",
        consent_version: "v1",
        consent_text: "text",
        content_sha256: hash,
        content_check: "unchanged",
        ip: "must not pass through",
      },
      links: [
        {
          link: 1,
          label: "Lender",
          first_opened_at: "2026-11-19T11:00:00Z",
          last_opened_at: "2026-11-19T12:00:00Z",
          open_count: 3,
          reliance: [
            {
              name: "Rae",
              firm: "Bank Co",
              role: "lender",
              statements_disputed: ["S06"],
            },
          ],
        },
      ],
    },
  };
  const { f } = fakeExchange(() => ({ json: view }));
  configureExchange({ fetch: f });
  const out = await runToolAsync("fact_package_status", {
    status_link:
      "https://site.test/#/r/11111111-2222-3333-4444-555555555555/ownertoken1",
  });
  assert.ok(out.ok);
  const r = out.result as Json;
  const sg = r.signature as Json;
  assert.equal(sg.signer_title, "Controller");
  assert.equal(sg.content_sha256, hash);
  assert.equal(sg.content_check, "unchanged");
  assert.equal(sg.ip, undefined, "no address passes through");
  const l = (r.links as Json[])[0]!;
  assert.equal(l.open_count, 3);
  assert.equal(l.first_opened_at, "2026-11-19T11:00:00Z");
  // A package answered before signing says so.
  const old = {
    ok: true,
    result: {
      ...view.result,
      signature: { signed: false, answered_without_signature: true },
    },
  };
  const { f: f2 } = fakeExchange(() => ({ json: old }));
  configureExchange({ fetch: f2 });
  const o2 = await runToolAsync("fact_package_status", {
    status_link:
      "https://site.test/#/r/11111111-2222-3333-4444-555555555555/ownertoken1",
  });
  assert.ok(o2.ok);
  assert.deepEqual((o2.result as Json).signature, {
    signed: false,
    answered_without_signature: true,
    signature_required: false,
  });
});

test("fact_package_send and fact_package_status need runToolAsync; runTool says so", () => {
  const { pkg, ids } = makePackage();
  const a = runTool("fact_package_send", baseInput(pkg, ids));
  assert.ok(!a.ok && /call runToolAsync/.test(a.error.message));
  const b = runTool("fact_package_status", { package_id: "x", token: "y" });
  assert.ok(!b.ok && /call runToolAsync/.test(b.error.message));
});
