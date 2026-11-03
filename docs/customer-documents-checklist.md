# Hosted ingest launch checklist

What must be true before FactLot Cloud accepts its first customer document. Each item makes a
promise in the [customer documents policy](customer-documents.md) real. Tick an item only when
it is verified, and write the date and how it was verified next to it. Items marked **needs
counsel** cannot be ticked by an engineer.

## Storage and isolation

- [ ] **Encryption at rest is on** for the document bucket, the report database, and backups,
      and the key is a managed KMS key with rotation enabled (policy section 2). Verified by
      reading the bucket and database configuration, not the console summary.
- [ ] **Per-customer isolation** is enforced in storage (one prefix or bucket per customer with
      a policy that denies cross-prefix reads) and in the database (row-level filter on the
      customer ID applied by the data layer, not by each query). A test tries to read customer
      A's document with customer B's key and fails.
- [ ] **No standing human credentials** to customer storage. Only the ingest service identity
      can read documents; engineers' roles cannot (section 6).
- [ ] **Backups expire within 30 days** and the expiry is configured, not assumed (section 2).
- [ ] **Test and staging environments** hold only the synthetic leases in
      `python/tests/fixtures/leases/` and are blocked from reading production storage.

## Retention and deletion

- [ ] **Retention job** exists, runs daily, deletes every document whose report's
      `retention.retain_until` has passed, and writes each deletion to the audit log. It has a
      test that uses a report with a past date and a report with a future date.
- [ ] **Retention is settable** per run (`--retain-days` / API parameter) and per account, bounded
      to 0–365 days, and 0 deletes the document as soon as the report is written.
- [ ] **Hosted ingest persists only redacted reports** (`to_report(redact=True)`); a test on the
      hosted path checks that a rejected candidate's quote is not stored.
- [ ] **Customer deletion** works for one document, one report, and the whole account, is
      immediate from live storage, and is written to the audit log.
- [ ] **Account-closure deletion** runs 90 days after closure without a person's involvement.
- [ ] **Export** of every report (JSON) and of every still-retained document is self-serve.

## Model provider

- [ ] **Commercial organization.** The API key used by hosted ingest belongs to an organization
      under the provider's Commercial Terms of Service, so the no-training clause applies
      (section 3). Written down: organization name, who holds the admin login, date checked.
- [ ] **Retention arrangement chosen and recorded:** either zero data retention is enabled for the
      organization, or 30-day retention is accepted and stated to customers. The chosen models are
      listed with whether each requires 30-day retention.
- [ ] **Provider terms re-read** and the table in policy section 3 updated with the new "read on"
      date. Calendar reminder every 90 days.
- [ ] **Provider SDK logging is off** in production, and no request or response body is written
      anywhere (section 5).

## Logging and monitoring

- [ ] **Request log and usage log** schemas are unchanged from `packages/server/README.md`, and
      the "metadata only" test still passes against the deployed build.
- [ ] **Error reporting** (whatever is used) scrubs request bodies and local variables before
      sending; verified by raising a test exception with a sentinel in the body.
- [ ] **Audit log** records every human access, deletion, export, and retention change, is
      append-only, is kept one year, and is visible to the customer (section 8).

## Access and incidents

- [ ] **Break-glass procedure** is written as a runbook: who can grant, the 24-hour cap, the
      audit entry, the customer notice (section 6). Tested once with a synthetic account.
- [ ] **Breach response runbook** names who decides a breach is confirmed, who writes the notice,
      the 72-hour clock, and the template (section 7). Contact details for the model provider's
      security team are in it.
- [ ] **State and sector notice obligations** for the first customers' jurisdictions are mapped.
      **Needs counsel.**

## Contracts and compliance

- [ ] **DPA template** exists, covers no-training and no-use by FactLot and subprocessors,
      retention, deletion, breach notice, audit rights, and the subprocessor-change procedure.
      **Needs counsel.**
- [ ] **Terms of service** for FactLot Cloud reference the policy and the DPA. **Needs counsel.**
- [ ] **Subprocessor list** is published at a fixed URL with function and region for each entry,
      and the 30-day notice procedure for additions is written down (section 7).
- [ ] **Cloud host chosen** (backlog A4) and its own DPA signed; its region is the one promised
      for data residency.
- [ ] **SOC 2 scope decided:** which trust service criteria, whether Type I first, which systems
      are in scope (at minimum: the ingest service, storage, the audit log, access management),
      and who the auditor is. The policy promises SOC 2 only for Enterprise; do not advertise it
      before a report exists.
- [ ] **Liability and insurance** for a document breach reviewed. **Needs counsel.**

## Before the first upload

- [ ] Every item above is ticked with a date and a verifier.
- [ ] The policy's "not live" paragraphs are rewritten to the present tense in the same change
      that opens the upload endpoint, and the version number is bumped.
