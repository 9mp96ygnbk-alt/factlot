# Hosted API Worker (deploy/cloudflare)

Operator notes for the hosted FactLot Worker. Configuration is in [`wrangler.jsonc`](wrangler.jsonc);
secrets are set with `npx wrangler@4 secret put <NAME>` and are never in the repository.

## Runtime check (workerd)

`npm run test:workerd` (part of `npm run check` and CI) bundles both Workers as `wrangler deploy`
does (`--dry-run`, no account), checks their compressed size, starts them together in workerd
with the API Worker's `REGISTRY` binding pointed at the registry Worker and a pack built from the
fixture registry, and calls the registry routes, the API's REST, MCP, assets, a property page, a
key-authenticated batch through the binding, the scheduled handler (feature variables unset and
set), and the registry on its object-storage backend. Run it before every deploy of either Worker.
The unit tests use file-backed fakes and cannot see what only the runtime refuses: a named export
of an entry module that is not a handler, or a binding whose shape differs from the fake. So never
decide what a binding is by probing its properties (`"x" in env.BINDING`, `typeof
env.BINDING.method`); choose explicitly.

## Lookup pages

`GET /lookup/?q=<address>` (optional `state`, `city`, `zip`, `county`) and
`GET /lookup/<county>/<parcel id>` on the site host answer a search or a record as a page, or as
the API's JSON with `?format=json` or `Accept: application/json`. Code: `src/lookup-pages.ts`.

- Counting. A page is answered by this Worker's own API call, sent back through the router as the
  caller (their address and `Authorization` header): `registry_search_address` for a search,
  `registry_get` for a record. It is counted, given back, limited per minute and cut to the free
  view exactly as that call is, on the same meters, and the module has no meter of its own. A
  search that finds one parcel under the batch lookup's rule redirects to its record; a record
  that has a public property page redirects to that page before anything is counted (the property
  pages' own route is asked, with its own per-address limit and cache). A HEAD looks nothing up.
- Never published. Every answer carries `Cache-Control: no-store`, `X-Robots-Tag: noindex` and
  `Referrer-Policy: no-referrer`; the pages are in no sitemap; `robots.txt` lets them be fetched.
- The address searched is in the query string, which `redact_query_string` keeps out of Workers
  Logs; a record's path holds the county and the parcel id. The usage counters see `/lookup` and
  `/lookup/*` only. A query parameter named like a credential (`key`, `token`, ...) is refused
  before anything is looked up, and its value is not written into the answer.
- On the API host the same paths redirect (302) to the site host, with the same headers, after the
  same refusal of a credential-like parameter, so its value is never put in a `Location` header.

## Usage counters

How the hosted service is used, without recording who used it. Off unless the variable
`USAGE_COUNTERS_ENABLED` is exactly `"true"` (it is not set in `wrangler.jsonc`; turn it on by
adding `"USAGE_COUNTERS_ENABLED": "true"` to `vars` and deploying, off again by removing it).
Code: `src/usage.ts` and `src/usage-sketch.ts`; the reader is `scripts/ops/usage.mjs`.

Read it:

```sh
npm run ops:usage                  # yesterday and the last 7 complete UTC days
npm run ops:usage -- --json        # the same numbers as JSON
```

It runs read-only `wrangler kv key list` and `wrangler kv bulk get` against the `KEYS` namespace
(`--remote`), so it needs a `wrangler login` on the machine with the Workers KV permission and no
other credential. Days with no stored record print `no data`, not zero.

What is counted (each counter name is `event|dimension|...`):

| Event               | Dimensions                                                                      |
| ------------------- | ------------------------------------------------------------------------------- |
| `req`               | surface (`mcp`, `rest`, `site`), path group, status class (`2xx`)               |
| `mcp_call`          | tool name (catalog tools; anything else `other`), caller kind                   |
| `lookup`            | registry tool, region prefix (`us-48`, `us-tx`, `search`, `other`), caller kind |
| `quota_exhausted`   | caller kind, window (`day` keyless and free connections, `month` paid)          |
| `plan_required`     | reason (`batch`, `dated`, `model_tool`), caller kind                            |
| `history_note`      | surface, caller kind: free answers with earlier values withheld                 |
| `checkout_start`    | plan, interval                                                                  |
| `checkout_complete` | plan, who collected the key (`page`, `agent`)                                   |
| `report`            | outcome (`created`, `refused`), tier                                            |
| `model_call`        | tool, outcome (`ok`, `plan_required`, `limited`, `error`)                       |

Caller kinds: `keyless` (address), `oauth_free` (free OAuth connection), `free_key`, `pro`, `team`.
Path groups are fixed lists (`/`, `/pricing`, `/try`, `/texas/*`, `/property/*`, `asset`, `other`,
and the REST routes without opaque segments), so cardinality is bounded; an isolate keeps at most
300 distinct counters a day (the rest add to `overflow`). Add a site section to `SITE_SECTIONS` in
`src/usage.ts` when a new top-level page family should be broken out.

Distinct callers per kind are HyperLogLog sketches (512 registers, about 5% error) of values that
are already hashes: the Worker's daily salted address hash (`IP_HASH_SALT`), the OAuth connection's
subject, or the key ID. A sketch keeps no caller and merges across isolates and days. Keyless
hashes rotate daily, so over several days they add up as caller-days, not people. "Active paid
keys" is the Pro and Team sketches merged.

Storage and cost: counting is a memory update (no subrequest). Each isolate writes its counters to
KV as `usage:v1:<UTC day>:<isolate id>` (an isolate only writes its own key, so nothing is
overwritten), at most once every 30 seconds, from `waitUntil` after the response, with a 40-day
expiry. That is at most two KV writes a minute per active isolate. No sampling. Counts an isolate
had not written when it was evicted (up to 30 seconds) are lost, so figures are slight undercounts.
Event rows (everything except `req`) are also written to the Analytics Engine dataset
`factlot_usage` with index `evt`, blob1 the event, blobs 2 to 4 its dimensions and double1 the
count. Reading Analytics Engine needs an API token with Account Analytics Read, which the
`wrangler login` token does not have; with one, for example:

```sql
SELECT blob1 AS event, blob2, blob3, blob4, SUM(_sample_interval * double1) AS n
FROM factlot_usage
WHERE index1 = 'evt' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY event, blob2, blob3, blob4 ORDER BY n DESC
```

(POST it to `https://api.cloudflare.com/client/v4/accounts/<account id>/analytics_engine/sql`.)
`ops:usage` does not use it.

Not counted: addresses, emails, keys, key hashes, URLs, query strings, URNs, addresses of
properties or document contents. A request's counters never leave the isolate except as the sums
above.

## Watch lists

Off unless the variable `WATCH_LISTS_ENABLED` is exactly `"true"`. While off, the `watch_*` tools
are not listed, `/v1/watch/*` and the alert stop links answer 404, the account page shows no
watch section, and the scheduled handler returns at once.

When on, a Pro or Team subscription keeps named lists of parcel, entity and building URNs
(`WATCH_LIMITS` in `src/plans.ts`: 200 subjects and 20 lists on Pro, 5,000 and 100 on Team; after
a downgrade only the oldest subjects up to the limit are compared, and `watch_list` says how many
are not).
Tools, on MCP and as `POST /v1/watch/<name>`: `watch_add`, `watch_remove`, `watch_list`,
`watch_changes`, `watch_alerts`. Any other caller gets `PlanRequired`, unmetered. `watch_add`
reads each new subject once (one registry lookup each; a subject already watched in another list,
an invalid URN and a miss are not counted, and the same new URN added to two lists at once is
counted once); nothing else counts.

Storage: the `LIMITER` Durable Object class (SQLite), objects `watch:sub:<subscription>` and
`watch:index` (`src/watch-store.ts`); KV `watchstop:<alert id>` and `watchconfirm:<pending id>`
map stop and confirmation links to their subscription. No new binding or migration. Each subject keeps a fingerprint (`src/watch-print.ts`):
the newest roll year's values, the owner-of-record values and owning entity URNs, one keyed hash
(HMAC) per recorded document with its date and amount, the entity status, and one hash per other predicate.
Changes are kept 400 days, at most 10,000 per subscription.

The check (`src/watch-check.ts`) runs from the Worker's `scheduled` handler when a cron trigger is
configured (the example in `wrangler.jsonc` is commented out). Each run reads the registry's
`/health`; when the pack's `built_at` differs from the last one checked it gets a new check number
from the index (so a rolled-back pack deployed again is compared again) and compares each watched
URN once. Cloudflare allows 32 Worker invocations per request and counts every service-binding
call, so a run makes at most 30 calls to the registry and to Durable Objects together and reads up
to 50 subjects per registry call (`POST /get-many` of the registry Worker; against an older
registry Worker it falls back to one `/run` call per subject within the same budget). A run that
runs out stops cleanly and the next resumes. A subject the registry cannot read keeps its
fingerprint and is read again, alone, in the next run; after 3 failures in a row it is left out of
that check (`watch_changes` lists it under `check.not_compared`). When the registry does not answer
at all the run stops without counting anything against a subject, and an error in one
subscription never stops the others. Without a cron trigger, `watch_changes` compares up to 25 of
the caller's own subjects inline when the pack is newer; alert emails need the cron trigger.

Alerts: `watch_alerts` with an address sends that address one confirmation email (a signed link
that works once and expires after 24 hours; at most one every 10 minutes and 5 a day per
subscription; one pending address at a time). Nothing else is sent to an address until it is
confirmed. Once confirmed: one email per check that changed something watched, with a one-click
stop link (`List-Unsubscribe` and `List-Unsubscribe-Post` headers). A digest is claimed before it
is sent, so it goes at most once. Links are signed with `RECOVERY_SIGNING_SECRET`; rotating it
invalidates every confirmation and stop link already sent (alerts can still be stopped on the
account page), and recorded-document hashes, keyed from the same secret, are re-baselined at the
next comparison. Needs the `EMAIL` binding and that secret; `POSTAL_ADDRESS` (the secret the lifecycle
emails use) is printed at the foot of the digests when set; digests are sent without it.

Deletion: removing a subject from its last list deletes its fingerprint and changes; stopping
alerts deletes both addresses; changes older than 400 days are pruned on every read and check,
paid or not. A cancelled subscription loses its whole watch object and link records on the Stripe
webhook (a storage failure answers 503 so Stripe retries). The check deletes only when a key record
shows a terminal Stripe status and none is active; an empty or unreadable key list is skipped.
With the variable off the webhook makes no watch call.

## Tokens in URL paths (what a request log can leak)

Workers Logs keeps the request path (`redact_query_string` covers query strings only; see the
comment in `wrangler.jsonc`), so a link whose secret is in the path is stored with it. What each
secret can do if someone with log access reads it, from the code (checked 2026-11-12):

| Path                                                   | What the token does                                                                                                                                      | Lifetime and use                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/reports/d/<token>`                                | GET returns the report file (figures and any text the caller put in it). No key needed.                                                                  | 24 hours (`REPORT_TTL_SECONDS`), not single use: every GET and HEAD inside the day works. 256-bit random token; limited per address and per token.                                                          |
| `/v1/billing/claim/<token>`                            | GET hands out the new paid API key, once. A reader who polls first after payment gets the key.                                                           | The claim lasts 1 hour (`CLAIM_TTL_SECONDS`); KV keeps it 15 minutes more so a payment finished at the last minute is still collected. Single use: after the key is handed out the URL answers 410 Claimed. |
| `/account/recover/<id>.<sig>`                          | GET only shows a page; the POST issues or rotates a key for the subscription (shown once), so the reader needs the POST before the owner does.           | 15 minutes (`RECOVERY_TTL_SECONDS`), single use (decided by a Durable Object claim). Signed, purpose-bound.                                                                                                 |
| `/account/free-key/<id>.<sig>`                         | POST creates the free key for that address (shown once) and replaces its earlier key.                                                                    | 30 minutes (`FREE_KEY_LINK_TTL_SECONDS`), single use. Signed, purpose-bound.                                                                                                                                |
| `/account/free-key-delete/<id>.<sig>`                  | POST deletes that address's free key and its counters.                                                                                                   | 30 minutes, single use. Signed, purpose-bound.                                                                                                                                                              |
| `/authorize/email/<id>.<sig>` (OAuth sign-in by email) | POST connects the waiting MCP client (the browser session that started the sign-in) to the subscription. The reader needs that sign-in page's state too. | 10 minutes (`CONSENT_TTL_SECONDS`), single use. Signed.                                                                                                                                                     |

Reading the table: every link is dead once used, except the report download. A log reader gains
something only by using a link before its owner does (claim, recovery, free-key and sign-in links)
or within 24 hours (reports). Used links are worthless; unused links expire in 10 to 75 minutes.

Not changed, on purpose. A report download token could be made single use, but the documented
behaviour is "download_url works 24 hours" (the `report_create` tool description, the MCP and security pages), and clients legitimately fetch it more than once (a HEAD first, a retry, a second
agent). Shortening it would break that promise. Moving tokens out of paths (POST bodies, headers or
URL fragments) is a URL redesign. If the exposure matters more than the request log, set
`"invocation_logs": false` inside `observability.logs` (drops request URLs and the request log) or
restrict Workers Logs access to the owner.
