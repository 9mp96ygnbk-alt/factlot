# Data stories

A data story is a short page of figures computed from one registry file. The generator writes one JSON
document; a separate verifier recomputes every figure by a second route; the site build renders only
stories whose verification stamp matches the story file.

```bash
# generate (the registry file is opened read-only; its path is not written into the story)
PYTHONPATH=python/src python3 -m factlot.registry.story --db tx.db --county 48201 \
  --years 2022 2023 2024 2025 --threshold 10 --threshold 25 --out site/_data/stories/<slug>.json
# verify and write <slug>.stamp.json beside it
PYTHONPATH=python/src python3 -m factlot.registry.story --db tx.db --verify site/_data/stories/<slug>.json
```

`<slug>` is the `slug` field of the generated file. With no files in `site/_data/stories/`, the build makes
no `/data/` section and adds no link.

## What a story holds

- `figures`: id, label, value, unit, the rule in one sentence, and the sources (source id, as-of date,
  attribution from the source's rights record).
- `sentences`: built by code from the figures; every number in a sentence is a figure the sentence cites.
- `tables`: small tables; a cell built from fewer than 10 parcels is empty, except a county total.
- `registry`: schema versions and a hash of the documents read (not the file path). `generator`: name and version.

## What the generator refuses

- A withheld county (Tarrant, 48439).
- A roll year with no value of the chosen type (`--value-type market|appraised`), or a year that has only
  the other type: values of different types are not compared.
- A source whose rights record prohibits redistribution or AI use.
- A tax year that more than one file in the registry states, or a value with a fraction of a cent.

Only parcels in the registry's commercial scope are counted. Owner names are not written unless
`--name-organisations` is passed, and then only organisations that do not read as a person's or a family's,
with at least 10 parcels. A roll year is labelled preliminary when its tax year is later than the year of
its file's as-of date, or when `--preliminary` names it.

The page prints the stated values of the publisher as published in the named files. It is not an appraisal,
not an opinion of value and not advice.
