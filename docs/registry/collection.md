# Getting the Texas data (and why it becomes the moat)

## The moat is not the files

Appraisal-district files are public, so anyone can download this year's copy. What competitors
cannot recreate later:

1. **Continuous history.** We can keep weekly or yearly snapshots of every release, each
   hash-verified and timestamped. Ownership changes, value trends, reclassifications, and
   parcel splits only exist as history if someone archived them at the time. Nobody can go back
   and backfill them. **This is why collection should start now, before the parsers exist.** The
   collector archives raw files regardless of format.
2. **Normalization across 254 counties.** Each appraisal district publishes its own layout. One
   schema, keyed by FactLot IDs, is a large amount of tedious, compounding work.
3. **The entity graph.** Owner-of-record names are resolved to registered entities and linked
   across counties, with crosswalks to every system's IDs.
4. **Trust.** Every fact cites its file and record and carries its usage rights, and the
   corrections users send back flow in.

## The collector

The collector is `python -m factlot.collector`. It is standard-library Python, and its tests run
against a local HTTP server. It enforces the [data policy](data-policy.md):

- **It identifies itself.** Requests carry the user agent `FactLotRegistryBot/0.1`, which includes
  a contact address.
- **It obeys robots.txt.** When robots.txt can't be read, it reports the site as _unreachable_
  rather than pretending the site refused.
- **It is rate-limited and avoids repeat downloads.** It enforces a delay per host and uses
  conditional requests.
- **It stays inside allowed hosts.** It only follows links to hosts allowed for each source.
- **It discovers before it downloads.** The `discover` step only lists the links on each landing
  page. The `snapshot` step only archives sources marked `verified: true`, meaning a person has
  reviewed the publisher's terms and confirmed the file URLs.
- **It records everything in a manifest.** Every decision (archived, unchanged, skipped, refused,
  unreachable, error) is written to `manifest.jsonl`. Archived files are content-addressed
  (`fl:document:sha256-…`), which matches the registry's snapshot citations.

Sources are configured in [`registry/sources/texas.json`](../../registry/sources/texas.json).

## Four ways to reach the sources

| Route                                                    | What to do                                                                                                                                          | Speed                    | Notes                                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Allow the domains in this development environment** | Environment settings → Network access → add the domains in [texas-sources.md](texas-sources.md)                                                     | Minutes                  | Best for building adapters interactively: I can read the real file layouts.                                                                                                                      |
| **2. Scheduled collection on GitHub Actions**            | Create the `factlot` repository. The workflow `.github/workflows/collect-texas.yml` then runs weekly on GitHub's runners, which have open internet. | Hours                    | This is the production pipeline. It publishes archives as release assets, which is free storage. It starts with discovery reports only; verified sources are added after the terms are reviewed. |
| **3. Run from your computer**                            | Set up Remote Control in the Claude desktop app, then let a session use a folder on your machine                                                    | Minutes                  | Uses your network. The commands are the same.                                                                                                                                                    |
| **4. Texas Public Information Act requests**             | Send the [request letter](public-information-requests.md) to each appraisal district                                                                | 10 business days or more | Fully legal and on the record. Useful when a district doesn't publish bulk files, or when its terms are unclear.                                                                                 |

**Recommended:** use routes 1 and 2 together. Route 1 lets me write and test the Harris and Dallas
adapters against the real files. Route 2 starts the archive running and accumulating history
every week. Use route 4 for any district without a public bulk download.

## After the first discovery run

1. Read each `discovered.json`, either from the workflow artifact or from a local run.
2. Open each publisher's terms of use. Record the license, AI-use status, and redistribution
   status in [texas-sources.md](texas-sources.md).
3. Put the confirmed file URLs in `files` and set `verified: true`.
4. Let the weekly run archive them. Write the county adapter against the first real snapshot.
