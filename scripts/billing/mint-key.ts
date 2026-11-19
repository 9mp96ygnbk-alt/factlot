// Maintainer CLI for hosted API keys: lost-key support and billing holds.
//
//   node --experimental-strip-types scripts/billing/mint-key.ts show <sub_...>
//   node --experimental-strip-types scripts/billing/mint-key.ts mint <sub_...> [--keep] [--guest] [--out <file>]
//   node --experimental-strip-types scripts/billing/mint-key.ts guest <sub_...> <key-id>
//   node --experimental-strip-types scripts/billing/mint-key.ts clear-hold <sub_...>
//
// mint     issues a new key for the subscription and prints it once on stdout, or with --out
//          writes it to a new file readable only by you (mode 0600) and prints nothing secret.
//          Send it to the customer from contact@factlot.com, to the email Stripe has for the
//          subscription, then delete the file. By default
//          the subscription's other keys are replaced (a lost key may be a leaked key); --keep
//          leaves them working. Plan, customer and status come from the subscription's newest
//          key record; with no record, from Stripe (needs STRIPE_SECRET_KEY in the environment,
//          read-only calls) or from --plan pro|team --customer cus_... .
//          --guest makes a guest key (keys.ts): for someone outside the subscription, such as a
//          reviewer. It calls the tools at the plan's limits on its own meter and has no account
//          powers (billing portal, key changes, connected apps, /account). It implies --keep.
// guest    turns an existing key of the subscription (its 16-hex id, from show) into a guest
//          key. Its use so far stays on the subscription's meter; from now on it counts alone.
// clear-hold  removes a "refunded" or "disputed" hold (for example after a dispute is won), so
//          the keys follow the subscription's Stripe status again.
// show     prints the subscription's key ids, status and hold. Never prints a key.
//
// Storage goes through `npx wrangler@4 kv key ...` against the production KEYS namespace (it
// uses your wrangler login). Add --local [--persist-to <dir>] to work on `wrangler dev` state.
// Any wrangler failure (login, network, namespace) stops the script before it writes anything
// further; only "Value not found" counts as an empty key.
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  billingDeps,
  subscriptionState,
} from "../../deploy/cloudflare/src/billing.ts";
import {
  addSubscriptionKey,
  generateKey,
  hashKey,
  keyId,
  liveKeys,
  settleSubscription,
  writeKey,
  type KeyRecord,
} from "../../deploy/cloudflare/src/keys.ts";
import { isPlanId } from "../../deploy/cloudflare/src/plans.ts";
import type { Env, KV } from "../../deploy/cloudflare/src/types.ts";

const workerDir = fileURLToPath(
  new URL("../../deploy/cloudflare/", import.meta.url),
);

function usage(message: string): never {
  console.error(
    `${message}\nusage: mint-key.ts show|mint|guest|clear-hold <sub_...> [key-id] [--keep] [--guest] [--out file] [--plan pro|team --customer cus_...] [--local [--persist-to dir]]`,
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [command, subscription] = args;
if (!command || !["show", "mint", "guest", "clear-hold"].includes(command))
  usage("unknown command");
if (!subscription || !/^sub_[A-Za-z0-9]+$/.test(subscription))
  usage("give a Stripe subscription id (sub_...)");

const namespaceId = readFileSync(`${workerDir}wrangler.jsonc`, "utf8").match(
  /"binding":\s*"KEYS",\s*"id":\s*"([0-9a-f]+)"/,
)?.[1];
if (!namespaceId)
  usage("no KEYS namespace id in deploy/cloudflare/wrangler.jsonc");
const outFile = option("out");
if (flag("out") && (!outFile || outFile.startsWith("--")))
  usage("--out needs a file name");
// Opened (created, mode 0600) before anything is written to KV, so a bad path cannot leave a
// minted key that nobody can read.
let outFd: number | undefined;
if (outFile && command === "mint")
  try {
    outFd = openSync(outFile, "wx", 0o600);
  } catch (err) {
    usage(
      `cannot create ${outFile}: ${(err as Error).message} (it must not exist yet)`,
    );
  }

const where = flag("local")
  ? [
      "--local",
      ...(option("persist-to") ? ["--persist-to", option("persist-to")!] : []),
    ]
  : ["--remote"];

/** Run `wrangler kv key ...`; any failure ends the script with wrangler's own message. */
function wrangler(...rest: string[]): string {
  try {
    return execFileSync(
      "npx",
      [
        "-y",
        "wrangler@4",
        "kv",
        "key",
        ...rest,
        "--namespace-id",
        namespaceId!,
        ...where,
      ],
      { cwd: workerDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; status?: number };
    // The value (argument 3 of a put) is a key record; never echo the command.
    console.error(
      `wrangler kv key ${rest[0]} ${rest[1]} failed (exit ${e.status ?? "?"}):\n${(e.stderr || e.stdout || String(err)).trim()}`,
    );
    process.exit(1);
  }
}

/** The KEYS namespace through wrangler, in the shape keys.ts expects. */
const kv: KV = {
  async get(key) {
    const out = wrangler("get", key, "--text").trim();
    return out === "Value not found" ? null : out;
  },
  async put(key, value, options) {
    wrangler(
      "put",
      key,
      value,
      ...(options?.expirationTtl
        ? ["--ttl", String(options.expirationTtl)]
        : []),
    );
  },
  async delete(key) {
    wrangler("delete", key);
  },
};

const keys = await liveKeys(kv, subscription);

if (command === "show") {
  if (keys.length === 0) console.log(`${subscription}: no live keys`);
  for (const { hash, record } of keys)
    console.log(
      `${keyId(hash)}  ${record.plan}  ${record.status}  stripe=${record.stripe_status}${record.hold ? `  hold=${record.hold}` : ""}${record.paused ? "  paused" : ""}${record.guest ? "  guest" : ""}  created ${record.created}`,
    );
  process.exit(0);
}

if (command === "guest") {
  const id = args[2];
  if (!id || !/^[0-9a-f]{16}$/.test(id))
    usage("give the key's 16-hex id (from show)");
  const target = keys.find((k) => keyId(k.hash) === id);
  if (!target) usage(`no live key ${id} on ${subscription}`);
  if (target.record.guest) {
    console.log(`${id} is already a guest key.`);
    process.exit(0);
  }
  if (keys.filter((k) => !k.record.guest && k !== target).length === 0)
    usage("that is the subscription's only key of its own; mint another first");
  await writeKey(kv, target.hash, { ...target.record, guest: true });
  console.log(
    `${id} is now a guest key: its own meter, no account powers. It can take a minute everywhere.`,
  );
  process.exit(0);
}

if (command === "clear-hold") {
  let n = 0;
  for (const { hash, record } of keys)
    if (record.hold) {
      const next: KeyRecord = { ...record, checked_at: 0 };
      delete next.hold;
      await writeKey(kv, hash, next);
      n++;
    }
  await settleSubscription(kv, subscription);
  console.log(
    `${n} key record(s) cleared; each is re-checked with Stripe on its next request.`,
  );
  process.exit(0);
}

// mint
const now = Date.now();
const guest = flag("guest");
const keep = flag("keep") || guest;
// The newest key of the subscription's own: a guest's record is never the template.
let base: KeyRecord | undefined =
  keys.filter((k) => !k.record.guest).at(-1)?.record ?? keys.at(-1)?.record;
if (!base) {
  const env = {
    KEYS: kv,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  } as Env;
  const d = billingDeps(env);
  if (d) {
    const sub = await d.stripe.get(`/subscriptions/${subscription}`);
    const state = subscriptionState(sub);
    const plan = state.plan ?? option("plan");
    if (!isPlanId(plan))
      usage("Stripe does not say the plan; add --plan pro|team");
    base = {
      plan,
      status: "active",
      customer: String(
        typeof sub.customer === "object" && sub.customer !== null
          ? (sub.customer as { id?: unknown }).id
          : sub.customer,
      ),
      subscription,
      stripe_status: state.stripe_status,
      created: new Date(now).toISOString(),
      checked_at: now,
      ...(state.paused ? { paused: true } : {}),
    };
  } else {
    const plan = option("plan");
    const customer = option("customer");
    if (!isPlanId(plan) || !customer?.startsWith("cus_"))
      usage(
        "no key record for this subscription: set STRIPE_SECRET_KEY, or give --plan and --customer",
      );
    // Unchecked: the key is re-checked with Stripe on its first request.
    base = {
      plan,
      status: "active",
      customer,
      subscription,
      stripe_status: "active",
      created: new Date(now).toISOString(),
      checked_at: 0,
    };
  }
}

const key = generateKey();
const hash = await hashKey(key);
const fresh: KeyRecord = { ...base, created: new Date(now).toISOString() };
delete fresh.replaced_by;
delete fresh.revoked_at;
delete fresh.inactive_since;
delete fresh.guest;
if (guest) fresh.guest = true;
await writeKey(kv, hash, fresh, now);
await addSubscriptionKey(kv, subscription, hash);
if (!keep)
  for (const old of keys)
    await writeKey(
      kv,
      old.hash,
      { ...old.record, replaced_by: hash.slice(0, 12) },
      now,
    );
await settleSubscription(kv, subscription);

const summary = `new ${guest ? "guest " : ""}key ${keyId(hash)} for ${subscription} (${fresh.plan}, ${fresh.stripe_status})${keep ? "" : `; replaced ${keys.length} older key(s)`}. It can take a minute to work everywhere.`;
if (outFd !== undefined) {
  writeSync(outFd, `${key}\n`);
  closeSync(outFd);
  console.error(
    `${summary} Written to ${outFile} (mode 0600); delete it once sent.`,
  );
} else {
  console.error(`${summary} Shown once:`);
  console.log(key);
}
