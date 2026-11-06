# Customer documents policy

**Version 1, 2026-11-03. Status: policy and product commitment, not yet a contract.** The
contractual version of these promises is the data processing addendum a customer signs.
Where this page
and a signed agreement differ, the agreement wins. Where this page and the code differ, the code
is the bug.

FactLot Ingest reads a customer's lease file and returns cited facts. The documents it reads are
the most sensitive thing a customer gives FactLot. This page says what FactLot does with them,
in plain language, so that a customer's counsel can read it without a call. Every rule here
that can be enforced by code is, and the section says where.

Today FactLot Ingest runs only self-hosted. A hosted version (FactLot Cloud) is planned and is
not yet available; the hosted sections below describe the rules it will operate under.

**Hosted document verification (live since 2026-11-04).** The hosted API at
`https://api.factlot.com` offers the document-verification tools (`doc_verify_facts`,
`doc_abstract_lease`, `doc_compare`, `doc_verify_claim`; see
[document verification](document-verification.md)). A customer's agent sends page text and the
terms it extracted in a single request; FactLot checks them in memory, returns the answer, and
keeps nothing: no document text, quotes or facts are stored or logged, and the only record of the
request is its metadata (time, route, status, plan, a hashed key ID). No model runs and no third
party receives the text. These tools are stateless, so the storage and retention rules below for
FactLot Cloud do not apply to them. For documents that must not leave the customer's network,
run the same tools self-hosted.

## 1. What a customer document is

A customer document is any file a customer gives FactLot Ingest to read, and anything derived
from it that still contains its words. That includes:

- leases and amendments, side letters, guaranties, and estoppel certificates
- rent rolls, operating statements (T-12s), budgets, and CAM reconciliations
- offering memoranda, appraisals, and loan documents
- the text layer extracted from any of these, OCR output for scanned pages, and page images

Customer documents are not registry data. The
[registry data policy](registry/data-policy.md) covers public records; customer documents never
enter the registry, never become public, and are never used to improve the registry or anything
else FactLot sells, except as the customer directs for their own account.

The facts FactLot extracts (a value, a predicate, a page number, and a verbatim quote) belong to
the customer. The quote is part of the document and is treated as one.

## 2. Where documents are stored and for how long

### Self-hosted (what exists today)

`python -m factlot.ingest` runs on the customer's machine. The documents never leave it except
for the page text sent to the model provider during extraction (section 3). Specifically:

- The `factlot` Python package and the `@factlot/*` packages make no network calls of their own.
  The ingest CLI makes exactly one kind: the extraction request to the model provider, and only
  when `--model` is given. OCR (`--ocr tesseract`) runs locally.
- FactLot the company receives nothing: no documents, no facts, no telemetry.
- Retention is the customer's. The ingest report carries a `retention.retain_until` date
  (section 2, hosted) so the same report format works in both modes, but nothing acts on it
  locally.

### Hosted (FactLot Cloud, planned)

When hosted ingest is available it will keep documents under these rules.

| What                                                    | Where                                                                        | Kept for                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Uploaded documents, extracted page text, OCR output     | Object storage encrypted at rest, one isolated prefix or bucket per customer | **30 days** after the ingest run (`retain_until`), adjustable per run from 0 to 365 days     |
| Ingest reports: facts, quotes, review queue, rejections | Database encrypted at rest, row-level customer isolation                     | While the account is open; **90 days** after it closes, or on request, whichever is earlier  |
| Request and usage logs (metadata only, section 5)       | Log store                                                                    | Request logs **90 days**; usage (billing) records as long as tax and accounting law requires |
| Audit log (who accessed what)                           | Append-only store                                                            | **1 year**, exportable by the customer at any time                                           |
| Backups                                                 | Same region, encrypted                                                       | Expire within **30 days**, so a deleted document is gone from backups within 30 days         |

Why these defaults:

- **30 days for documents.** The review queue needs the page: a reviewer judging a queued quote
  has to see where it came from. One review cycle fits comfortably in 30 days. It is also the
  provider's own retention window (section 3), so no copy of a document anywhere in the chain
  outlives the customer's own by more than a month. A customer who wants no hosted copy at all
  sets 0 days: the document is deleted as soon as the report is written, and queued items are
  reviewed against the customer's own copy. The default and the per-run override are in code:
  `DEFAULT_RETENTION_DAYS` in `python/src/factlot/ingest/retention.py`, `--retain-days` on the
  CLI, and `retention.retain_until` in every report.
- **Reports until the account closes.** The report is the product the customer paid for, and
  re-running a lease file reads the previous report back to keep review decisions. Deleting it
  early would silently undo a reviewer's work.
- **90 days after closing.** Long enough to export after a lapse, short enough that FactLot does
  not become an archive of former customers' lease terms. Deletion on request is immediate from
  live storage and complete within 30 days once backups expire.

Encryption at rest uses the cloud provider's managed keys by default. Enterprise customers can
bring their own (section 9).

Documents are never copied to a laptop, a ticket, a chat, or a test environment. Test and
development environments use the synthetic leases in `python/tests/fixtures/leases/` and
nothing else.

## 3. What is sent to a model provider, and under what terms

Extraction is the one step that sends document content anywhere. What goes, exactly, is in
`python/src/factlot/ingest/extract.py` (`ClaudeExtractor.extract`):

- **Sent:** the document's title (by default the file name without its extension, so name files
  accordingly), its role (original or amendment), and the text of every page, each prefixed
  `[Page N]`; plus FactLot's fixed instructions and the JSON schema for the answer. For a
  scanned page, the text is the OCR output.
- **Not sent:** the file itself, page images, the customer's name, the lease URN, any earlier
  report, any review decision, and anything from any other document or customer.
- **Returned:** candidate facts, each with a quote the verifier then checks against the page.
  Nothing the model returns is persisted unless it verifies or is queued for review.

The extractor is pluggable. A customer may run their own extractor (any object with an
`extract(doc)` method), including one that calls a model inside their own cloud account, and then
nothing leaves their environment. The shipped extractor calls the Claude API, so its provider's
published terms are the ones that matter. Read on 2026-11-03:

| Promise                                | What the provider publishes                                                                                                                                                                                                                                                                                                                                                                                           | Source                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No training on inputs                  | Commercial Terms of Service, section B: "Anthropic may not train models on Customer Content from Services." The customer retains its inputs and owns its outputs. Effective date shown on the page: June 17, 2025.                                                                                                                                                                                                    | <https://www.anthropic.com/legal/commercial-terms>                                                                   |
|                                        | API documentation: "Retained data is never used for model training without your express permission."                                                                                                                                                                                                                                                                                                                  | <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>                                           |
| Retention of inputs and outputs        | Privacy center (page dated July 1, 2026): "For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation." The API documentation describes the default differently: conversation content "is not retained by default; the exception is Covered Models, which require 30-day retention." FactLot assumes the longer of the two, 30 days, for every model. | <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-personal-data> and the API documentation above |
| Zero data retention                    | Available per organization on request to the provider's sales team; not available for the models the provider designates as Covered Models unless it expressly authorizes it.                                                                                                                                                                                                                                         | API documentation above                                                                                              |
| Longer retention the provider reserves | Inputs flagged by its trust and safety systems may be kept "for up to 2 years"; data may be kept to enforce its usage policy or comply with law.                                                                                                                                                                                                                                                                      | Privacy center article above                                                                                         |
| Breach notice to FactLot               | Data Processing Addendum, section G.1: notice "without undue delay, but in any event within 48 hours" of becoming aware of a breach. Effective date shown: February 24, 2025.                                                                                                                                                                                                                                         | <https://www.anthropic.com/legal/data-processing-addendum>                                                           |
| Deletion after termination             | DPA section H.1: return or self-service export within 30 days of termination, then deletion of all copies, with exceptions for legal requirements, disputes, and combating harmful use.                                                                                                                                                                                                                               | DPA above                                                                                                            |
| The provider's own subprocessors       | Listed by the provider; the DPA's Schedule 4 points to the list.                                                                                                                                                                                                                                                                                                                                                      | <https://www.anthropic.com/subprocessors> (redirected to <https://trust.anthropic.com/subprocessors> when read)      |

Two things are unclear and are stated as such rather than resolved here:

- The provider's two pages describe the default retention window differently (not retained by
  default versus deleted within 30 days). Until the provider reconciles them, FactLot tells
  customers 30 days.
- The no-training clause is in the commercial terms, which apply to API keys from an organization
  under those terms. A key from a consumer account is under different terms. Hosted ingest will
  use only a commercial organization; a self-hosted customer must do the same to get this
  promise (checklist item).

A customer who runs the model through their own Amazon Bedrock or Google Cloud account is under
that cloud provider's terms instead, and the model provider is not a processor of their data at
all; the API documentation above says so. Enterprise deployments can be set up this way
(section 9).

## 4. What FactLot keeps after extraction, and what it never keeps

After a run, the only artefact is the ingest report (`--out`, default `lease-facts.json`). It
holds:

- **the facts** the verifier accepted, each with its predicate, value, page, section, and the
  verbatim quote that supports it (and `ocr: true` when the page was read by OCR)
- **the review queue**: candidates a person must decide on, each with its quote, and every
  decision with the reviewer's name and time
- **the rejections**: candidates the verifier dismissed, with the reason
- **the header**: the lease URN, the run date, the extractor's name and version, the document
  IDs (a hash of each file, `fl:document:sha256-…`, which identifies a file without containing
  it), and the retention date

Reports can be **redacted** so that the only document text in them is the quotes that are
evidence for a fact or a review item. A redacted report drops the quotes of rejected
candidates (text the model produced that the verifier could not pin to one page) and any
page-text field that might find its way under a document entry. Hosted ingest will always
persist the redacted form; self-hosted users choose with `--redact`
(`IngestResult.to_report(redact=True)`, `redact_report` in
`python/src/factlot/ingest/retention.py`; tested in `python/tests/test_ingest_policy.py`).

FactLot never keeps, in any mode:

- the model's raw request or response
- page text or page images beyond the retention period in section 2
- a document in a log, an error report, a metric, or a support ticket
- anything derived from one customer's documents in another customer's account, in the
  registry, in FactLot Bench, in a prompt, or in a model

## 5. Logging

The hosted server (`packages/server`) writes two logs today, both metadata only. Their full
schemas are in `packages/server/README.md`:

- the **request log** (`FACTLOT_LOG=json`): time, method, path, tool name, key name, status, and
  duration; a rejected bearer token adds a few leading characters of it, never the key
- the **usage log** (`FACTLOT_USAGE_LOG`): time, key name, tool, surface, status, and duration,
  one line per metered call, kept as the billing record

Neither log contains a request body, tool arguments, tool results, headers, or a bearer key, and
no future endpoint may add them. The list of fields a request log line may carry is a constant
in the code (`REQUEST_LOG_FIELDS` in `packages/server/src/index.ts`), the logger carries a
comment pointing here, and a test sends a sentinel string through REST bodies, MCP tool
arguments, and a bearer token and checks that it reaches no log line and that no log field could
carry one (`packages/server/src/index.test.ts`, "request and usage logs carry metadata only").

When a document-carrying endpoint is added, the same rule applies to everything around it:
the model provider's SDK logging stays off, error reporters must scrub bodies before sending,
and a stack trace that would include page text is a bug to fix, not a line to keep.

## 6. Access: who at FactLot can see a document

**Nobody, by default.** Hosted storage is read by the ingest service under a service identity;
no person holds standing credentials to customer buckets or rows. Support works from the
customer's description and from metadata (document IDs, page numbers, the reason a candidate was
rejected), never from the document.

**Break-glass.** A person may read a customer's document only when all of these hold:

1. the customer asked in writing for help that requires it, or there is an active security
   incident that requires it
2. one named engineer is granted access to the named documents, for at most 24 hours
3. the grant and every read are written to the audit log the customer can see (section 8)
4. the customer is told before the access, or, in an incident, within 24 hours after it

Access for any other purpose, including improving the extractor, is not permitted. Improving the
extractor uses synthetic documents and documents whose owners have licensed them for that use
in writing.

## 7. Subprocessors and breach notice

**Subprocessors.** A subprocessor is any company that may hold customer documents on FactLot's
behalf. For hosted ingest there will be at most three kinds, and the list will be published at a
fixed URL before hosted ingest opens, with the function and processing region of each:

- the model provider, for the duration of an extraction request and its retention window
  (section 3)
- the cloud host for storage and compute
- no OCR subprocessor: OCR runs inside FactLot's own environment

Customers get 30 days' notice before a subprocessor is added and may terminate without penalty
if they object.

**Breach notice.** If FactLot confirms that a customer's documents were accessed, taken, or
exposed without authorization, it tells the customer without undue delay and in any event
within 72 hours of confirming it, with what was affected, what is known about how, and what
FactLot has done. The provider's 48-hour notice to FactLot (section 3) is what makes 72 hours
achievable end to end. Where state or sector law requires a shorter clock or additional
recipients, FactLot follows that law.

## 8. The customer's rights

In every mode the customer owns their documents and the facts extracted from them. Hosted
customers can, without asking FactLot:

- **Export.** The ingest report is plain JSON and is always downloadable. Uploaded documents are
  downloadable until their retention date. On account closure, everything is exportable for the
  90 days in section 2.
- **Delete.** Any document, report, or the whole account, at any time. Deletion from live storage
  is immediate; backups expire within 30 days. A deleted document cannot be recovered by FactLot
  either.
- **Set retention.** Per run (`retain_until`) or as an account default, from 0 to 365 days for
  documents.
- **See the audit log.** Every access to their documents by a person (section 6), every deletion,
  every export, and every change to retention, with who and when; kept for one year and
  exportable.

Requests that cannot yet be self-served go to contact@factlot.com and are honoured promptly.

## 9. What changes for Enterprise

The engine is Apache-2.0 and the promises above hold in every tier. Enterprise adds the
guarantees large firms require:

- **Private VPC or on-prem.** Ingest runs inside the customer's own cloud account or data centre.
  FactLot operates it or hands it over with support; either way, documents never reach FactLot's
  infrastructure.
- **Model routing the customer controls.** Extraction through the customer's own Bedrock or
  Vertex account, or through a zero-data-retention agreement the customer holds directly with
  the provider, or with a model the customer hosts.
- **Customer-managed keys.** Storage and backups encrypted with a key in the customer's KMS.
  Revoking the key makes every copy FactLot holds unreadable, including backups.
- **Contractual no-training and no-use terms** covering FactLot and every subprocessor, in the
  DPA.
- **Data residency.** Storage, compute, and backups pinned to a named region.
- **Audit logs and SSO** as account features rather than on request.

## 10. Changes to this policy

This page is versioned (the version is also written into every ingest report as
`retention.policy_version`). A change that reduces a protection is announced 30 days before it
takes effect and never applies to documents already uploaded. The history is in the repository.
