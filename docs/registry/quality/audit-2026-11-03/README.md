# Audit reports, 2026-11-03

The JSON that `python -m factlot.registry.audit` printed for each Tier 1 registry file before and after the quality pass; the tables in
[../tier1-2026-11-03.md](../tier1-2026-11-03.md) are read from these.

- `before-*`: the files as the first Tier 1 pass left them (Harris, Dallas and the Comptroller in one file; Tarrant, Travis, Collin, Boston,
  San Francisco and Philadelphia each in their own; the other Tier 1 sources and four entity registries in the Tier 1 file). The Boston,
  San Francisco and Philadelphia reports predate the personal-trust rule.
- `after-texas.json`: Harris, Dallas, Tarrant, Travis, Collin and the Comptroller's entities in one file.
- `after-tier1.json`: New York City, Los Angeles, Denver, DC, Hennepin, Mecklenburg and the Colorado, New York, Pennsylvania and DC entity registries.
- Run with `--reread --entity-names` against the collector's archive (`collected/`), as 2026-11-03. Parcel and snapshot identifiers are
  FactLot IDs; no owner name appears in a report.
