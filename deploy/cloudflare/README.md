# Hosted API Worker (deploy/cloudflare)

Operator notes for the hosted FactLot Worker. Configuration is in [`wrangler.jsonc`](wrangler.jsonc);
secrets are set with `npx wrangler@4 secret put <NAME>` and are never in the repository.

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
