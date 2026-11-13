# Security

How FactLot's hosted service is run, what it keeps and does not keep, how keys and secrets are
handled, and what is not in place yet. Everything here can be checked in this repository or on the
live service; where a claim rests on a GitHub setting or on a live response instead, the text says
so. Written 7 November 2026; the free key and the daily usage totals added 13 November 2026. The same text is on [factlot.com/security](https://factlot.com/security/).

Related: [service status](https://factlot.com/status/), [service levels](sla.md),
[how the numbers are proven](https://factlot.com/assurance/), the vulnerability policy in
[SECURITY.md](../SECURITY.md).

## In short

- The hosted service runs on Cloudflare Workers. A sole proprietor operates it. There is no SOC 2
  report yet; for confidential documents, run FactLot yourself.
- It stores no request bodies, tool inputs or outputs, and no documents, except a report you build
  with `report_create`: that file is kept for 24 hours so you can download it, then deleted. It
  stores API keys only as hashes, and usage metadata without IP addresses.
- Every tool runs without a model, except `doc_extract_lease` and `report_narrative` (Pro and Team,
  and only when you call them), which send what you submit to a model provider. See the
  [privacy notice](https://factlot.com/privacy).
- All code that runs the service is in this repository. You can read it, and run the same code on
  your own machine.
- Report a vulnerability by email, privately. [Details below](#responsible-disclosure).

## Where it runs

- **`factlot-api` Worker (Cloudflare Workers).** Serves factlot.com and api.factlot.com: the pages,
  REST, OpenAPI, the MCP endpoint, billing and account routes. Holds nothing between requests except
  what the stores below keep. Source: [`deploy/cloudflare`](../deploy/cloudflare).
- **`factlot-registry` Worker.** Answers registry lookups from a prebuilt data pack of public-record
  registry data (see [public records](#public-records-and-natural-persons)). It has no public route,
  no workers.dev address and no preview address: only the API Worker can call it, through a service
  binding. Source: [`deploy/registry`](../deploy/registry).
- **Cloudflare KV.** Key records for paid plans: a SHA-256 hash of each key, plan, status, Stripe
  customer and subscription IDs, and dates. Never a key. Free key records: a SHA-256 hash of the
  key, a hash of the email address made with a secret only FactLot holds (never the address), and
  dates; and short-lived records of the emailed links, held under a hash of each link's random ID.
  Daily usage totals: counts by route group, tool, state or county and kind of caller, with
  distinct-caller estimates built from values that are already hashes; no IP address, address
  searched, parcel, key or email. Also the report files built with `report_create`, for 24 hours.
- **Cloudflare Durable Objects.** Per-minute rate limits, registry lookup quotas and monthly report
  counters, including a free key's own counters: counters for the current window only, keyed by key
  ID or by a hash of the IP address.
- **Cloudflare Analytics Engine.** Usage records for capacity planning: time, key ID ("free-key" for
  a free key), plan, path, method and status, and event totals. No IP address. Kept 90 days.

Cloudflare is a United States company and serves requests from its global network. FactLot sets no
data-location restriction on any of these stores. The [privacy notice](https://factlot.com/privacy)
lists every record, how long it is kept, and the subprocessors (Cloudflare, Stripe, GitHub). Stripe
handles card data; FactLot never sees a card number.

## What is stored, and what is not

Not stored or logged:

- Request bodies, tool inputs and outputs (a built report file is the exception, below)
- Documents and their text, quotes and extracted facts
- Request headers (the key is read to authorise, then dropped)
- IP addresses in usage records
- API keys in readable form
- Cookies, tracking or third-party analytics on factlot.com (page views are counted in daily totals
  only; see the privacy notice)

Stored:

- Usage metadata: time, key ID, plan, path, method, status (90 days)
- Daily usage totals, with no IP address, address searched, parcel, key or email: 40 days (90 days
  for event totals). Distinct visitors and callers are estimated from a hash of the IP address that
  changes every day, a connection's ID or a key ID, folded into a sketch that cannot be turned back
  into a list.
- For an optional free key: the key's hash, a secret-keyed hash of the email address (never the
  address itself) and dates, until you delete the key (a replaced key's record for 12 months); the
  emailed link's record for 30 minutes, and a marker that a link was used, not linked to the
  address, for 13 months
- Key hashes and subscription records for paid plans, until the subscription ends and then for up to
  12 months
- Rate-limit, lookup and report counters, deleted when their window ends (the free report counter is
  keyed by a hash of the IP address)
- A report file built with `report_create`: the generated workbook, PDF or calendar, with its figures
  and any text you passed, for 24 hours, then deleted. It is stored under a hash of the download
  link's token.
- Error names (never messages), as long as Cloudflare keeps logs

Two pieces of code enforce this. The server's request log has a fixed list of fields
([`REQUEST_LOG_FIELDS`](../packages/server/src/index.ts)), and a test fails if a request body, a tool
argument or a bearer token reaches a log line. The Worker's error handler logs the error's name only.

**Models on the hosted API.** The hosted tools are deterministic code and run without a model,
including `report_create`, with two exceptions: `doc_extract_lease` and `report_narrative` (Pro and
Team, and only when you call them) send what you submit to a model provider for inference. FactLot
stores neither the input nor the model's answer. The [privacy notice](https://factlot.com/privacy)
names the provider and says how long it may keep what it receives. Lease extraction in
`factlot.ingest` can also run on your own machine with a model you choose. See the
[customer documents policy](customer-documents.md).

## Transport

- Both factlot.com and api.factlot.com are served over TLS by Cloudflare. A request to the plain
  `http://` address is answered with a redirect to `https://` (checked on the live service on 7
  November 2026).
- TLS ends at Cloudflare. As our host, Cloudflare handles request content in memory while it answers
  the request.
- API responses carry `content-security-policy: default-src 'none'`,
  `x-content-type-options: nosniff`, `referrer-policy: no-referrer` and `x-frame-options: DENY`. They
  allow cross-origin calls from any site (`access-control-allow-origin: *`) because callers
  authenticate with a bearer key in a header, not with cookies.
- The API refuses request bodies over 1 MB and MCP batches over 20 messages, and validates every tool
  input against its published schema before running it.

## API keys

- A paid key is `fl_live_` followed by 32 random bytes (256 bits). It is shown once, when it is
  created. Only its SHA-256 hash is stored, so FactLot cannot show a key again; a lost key is
  replaced, not recovered.
- A free key is `fl_free_` followed by 32 random bytes, shown once and stored only as its SHA-256
  hash, the same way. It is a free caller: it has the Free plan's limits on its own meter and opens
  nothing a paid key does. You can delete it yourself; the
  [privacy notice](https://factlot.com/privacy) says what is deleted with it.
- The "key ID" in usage records and responses is the first 16 characters of that hash. It identifies a
  key without revealing it.
- You can replace a key at any time (`POST /v1/billing/rotate`); the old key stops working at once.
  Team plans can add and revoke keys (up to five).
- Failed key attempts are rate limited per address before the key store is read. Keyless callers are
  limited per IP address (per /64 for IPv6).
- Stripe webhooks are accepted only with a valid signature, and a refunded or disputed payment stops
  the subscription's keys.
- Please never send a key in an email or a public issue. If one leaks, rotate it, then tell us.

## Secrets management

- The Stripe secret key, the Stripe webhook secret and the other signing and hashing secrets are
  Cloudflare Worker secrets, set by the maintainer with `wrangler secret put`. They are not in the
  repository; the Worker configuration only names them
  ([`wrangler.jsonc`](../deploy/cloudflare/wrangler.jsonc)).
- The repository's GitHub secret scanning and push protection are on (a repository setting, checked
  on 7 November 2026).
- The CI workflow runs with read-only repository permission and does not keep the checkout token on
  disk. The weekly data collector gives its one write token only to the steps that publish its
  release, never to the steps that download and parse publishers' files.

## Dependencies and supply chain

- The lockfile is committed and CI installs with `npm ci`. The `@factlot/*` packages depend on each
  other at exact versions.
- The Python SDK has no runtime dependencies. Its two optional extras are `pypdf` (reading PDFs) and
  `cryptography` (signing). The TypeScript packages depend on `zod` and the official MCP SDK.
- Every GitHub Action in the workflows is pinned to a full commit SHA, with the version in a comment.
- [Dependabot](../.github/dependabot.yml) proposes updates weekly for npm, Python, GitHub Actions and
  the Docker base image. For npm and Actions it waits seven days after a release before proposing it,
  so a hijacked release is usually pulled before it reaches us.
- `main` requires the three CI checks to pass before a change merges, and force pushes and deletions
  of `main` are blocked (a repository setting, checked on 7 November 2026). The maintainer is the sole
  code owner and can override these rules.
- Releases are published as GitHub release assets. The release workflow can publish to npm with
  provenance and to PyPI with trusted publishing; the packages are not on those registries yet.

## What you can review

The Worker that serves the hosted API, its billing and rate-limit code, the registry Worker, the
calculators, the collector and every workflow are in this repository under Apache-2.0 and MIT. What is
not public: the registry data pack the registry Worker serves, the maintainers' private release drafts
of raw source files (they name natural persons; see below), and the secrets. The repository does not
publish a reproducible-build proof that the deployed Worker equals a given commit.

## Responsible disclosure

Report vulnerabilities privately, never in a public issue, pull request or discussion. The policy is
in [SECURITY.md](../SECURITY.md).

- Email contact@factlot.com with "SECURITY" at the start of the subject line.
- Include the affected package and version (or commit), the steps or input that reproduce the problem,
  and what you expected.
- We aim to acknowledge a report within three business days, keep you informed while we fix it, and
  credit you in the release notes unless you ask us not to. Please give us a reasonable time to fix a
  problem before you disclose it.
- In scope: the hosted service, the MCP and REST servers, the Python SDK and collector, the Docker
  image and the workflows. Especially welcome: a calculator returning a wrong result without a
  warning, ID collisions, input that causes unbounded CPU or memory use or leaks internal detail, ways
  around key authentication or limits, and anything that lets document text reach a log.

GitHub's private vulnerability reporting is on for the repository: you can also report through the
repository's Security tab ("Report a vulnerability").

## What is not in place yet

- **No SOC 2 report**, no ISO 27001 certificate, and no published independent penetration test.
  FactLot is run by one person; there is no separation of duties inside the company.
- **What that means for confidential documents.** The hosted document tools check text in memory and
  keep nothing, and the code is open for you to confirm that. But a security review that requires an
  audited vendor cannot be satisfied by this page. For leases and other documents that must not leave
  your network, self-host: the same tools run on your machine and make no network calls. Please do not
  email confidential documents to us.
- The API does not send a `Strict-Transport-Security` header, and the static site sends no
  `Content-Security-Policy` header (its only scripts are two same-origin files under /try/: the one
  behind the Try a lookup page, which writes API answers as text, never as HTML, and the one that
  shows the free key link when the API offers it). The plain-HTTP redirect above is what
  protects first visits.
- Enterprise customers can ask about a signed data-processing agreement and private deployment
  (contact@factlot.com); neither is published terms today.

## Public records and natural persons

The registry holds commercial, industrial and multifamily parcels and the organisations that own them,
built only from public records obtained under the [registry data policy](registry/data-policy.md).

- When the owner of record is a natural person, the registry keeps the parcel but drops the person's
  name, mailing address and any ownership link. It is built to keep organisations and to exclude
  natural persons' names.
- Owners that a source withheld (for example under Texas Tax Code §25.025) are never recovered,
  inferred or cross-referenced.
- The collector identifies itself, obeys robots.txt, rate limits itself and never bypasses access
  controls. Sources whose terms are unclear, or do not allow us to serve their data, are not served.
- Every fact cites its source file and record and carries the source's licence and AI-use rights. The
  raw source files stay in private drafts, not in the public repository.
- If a record names you as a person, or is wrong, email contact@factlot.com and we will remove or
  correct it. Requests about natural persons are honoured promptly.
