/**
 * estoppel_certificate: the tenant estoppel statements estoppel_prepare produced, laid out in the
 * institutional style (institutional.ts), with the tenant's answers beside each statement once
 * the caller sends them. PDF only. The tenant's signature, not FactLot, makes it an estoppel.
 */
import { usd } from "../format.ts";
import { InstitutionalWriter, type Cell } from "../institutional.ts";

import { longDate } from "./audit.ts";
import { attestationParagraph, type KindInput } from "./common.ts";

type Json = Record<string, unknown>;

export const ESTOPPEL_NOTICE =
  "These statements are facts and arithmetic worked from the lease documents supplied, each with the quotation and page it rests on. They are not legal advice. The tenant's signature, not FactLot, is what makes this an estoppel certificate: until the tenant answers each statement and signs, nothing here binds the tenant.";

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : String(v ?? "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Every ISO date in a sentence, written as a person reads it. */
const dates = (s: string): string =>
  s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (d) => longDate(d));

const sha8 = (id: string | null): string => {
  const m = /sha256-([0-9a-f]{8})/.exec(id ?? "");
  return m ? m[1]! : "";
};
const sha64 = (id: string | null, sha: string | null): string => {
  if (sha && /^[0-9a-f]{64}$/.test(sha)) return sha;
  const m = /sha256-([0-9a-f]{64})/.exec(id ?? "");
  return m ? m[1]! : "";
};

/** "2026-11-20 14:03 UTC" from an ISO timestamp. */
const utc = (iso: string): string => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}/.exec(iso);
  return m ? `${longDate(m[1]!)}, ${m[2]} UTC` : iso;
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** A gap or flag message as prose: predicate names in words, first letter capital. */
const prose = (s: string): string =>
  cap(
    dates(s).replace(/\blease\.([a-z_]+)/g, (_m, p: string) =>
      p.replace(/_/g, " "),
    ),
  );

/** "Lease" for the original document's sentences, "Amendment" for an amendment's. */
const srcLabel = (src: Json): string =>
  src.role === "superseded"
    ? "Superseded"
    : src.role === "conflicting"
      ? "Conflicting"
      : src.document_role === "amendment"
        ? "Amendment"
        : "Lease";

const BASIS_TAG: Record<string, string> = {
  lease: "FROM THE LEASE",
  tenant: "TENANT TO CONFIRM",
};

export async function estoppelPdf(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as Json;
  const totals = r.totals as Json;
  const parties = r.parties as Json;
  const figs = r.key_figures as Json;
  const statements = arr(r.statements);
  const docs = arr(r.documents);
  const gaps = arr(r.gaps);
  const conflicts = arr(r.conflicts);
  const asOf = longDate(str(r.as_of));
  const premises = str(r.premises);
  const tenant = str(parties.tenant);
  const landlord = str(parties.landlord);
  const requested = parties.requested_by as Json | undefined;
  const preparedFor = k.ctx.prepared_for;
  const answers = new Map(
    (k.ctx.estoppel_answers ?? []).map((a) => [a.key, a] as const),
  );
  const reliers = k.ctx.estoppel_reliers ?? [];
  const sig = k.ctx.estoppel_signature;
  const signed = sig?.signed === true && !!sig.signer_name && !!sig.signed_at;

  const w = await InstitutionalWriter.create({
    title: "Tenant estoppel certificate",
    subject: `Tenant estoppel certificate, ${premises}, ${asOf}`,
    brand: "FactLot",
    mastheadRight: `Tenant estoppel certificate  ·  ${asOf}`,
    runningHeader: `Tenant estoppel certificate  ·  ${premises}`,
    footer: `Prepared from the documents supplied. Not legal advice. FactLot ${k.p.version}.`,
    producer: `FactLot ${k.p.version} reports`,
    keywords: k.p.keywords,
    created: k.p.generatedAt,
  });

  // ---- page 1 ---------------------------------------------------------------------------------
  w.titleBlock({
    title: "Tenant estoppel certificate",
    line: `${premises}  ·  ${tenant} and ${landlord}`,
    preparedFor,
    asOf,
  });
  const annual = num(figs.annual_base_rent);
  const dep = num(figs.security_deposit);
  const cells: Cell[] = [
    {
      figure: annual === null ? "Not stated" : usd(annual),
      label: "Current annual base rent",
    },
    {
      figure: figs.expiration_date
        ? longDate(str(figs.expiration_date))
        : "Not stated",
      label: "Expiration date",
    },
    {
      figure: dep === null ? "Not stated" : usd(dep),
      label: "Security deposit",
    },
    {
      figure: `${num(totals.from_lease) ?? 0} + ${num(totals.tenant_to_confirm) ?? 0}`,
      label: "Statements from the lease + for the tenant to confirm",
    },
  ];
  w.band(cells, { figureSize: 19, accent: true });

  const answeredN = statements.filter((s) => answers.has(str(s.key))).length;
  const agreedN = statements.filter(
    (s) => answers.get(str(s.key))?.decision === "agreed",
  ).length;
  const disputedN = statements.filter(
    (s) => answers.get(str(s.key))?.decision === "disputed",
  ).length;

  w.section("Summary", 90);
  w.table(
    [
      { header: "No.", width: 24 },
      { header: "Statement", width: 150 },
      { header: "Basis", width: 60 },
      { header: "Status", width: 60 },
      { header: "Tenant's answer", width: 72 },
    ],
    statements.map((s) => {
      const a = answers.get(str(s.key));
      const st = str(s.status);
      return [
        String(s.number),
        str(s.title),
        s.basis === "lease" ? "Lease" : "Tenant",
        st === "gap"
          ? "Gap"
          : st === "conflict"
            ? "Conflict"
            : st === "tenant_to_confirm"
              ? "To confirm"
              : "Ready",
        a ? (a.decision === "agreed" ? "Agreed" : "Disputed") : "Awaiting",
      ];
    }),
    { size: 8.25, padY: 2.4 },
  );
  w.space(6);
  w.note(
    "How to read this certificate",
    answeredN === 0
      ? `${ESTOPPEL_NOTICE} No answer from the tenant is recorded here yet.`
      : `${ESTOPPEL_NOTICE} The tenant's answers are as the caller supplied them from the exchange record (${agreedN} agreed, ${disputedN} disputed); FactLot did not re-read them.`,
  );

  // ---- parties and premises -------------------------------------------------------------------
  w.section("Parties and premises", 90);
  const defs: [string, string][] = [
    ["Tenant", tenant],
    ["Landlord", landlord],
    ["Premises", premises],
    ["As of", asOf],
  ];
  if (num(figs.rentable_area_sf) !== null)
    defs.push([
      "Rentable area",
      `${new Intl.NumberFormat("en-US").format(num(figs.rentable_area_sf)!)} SF`,
    ]);
  if (requested)
    defs.push([
      "Requested by",
      `${str(requested.organisation)}${requested.role ? ` (${str(requested.role)})` : ""}`,
    ]);
  for (const d of docs)
    defs.push([
      d.role === "original"
        ? "Lease"
        : d.role === "amendment"
          ? "Amendment"
          : "Document",
      cap(str(d.label)),
    ]);
  w.definitions(defs, 100);

  // ---- statements -----------------------------------------------------------------------------
  w.section("Statements", 120);
  for (const s of statements) {
    const a = answers.get(str(s.key));
    const st = str(s.status);
    const sources = arr(s.sources);
    let ansHead = "Awaiting the tenant";
    const ansLines: string[] = [];
    if (a) {
      ansHead = a.decision === "agreed" ? "Tenant agrees" : "Tenant disputes";
      if (a.tenants_own_version)
        ansLines.push(`Tenant's own version: ${a.tenants_own_version}`);
      if (a.note) ansLines.push(`Note: ${a.note}`);
      const who = [a.by, a.at ? longDate(a.at.slice(0, 10)) : ""]
        .filter(Boolean)
        .join(", ");
      if (who) ansLines.push(`Recorded: ${who}`);
    } else if (st === "gap" || st === "conflict") {
      ansHead = "Not prepared";
    } else if (s.needs_tenant_value) {
      ansLines.push("The tenant states the figure.");
    }
    const first = sources[0];
    w.statementHead({
      heading: `${s.number}. ${str(s.title)}`,
      tag: BASIS_TAG[str(s.basis)] ?? "",
      text: dates(str(s.text)),
      answerLabel: "Tenant's answer",
      answerHead: ansHead,
      answerLines: ansLines,
      keep: first ? 60 : 0,
    });
    for (const src of sources) {
      const label = srcLabel(src);
      const doc = sha8(src.document_id as string | null);
      w.quote(
        str(src.quote),
        `${label}, page ${num(src.page) ?? ""}${src.section ? `, ${str(src.section)}` : ""}${doc ? ` · document ${doc}` : ""}`,
      );
    }
    const steps = arr(s.steps) as unknown as string[];
    if (steps.length) w.steps(steps.map((x) => dates(str(x))));
    for (const f of arr(s.flags))
      w.para(prose(str(f.message)), { size: 8.25, color: "slate" });
  }

  // ---- signature ------------------------------------------------------------------------------
  w.section("Signature of the tenant", 150);
  if (signed && sig) {
    const when = longDate(str(sig.signed_at).slice(0, 10));
    w.para(
      `The tenant's signer confirmed, in the consent wording printed in the electronic signature record below, that the signer is authorised to sign for ${tenant}, intends the typed name as the signature, agrees to sign electronically, and that the statements as answered here are true as of the date of signing. The tenant's signature, not FactLot, makes this an estoppel certificate.`,
      { size: 8.75, leading: 12.5 },
    );
    w.space(4);
    w.para(
      `Signed electronically by ${str(sig.signer_name)}, ${str(sig.signer_title)}, ${when}`,
      { font: "sansBold", size: 9.25 },
    );
    w.definitions(
      [
        [
          "Signed for",
          sig.signer_organisation ? str(sig.signer_organisation) : tenant,
        ],
        ["Name", str(sig.signer_name)],
        ["Title", str(sig.signer_title)],
        ["Date", when],
      ],
      110,
    );
  } else {
    w.para(
      `By signing, ${tenant} states that, as of ${asOf}, the statements above that it has confirmed are true and that the statements it has answered with its own version are as it has written them. The tenant's signature, not FactLot, makes this an estoppel certificate; FactLot has not seen the tenant sign, and the signature lines below are for the parties' own use.`,
      { size: 8.75, leading: 12.5 },
    );
    w.space(4);
    w.signatureLines([`Signature, for ${tenant}`, "Name", "Title", "Date"]);
  }

  // ---- back matter ----------------------------------------------------------------------------
  if (gaps.length || conflicts.length) {
    w.section("Gaps and conflicts", 70);
    w.table(
      [
        { header: "Kind", width: 20 },
        { header: "What needs a person", width: 80 },
      ],
      [
        ...gaps.map((g) => ["Gap", prose(str(g.message))]),
        ...conflicts.map((c) => ["Conflict", prose(str(c.message))]),
      ],
      { size: 8.25, padY: 3.5 },
    );
  }

  w.section("Reliance recorded", 120);
  if (reliers.length === 0)
    w.para("No reliance has been recorded.", { color: "slate" });
  else
    w.table(
      [
        { header: "Relying party", width: 40 },
        { header: "Role", width: 18 },
        { header: "Statements", width: 26 },
        { header: "Recorded", width: 16 },
      ],
      reliers.map((x) => [
        x.who,
        x.role ?? "",
        `${(x.statements ?? []).join(", ")}${
          (x.statements_disputed ?? []).length
            ? `. Not confirmed by the tenant, and acknowledged by this party: ${(x.statements_disputed ?? []).join(", ")}`
            : ""
        }`,
        x.at ? longDate(x.at.slice(0, 10)) : "",
      ]),
      { size: 8.25, padY: 3.5 },
    );

  if (signed && sig) {
    w.section("Electronic signature record", 120);
    w.definitions(
      [
        ["Signer", `${str(sig.signer_name)}, ${str(sig.signer_title)}`],
        ["Signed (UTC)", utc(str(sig.signed_at))],
        ["Consent wording", str(sig.consent_version)],
        [
          "Signed statements",
          sig.content_check === "changed"
            ? "The statements as now recorded do not produce the fingerprint below: they differ from what was signed."
            : sig.content_check === "unchanged"
              ? "The statements as recorded when this certificate was prepared produce the fingerprint below, so they are unchanged since signing."
              : "Not rechecked when this certificate was prepared.",
        ],
      ],
      110,
    );
    if (sig.content_sha256) {
      w.space(4);
      w.table(
        [
          {
            header: "SHA-256 of the signed statements",
            width: 100,
            mono: true,
          },
        ],
        [[sig.content_sha256]],
        { size: 7.75, padY: 3.5 },
      );
    }
    if (sig.consent_text) {
      w.space(2);
      w.para("The consent wording the signer saw and accepted:", {
        size: 8,
        color: "slate",
      });
      for (const line of sig.consent_text.split("\n"))
        w.para(line, { size: 8, leading: 11.5, indent: 10 });
    }
    w.para(
      "The fingerprint is the SHA-256 of the canonical form (RFC 8785) of each statement as stated, with the tenant's answer, own version and note. No IP address or device data was kept.",
      { size: 8, leading: 11.5, color: "slate" },
    );
  }

  w.section("Basis of preparation", 60);
  w.para(
    `Each statement from the lease rests on facts read from the lease documents, each carrying its verbatim quotation and page, checked by FactLot ${k.p.version}. The checks are fixed rules: the same facts always give the same statements. A statement with no lease source is for the tenant to confirm, and a gap or conflict between the lease and an amendment is flagged rather than resolved. FactLot keeps facts, quotations, pages and document fingerprints, never the documents themselves.`,
    { size: 8, leading: 11.5 },
  );
  const attestationText = attestationParagraph(k.ctx);
  if (attestationText) {
    w.section("Verification of the figures", 50);
    w.para(attestationText, { size: 8, leading: 11.5 });
  }
  w.section("Important information", 50);
  w.para(
    "This certificate is prepared from the documents supplied and has not been checked against any other source. It is not legal advice and states no legal conclusion. Confirm each statement against the lease and its amendments, and take advice before relying on it or asking anyone to sign it. A lender or buyer who relies on it should read the tenant's answers, not only the statements.",
    { size: 8, leading: 11.5 },
  );

  w.section("Sources", 80);
  const srcRows: string[][] = [];
  for (const s of statements)
    for (const src of arr(s.sources))
      srcRows.push([
        `${srcLabel(src)}${sha8(src.document_id as string | null) ? ` · ${sha8(src.document_id as string | null)}` : ""}`,
        String(num(src.page) ?? ""),
        String(s.number),
        str(src.fact_id),
      ]);
  w.table(
    [
      { header: "Document", width: 25 },
      { header: "Page", width: 6, align: "right" },
      { header: "Statement", width: 12, align: "right" },
      { header: "Fact id", width: 57, mono: true },
    ],
    srcRows,
    { size: 7.75, padY: 3.5 },
  );

  w.section("Document fingerprints", 80);
  w.para(
    "SHA-256 of each document as supplied. Compare these with the documents you hold: a different file gives a different fingerprint.",
    { size: 8, leading: 11.5 },
  );
  w.table(
    [
      { header: "Document", width: 34 },
      { header: "SHA-256", width: 66, mono: true },
    ],
    docs.map((d) => [
      cap(str(d.label).replace(/ \(document [0-9a-f]+\)$/, "")),
      sha64(d.document_id as string | null, d.sha256 as string | null) ||
        "not supplied",
    ]),
    { size: 7.75, padY: 3.5 },
  );
  return w.bytes();
}
