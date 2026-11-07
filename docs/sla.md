# Service levels

Today FactLot has no service-level agreement. This page says exactly what that means, publishes the
draft service-level terms for paid plans, and sets out how versions, maintenance, data refresh and
incident notices work now. Written 7 November 2026. The same text is on
[factlot.com/sla](https://factlot.com/sla/).

Related: [service status](https://factlot.com/status/), [security](security.md),
[how the numbers are proven](https://factlot.com/assurance/).

## What applies today

The [Terms of service](https://factlot.com/terms) (section 11) say the Free, Pro and Team plans come
with no service-level commitment: FactLot works to keep the service available but does not guarantee
it. There is no contractual uptime figure, no service credit and no contractual response time. FactLot
does not yet measure availability, so no measured figure is published on
[status](https://factlot.com/status/).

- **Free.** Availability: no commitment. Support: public discussions and issues, as time allows.
- **Pro.** Availability: no commitment. Support: email at contact@factlot.com; no response time is
  promised yet.
- **Team.** Availability: no commitment. Support: priority email support at the same address; no
  response time is promised yet.

If you need a signed agreement, a data-processing agreement or a private deployment, that is the
Enterprise plan, by quote: email contact@factlot.com to discuss terms.

## Draft terms, effective when referenced from the Terms of Service

> **Draft.** Nothing in this section is in force. It becomes part of the agreement for Pro and Team
> subscribers only when the Terms of service refer to it. The Free plan is not covered. Until then,
> the section above is what applies.

### Availability target

FactLot targets 99.9% availability of the hosted API in each calendar month (UTC). Availability is the
share of minutes in the month in which `GET https://api.factlot.com/health` succeeds, as recorded by
an external monitor, and FactLot publishes each month's figure on
[/status/](https://factlot.com/status/). Rate-limit and quota answers (HTTP 429) are not downtime. No
such monitor runs today, so these terms cannot take effect until one does.

### Service credit

If measured availability for a calendar month is below 99.5%, a Pro or Team subscriber is credited 10%
of that month's fee for the plan, applied to the next charge. Section 12 of the Terms (limitation of
liability) and section 19 (events beyond reasonable control) still apply.

### Support response targets

- **Pro:** first reply by email within 2 business days.
- **Team:** first reply by email within 1 business day.

A target is a first human reply, not a fix. A business day is Monday to Friday, excluding United
States federal holidays. Write from the address on your account, say what you called and what
happened, and never send a key.

### Previous formula versions

When a formula's version changes, the previous version keeps answering on the hosted API for 12
months, selectable by `@version`. **This is not available yet.** The hosted API serves only the
current version of each formula, and has no way to select an older one. Until that ships, this item is
not offered; the [versioning rules](#versions-changes-and-deprecation) below are what apply.

## Versions, changes and deprecation

- **A formula never changes silently.** Every calculator result carries a versioned formula ID such as
  `calc.net_effective_rent@1`. If any valid input could produce a different output, the formula's
  version is increased in both the TypeScript and Python libraries and in its test vectors, and the
  change is listed under "Changed" in the [changelog](../CHANGELOG.md) with the calculator's name. A
  change to any calculator's output is at least a minor release; before 1.0, a minor release can
  contain breaking changes, and the changelog says so.
- **IDs do not change.** `@factlot/id` returns the same ID for the same input forever.
- **Older versions today.** The hosted API runs the current formula only. To reproduce an older
  result, run the release that produced it: releases are kept on the
  [releases page](https://github.com/9mp96ygnbk-alt/factlot/releases) and as tags in the repository,
  and each result names its formula version.
- **Removing features or lowering limits.** Before removing a feature or lowering a limit in a way
  that materially reduces a paid plan, FactLot emails paid subscribers at least 30 days ahead (Terms,
  section 15). A change the law requires, or one that fixes a security problem, may take effect
  sooner.
- **Maintenance.** Deploys replace the running Worker in place and do not need a maintenance window.
  If a window is ever needed, it will be announced on [/status/](https://factlot.com/status/)
  beforehand.

The versioning rules are in [release-process.md](release-process.md#versioning-rules) and the
project's contributor rules (formula versions are rule 3).

## Data refresh

- **Every registry fact says how old it is.** `registry_coverage` (never counted as a lookup) lists
  each hosted county with the `as_of` date of each source, and every fact carries its own `as_of`. The
  [coverage map](https://factlot.com/coverage/) shows each county's data date.
- **Hosted regions are refreshed by hand.** The maintainer rebuilds the registry pack from verified
  sources and deploys it. No refresh interval is promised. A region is served only while
  `registry_coverage` lists it, and a source whose terms do not allow us to serve its data is not
  served.
- **Texas.** A collector workflow runs every Monday at 09:17 UTC on GitHub Actions and archives the
  verified public sources, Texas appraisal districts included, as private release drafts with hash
  manifests. That builds an archive; it does not change what the hosted API serves by itself. Texas
  counties appear on the hosted API only when `registry_coverage` lists them, and Tarrant County is
  withheld while the publisher's terms for AI use are unclear.
- **Rules.** A rules pack returns the date it was last checked against the official text, so you can
  see how old the check is. No re-check schedule is promised.

## How problems are communicated

- The [status page](https://factlot.com/status/) holds the incident history and links the live health
  endpoint. An incident is added with its date, duration, what was affected, the cause and what
  changed.
- Notices that affect your account (price changes, removals, a security problem) go to the email
  address on your account, with the notice periods in the Terms.
- Fixes and behaviour changes are in the [changelog](../CHANGELOG.md).
- A wrong number is handled as described in
  [how to report a wrong number](https://factlot.com/assurance/#report).
