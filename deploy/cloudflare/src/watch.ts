/**
 * Watch lists (hosted only; Worker variable WATCH_LISTS_ENABLED = "true", off when unset). A Pro
 * or Team subscription keeps named lists of parcel, entity and building URNs and is told what
 * changed about them after each registry update.
 *
 *   MCP tool         REST                      what it does
 *   watch_add        POST /v1/watch/add        add URNs to a list (one registry lookup per new subject)
 *   watch_remove     POST /v1/watch/remove     remove URNs, or a whole list
 *   watch_list       POST /v1/watch/list       lists, subjects, limits, alert setting
 *   watch_changes    POST /v1/watch/changes    changes since a cursor
 *   watch_alerts     POST /v1/watch/alerts     turn the per-update email on (with an address) or off
 *
 * Note: the per-request cap on watch_add and watch_changes counts only watch calls; other calls in
 * the same MCP batch are limited by their own rules.
 *
 * Only a Pro or Team key (or a paid OAuth connection) gets the tools listed; any other caller
 * gets PlanRequired, unmetered. With the variable off the tools are not listed, the REST paths
 * answer 404, the account page shows nothing and no check runs.
 *
 * Storage is watch-store.ts, the check after an update and the alert email watch-check.ts, the
 * fingerprint and comparison watch-print.ts.
 */
import { parse } from "@factlot/id";

import { regionOf } from "./account-tools.ts";
import { json, maskEmail } from "./billing.ts";
import { escapeHtml } from "./html.ts";
import { meterSubject, randomToken, type KeyRecord } from "./keys.ts";
import { messagePage, page } from "./pages.ts";
import {
  PLANS,
  PRICING_URL,
  WATCH_ADD_MAX,
  WATCH_LIMITS,
  watchEnabled,
  type PlanId,
} from "./plans.ts";
import { EMAIL_RE } from "./recovery.ts";
import type { Env } from "./types.ts";
import { countEvent, type CallerKind } from "./usage.ts";
import {
  CONFIRM_PATH,
  STOP_PATH,
  WATCH_CHECK,
  alertsReady,
  compareItems,
  confirmTokenId,
  newContext,
  registryReader,
  sendConfirmation,
  stopTokenId,
  type PendingItem,
  type RegistryReader,
} from "./watch-check.ts";
import { CONFIRM_KV_PREFIX, STOP_KV_PREFIX } from "./watch-forget.ts";
import { ASPECTS, fingerprint, parseAspects } from "./watch-print.ts";
import type { AlertState, StoredChange } from "./watch-store.ts";

export { watchEnabled };

export const WATCH_TOOL_NAMES = new Set([
  "watch_add",
  "watch_remove",
  "watch_list",
  "watch_changes",
  "watch_alerts",
]);

export const WATCH_PATHS = new Map([
  ["/v1/watch/add", "watch_add"],
  ["/v1/watch/remove", "watch_remove"],
  ["/v1/watch/list", "watch_list"],
  ["/v1/watch/changes", "watch_changes"],
  ["/v1/watch/alerts", "watch_alerts"],
]);

const LIST_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
const DEFAULT_LIST = "default";
const WATCHABLE = new Set(["parcel", "entity", "building"]);
/** Seconds the pack date is cached per isolate for the tools (the check reads it fresh). */
const HEALTH_CACHE_MS = 60_000;

const listProp = {
  type: "string",
  pattern: LIST_RE.source,
  default: DEFAULT_LIST,
  description:
    'List name (letters, digits, space, "_", "." or "-"; up to 40 characters). Default "default".',
};

const tool = (
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  hints: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
  },
) => ({
  name,
  title,
  description,
  inputSchema: {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  },
  annotations: { title, ...hints, openWorldHint: false },
});

/** MCP tool definitions, listed only for a Pro or Team caller while watch lists are on. */
export const WATCH_TOOLS = [
  tool(
    "watch_add",
    "Watch registry records",
    `Hosted FactLot tool (Pro and Team). Adds parcel, entity or building URNs to a named watch list, so each registry update is compared with them and changes can be read with watch_changes (and emailed, see watch_alerts). Each new subject is read once to check it exists, which counts one registry lookup; a subject already watched in another list, an invalid URN and a subject the registry does not hold are not counted. Up to ${WATCH_ADD_MAX} URNs a call; ${WATCH_LIMITS.pro.subjects.toLocaleString("en-US")} watched subjects on Pro, ${WATCH_LIMITS.team.subjects.toLocaleString("en-US")} on Team. aspects chooses what counts as a change: value (newest roll year's market and appraised values), owner (owner of record), documents (recorded sales, deeds, mortgages, satisfactions, CMBS loans), entity_status, other (any other fact), or any (the default). A record that leaves the registry is always reported.`,
    {
      urns: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: WATCH_ADD_MAX,
        description:
          "Parcel, entity or building URNs (fl:parcel:..., fl:entity:..., fl:building:...).",
      },
      list: listProp,
      aspects: {
        type: "array",
        items: { type: "string", enum: ["any", ...ASPECTS] },
        minItems: 1,
        description:
          "What to be told about (default any). Applies to the URNs of this call.",
      },
    },
    ["urns"],
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  ),
  tool(
    "watch_remove",
    "Stop watching records",
    "Hosted FactLot tool (Pro and Team). Removes URNs from a watch list, or the whole list with all: true. A URN no longer in any list loses its stored comparison data and its changes. Never counts as a lookup.",
    {
      urns: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 500,
        description: "URNs to remove from the list.",
      },
      list: listProp,
      all: {
        type: "boolean",
        description: "Remove the whole list (instead of urns).",
      },
    },
    [],
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  ),
  tool(
    "watch_list",
    "List watch lists",
    "Hosted FactLot tool (Pro and Team). Returns the subscription's watch lists, their subjects (label, aspects, when added, the registry update last compared, status), the plan's limits and whether alert emails are on. Never counts as a lookup.",
    {
      list: {
        ...listProp,
        default: undefined,
        description: "Only this list's subjects (default: every list).",
      },
      offset: { type: "integer", minimum: 0, default: 0 },
      limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
    },
    [],
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  ),
  tool(
    "watch_changes",
    "What changed on watched records",
    "Hosted FactLot tool (Pro and Team). Returns the changes found on watched subjects since `since` (the cursor of an earlier answer; omit it for every change kept), oldest first: the subject, the aspect, the registry update it came with, old and new values, and the citation of the new fact. Pass the answer's cursor next time. Changes are kept 400 days. When the registry has an update not yet compared, up to 25 of your subjects are compared first; check.unchecked says how many remain, and check.not_compared lists subjects the registry could not read. Never counts as a lookup.",
    {
      since: {
        type: "string",
        pattern: "^[0-9]{1,12}$",
        description: "Cursor from an earlier watch_changes answer.",
      },
      list: {
        ...listProp,
        default: undefined,
        description: "Only changes to this list's subjects, in its aspects.",
      },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
    [],
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  ),
  tool(
    "watch_alerts",
    "Watch-list alert email",
    "Hosted FactLot tool (Pro and Team). enabled: true with an email address sends that address one confirmation email; once its link is opened, one email goes there after each registry update that changed something the subscription watches (a short list of changes and a one-click stop link). Until then nothing else is sent to it, and the current confirmed address (if any) keeps receiving alerts. enabled: false stops them and deletes the stored addresses. watch_list shows whether the address is pending or confirmed. Never counts as a lookup.",
    {
      enabled: { type: "boolean" },
      email: {
        type: "string",
        maxLength: 254,
        description: "Where alerts go (needed to turn them on the first time).",
      },
    },
    ["enabled"],
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  ),
];

/** The paying caller watch lists belong to: an active Pro or Team subscription. */
export interface WatchCaller {
  subscription: string;
  plan: PlanId;
  /** The meter subject of the subscription's lookups (`sub:<id>`). */
  meter: string;
}

export function watchCaller(
  paid: { hash: string; record: KeyRecord } | undefined,
): WatchCaller | undefined {
  if (!paid || !paid.record.subscription) return undefined;
  return {
    subscription: paid.record.subscription,
    plan: paid.record.plan,
    meter: meterSubject(paid.record, paid.hash),
  };
}

/** The tool definitions tools/list adds for this caller (none while the feature is off). */
export function watchToolsFor(
  env: Env,
  caller: WatchCaller | undefined,
): unknown[] {
  return watchEnabled(env) && env.WATCH && caller ? WATCH_TOOLS : [];
}

export interface WatchDeps {
  reader?: RegistryReader;
  now?: () => number;
}

interface ToolAnswer {
  status: number;
  body: Record<string, unknown>;
}

const fail = (
  status: number,
  code: string,
  message: string,
  next: string,
  extra: Record<string, unknown> = {},
): ToolAnswer => ({
  status,
  body: { error: code, code, message, next, ...extra },
});

export function watchPlanRequired(): ToolAnswer {
  return fail(
    403,
    "PlanRequired",
    `watch lists are part of the paid plans only: Pro (${WATCH_LIMITS.pro.subjects.toLocaleString("en-US")} watched subjects) and Team (${WATCH_LIMITS.team.subjects.toLocaleString("en-US")}). Every other FactLot tool stays free.`,
    `send a Pro or Team key as Authorization: Bearer <key> (${PRICING_URL})`,
    { upgrade: PRICING_URL },
  );
}

const unavailable = (): ToolAnswer =>
  fail(
    503,
    "RegistryUnavailable",
    "the registry did not answer, so nothing was added and nothing was counted; retry in a minute.",
    "retry after 60 seconds",
    { retry_after_seconds: 60 },
  );

const storeDown = (): ToolAnswer =>
  fail(
    503,
    "ServiceUnavailable",
    "watch-list storage is briefly unavailable, so the request was not run; retry in a few seconds.",
    "retry after 5 seconds",
    { retry_after_seconds: 5 },
  );

function readerFor(env: Env, deps: WatchDeps): RegistryReader | undefined {
  if (deps.reader) return deps.reader;
  return env.REGISTRY
    ? registryReader(env.REGISTRY, { now: deps.now, cacheMs: HEALTH_CACHE_MS })
    : undefined;
}

function listArg(v: unknown, required = true): string | undefined | ToolAnswer {
  if (v === undefined || v === null) return required ? DEFAULT_LIST : undefined;
  if (typeof v !== "string" || !LIST_RE.test(v))
    return fail(
      400,
      "InvalidInput",
      'list must be 1 to 40 characters: letters, digits, space, "_", "." or "-", starting with a letter or digit',
      "fix the list name",
    );
  return v;
}

const isAnswer = (v: unknown): v is ToolAnswer =>
  typeof v === "object" && v !== null && "status" in v && "body" in v;

const ownerOf = (c: WatchCaller) => `sub:${c.subscription}`;

/** Put the subscription in the check's index (idempotent). */
const register = (env: Env, c: WatchCaller) =>
  env.WATCH!.index("register", { owner: ownerOf(c) });

/**
 * The pack this isolate sees and the check the scheduled run last started. Only the scheduled
 * check, which reads the pack date fresh, starts a check; a tool's reading may be up to a minute
 * old (or come from the other pack during a gradual deploy), so a tool never moves the check
 * number. `same` says whether both name the same pack: only then is a tool's work filed under it.
 */
async function currentCheck(
  env: Env,
  reader: RegistryReader | undefined,
): Promise<{ builtAt: string; seq: number; same: boolean }> {
  let builtAt = "";
  try {
    if (reader) builtAt = (await reader.builtAt()) ?? "";
  } catch {
    builtAt = "";
  }
  const cur = await env.WATCH!.index<{ seq: number; built_at: string | null }>(
    "current",
  );
  const same = builtAt !== "" && cur.seq > 0 && cur.built_at === builtAt;
  return { builtAt, seq: same ? cur.seq : 0, same };
}

/** Registry calls watch_add may make when the registry Worker has no /get-many (an older one). */
const ADD_MAX_CALLS = 10;

async function addTool(
  env: Env,
  c: WatchCaller,
  a: Record<string, unknown>,
  deps: WatchDeps,
): Promise<ToolAnswer> {
  const W = env.WATCH!;
  const now = deps.now ?? Date.now;
  const list = listArg(a.list);
  if (isAnswer(list)) return list;
  if (
    !Array.isArray(a.urns) ||
    a.urns.length === 0 ||
    a.urns.length > WATCH_ADD_MAX ||
    a.urns.some((u) => typeof u !== "string")
  )
    return fail(
      400,
      "InvalidInput",
      `urns must be a list of 1 to ${WATCH_ADD_MAX} URN strings`,
      'send urns: ["fl:parcel:..."]',
    );
  const aspects = parseAspects(a.aspects);
  if (typeof aspects === "string")
    return fail(400, "InvalidInput", aspects, "fix aspects");
  const errors: { urn: string; error: string; message: string }[] = [];
  const urns: string[] = [];
  for (const raw of new Set((a.urns as string[]).map((u) => u.trim()))) {
    try {
      const { kind } = parse(raw);
      if (!WATCHABLE.has(kind))
        errors.push({
          urn: raw,
          error: "InvalidInput",
          message: `a ${kind} URN cannot be watched; watch a parcel, entity or building`,
        });
      else urns.push(raw);
    } catch (err) {
      errors.push({
        urn: raw,
        error: "InvalidId",
        message:
          err instanceof Error
            ? err.message.slice(0, 200)
            : "not a FactLot URN",
      });
    }
  }
  const limits = WATCH_LIMITS[c.plan];
  const room = await W.sub<{
    list_allowed: boolean;
    room: number;
    already: string[];
    fresh: string[];
    known: string[];
  }>(c.subscription, "room", {
    list,
    urns,
    maxSubjects: limits.subjects,
    maxLists: limits.lists,
  });
  if (!room.list_allowed)
    return fail(
      409,
      "WatchListLimit",
      `this subscription has ${limits.lists} watch lists, the most the ${PLANS[c.plan].name} plan allows; add to an existing list or remove one.`,
      "watch_list shows the lists; watch_remove with all: true removes one",
      { limit: limits.lists },
    );
  if (room.fresh.length > room.room)
    return fail(
      409,
      "WatchLimitReached",
      `this call adds ${room.fresh.length} subjects and the subscription has room for ${room.room} more (${limits.subjects.toLocaleString("en-US")} on ${PLANS[c.plan].name}); nothing was added and nothing was counted.${c.plan === "pro" ? ` Team watches up to ${WATCH_LIMITS.team.subjects.toLocaleString("en-US")}.` : ""}`,
      c.plan === "pro"
        ? `remove subjects with watch_remove, or upgrade: ${PRICING_URL}`
        : "remove subjects with watch_remove",
      { limit: limits.subjects, room: room.room },
    );
  const known = new Set(room.known);
  const toRead = room.fresh.filter((u) => !known.has(u));
  const reader = readerFor(env, deps);
  if (toRead.length > 0 && !reader) return unavailable();

  // In the check's index before anything is stored or charged, so a stored subject is always
  // checked (registering twice is harmless).
  if (room.fresh.length > 0) await register(env, c);

  // One registry lookup per subject read, taken first, given back for each one not added.
  let quota:
    | { used: number; limit: number; remaining: number; resets_at: string }
    | undefined;
  if (toRead.length > 0) {
    const hit = await env.METER.consume(c.meter, {
      kind: "month",
      limit: PLANS[c.plan].registryLookupsPerMonth,
      n: toRead.length,
    });
    quota = hit.quota;
    if (hit.granted < toRead.length) {
      if (hit.granted > 0 && quota)
        await env.METER.refund(c.meter, "month", hit.granted, quota.resets_at);
      return fail(
        429,
        "RegistryQuotaExceeded",
        `adding these subjects needs ${toRead.length} registry lookups and the subscription has ${(quota?.remaining ?? 0) + hit.granted} left this month; nothing was added.`,
        `wait until ${quota?.resets_at ?? "the 1st"}, or add fewer subjects`,
        quota ? { ...quota, remaining: quota.remaining + hit.granted } : {},
      );
    }
  }
  let charged = toRead.length;
  const giveBack = async (n: number) => {
    if (n > 0 && quota) {
      await env.METER.refund(c.meter, "month", n, quota.resets_at).catch(() => {
        console.error(JSON.stringify({ msg: "quota refund failed" }));
      });
      charged -= n;
      quota = {
        ...quota,
        used: quota.used - n,
        remaining: quota.remaining + n,
      };
    }
  };
  try {
    const check =
      toRead.length > 0 || room.known.length > 0
        ? await currentCheck(env, reader)
        : { builtAt: "", seq: 0 };
    let reads: (
      | { found: true; record: Record<string, unknown> }
      | { found: false; message: string }
      | { error: string }
      | undefined
    )[] = [];
    let callFailed = false;
    if (toRead.length > 0) {
      try {
        reads = (await reader!.getMany(toRead, ADD_MAX_CALLS)).reads;
      } catch {
        callFailed = true;
      }
    }
    if (callFailed) {
      await giveBack(charged);
      return unavailable();
    }
    const items: {
      urn: string;
      label: string | null;
      print: string;
      status: string;
      built_at: string;
    }[] = [];
    for (const [k, urn] of toRead.entries()) {
      const read = reads[k];
      if (!read || "error" in read)
        errors.push({
          urn,
          error: "RegistryUnavailable",
          message:
            "the registry did not answer for this subject; not added, not counted",
        });
      else if (!read.found)
        errors.push({ urn, error: "NotFound", message: read.message });
      else {
        const print = await fingerprint(
          read.record,
          env.RECOVERY_SIGNING_SECRET,
        );
        items.push({
          urn,
          label:
            typeof read.record.label === "string" ? read.record.label : null,
          print: JSON.stringify(print),
          status: print.status,
          built_at: check.builtAt,
        });
      }
    }
    const added = await W.sub<{
      added: string[];
      refused: string[];
      reused: string[];
      total: number;
    }>(c.subscription, "add", {
      list,
      aspects,
      items,
      known: [...known],
      seq: check.seq,
      maxSubjects: limits.subjects,
      maxLists: limits.lists,
      now: new Date(now()).toISOString(),
    });
    // Charged: subjects read here and stored here. A subject another call stored meanwhile
    // (the same new URN added to two lists at once) is not charged twice.
    const read = new Set(items.map((i) => i.urn));
    const reused = new Set(added.reused);
    const kept = added.added.filter((u) => read.has(u) && !reused.has(u));
    await giveBack(charged - kept.length);
    for (const u of added.refused)
      errors.push({
        urn: u,
        error: "WatchLimitReached",
        message: `the subscription reached ${limits.subjects.toLocaleString("en-US")} watched subjects; not added, not counted`,
      });
    if (kept.length > 0)
      await env.METER.record(
        c.meter,
        kept.map((urn) => ({
          tool: "watch_add",
          region: regionOf("registry_get", { urn }),
        })),
      ).catch(() => {});
    const labels = new Map(items.map((i) => [i.urn, i.label]));
    return {
      status: 200,
      body: {
        list,
        aspects,
        added: added.added.map((urn) => ({
          urn,
          label: labels.get(urn) ?? null,
        })),
        already_watched: room.already,
        errors,
        lookups_charged: kept.length,
        watched: { subjects: added.total, limit: limits.subjects },
        ...(quota ? { quota } : {}),
      },
    };
  } catch (err) {
    // Storage failed after the lookups were taken: give them all back.
    await giveBack(charged);
    throw err;
  }
}

async function removeTool(
  env: Env,
  c: WatchCaller,
  a: Record<string, unknown>,
): Promise<ToolAnswer> {
  const list = listArg(a.list);
  if (isAnswer(list)) return list;
  const all = a.all === true;
  const urns = a.urns;
  if (
    !all &&
    (!Array.isArray(urns) ||
      urns.length === 0 ||
      urns.length > 500 ||
      urns.some((u) => typeof u !== "string"))
  )
    return fail(
      400,
      "InvalidInput",
      "send urns (1 to 500 URNs) or all: true",
      'watch_remove {"list": "default", "urns": ["fl:parcel:..."]}',
    );
  const r = await env.WATCH!.sub<{
    removed: number;
    forgotten: number;
    total: number;
    alerts: boolean;
  }>(c.subscription, "remove", {
    list,
    all,
    urns: all ? [] : (urns as string[]).map((u) => u.trim()),
  });
  if (r.total === 0 && !r.alerts)
    await env.WATCH!.index("unregister", { owner: ownerOf(c) });
  return {
    status: 200,
    body: {
      list,
      removed: r.removed,
      ...(all ? { list_removed: true } : {}),
      subjects_forgotten: r.forgotten,
      watched: { subjects: r.total, limit: WATCH_LIMITS[c.plan].subjects },
    },
  };
}

/** The alert setting as callers see it: off, pending (waiting for its confirmation) or on. */
function alertsView(env: Env, s: AlertState) {
  return {
    state: s.email ? "confirmed" : s.pending_email ? "pending" : "off",
    enabled: s.email !== null,
    email: s.email ? maskEmail(s.email) : null,
    ...(s.pending_email
      ? {
          pending_email: s.pending_email,
          pending_expires_at: s.pending_expires,
        }
      : {}),
    available: alertsReady(env),
  };
}

async function listTool(
  env: Env,
  c: WatchCaller,
  a: Record<string, unknown>,
  deps: WatchDeps = {},
): Promise<ToolAnswer> {
  const list = listArg(a.list, false);
  if (isAnswer(list)) return list;
  const limits = WATCH_LIMITS[c.plan];
  const r = await env.WATCH!.sub<{
    lists: unknown[];
    subjects: unknown[];
    total: number;
    distinct: number;
    over_limit: number;
    next_offset: number | null;
    alerts: AlertState;
    last_built_at: string | null;
  }>(c.subscription, "list", {
    list,
    offset: typeof a.offset === "number" ? a.offset : 0,
    limit: typeof a.limit === "number" ? a.limit : 100,
    maxSubjects: limits.subjects,
    now: new Date((deps.now ?? Date.now)()).toISOString(),
  });
  if (r.total > 0) await register(env, c);
  return {
    status: 200,
    body: {
      lists: r.lists,
      subjects: r.subjects,
      next_offset: r.next_offset,
      watched: {
        subjects: r.total,
        limit: limits.subjects,
        lists: r.lists.length,
        lists_limit: limits.lists,
        ...(r.over_limit > 0
          ? {
              not_checked: r.over_limit,
              note: `${r.over_limit} watched subject${r.over_limit === 1 ? " is" : "s are"} beyond the plan's ${limits.subjects.toLocaleString("en-US")} and not compared after registry updates (the newest added are left out; they show checked: false). Remove subjects or change plan.`,
            }
          : {}),
      },
      alerts: alertsView(env, r.alerts),
      last_registry_update_compared: r.last_built_at,
    },
  };
}

interface CheckView {
  built_at: string | null;
  unchecked: number;
  failing: number;
  skipped: { urn: string; reason: string }[];
  note?: string;
}

/** Compare up to WATCH_CHECK.inlineReads pending subjects when the pack is newer. */
async function catchUp(
  env: Env,
  c: WatchCaller,
  deps: WatchDeps,
): Promise<CheckView> {
  const view: CheckView = {
    built_at: null,
    unchecked: 0,
    failing: 0,
    skipped: [],
  };
  const reader = readerFor(env, deps);
  if (!reader) return view;
  const check = await currentCheck(env, reader);
  if (!check.builtAt)
    return {
      ...view,
      note: "the registry did not say which update it holds; changes are as of the last check",
    };
  view.built_at = check.builtAt;
  if (!check.same)
    return {
      ...view,
      note: "the scheduled check has not started on this registry update yet; changes are as of the last check",
    };
  const p = await env.WATCH!.sub<{
    items: PendingItem[];
    remaining: number;
    total: number;
  }>(c.subscription, "pending", {
    seq: check.seq,
    max: WATCH_CHECK.inlineReads,
    maxSubjects: WATCH_LIMITS[c.plan].subjects,
    now: new Date((deps.now ?? Date.now)()).toISOString(),
  });
  if (p.total > 0) await register(env, c);
  let settled = 0;
  if (p.items.length > 0) {
    try {
      settled = (
        await compareItems(
          env.WATCH!,
          c.subscription,
          check.seq,
          check.builtAt,
          p.items,
          newContext(reader, deps.now, () => {}, env.RECOVERY_SIGNING_SECRET),
          2,
          new Set(),
          // Failed reads here never count toward giving a subject up.
          false,
        )
      ).settled;
    } catch {
      view.note =
        "the registry did not answer, so the newest update is not compared yet; ask again in a minute";
    }
  }
  const s = await env.WATCH!.sub<{
    failing: number;
    skipped: { urn: string; reason: string }[];
  }>(c.subscription, "check_state", { seq: check.seq });
  return {
    ...view,
    unchecked: Math.max(0, p.remaining - settled),
    failing: s.failing,
    skipped: s.skipped,
  };
}

const publicChange = (ch: StoredChange) => ({
  cursor: String(ch.id),
  urn: ch.urn,
  label: ch.label,
  aspect: ch.aspect,
  summary: ch.summary,
  old: ch.old,
  new: ch.new,
  citation: ch.citation ?? null,
  registry_update: ch.built_at,
  detected_at: ch.detected_at,
});

async function changesTool(
  env: Env,
  c: WatchCaller,
  a: Record<string, unknown>,
  deps: WatchDeps,
): Promise<ToolAnswer> {
  const list = listArg(a.list, false);
  if (isAnswer(list)) return list;
  if (
    a.since !== undefined &&
    (typeof a.since !== "string" || !/^[0-9]{1,12}$/.test(a.since))
  )
    return fail(
      400,
      "InvalidInput",
      "since must be a cursor from an earlier answer",
      "omit since for every change kept",
    );
  const check = await catchUp(env, c, deps);
  const r = await env.WATCH!.sub<{
    changes: StoredChange[];
    cursor: number;
    more: boolean;
  }>(c.subscription, "changes", {
    since: a.since === undefined ? 0 : Number(a.since),
    list,
    limit: typeof a.limit === "number" ? a.limit : 50,
    now: new Date((deps.now ?? Date.now)()).toISOString(),
  });
  return {
    status: 200,
    body: {
      changes: r.changes.map(publicChange),
      cursor: String(r.cursor),
      more: r.more,
      check: {
        registry_update: check.built_at,
        complete: check.unchecked === 0 && !check.note,
        unchecked: check.unchecked,
        ...(check.failing > 0 || check.skipped.length > 0
          ? {
              read_failures: check.failing,
              not_compared: check.skipped,
              failure_note: `Subjects the registry could not read are tried again; after ${WATCH_CHECK.maxFails} failures in a row one is left out of this update's comparison (not_compared) and compared again after the next.`,
            }
          : {}),
        ...(check.note ? { note: check.note } : {}),
      },
    },
  };
}

/**
 * Alerts on: the address gets one confirmation email and nothing else until its link is opened
 * (single purpose, expires, at most one every WATCH_CHECK.confirmGapMs and confirmPerDay a day per
 * subscription, one pending address at a time). Off: both addresses are deleted.
 */
export async function setAlerts(
  env: Env,
  c: WatchCaller,
  enabled: unknown,
  email: unknown,
  deps: WatchDeps = {},
): Promise<ToolAnswer> {
  const W = env.WATCH!;
  const now = (deps.now ?? Date.now)();
  if (typeof enabled !== "boolean")
    return fail(
      400,
      "InvalidInput",
      "enabled must be true or false",
      '{"enabled": true, "email": "you@example.com"}',
    );
  if (!enabled) {
    const r = await W.sub<{
      previous_alert_id: string | null;
      previous_pending_id: string | null;
      total: number;
    }>(c.subscription, "alerts_off", {});
    if (r.previous_alert_id)
      await env.KEYS.delete(`${STOP_KV_PREFIX}${r.previous_alert_id}`);
    if (r.previous_pending_id)
      await env.KEYS.delete(`${CONFIRM_KV_PREFIX}${r.previous_pending_id}`);
    if (r.total === 0) await W.index("unregister", { owner: ownerOf(c) });
    return {
      status: 200,
      body: alertsView(env, {
        email: null,
        alert_id: null,
        pending_email: null,
        pending_id: null,
        pending_expires: null,
      }),
    };
  }
  if (!alertsReady(env))
    return fail(
      503,
      "AlertsUnavailable",
      "alert emails are not available on this server yet; watch_changes works without them.",
      "use watch_changes",
    );
  const cur = await W.sub<AlertState>(c.subscription, "alerts_get", { now });
  let address: string;
  if (email === undefined || email === null || email === "") {
    if (!cur.email && !cur.pending_email)
      return fail(
        400,
        "InvalidInput",
        "email is needed to turn alerts on",
        '{"enabled": true, "email": "you@example.com"}',
      );
    return { status: 200, body: alertsView(env, cur) };
  } else if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !EMAIL_RE.test(email.trim())
  )
    return fail(
      400,
      "InvalidInput",
      "email is not a valid address",
      "send one address, e.g. you@example.com",
    );
  else address = email.trim();
  if (cur.email === address) return { status: 200, body: alertsView(env, cur) };
  const pendingId = randomToken();
  const expires = new Date(
    now + WATCH_CHECK.confirmHours * 3_600_000,
  ).toISOString();
  const r = await W.sub<{
    ok: boolean;
    limited?: string;
    retry_at?: string;
    previous_pending_id?: string | null;
  }>(c.subscription, "alerts_request", {
    // Only the masked form is kept here; the address itself waits in KV for 24 hours.
    email: maskEmail(address),
    pending_id: pendingId,
    expires,
    now,
    minGapMs: WATCH_CHECK.confirmGapMs,
    maxPerDay: WATCH_CHECK.confirmPerDay,
  });
  if (!r.ok)
    return fail(
      429,
      "AlertsRateLimited",
      `a confirmation email was sent recently for this subscription (at most one every ${WATCH_CHECK.confirmGapMs / 60_000} minutes and ${WATCH_CHECK.confirmPerDay} a day); try again after ${r.retry_at}.`,
      `retry after ${r.retry_at}`,
      { retry_at: r.retry_at },
    );
  if (r.previous_pending_id)
    await env.KEYS.delete(`${CONFIRM_KV_PREFIX}${r.previous_pending_id}`);
  await env.KEYS.put(
    `${CONFIRM_KV_PREFIX}${pendingId}`,
    JSON.stringify({ subscription: c.subscription, email: address }),
    { expirationTtl: WATCH_CHECK.confirmHours * 3600 },
  );
  // A pending address keeps the subscription in the index, so cancelling it reaches the address.
  await register(env, c);
  const sent = await sendConfirmation(env, address, pendingId);
  const view = alertsView(env, {
    ...cur,
    pending_email: maskEmail(address),
    pending_id: pendingId,
    pending_expires: expires,
  });
  return {
    status: sent ? 202 : 503,
    body: sent
      ? {
          ...view,
          next: "open the confirmation link sent to that address; alerts start once it is confirmed",
        }
      : {
          ...view,
          error: "EmailFailed",
          code: "EmailFailed",
          message:
            "the confirmation email could not be sent; try again in a few minutes.",
          next: "retry later",
        },
  };
}

/** Run one watch tool for this caller. */
export async function runWatchTool(
  name: string,
  args: unknown,
  env: Env,
  caller: WatchCaller | undefined,
  kind: CallerKind,
  deps: WatchDeps = {},
): Promise<ToolAnswer> {
  if (!caller) {
    countEvent(env, "plan_required", ["watch", kind]);
    return watchPlanRequired();
  }
  if (!env.WATCH) return storeDown();
  const a = (
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? args
      : {}
  ) as Record<string, unknown>;
  try {
    switch (name) {
      case "watch_add":
        return await addTool(env, caller, a, deps);
      case "watch_remove":
        return await removeTool(env, caller, a);
      case "watch_list":
        return await listTool(env, caller, a, deps);
      case "watch_changes":
        return await changesTool(env, caller, a, deps);
      case "watch_alerts":
        return await setAlerts(env, caller, a.enabled, a.email, deps);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "watch tool failed",
        tool: name,
        error: err instanceof Error ? err.name : typeof err,
      }),
    );
    return storeDown();
  }
  return fail(404, "NotFound", `unknown tool ${name}`, "tools/list");
}

// --- MCP and REST glue ----------------------------------------------------------------------------

export type WatchCall = {
  id: string | number;
  params: { name: string; arguments?: unknown };
};

/** A tools/call of a watch tool, while watch lists are on. */
export function isWatchCall(env: Env, item: unknown): item is WatchCall {
  if (!watchEnabled(env) || typeof item !== "object" || item === null)
    return false;
  const { id, method, params } = item as {
    id?: unknown;
    method?: unknown;
    params?: { name?: unknown } | null;
  };
  return (
    method === "tools/call" &&
    (typeof id === "string" || typeof id === "number") &&
    typeof params?.name === "string" &&
    WATCH_TOOL_NAMES.has(params.name)
  );
}

/**
 * watch_add and watch_changes calls answered per MCP request: each may read the registry (one
 * /get-many call, or up to 10 single calls against an older registry Worker; watch_changes two),
 * so this keeps one request well inside Cloudflare's 32 invocations. Further ones get an error,
 * uncharged, to send in another request.
 */
export const MAX_WATCH_READ_CALLS_PER_REQUEST = 2;
const READING_TOOLS = new Set(["watch_add", "watch_changes"]);

/** Whether a watch call may read the registry (and so counts toward the cap above). */
export const readsRegistry = (m: WatchCall) => READING_TOOLS.has(m.params.name);

export async function answerWatchCall(
  env: Env,
  caller: WatchCaller | undefined,
  kind: CallerKind,
  m: WatchCall,
  deps: WatchDeps = {},
  /** This call is over MAX_WATCH_READ_CALLS_PER_REQUEST: refused, nothing run or charged. */
  overCap = false,
): Promise<unknown> {
  const a =
    overCap && caller
      ? fail(
          429,
          "WatchCallLimit",
          `one request may hold at most ${MAX_WATCH_READ_CALLS_PER_REQUEST} watch_add or watch_changes calls; this one was not run and nothing was counted.`,
          "send it in another request",
        )
      : await runWatchTool(
          m.params.name,
          m.params.arguments ?? {},
          env,
          caller,
          kind,
          deps,
        );
  return {
    jsonrpc: "2.0",
    id: m.id,
    result: {
      content: [{ type: "text", text: JSON.stringify(a.body, null, 2) }],
      structuredContent: a.body,
      ...(a.status >= 400 ? { isError: true } : {}),
    },
  };
}

/** POST /v1/watch/*. */
export async function watchRestRoute(
  request: Request,
  env: Env,
  path: string,
  caller: WatchCaller | undefined,
  kind: CallerKind,
  deps: WatchDeps = {},
): Promise<Response> {
  if (request.method !== "POST")
    return json(
      405,
      {
        error: "MethodNotAllowed",
        code: "MethodNotAllowed",
        message: `use POST for ${path}`,
        next: `POST ${path}`,
      },
      { allow: "POST" },
    );
  const text = await request.text();
  if (text.length > 64 * 1024)
    return json(413, {
      error: "PayloadTooLarge",
      code: "PayloadTooLarge",
      message: "request body over 64 KB",
    });
  let args: unknown = {};
  if (text.trim()) {
    try {
      args = JSON.parse(text);
    } catch {
      return json(400, {
        error: "InvalidInput",
        code: "InvalidInput",
        message: "the body is not JSON",
        next: "send a JSON object",
      });
    }
  }
  const a = await runWatchTool(
    WATCH_PATHS.get(path)!,
    args,
    env,
    caller,
    kind,
    deps,
  );
  return json(a.status, a.body);
}

// --- Account page -----------------------------------------------------------------------------

const form = (
  key: string,
  action: string,
  label: string,
  fields = "",
  cls = "button",
) =>
  `<form method="post" action="/account"><input type="hidden" name="key" value="${escapeHtml(key)}">${fields}<button type="submit" class="${cls}" name="action" value="${action}">${escapeHtml(label)}</button></form>`;

/** The account page's watch-list section (empty while the feature is off). */
export async function watchAccountSection(
  env: Env,
  key: string,
  caller: WatchCaller | undefined,
): Promise<string> {
  if (!watchEnabled(env) || !env.WATCH || !caller) return "";
  let l: Awaited<ReturnType<typeof listTool>>;
  let recent: { changes: StoredChange[] };
  try {
    [l, recent] = await Promise.all([
      listTool(env, caller, { limit: 50 }),
      env.WATCH.sub<{ changes: StoredChange[] }>(
        caller.subscription,
        "recent",
        { limit: 10 },
      ),
    ]);
  } catch {
    return `<section class="step" id="watch" aria-labelledby="h-watch"><h2 id="h-watch">Watch lists</h2><p>Watch lists are briefly unavailable. Reload in a minute.</p></section>`;
  }
  const b = l.body as {
    lists: { name: string; subjects: number }[];
    watched: { subjects: number; limit: number };
    alerts: {
      state: string;
      email: string | null;
      pending_email?: string;
      available: boolean;
    };
  };
  const lists = b.lists.length
    ? `<ul class="plain">${b.lists
        .map(
          (x) =>
            `<li><strong>${escapeHtml(x.name)}</strong>: ${x.subjects} subject${x.subjects === 1 ? "" : "s"} ${form(key, "watch_remove_list", "Remove list", `<input type="hidden" name="list" value="${escapeHtml(x.name)}">`, "link")}</li>`,
        )
        .join("")}</ul>`
    : "<p>No lists yet.</p>";
  const changes = recent.changes.length
    ? `<p>Latest changes</p><ul class="plain">${recent.changes
        .map(
          (c) =>
            `<li>${escapeHtml(c.built_at.slice(0, 10))}: ${escapeHtml(c.label ?? c.urn)}: ${escapeHtml(c.summary)}</li>`,
        )
        .join("")}</ul>`
    : "";
  const pending = b.alerts.pending_email
    ? `<p>Waiting for confirmation: open the link sent to ${escapeHtml(b.alerts.pending_email)}. Nothing else is sent there until then.</p>`
    : "";
  const alerts = b.alerts.email
    ? `<p>Alert emails go to ${escapeHtml(b.alerts.email)} after each registry update that changes something you watch.</p>${pending}<div class="buttons">${form(key, "watch_alerts_off", "Stop alert emails")}</div>`
    : pending
      ? `${pending}<div class="buttons">${form(key, "watch_alerts_off", "Cancel")}</div>`
      : b.alerts.available
        ? `<p>Alert emails are off.</p>${form(key, "watch_alerts_on", "Email me changes", `<label>Email <input type="email" name="email" maxlength="254" required></label> `)}`
        : `<p>Alert emails are not available yet; the <code>watch_changes</code> tool shows every change.</p>`;
  return `<section class="step" id="watch" aria-labelledby="h-watch"><h2 id="h-watch">Watch lists</h2>
<p>${b.watched.subjects.toLocaleString("en-US")} of ${b.watched.limit.toLocaleString("en-US")} subjects watched. After each registry update FactLot compares them and keeps what changed: value, owner of record, recorded documents, entity status.</p>
${lists}
${form(key, "watch_add", "Watch", `<label>List <input name="list" value="${DEFAULT_LIST}" maxlength="40"></label><label>URNs, one per line (one registry lookup each) <textarea name="urns" rows="3"></textarea></label>`)}
${changes}
${alerts}
<p class="small">Agents use the <code>watch_add</code>, <code>watch_list</code>, <code>watch_changes</code>, <code>watch_remove</code> and <code>watch_alerts</code> tools.</p></section>`;
}

/** A watch action from the account page's forms; the notice to show. */
export async function watchAccountAction(
  env: Env,
  caller: WatchCaller | undefined,
  kind: CallerKind,
  action: string,
  fields: URLSearchParams,
  deps: WatchDeps = {},
): Promise<string> {
  if (!watchEnabled(env) || !env.WATCH) return "Watch lists are not available.";
  const say = (a: ToolAnswer, ok: string) =>
    a.status < 300 ? ok : String(a.body.message ?? "That did not work.");
  if (action === "watch_add") {
    const urns = (fields.get("urns") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, WATCH_ADD_MAX);
    if (!urns.length) return "Enter at least one URN.";
    const a = await runWatchTool(
      "watch_add",
      { list: fields.get("list") || DEFAULT_LIST, urns },
      env,
      caller,
      kind,
      deps,
    );
    const b = a.body as {
      added?: unknown[];
      errors?: { urn: string; message: string }[];
    };
    return say(
      a,
      `${b.added?.length ?? 0} added.${b.errors?.length ? ` Not added: ${b.errors.map((e) => `${e.urn} (${e.message})`).join("; ")}` : ""}`,
    );
  }
  if (action === "watch_remove_list")
    return say(
      await runWatchTool(
        "watch_remove",
        { list: fields.get("list") ?? "", all: true },
        env,
        caller,
        kind,
        deps,
      ),
      "The list is removed.",
    );
  if (action === "watch_alerts_on")
    return say(
      await runWatchTool(
        "watch_alerts",
        { enabled: true, email: fields.get("email") ?? "" },
        env,
        caller,
        kind,
        deps,
      ),
      "A confirmation link is on its way to that address. Alerts start once it is opened.",
    );
  if (action === "watch_alerts_off")
    return say(
      await runWatchTool(
        "watch_alerts",
        { enabled: false },
        env,
        caller,
        kind,
        deps,
      ),
      "Alert emails are off and the addresses are deleted.",
    );
  return "Unknown action.";
}

// --- The stop link ----------------------------------------------------------------------------

/** GET shows one button; POST (the button, or a mail client's one-click POST) stops alerts. */
export async function watchStopRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const token = path.slice(STOP_PATH.length);
  const secret = env.RECOVERY_SIGNING_SECRET;
  const id = secret ? await stopTokenId(secret, token) : undefined;
  const gone = () =>
    messagePage(
      404,
      "Link not valid",
      "This stop link is not valid or alerts were already stopped. Nothing else changed.",
    );
  if (!id || !env.WATCH) return gone();
  if (request.method === "GET" || request.method === "HEAD")
    return page(
      "Stop watch-list emails",
      `<h1>Stop watch-list emails</h1>
<p class="lead">Press the button to stop FactLot's watch-list alert emails and delete the address they go to. Your watch lists stay, and the watch_changes tool keeps working.</p>
<form method="post" action="${escapeHtml(STOP_PATH + token)}"><div class="buttons"><button type="submit" class="button primary">Stop the emails</button></div></form>`,
      { formAction: "'self'" },
    );
  if (request.method !== "POST")
    return json(
      405,
      { error: "MethodNotAllowed", message: "GET or POST" },
      { allow: "GET, POST" },
    );
  const subscription = await env.KEYS.get(`${STOP_KV_PREFIX}${id}`);
  if (!subscription) return gone();
  const cur = await env.WATCH.sub<{ alert_id: string | null }>(
    subscription,
    "alerts_get",
  );
  if (cur.alert_id === id) {
    const r = await env.WATCH.sub<{ previous_pending_id: string | null }>(
      subscription,
      "alerts_off",
      {},
    );
    if (r.previous_pending_id)
      await env.KEYS.delete(`${CONFIRM_KV_PREFIX}${r.previous_pending_id}`);
  }
  await env.KEYS.delete(`${STOP_KV_PREFIX}${id}`);
  return messagePage(
    200,
    "Emails stopped",
    "Watch-list alert emails are stopped and the address is deleted. You can turn them on again on your account page.",
  );
}

// --- The confirmation link --------------------------------------------------------------------

/** GET shows one button; POST confirms the pending address (once, before it expires). */
export async function watchConfirmRoute(
  request: Request,
  env: Env,
  path: string,
  deps: WatchDeps = {},
): Promise<Response> {
  const token = path.slice(CONFIRM_PATH.length);
  const secret = env.RECOVERY_SIGNING_SECRET;
  const id = secret ? await confirmTokenId(secret, token) : undefined;
  const gone = () =>
    messagePage(
      404,
      "Link not valid",
      "This confirmation link is not valid, has expired or was already used. Turn alerts on again to get a new one.",
    );
  if (!id || !env.WATCH) return gone();
  if (request.method === "GET" || request.method === "HEAD")
    return page(
      "Confirm watch-list emails",
      `<h1>Confirm watch-list emails</h1>
<p class="lead">Press the button to receive FactLot's watch-list alert emails at this address: one email after each registry update that changes something the subscription watches, each with a one-click stop link.</p>
<form method="post" action="${escapeHtml(CONFIRM_PATH + token)}"><div class="buttons"><button type="submit" class="button primary">Confirm</button></div></form>`,
      { formAction: "'self'" },
    );
  if (request.method !== "POST")
    return json(
      405,
      { error: "MethodNotAllowed", message: "GET or POST" },
      { allow: "GET, POST" },
    );
  const raw = await env.KEYS.get(`${CONFIRM_KV_PREFIX}${id}`);
  const pending = ((): { subscription?: unknown; email?: unknown } => {
    try {
      return (JSON.parse(raw ?? "{}") ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const subscription = pending.subscription;
  if (typeof subscription !== "string" || typeof pending.email !== "string")
    return gone();
  const alertId = randomToken();
  const r = await env.WATCH.sub<{
    ok: boolean;
    previous_alert_id?: string | null;
  }>(subscription, "alerts_confirm", {
    pending_id: id,
    email: pending.email,
    alert_id: alertId,
    now: (deps.now ?? Date.now)(),
  });
  await env.KEYS.delete(`${CONFIRM_KV_PREFIX}${id}`);
  if (!r.ok) return gone();
  await env.KEYS.put(`${STOP_KV_PREFIX}${alertId}`, subscription);
  if (r.previous_alert_id)
    await env.KEYS.delete(`${STOP_KV_PREFIX}${r.previous_alert_id}`);
  await env.WATCH.index("register", { owner: `sub:${subscription}` });
  return messagePage(
    200,
    "Alerts confirmed",
    "Watch-list alert emails will go to this address after each registry update that changes something the subscription watches. Every email has a one-click stop link.",
  );
}

export { CONFIRM_PATH, STOP_PATH };
