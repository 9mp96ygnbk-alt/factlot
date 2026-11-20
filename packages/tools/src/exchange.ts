/**
 * fact_package_send and fact_package_status: send a fact package to a counterparty for
 * confirmation through the Record, and read the counterparty's answers.
 *
 * Both call the Record's public exchange endpoint, the same one anyone could call (no private
 * door). The one thing a configured FactLot service adds is an application token: with it, the
 * Record counts the package as real; without it (a local server, a test) the package is a
 * sandbox package and never counts in the Record's measure. Nothing is sent without a named
 * person's approval (approved_by and approval_confirmed), and the package must pass
 * fact_package_verify's integrity checks first.
 *
 * These are the only tools that make an outbound call. They are `async` (like fact_package_verify)
 * and reach the network through `fetch`, which can be replaced for tests with configureExchange.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { z } from "zod";

import { ToolInputError } from "./documents.ts";
import type { Json } from "./documents.ts";
import type { FreeDocumentHost } from "./free_document.ts";
import { verifyFactPackage } from "./packages.ts";

export const EXCHANGE_URL =
  "https://czmyqwkauymguoznzpzr.supabase.co/functions/v1/exchange";
/** The most facts the Record takes in one rent roll package (a lease-by-lease roll is larger than an estoppel). */
export const RENT_ROLL_PACKAGE_FACTS = 600;
export const EXCHANGE_SITE_URL = "https://cre-record.vercel.app";

export interface ExchangeConfig {
  /** The exchange endpoint (default EXCHANGE_URL, or FACTLOT_EXCHANGE_URL). */
  url?: string;
  /** Where counterparty links point (default EXCHANGE_SITE_URL, or FACTLOT_EXCHANGE_SITE_URL). */
  siteUrl?: string;
  /** Application token (default FACTLOT_EXCHANGE_TOKEN). With it a package is real, without it a sandbox. */
  token?: string;
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
}

let config: ExchangeConfig = {};

/** Set the exchange endpoint, site, application token or fetch. Pass {} to go back to the defaults. */
export function configureExchange(next: ExchangeConfig): void {
  config = { ...next };
}

const envOf = (name: string): string | undefined => {
  const p = (globalThis as { process?: { env?: Record<string, string> } })
    .process;
  const v = p?.env?.[name];
  return v ? v : undefined;
};
const endpoint = (): string =>
  config.url ?? envOf("FACTLOT_EXCHANGE_URL") ?? EXCHANGE_URL;
const siteUrl = (): string =>
  (
    config.siteUrl ??
    envOf("FACTLOT_EXCHANGE_SITE_URL") ??
    EXCHANGE_SITE_URL
  ).replace(/\/$/, "");
const appToken = (): string | undefined =>
  config.token ?? envOf("FACTLOT_EXCHANGE_TOKEN");

/**
 * Who is calling, set by a host that knows (the hosted Worker, after it has checked a FactLot
 * key). accountId is a stable id for the account behind the key (never the key itself). Without it
 * a package is sent in test mode.
 */
export interface ExchangeCaller {
  accountId?: string;
  /** Why this caller sends test packages only, when the host knows (a guest key). */
  testReason?: string;
  /**
   * The hosted plan rule for audit_expense_statement: false means this caller gets the summary
   * only (no Pro or Team key while gating is on). Unset (a local call) means the whole answer.
   */
  fullAudit?: boolean;
  /**
   * The hosted rule that gives a free, email-verified account one full document (free_document.ts).
   * Only read when fullAudit is false.
   */
  freeDocument?: FreeDocumentHost;
}
const callerStore = new AsyncLocalStorage<ExchangeCaller>();

/** The caller set by runWithExchangeCaller around the current call, if any. */
export function currentExchangeCaller(): ExchangeCaller | undefined {
  return callerStore.getStore();
}

/** Run `fn` with the caller's account known to fact_package_send. */
export function runWithExchangeCaller<T>(
  caller: ExchangeCaller,
  fn: () => T,
): T {
  return callerStore.run(caller, fn);
}

/** The exchange could not be reached or failed on its side; nothing was sent or recorded as far as FactLot knows. */
export class ExchangeUnavailableError extends Error {
  override name = "ExchangeUnavailableError";
}

// --- input ---------------------------------------------------------------------------------------

const Party = z.object({
  organisation: z.string().min(1).max(120),
  person: z.string().min(1).max(120),
  email: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Kept by the Record to reach the person; never shown to the other party.",
    ),
});
const Counterparty = z.object({
  organisation: z.string().min(1).max(120),
  person: z.string().max(120).optional(),
  email: z
    .string()
    .max(200)
    .optional()
    .describe("Kept by the Record; never shown to anyone else."),
});
const Figure = z.union([z.string().min(1).max(400), z.number().finite()]);

const RENT_ROLL_GRADES = [
  "matches_lease",
  "matches_lease_confirmed_by_tenant",
  "differs",
  "no_lease_supplied",
  "not_checkable",
] as const;

export const ExchangeItem = z.object({
  key: z
    .string()
    .regex(
      /^[A-Za-z0-9_.-]{1,60}$/,
      "letters, digits, _ . and - only (1 to 60)",
    )
    .describe("A short stable name for the item, unique in the package."),
  label: z
    .string()
    .min(1)
    .max(160)
    .describe("What the item is, in plain words the counterparty will read."),
  value: Figure.describe(
    "The sender's figure. For accept_theirs it is the figure the sender accepts (the counterparty's own); for state_ours it is the figure the sender says is right.",
  ),
  unit: z.string().max(30).optional().describe("For example USD, SF, percent."),
  position: z
    .enum(["accept_theirs", "state_ours"])
    .describe(
      "accept_theirs: the sender accepts the counterparty's figure (recorded at once as relied on by the sender). state_ours: the sender states its own figure and asks the counterparty to agree or dispute it.",
    ),
  their_value: Figure.optional().describe(
    "The counterparty's figure, when it differs (always give it for state_ours).",
  ),
  fact_ids: z
    .array(z.string().min(1).max(200))
    .min(0)
    .max(20)
    .describe(
      "The ids of the facts in the package this item rests on. Each fact must carry a source quote, page and document sha256. Only an estoppel statement the tenant alone can confirm (tenant_to_confirm true) may have none.",
    ),
  note: z
    .string()
    .max(600)
    .optional()
    .describe("A sentence on why, shown to the counterparty."),
  number: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Estoppel: the statement's number in the certificate."),
  text: z
    .string()
    .min(1)
    .max(700)
    .optional()
    .describe(
      "Estoppel: the statement as the tenant reads and answers it (estoppel_prepare package_items[].text).",
    ),
  tenant_to_confirm: z
    .boolean()
    .optional()
    .describe(
      "Estoppel: true for a statement with no lease source that only the tenant can confirm. It has no fact_ids.",
    ),
  needs_tenant_value: z
    .boolean()
    .optional()
    .describe(
      "Estoppel: true when the tenant must state the figure or date itself (for example the date rent is paid through); the tenant's answer then carries its own version.",
    ),
  grade: z
    .enum(RENT_ROLL_GRADES)
    .optional()
    .describe(
      "Rent roll: the line's grade from rent_roll_certify. Reliance is recorded only for matches_lease and matches_lease_confirmed_by_tenant.",
    ),
  grade_label: z
    .string()
    .max(80)
    .optional()
    .describe("Rent roll: the grade in words, as rent_roll_certify gives it."),
  differences: z
    .array(
      z.object({
        field: z.string().min(1).max(40).describe("The field that differs."),
        label: z.string().max(80).describe("The field in words."),
        roll: z
          .union([z.string().max(200), z.number().finite()])
          .nullable()
          .describe("The roll's figure."),
        against: z
          .union([z.string().max(200), z.number().finite()])
          .nullable()
          .describe("The figure it was compared with."),
        against_label: z
          .string()
          .max(20)
          .describe("What it was compared with: Lease, Tenant or Roll."),
        difference: z
          .number()
          .finite()
          .optional()
          .describe("Roll minus the figure compared with."),
      }),
    )
    .max(12)
    .optional()
    .describe("Rent roll: the fields of the line that differ."),
  estoppel_package_id: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Rent roll: the estoppel package whose confirmed statements back a matches_lease_confirmed_by_tenant grade.",
    ),
  estoppel_statements: z
    .array(z.string().min(1).max(60))
    .max(60)
    .optional()
    .describe(
      "Rent roll: the keys of the estoppel statements the tenant agreed.",
    ),
});

export const FactPackageSendInput = z.object({
  package: z
    .record(z.string(), z.unknown())
    .describe("The package from fact_package_create (signed or not)."),
  kind: z
    .enum([
      "expense_reconciliation",
      "fact_confirmation",
      "estoppel",
      "rent_roll",
    ])
    .describe(
      "What is being confirmed. estoppel: the statements from estoppel_prepare, answered by the tenant and then open to a lender or buyer through relying_parties. rent_roll: a certified rent roll from rent_roll_certify, asserted by the sender (no answer step) and open at once to the lender or buyer named in to, and to relying_parties, who record reliance on each line graded as matching.",
    ),
  title: z.string().min(1).max(160).describe("A title the counterparty sees."),
  subject: z
    .object({
      label: z
        .string()
        .min(1)
        .max(240)
        .describe("What it is about, in words (for example an address)."),
      record_id: z
        .string()
        .regex(
          /^par_[0-9A-Za-z]{13}$/,
          "a Record ID looks like par_ plus 13 characters",
        )
        .optional(),
      urn: z
        .string()
        .regex(
          /^fl:[a-z_]+:[A-Za-z0-9_.:-]+$/,
          "a FactLot URN looks like fl:parcel:...",
        )
        .max(120)
        .optional(),
    })
    .describe("The property or lease the facts are about."),
  from: Party.describe("The sender: organisation, person, email."),
  to: Counterparty.describe("The counterparty."),
  items: z
    .array(ExchangeItem)
    .min(1)
    .max(60)
    .describe("The line items. The counterparty answers each state_ours item."),
  calculation: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "A calc tool's output (for example calc_cam_reconciliation) shown to the counterparty with every step.",
    ),
  relying_parties: z
    .array(z.string().min(1).max(120))
    .max(5)
    .optional()
    .describe(
      "Estoppel and rent_roll only: a label for each lender or buyer that is to get its own view link and token (for example the lender's name). Each can read the package and record its own reliance; none can answer for the tenant. For an estoppel with none given the Record makes one link; for a rent roll the party named in to has a link already and these are additional.",
    ),
  estoppel_links: z
    .array(z.string().max(500))
    .max(60)
    .optional()
    .describe(
      "Rent roll only: the sender's status link (status_link_for_sender) of each estoppel that backs a matches_lease_confirmed_by_tenant line. The Record opens each with its private token to check the tenant agreed the statements; the token is not stored.",
    ),
  approved_by: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "The full name of the person at the sender who reviewed every item and approved sending this package. Recorded with the package and shown to the counterparty.",
    ),
  approval_confirmed: z
    .boolean()
    .describe(
      "Confirms that the person named in approved_by reviewed every item, both figures, the quote and page behind each, the calculation and the recipient, and approved sending. The tool refuses unless it is true.",
    ),
});

export const FactPackageStatusInput = z.object({
  status_link: z
    .string()
    .max(500)
    .optional()
    .describe("The sender's private status link from fact_package_send."),
  package_id: z.string().max(60).optional(),
  token: z
    .string()
    .max(200)
    .optional()
    .describe(
      "The sender's private token (with package_id), if there is no link.",
    ),
});

// --- platform calls ------------------------------------------------------------------------------

async function call(body: Json, forwardToken: boolean): Promise<Json> {
  const f = config.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = appToken();
  if (forwardToken && token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await f(endpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ExchangeUnavailableError(
      "the Record's exchange did not answer, so nothing was sent; retry in a moment",
    );
  }
  let out: Json;
  try {
    out = (await res.json()) as Json;
  } catch {
    throw new ExchangeUnavailableError(
      "the Record's exchange gave an unreadable answer; check fact_package_status before sending again",
    );
  }
  if (out.ok === true) return out.result as Json;
  const message = String(out.error ?? `the exchange answered ${res.status}`);
  if (res.status >= 500)
    throw new ExchangeUnavailableError(
      `the Record's exchange failed (${message}); check fact_package_status before sending again`,
    );
  throw new ToolInputError([{ path: "", message }]);
}

const link = (id: string, token: string): string =>
  `${siteUrl()}/#/r/${id}/${token}`;

// --- fact_package_send ----------------------------------------------------------------------------

export async function sendFactPackage(
  input: z.output<typeof FactPackageSendInput>,
): Promise<Json> {
  const issues: { path: string; message: string }[] = [];
  if (input.approval_confirmed !== true)
    issues.push({
      path: "approval_confirmed",
      message:
        "refused: nothing is sent without approval_confirmed true, confirming that the person named in approved_by reviewed every item, both figures, the quote and page behind each, the calculation and the recipient, and approved sending",
    });
  if (!input.approved_by.trim())
    issues.push({
      path: "approved_by",
      message: "the full name of the person who approved sending is required",
    });
  if (
    input.from.organisation.trim().toLowerCase() ===
    input.to.organisation.trim().toLowerCase()
  )
    issues.push({
      path: "to.organisation",
      message:
        "the counterparty must be a different organisation from the sender",
    });
  const seen = new Set<string>();
  const estoppel = input.kind === "estoppel";
  const rentRoll = input.kind === "rent_roll";
  if (!estoppel && !rentRoll && input.relying_parties)
    issues.push({
      path: "relying_parties",
      message: "relying parties are for kinds estoppel and rent_roll only",
    });
  if (!rentRoll && input.estoppel_links)
    issues.push({
      path: "estoppel_links",
      message: "estoppel_links are for kind rent_roll only",
    });
  const linked: { id: string; token: string }[] = [];
  (input.estoppel_links ?? []).forEach((l, i) => {
    const m = /#\/r\/([0-9a-f-]{36})\/([0-9a-zA-Z]+)\/?$/.exec(l.trim());
    if (!m)
      issues.push({
        path: `estoppel_links.${i}`,
        message: "not a status link from fact_package_send",
      });
    else linked.push({ id: m[1]!, token: m[2]! });
  });
  input.items.forEach((it, i) => {
    if (seen.has(it.key))
      issues.push({
        path: `items.${i}.key`,
        message: `duplicate item key ${it.key}`,
      });
    seen.add(it.key);
    const rrOnly =
      it.grade !== undefined ||
      it.grade_label !== undefined ||
      it.differences !== undefined ||
      it.estoppel_package_id !== undefined ||
      it.estoppel_statements !== undefined;
    if (rrOnly && !rentRoll)
      issues.push({
        path: `items.${i}`,
        message:
          "grade, grade_label, differences, estoppel_package_id and estoppel_statements are for kind rent_roll only",
      });
    if (rentRoll) {
      if (it.position !== "state_ours")
        issues.push({
          path: `items.${i}.position`,
          message:
            "every rent roll line is state_ours: the sender asserts it and the lender or buyer relies on it",
        });
      if (it.grade === undefined)
        issues.push({
          path: `items.${i}.grade`,
          message: "give the line's grade from rent_roll_certify",
        });
      if (it.fact_ids.length === 0)
        issues.push({
          path: `items.${i}.fact_ids`,
          message: "give the roll and lease facts the line rests on",
        });
      if (
        it.tenant_to_confirm !== undefined ||
        it.needs_tenant_value !== undefined ||
        it.text !== undefined
      )
        issues.push({
          path: `items.${i}`,
          message:
            "text, tenant_to_confirm and needs_tenant_value are for kind estoppel only",
        });
      if (it.grade === "matches_lease_confirmed_by_tenant") {
        if (!it.estoppel_package_id || !(it.estoppel_statements ?? []).length)
          issues.push({
            path: `items.${i}.estoppel_package_id`,
            message:
              "a line graded confirmed by tenant names the estoppel package and the statements the tenant agreed",
          });
        else if (!linked.some((l) => l.id === it.estoppel_package_id))
          issues.push({
            path: `items.${i}.estoppel_package_id`,
            message:
              "give the status link of that estoppel in estoppel_links so the Record can check the tenant's answers",
          });
      } else if (it.estoppel_package_id !== undefined)
        issues.push({
          path: `items.${i}.estoppel_package_id`,
          message: "only a line graded confirmed by tenant names an estoppel",
        });
    } else if (estoppel) {
      if (it.position !== "state_ours")
        issues.push({
          path: `items.${i}.position`,
          message:
            "every estoppel statement is state_ours: the tenant answers each one",
        });
      if (it.tenant_to_confirm === true && it.fact_ids.length > 0)
        issues.push({
          path: `items.${i}.fact_ids`,
          message:
            "a tenant_to_confirm statement has no lease source: leave fact_ids empty",
        });
      if (it.tenant_to_confirm !== true && it.fact_ids.length === 0)
        issues.push({
          path: `items.${i}.fact_ids`,
          message:
            "give the lease facts the statement rests on, or mark it tenant_to_confirm",
        });
    } else {
      if (it.fact_ids.length === 0)
        issues.push({
          path: `items.${i}.fact_ids`,
          message: "give at least one fact the item rests on",
        });
      if (
        it.tenant_to_confirm !== undefined ||
        it.needs_tenant_value !== undefined ||
        it.number !== undefined ||
        it.text !== undefined
      )
        issues.push({
          path: `items.${i}`,
          message:
            "number, text, tenant_to_confirm and needs_tenant_value are for kind estoppel only",
        });
      if (it.position === "state_ours" && it.their_value === undefined)
        issues.push({
          path: `items.${i}.their_value`,
          message:
            "give the counterparty's figure for an item the sender states",
        });
    }
  });
  const ids = new Set(
    Array.isArray(input.package.facts)
      ? (input.package.facts as Json[])
          .map((f) => f?.id)
          .filter((x) => typeof x === "string")
      : [],
  );
  input.items.forEach((it, i) =>
    it.fact_ids.forEach((fid, j) => {
      if (!ids.has(fid))
        issues.push({
          path: `items.${i}.fact_ids.${j}`,
          message: `${fid} is not a fact in the package`,
        });
    }),
  );
  if (
    rentRoll &&
    Array.isArray(input.package.facts) &&
    input.package.facts.length > RENT_ROLL_PACKAGE_FACTS
  )
    issues.push({
      path: "package.facts",
      message: `a rent roll package holds at most ${RENT_ROLL_PACKAGE_FACTS} facts (this one has ${input.package.facts.length}): send the roll in parts, by building or floor`,
    });
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  // The package must pass the same integrity and fact checks fact_package_verify makes.
  const check = (await verifyFactPackage({ package: input.package })) as Json;
  if (check.valid !== true) {
    const integrity = check.integrity as Json;
    const problems = [
      ...((integrity.problems as string[] | undefined) ?? []).map((m) => ({
        path: "package",
        message: m,
      })),
      ...((check.facts as Json).invalid as Json[]).map((x) => ({
        path: `package.facts.${String(x.fact)}`,
        message:
          "the fact does not pass fact_validate (run fact_package_verify for details)",
      })),
    ];
    throw new ToolInputError(
      problems.length
        ? problems.slice(0, 20)
        : [
            {
              path: "package",
              message: "the package does not pass fact_package_verify",
            },
          ],
    );
  }

  const ref = input.subject.record_id ?? input.subject.urn;
  // A package can be real only when this service holds the Record's application token and the
  // host has said which FactLot account is calling. Otherwise it is sent without the token, which
  // the Record can only take as a test.
  const caller = callerStore.getStore();
  const accountId = caller?.accountId;
  const forward = Boolean(appToken() && accountId);
  const sent = await call(
    {
      action: "send",
      package: input.package,
      kind: input.kind,
      title: input.title,
      subject: { label: input.subject.label, ...(ref ? { ref } : {}) },
      from: input.from,
      to: input.to,
      items: input.items,
      ...(input.calculation ? { calculation: input.calculation } : {}),
      ...((estoppel || rentRoll) && input.relying_parties
        ? { relying_parties: input.relying_parties }
        : {}),
      ...(rentRoll && linked.length ? { linked_estoppels: linked } : {}),
      approved_by: input.approved_by,
      approval_confirmed: true,
      ...(forward ? { sender_account: accountId } : {}),
    },
    forward,
  );
  const id = String(sent.id);
  const reliances = (sent.reliances_recorded as Json[]) ?? [];
  const sandbox = sent.sandbox === true;
  const reason = !appToken()
    ? "this FactLot is not connected to the Record as an accredited service (a local or self-hosted install, or a service without the Record's application token)"
    : !accountId
      ? (caller?.testReason ??
        "no full FactLot account key came with the call, and a full FactLot account key (a paid fl_live_ key or an email-verified fl_free_ key) is needed to send for real")
      : String(sent.test_mode_reason ?? "the Record took it as a test");
  const message = sandbox
    ? `TEST MODE: this package was sent in test mode. It does not count in the Record's measure and records no real reliance, because ${reason}. The counterparty can still open the link and ${rentRoll ? "read it" : "answer"}.`
    : rentRoll
      ? `SENT FOR REAL: the certified rent roll was sent to ${input.to.organisation}. Nothing is recorded as relied on yet: a reliance is recorded for each line graded as matching when a lender or buyer, a different firm from the sender, records its own. A line that differs from its lease, has no lease or could not be checked is never recorded as relied on. The sender's certification, not FactLot, is what the lender or buyer relies on.`
      : estoppel
        ? `SENT FOR REAL: the estoppel statements were sent to ${input.to.organisation}. Nothing is recorded as relied on yet: a reliance is recorded for each statement the tenant confirms when a lender or buyer, a different firm from the sender and the tenant, records its own. A disputed statement is never recorded as relied on.`
        : `SENT FOR REAL: the Record recorded ${reliances.length} reliance${reliances.length === 1 ? "" : "s"} now (the sender relies on ${reliances.length === 1 ? "the figure" : "the figures"} it accepted from ${input.to.organisation}), and each item ${input.to.organisation} agrees to will be recorded as relied on by them. Each is tied to the sender's FactLot account.`;
  const relierTokens = Array.isArray(sent.relier_tokens)
    ? (sent.relier_tokens as Json[])
    : [];
  return {
    package_id: id,
    digest: sent.digest,
    package_root: sent.package_root,
    status: sent.status,
    recorded_as: sandbox ? "sandbox" : "real",
    test_mode: sandbox,
    message,
    link_for_counterparty: link(id, String(sent.counterparty_token)),
    status_link_for_sender: link(id, String(sent.owner_token)),
    ...(estoppel || rentRoll
      ? {
          links_for_relying_parties: relierTokens.map((r) => ({
            label: r.label ?? null,
            link: link(id, String(r.token)),
          })),
        }
      : {}),
    recorded: {
      reliances_recorded: reliances.length,
      items_accepted: reliances.map((r) => r.item),
      items_awaiting_answer: input.items
        .filter((x) => !rentRoll && x.position === "state_ours")
        .map((x) => x.key),
      counts_in_the_measure: !sandbox,
    },
    note: rentRoll
      ? `Send link_for_counterparty to ${input.to.organisation} (the lender or buyer); it needs no account and shows each line with its grade, its quotes and pages, and the document fingerprints, and lets that party record reliance on the lines graded as matching. Give any other lender or buyer its own link from links_for_relying_parties. Keep status_link_for_sender private: it reads who has relied (fact_package_status).`
      : estoppel
        ? `Send link_for_counterparty to ${input.to.organisation} (the tenant); it needs no account. Give each lender or buyer its own link from links_for_relying_parties only after the tenant has answered: it shows the statements, the tenant's answers and the document fingerprints, and lets that party record reliance. Keep status_link_for_sender private: it reads the answers and the reliers (fact_package_status).`
        : `Send link_for_counterparty to ${input.to.organisation}; it needs no account. Keep status_link_for_sender private: it reads the answers (fact_package_status).`,
  };
}

// --- fact_package_status --------------------------------------------------------------------------

function idAndToken(input: z.output<typeof FactPackageStatusInput>): {
  id: string;
  token: string;
} {
  if (input.status_link) {
    const m = /#\/r\/([0-9a-f-]{36})\/([0-9a-zA-Z]+)\/?$/.exec(
      input.status_link.trim(),
    );
    if (!m)
      throw new ToolInputError([
        {
          path: "status_link",
          message: "not a status link from fact_package_send",
        },
      ]);
    return { id: m[1]!, token: m[2]! };
  }
  if (input.package_id && input.token)
    return { id: input.package_id, token: input.token };
  throw new ToolInputError([
    { path: "", message: "give status_link, or package_id with token" },
  ]);
}

export async function factPackageStatus(
  input: z.output<typeof FactPackageStatusInput>,
): Promise<Json> {
  const { id, token } = idAndToken(input);
  const s = await call({ action: "status", id, token }, false);
  const items = (s.items as Json[]).map((it) => ({
    key: it.key,
    label: it.label,
    position: it.position,
    value: it.value,
    their_value: it.their_value ?? null,
    ...(it.number !== undefined ? { number: it.number } : {}),
    ...(it.text !== undefined ? { text: it.text } : {}),
    ...(it.tenant_to_confirm === true ? { tenant_to_confirm: true } : {}),
    ...(it.grade !== undefined
      ? {
          grade: it.grade,
          grade_label: it.grade_label ?? null,
          ...(it.differences ? { differences: it.differences } : {}),
        }
      : {}),
    answer: it.response
      ? {
          decision:
            (it.response as Json).decision === "confirm"
              ? "agreed"
              : "disputed",
          note: (it.response as Json).note ?? null,
          tenants_own_version: (it.response as Json).own_value ?? null,
          by: (it.response as Json).responded_by_name,
          at: (it.response as Json).responded_at,
        }
      : it.position === "accept_theirs"
        ? { decision: "accepted_by_sender" }
        : it.grade !== undefined
          ? { decision: "asserted_by_sender" }
          : null,
  }));
  return {
    package_id: s.id,
    title: s.title,
    status: s.status,
    sandbox: s.sandbox,
    test_mode: s.sandbox,
    to: (s.to as Json).organisation,
    package_root: s.package_root,
    integrity: s.integrity,
    items,
    awaiting_answer: items.filter(
      (x) => x.position === "state_ours" && x.answer === null,
    ).length,
    agreed: items.filter(
      (x) => (x.answer as Json | null)?.decision === "agreed",
    ).length,
    disputed: items.filter(
      (x) => (x.answer as Json | null)?.decision === "disputed",
    ).length,
    reliances: s.reliances,
    ...(Array.isArray(s.reliers) ? { reliers: s.reliers } : {}),
    responded_at: s.responded_at,
  };
}
