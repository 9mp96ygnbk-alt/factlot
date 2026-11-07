# Audit reports, 2026-11-06

Quality notes for the loads re-audited on 2026-11-06, each with the report `python -m factlot.registry.audit` printed, trimmed to its
`audited_on`, `stats`, `violations` and `warnings` sections (the per-source detail is left out). Run with `--reread --entity-names` against the
collector's archive (`collected/`) and `--today 2026-11-06`. Parcel and snapshot identifiers are FactLot IDs; no owner name appears in a report.

- Statewide and multi-county loads: [md-sdat-real-property.md](md-sdat-real-property.md) (24 jurisdictions, 109,249 parcels),
  [ny-orpts-rolls.md](ny-orpts-rolls.md) (57 counties, 275,995 parcels), [ma-massgis-parcels.md](ma-massgis-parcels.md) (350 towns,
  127,922 parcels; no county passes), [in-statewide-parcels.md](in-statewide-parcels.md) (91 Indiana counties; the source stays unverified).
- Single-county loads: [mi-oakland-parcels.md](mi-oakland-parcels.md), [in-marion-parcels.md](in-marion-parcels.md),
  [ga-dekalb-parcels.md](ga-dekalb-parcels.md), [tn-davidson-assessor.md](tn-davidson-assessor.md),
  [pa-montgomery-parcels.md](pa-montgomery-parcels.md), [wa-pierce-assessor.md](wa-pierce-assessor.md).
- [in-counties.md](in-counties.md): the terms and freshness reading for 13 Indiana counties. None was downloaded; each record stops on a
  licence, clickwrap, fee, robots.txt rule or HTTP 403.
- `ma-massgis-parcels-reread.json`: the per-file re-read summary for MassGIS (the audit tool's adapter list does not include that adapter).
- The Hillsborough and Miami-Dade Florida records are review records only (nothing loaded), so they have no report here.
