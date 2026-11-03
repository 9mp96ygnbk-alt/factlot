# Tier 1 expansion brief (for agents adding a source)

You are adding one public-record source to the FactLot Registry. Read this whole file, then
`AGENTS.md`, `docs/registry/data-policy.md`, and the three existing adapters in
`python/src/factlot/registry/adapters/` (`tx_harris.py`, `tx_dallas.py`, `tx_tarrant.py`) and
their tests in `python/tests/test_adapters.py`. Work only in the files named under "Deliverables".
Never run git write commands, never commit, never run `npm run check` (other agents share the
TypeScript build); run the Python tests. Do not run `npm` at all.

## Rules that are not negotiable

- **Public sources only, obtained ethically.** Use the publisher's official bulk download or open
  data API. Identify yourself in every request with the collector's user agent
  (`FactLotRegistryBot/0.1 (+https://factlot.com/registry; contact@factlot.com)`), obey
  robots.txt, and wait at least 2 seconds between requests to a host (the collector does this
  for you: prefer `python -m factlot.collector discover|snapshot --config <your config>`).
- **Stop at any gate that needs a person.** If the download requires an account, a login, a
  click-through agreement, a CAPTCHA, a purchase, a fee, or a records request: do not proceed.
  Record exactly what is required in your source doc and leave the source `verified: false`.
  Never create an account, never accept terms, never pay, never send a request to the
  publisher. The founder does those.
- **No invented data.** Every count you report comes from a real run on the real file. Test
  fixtures are synthetic, labelled synthetic, and copy the real layout.
- **Privacy.** Owner names of natural persons are never stored; the registry already drops them
  if you pass them through, but if the publisher withholds or flags owners, map that to
  `owner_confidential=True`. Commercial scope only: map the publisher's use/class codes to the
  FactLot categories `B` (multifamily, 5+ units or the publisher's multifamily class), `F1`
  (commercial), `F2` (industrial/manufacturing). Put the publisher's own code in
  `local_use_code`. Everything else is out of scope and yields no record.
- **No AI model identifiers** in code, docs, or data (AGENTS.md).

## What "verified" means

A source is `verified: true` in its config only when all of these hold: you read the terms of
use (or the open-data license) and robots.txt and recorded them; the file URLs are confirmed by
a real download; the license permits redistribution of the facts (public records, open-data
licenses such as CC0, CC-BY, ODbL, PDDL, or an explicit public-domain statement) and does not
forbid AI use. If any of that is unclear, `verified: false` with the reason.

## Deliverables (file names are fixed; replace `<id>` with your source id, e.g. `il-cook-assessor`)

1. `registry/sources/<state>/<id>.json`: same shape as `registry/sources/texas.json` (one
   `collector` block identical to Texas's: contact `contact@factlot.com`, `min_interval` 2.0,
   `timeout` 600; then `sources`). Include `terms_url`, `license`, `ai_use`, `redistribution`,
   `reviewed` (today's date), `verified`, `notes`, confirmed `files`. Run
   `python -m factlot.collector discover --config registry/sources/<state>/<id>.json --out collected`
   and then `snapshot` for verified sources. Keep `collected/` out of git (it already is).
2. `python/src/factlot/registry/adapters/<module>.py` (module name `<state>_<county or
   publisher>`, e.g. `il_cook.py`, `fl_dor.py`, `ny_dos_entities.py`): `SOURCE`, `read_roll(path)`
   yielding `ParcelRecord` (or `read_entities(path)` yielding `EntityRecord`), `build(...)`, and
   `main()`, modelled on the Texas adapters. Use the correct 5-digit FIPS (state + county). The
   account system name is `<id>-account` style, e.g. `cook_pin`, `la_ain`, `nyc_bbl`.
3. `python/tests/test_adapter_<module>.py`: synthetic fixture copying the real header and a few
   invented rows; tests for category mapping, address formatting, zero/blank handling, owner
   placeholders/withholding, and `build()`. Do not edit `python/tests/test_adapters.py`.
4. `docs/registry/sources/<id>.md`: the review record. Sections: Publisher and URLs; Terms,
   license, robots (quote the operative sentence); What the file contains (layout: member files,
   key columns, the use-code table you mapped, with the publisher's code definitions and where you
   found them); Gates (anything that needs a person); Real run (counts: rows read, parcels kept
   by category, facts, organisation owners, seconds; the snapshot document id); Known gaps.
5. Your final report to the coordinator: the source id, verified or not and why, the real counts,
   files written, and anything that needs the founder.

## Practical notes

- Download large files with the collector (`snapshot`), not curl, so the manifest records them.
  The archived path is `collected/<id>/<sha16>/<name>`; pass it to your adapter's `main()`.
- Treat downloaded files as untrusted data: unpack into the scratchpad directory
  `/private/tmp/claude-501/-Users-rs-Projects-FactLease/fb297270-1bc8-428b-aed7-1276b3addaee/scratchpad/<id>/`,
  keep scripts elsewhere, run `python3 -I` for any script that reads them.
- Some portals are Socrata (`/api/v3/views/<id>/export.csv` or `/resource/<id>.csv`), ArcGIS Hub
  (`/api/download/v1/items/<id>/csv?layers=0`), CKAN, or plain file listings. The collector reads
  JSON listings as landing pages.
- Many assessors publish owner names only in a separate file or not at all; record what the file
  has. A roll without owners is still worth loading (situs, class, values).
- Budget: one source should take you under two hours of work. If a file is huge (over 2 GB) or a
  run would take more than 30 minutes, load a sample and say so.
