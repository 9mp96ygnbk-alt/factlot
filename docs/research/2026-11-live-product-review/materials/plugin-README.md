# FactLot plugin for Claude Code

Commercial real estate skills that call audited, deterministic calculators instead of letting the model do the arithmetic. The plugin registers the free hosted [FactLot MCP server](../../README.md) and adds eight skills that know which tool to call, what inputs to collect (with units), and how to report the answer: the tool's value, the formula ID, and every warning.

## Claude Code plugin

```text
/plugin marketplace add 9mp96ygnbk-alt/factlot
/plugin install factlot@factlot
```

Then restart the session or run `/reload-plugins`. Skills are namespaced, so you can run one directly (for example `/factlot:cre-loan-sizing`) or just describe the task and Claude picks the skill from its description.

From a shell: `claude plugin marketplace add 9mp96ygnbk-alt/factlot` then `claude plugin install factlot@factlot`.

## Skills

| Skill                       | Use it for                                                            | Tools                                                                     |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `cre-loan-sizing`           | Max loan under LTV, DSCR, and debt yield; binding constraint          | `calc_debt_sizing`                                                        |
| `lease-economics`           | Rent schedules, net effective rent, ranking lease proposals           | `calc_rent_schedule`, `calc_net_effective_rent`, `calc_compare_proposals` |
| `cam-reconciliation`        | CAM and opex true-ups with caps, gross-up, base year; percentage rent | `calc_cam_reconciliation`, `calc_percentage_rent`                         |
| `lease-accounting-asc842`   | Lessee lease remeasurement: liability, ROU asset, amortization        | `calc_lease_remeasurement_asc842`                                         |
| `lease-vs-own-and-renewals` | Lease vs buy, renew vs relocate, WALT                                 | `calc_lease_vs_own`, `calc_renew_vs_relocate`, `calc_walt`                |
| `investment-returns`        | IRR, NPV, prepayment premium, yield maintenance, defeasance           | `calc_irr`, `calc_npv`, `calc_prepayment_and_defeasance`                  |
| `hotel-metrics`             | Occupancy, ADR, RevPAR, GOP, EBITDA, NOI (USALI style)                | `calc_hotel_metrics`                                                      |
| `tx-property-tax-protest`   | Texas ARB protest filing deadline                                     | `rules_tx_property_tax_protest_deadline`                                  |

Every skill follows the same rules: never compute the figures in-context, report the tool's value as returned, cite the formula ID (for example `calc.debt_sizing@2`), and surface every warning. The MCP server also exposes the ID tools (`id_parcel`, `id_entity`, `id_space`, `id_document`, `id_parse`), `fact_validate`, `search`, `fetch`, and `schema_get`.

## How it connects

`.mcp.json` registers one remote server, `factlot`, at `https://api.factlot.com/mcp` (Streamable HTTP). It is free, needs no key, and is limited to 60 requests per minute. In Claude Code its tools appear as `mcp__plugin_factlot_factlot__<tool>`.

- **Data leaves your machine.** Each tool call sends its arguments (rents, NOI, loan terms, and so on) to `api.factlot.com`. If that is a problem, run the local server instead: `claude mcp add factlot-local -- npx -y https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.1/factlot-mcp-standalone-0.1.1.tgz` (Node 22.6 or newer, no network calls), and disable the plugin's hosted server in `/mcp`.
- **Paid key.** If you have a key, add your own server with the header instead of editing the plugin: `claude mcp add --transport http factlot-pro https://api.factlot.com/mcp --header "Authorization: Bearer <key>"`.
- **No MCP?** The same calculators are plain REST: `POST https://api.factlot.com/v1/calc/<name>`. `GET https://api.factlot.com/v1/tools` lists them with their input schemas.

## Verify the worked examples

Each skill's example arguments come from the repository's conformance vectors in [`spec/vectors`](../../spec/vectors) and were checked against the live API; the figures quoted in the skills match its responses.

## Layout

```text
.claude-plugin/marketplace.json     marketplace "factlot" (repository root)
plugins/factlot/.claude-plugin/plugin.json
plugins/factlot/.mcp.json
plugins/factlot/skills/<name>/SKILL.md
```

Validate with `claude plugin validate .` from the repository root and `claude plugin validate plugins/factlot`.

## License

Apache-2.0, like the rest of the repository.
