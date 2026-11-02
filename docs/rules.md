# Rules packs

Rules packs turn jurisdiction law into code that agents can call. Each pack is a deterministic
calculator that also declares:

- **the law it implements**, as statute citations with links;
- **a version**, which is bumped whenever any output could change;
- **a verification status**: `draft` until a named person has checked the rule against the
  official text of every citation and recorded when.

Every result returns the rule's metadata. Draft rules always add a warning. Where a mistake could
cost someone a legal deadline, the rule also returns a conservative answer that can't be late.

| Pack                                                                                    | Tool                                     | Status                                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Texas property tax protest deadline (Tax Code §41.44(a)(1), §1.06; Gov't Code §662.003) | `rules_tx_property_tax_protest_deadline` | **draft**                                                                                                                     |
| NYC Local Law 97 penalties                                                              | none yet                                 | Deferred: the law text (nyc.gov) can't be reached from the development environment, and we don't ship constants we can't cite |

## Texas protest deadline

The deadline is the later of May 15 and the 30th day after the notice of appraised value was
delivered. It then rolls forward past Saturdays, Sundays, and Texas legal holidays, using actual
holiday dates.

Observed (shifted) holidays and Columbus Day are not treated as holidays. That is deliberate:
when it's unclear whether a day is a holiday, assuming a business day can only make the deadline
earlier.

The rule also returns `recommended_file_by`, the last business day on or before the unadjusted
deadline. This date is safe even if the holiday list is wrong.

Not covered:

- other §41.44 deadlines, such as protests of changes made after notice and §25.25 corrections;
- late-protest relief;
- county-specific practice.

### How it was tested

- Shared vectors run in both SDKs, covering Memorial Day, Juneteenth, and weekend cases, with
  expected dates computed independently.
- A full 2026 holiday calendar vector.
- A TypeScript/Python differential test on random inputs from 2000 to 2100.
- An exhaustive invariant check over every notice date from 2000 to 2100. It confirms the deadline
  is always a business day, never before May 15, and that the recommended date is never later than
  the deadline.

## Verifying a pack

To move a pack from `draft` to `verified`:

1. Read each cited section in its official source.
2. Confirm the logic and the holiday list.
3. Set `verification.status` to `"verified"` and record `verified_by` and `verified_at`. Do this in
   both SDKs; the shared vectors keep them in sync.
4. Bump the version if any behaviour changed.
