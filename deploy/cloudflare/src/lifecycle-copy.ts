/**
 * The words and fixed rules of the lifecycle emails: which message is transactional and which is
 * optional, when each is due, the consent texts, and the message builders. Facts and figures in a
 * message come from the caller's own data or from plans.ts, never from a number typed here.
 *
 * Two classes (see lifecycle.ts):
 * - transactional: sent because of something the person did or bought and needed to use the
 *   service. No consent beyond the request itself.
 * - promotional (everything else): sent only to an address whose owner ticked the separate,
 *   unticked-by-default box, with the postal address and a one-click stop link in the footer.
 *   When in doubt a message is promotional.
 *
 * Message ids follow the order a customer meets them: A0 to A4 for a free key, B0 to B2 for a
 * paid plan.
 */
import { body } from "./email.ts";
import { PLANS, priceText, type Plan } from "./plans.ts";
import { hmacSha256Hex } from "./stripe.ts";

/** The feature is dark unless LIFECYCLE_EMAILS_ENABLED is exactly "true". */
export function lifecycleEnabled(env: {
  LIFECYCLE_EMAILS_ENABLED?: string;
}): boolean {
  return env.LIFECYCLE_EMAILS_ENABLED === "true";
}

export type MessageId = "A0" | "A1" | "A2" | "A3" | "A4" | "B0" | "B1" | "B2";
export type MessageClass = "transactional" | "promotional";
export type Audience = "free" | "paid";

export interface MessageSpec {
  class: MessageClass;
  audience: Audience;
  /** The event that sends it. */
  trigger: string;
}

export const MESSAGES: Record<MessageId, MessageSpec> = {
  A0: {
    class: "transactional",
    audience: "free",
    trigger:
      "the free key request: the key link email carries a line on where to connect the key",
  },
  A1: {
    class: "promotional",
    audience: "free",
    trigger:
      "the first answer to the free key that left earlier roll years or parcels out",
  },
  A2: {
    class: "promotional",
    audience: "free",
    trigger: "a daily check: the key is old enough and has made no lookup",
  },
  A3: {
    class: "promotional",
    audience: "free",
    trigger: "the first time the free key's daily lookups run out",
  },
  A4: {
    class: "promotional",
    audience: "free",
    trigger: "a daily check: the key is old enough and was used this week",
  },
  B0: {
    class: "transactional",
    audience: "paid",
    trigger:
      "a completed checkout: the welcome email (carries the return link when there is one)",
  },
  B1: {
    class: "promotional",
    audience: "paid",
    trigger: "a daily check: the plan is old enough and has made no lookup",
  },
  B2: {
    class: "promotional",
    audience: "paid",
    trigger: "a daily check: the plan is old enough and was used this week",
  },
};

/** The optional messages of one audience, in the order they can arrive. */
export const optionalMessages = (audience: Audience): MessageId[] =>
  (Object.keys(MESSAGES) as MessageId[]).filter(
    (id) =>
      MESSAGES[id].audience === audience &&
      MESSAGES[id].class === "promotional",
  );

/** At most this many optional messages a day to one person, whatever the audience. */
export const PROMO_DAILY_CAP = 1;

/** Days after the key or the purchase before the time-based messages are due. */
export const DUE_AFTER_DAYS = { A2: 2, A4: 7, B1: 1, B2: 7 } as const;
/** A time-based message is not sent once the key or plan is older than this many days. */
export const DUE_UNTIL_DAYS = 30;

/** The consent box texts: what is sent and how often, in plain words. */
export function freeConsentText(): string {
  const n = optionalMessages("free").length;
  return `Also email me up to ${n} optional notes about FactLot, only about my free key: one when a lookup leaves earlier roll years out, one if I have not used the key after ${DUE_AFTER_DAYS.A2} days, one when I reach the daily limit, and a summary after ${DUE_AFTER_DAYS.A4} days. No more than ${PROMO_DAILY_CAP} a day, each with a link that stops them.`;
}

export function paidConsentText(): string {
  const n = optionalMessages("paid").length;
  return `Also email me up to ${n} optional notes about my plan: one if my key has not been used ${DUE_AFTER_DAYS.B1} day after I buy, and one after ${DUE_AFTER_DAYS.B2} days. Each has a link that stops them.`;
}

export const CONSENT_FOOTNOTE =
  "Optional and off unless you tick it. Your address is kept for these notes only, until you stop them or delete your key.";

// --- Return links -----------------------------------------------------------------------------

/** The longest address search carried through a link. */
export const QUERY_MAX = 120;

/**
 * A property address (or part of one) made safe to carry in a link: control characters and anything
 * outside letters, digits and ` .,#'&/-` removed, whitespace collapsed, at most QUERY_MAX characters.
 * Empty when nothing is left. An address of a commercial parcel is not personal data; an email
 * address or a key never survives this (no "@", no "_").
 */
export function cleanQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .slice(0, QUERY_MAX * 4)
    .replace(/[^A-Za-z0-9 .,#'&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUERY_MAX)
    .trim();
}

/**
 * encodeURIComponent, but also the characters it leaves alone that can end a sentence or a quote
 * (`.` `'` `-` and the like), so a link never ends in punctuation a mail client might cut off.
 */
export function encodeQuery(s: string): string {
  return encodeURIComponent(s).replace(
    /[-.!~*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

const PARCEL_URN = /^fl:parcel:(us-\d{5}):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** A parcel URN as `fl:parcel:us-48201:0001`, or "" (nothing else is carried). */
export function cleanUrn(raw: unknown): string {
  return typeof raw === "string" && raw.length <= 200 && PARCEL_URN.test(raw)
    ? raw
    : "";
}

/** What the person was looking at when they went to checkout: an address search or a parcel. */
export interface Back {
  q?: string;
  urn?: string;
}

/** The sanitised `q` and `urn` of a query string or a JSON body. */
export function readBack(src: {
  get(name: string): unknown;
}): Back | undefined {
  const q = cleanQuery(src.get("q"));
  const urn = cleanUrn(src.get("urn"));
  if (!q && !urn) return undefined;
  return { ...(q ? { q } : {}), ...(urn ? { urn } : {}) };
}

/** `&q=...&urn=...` for a checkout or success URL (empty without a back). */
export function backParams(back?: Back): string {
  if (!back) return "";
  return (
    (back.q ? `&q=${encodeQuery(back.q)}` : "") +
    (back.urn ? `&urn=${encodeQuery(back.urn)}` : "")
  );
}

/**
 * Where the success page and the welcome email send the buyer back to: the parcel's page when
 * property pages are on, else the try page run on the same address. Undefined when there is
 * nothing to go back to.
 */
export function backLink(
  site: string,
  back: Back | undefined,
  propertyPath: (urn: string) => string | null,
  propertyPagesOn: boolean,
): { href: string; label: string } | undefined {
  if (!back) return undefined;
  const path = back.urn && propertyPagesOn ? propertyPath(back.urn) : null;
  if (path)
    return {
      href: `${site}${path}`,
      label: "Back to the property you were viewing",
    };
  if (back.q)
    return {
      href: `${site}/try/?q=${encodeQuery(back.q)}`,
      label: "Back to your lookup",
    };
  return undefined;
}

/** A checkout link that returns to what the person was looking at. */
export function checkoutLink(
  site: string,
  plan: "pro" | "team",
  back?: Back,
): string {
  return `${site}/billing/checkout?plan=${plan}${backParams(back)}`;
}

// --- Messages ---------------------------------------------------------------------------------

export interface Built {
  subject: string;
  text: string;
  html: string;
}

export interface PromoContext {
  site: string;
  api: string;
  /** One-click stop link for this person. */
  stopUrl: string;
  /** The operator's postal address, one line. */
  address: string;
  audience: Audience;
}

const n = (x: number) => x.toLocaleString("en-US");
const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/** Footer of every optional note: why it came, the postal address and the stop link. */
export function promoFooter(c: PromoContext): string {
  const why =
    c.audience === "free"
      ? "You get this because you ticked the box for optional emails when you asked for a free key."
      : "You get this because you ticked the box for optional emails after you bought a plan.";
  return `${why}\nStop these emails with one click, no sign-in: ${c.stopUrl}\nFactLot, ${c.address}`;
}

function promo(c: PromoContext, subject: string, paragraphs: string[]): Built {
  return { subject, ...body([...paragraphs, promoFooter(c)]) };
}

/** What a free answer left out, read from the answer itself. */
export interface WithheldFacts {
  /** Earlier roll years left out (from history_withheld.tax_years). */
  years?: number[];
  /** Earlier facts left out of a history list. */
  facts?: number;
  /** Parcels left out of an owner's portfolio, and the portfolio's size. */
  portfolio?: { count: number; total: number };
  /** The parcel the lookup was about, when the request named one. */
  urn?: string;
}

/** A1: the first answer to a free key that left something out. */
export function withheldMessage(c: PromoContext, f: WithheldFacts): Built {
  const years = [...(f.years ?? [])].sort((a, b) => a - b);
  const cut = f.portfolio && f.portfolio.count > 0 ? f.portfolio : undefined;
  const sentences: string[] = [];
  if (years.length > 0 || f.facts) {
    sentences.push(
      "Your last lookup with your free key returned the current roll year.",
    );
    sentences.push(
      years.length > 0
        ? `FactLot also holds ${years.length} earlier roll ${plural(years.length, "year", "years")} for that record (${years[0]}${years.length > 1 ? ` to ${years[years.length - 1]}` : ""}).`
        : `FactLot also holds ${n(f.facts!)} earlier ${plural(f.facts!, "fact", "facts")} in that record's history.`,
    );
  }
  if (cut)
    sentences.push(
      `${years.length > 0 || f.facts ? "Another answer" : "Your last lookup with your free key"} showed ${n(cut.total - cut.count)} of that owner's ${n(cut.total)} parcels; ${n(cut.count)} more ${plural(cut.count, "was", "were")} not shown.`,
    );
  const back: Back | undefined = f.urn ? { urn: f.urn } : undefined;
  return promo(c, "What your last FactLot lookup left out", [
    sentences.join(" "),
    `The rest comes with ${PLANS.pro.name} (${priceText(PLANS.pro)}, renews monthly until cancelled) or ${PLANS.team.name}. What each plan includes: ${c.site}/pricing/`,
    back
      ? `Start ${PLANS.pro.name} and come back to this parcel afterwards: ${checkoutLink(c.site, "pro", back)}`
      : `Start ${PLANS.pro.name}: ${checkoutLink(c.site, "pro")}`,
  ]);
}

/** A2: a free key with no lookup yet. */
export function unusedFreeMessage(c: PromoContext): Built {
  return promo(c, "Your FactLot key: a one-question test", [
    "You have a free FactLot key and it has not made a lookup yet.",
    `The shortest test: connect it to your assistant (${c.site}/mcp-server/) and ask about a commercial building you know. Every fact names the public file it came from, so you can check the answer. Or look up one address with no setup: ${c.site}/try/`,
    `If connecting was the obstacle, reply with the assistant you use and we will send the exact steps.`,
  ]);
}

/** A3: the daily lookups of a free key ran out. */
export function limitReachedMessage(
  c: PromoContext,
  f: { limit: number; resetsAt: string },
): Built {
  return promo(c, "Your free key reached today's lookups", [
    `Your free key used its ${n(f.limit)} registry lookups for today. They reset at ${f.resetsAt} (00:00 UTC). Calculators, IDs, document and rules tools are not counted and still work.`,
    `${PLANS.pro.name} includes ${n(PLANS.pro.registryLookupsPerMonth)} registry lookups a month (${priceText(PLANS.pro)}, renews monthly until cancelled): ${checkoutLink(c.site, "pro")}\nWhat each plan includes: ${c.site}/pricing/`,
  ]);
}

/** What a key's meter recorded over a window. */
export interface UsageFacts {
  lookups: number;
  tools: string[];
}

const toolList = (tools: string[]) =>
  tools.slice(0, 3).join(", ") + (tools.length > 3 ? " and others" : "");

/** A4: a free key's first week. */
export function freeWeekMessage(c: PromoContext, u: UsageFacts): Built {
  return promo(
    c,
    `Your FactLot key so far: ${n(u.lookups)} ${plural(u.lookups, "lookup", "lookups")}`,
    [
      `Your current free key has made ${n(u.lookups)} registry ${plural(u.lookups, "lookup", "lookups")}${u.tools.length ? ` (${toolList(u.tools)})` : ""}.`,
      `Earlier roll years and every parcel of an owner's portfolio come with ${PLANS.pro.name} (${priceText(PLANS.pro)}): ${checkoutLink(c.site, "pro")}`,
      "Or reply and tell us what you were trying to find; it decides what we load next.",
    ],
  );
}

/** B1: a paid plan with no lookup yet. */
export function unusedPaidMessage(c: PromoContext, plan: Plan): Built {
  return promo(c, "Did connecting FactLot work?", [
    `You bought ${plan.name} and FactLot has not recorded a registry lookup from it yet. Calculators and other tools are not recorded, so this may just mean you have used those.`,
    `If you meant to use registry lookups, the setup steps for Claude, ChatGPT, Cursor, VS Code, Python and curl are at ${c.api}/v1/onboarding?plan=${plan.id}`,
    "Reply with the client you use and we will send the exact lines, or do it with you on a call.",
  ]);
}

/** B2: a paid plan's first week. */
export function paidWeekMessage(
  c: PromoContext,
  plan: Plan,
  u: UsageFacts,
): Built {
  return promo(c, `Your ${plan.name} usage so far`, [
    `Your plan has made ${n(u.lookups)} registry ${plural(u.lookups, "lookup", "lookups")}${u.tools.length ? ` (${toolList(u.tools)})` : ""}. The plan includes ${n(plan.registryLookupsPerMonth)} a month.`,
    "One request: what is the one thing you wanted FactLot to answer that it could not? One line is enough. Replies are read and set the build order.",
    `Billing, usage and cancelling: ${c.site}/account`,
  ]);
}

// --- Consent proof (the box on the page after checkout) ---------------------------------------------

const CONSENT_PURPOSE = "factlot-lifecycle-consent";
/** How long after the key was shown the page's consent form is accepted. */
export const CONSENT_WINDOW_MS = 60 * 60 * 1000;

/** The proof the success page puts in the form: an HMAC of (purpose | session id | issue time). */
export async function consentProof(
  secret: string,
  sessionId: string,
  issuedAt: number,
): Promise<string> {
  return hmacSha256Hex(secret, `${CONSENT_PURPOSE}|${sessionId}|${issuedAt}`);
}

/** Whether a proof is genuine for this session and was issued within CONSENT_WINDOW_MS of `now`. */
export async function checkConsentProof(
  secret: string,
  sessionId: string,
  issuedAt: unknown,
  proof: unknown,
  now: number,
): Promise<boolean> {
  const t = typeof issuedAt === "string" ? Number(issuedAt) : NaN;
  if (!Number.isInteger(t) || typeof proof !== "string") return false;
  if (t > now + 60_000 || now - t > CONSENT_WINDOW_MS) return false;
  const expected = await consentProof(secret, sessionId, t);
  if (expected.length !== proof.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ proof.charCodeAt(i);
  return diff === 0;
}
