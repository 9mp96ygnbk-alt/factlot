# va-scc-entities: Virginia State Corporation Commission business entity data

Reviewed 2026-11-02. Status: **not verified (gated: host unreachable to the collector; download
sits behind a cookie-consent click-through; terms and any fee unconfirmed)**. Config:
[`registry/sources/va/va-scc-entities.json`](../../../registry/sources/va/va-scc-entities.json);
adapter `python/src/factlot/registry/adapters/va_scc_entities.py` (written to a third-party
description of the layout, **not yet run on a real file**).

## Publisher and URLs

- Publisher: Virginia State Corporation Commission (SCC), Office of the Clerk. The Clerk's
  Information System (CIS) is at <https://cis.scc.virginia.gov/>; the Clerk's Office pages are
  under <https://www.scc.virginia.gov/businesses/about-the-clerks-office/>.
- Bulk file: the only known route is
  `https://cis.scc.virginia.gov/DataSales/DownloadBEDataSalesFile` ("Business Entity Data Sales"
  file). It is documented by the open-source parser openva/crump
  (<https://github.com/openva/crump>, `crumplib/download.py`): the client first fetches
  `/Cookie/CookieConsent`, then POSTs `/Cookie/StoreCookieConsent` (accepting the site's cookie
  banner), then downloads the file, "a ZIP of CSV files" of about 177 MB that "The SCC refreshes
  … weekly". The SCC itself publishes no page describing this endpoint that the collector could
  read (see robots below).
- Paid extract: the SCC's purchase page <https://appspre.scc.virginia.gov/clk/purch.aspx>
  (found by web search; an `appspre` host, so possibly stale) says the Clerk's Office "provides
  extractions of its database for corporation, limited liability company, and limited partnership
  information", delivered "weekly via file transfer protocol (FTP) download", "The monthly fee is
  $1,000.00. Prepayment is required." Whether this is the same product as the free CIS download,
  or an older arrangement the 2019 CIS replaced, could not be established.
- Per-entity search (<https://cis.scc.virginia.gov/EntitySearch/Index>) is not a bulk source; a
  third-party guide reports it sits behind reCAPTCHA.

## Terms, license, robots

- `https://cis.scc.virginia.gov/robots.txt` and the CIS home page **did not answer** the
  collector's user agent on 2026-11-02: `curl` with the `FactLotRegistryBot/0.1` user agent timed
  out after 30, 60 and 90 seconds on both. The collector therefore records the site as
  unreachable (robots.txt could not be read), which under the data policy means it must not fetch.
- `https://www.scc.virginia.gov/robots.txt` (read 2026-11-02) names a few search engines with
  `Allow: /` and ends with:

      User-agent: *
      Disallow: /

  so the collector may not read the SCC's own web pages, including any terms. One page was read
  by hand (the Clerk's Office "about" page): it says "documents and information on file in the
  Office of the Clerk are in most instances open to public examination" and that many documents
  "may be viewed and downloaded from the Clerk's Information System (CIS)". It says nothing about
  bulk data, licenses, AI use, or redistribution.

- License: **not established**. Business entity filings are public records in Virginia (Va. Code
  § 13.1-612 et seq.; the Virginia FOIA, § 2.2-3700 et seq.), but no license or terms for the
  bulk file could be read, and the "Data Sales" naming plus the purchase page suggest a fee or
  agreement may apply.
- AI use and redistribution: not established.

## What the file contains (expected; from the openva/crump field maps, unconfirmed)

A zip of eleven CSVs: `Corp.csv`, `LLC.csv`, `LP.csv`, `GP.csv`, `BT.csv`, `PSA.csv` (entities),
plus `Amendment.csv`, `Merger.csv`, `Officer.csv`, `NameHistory.csv`, `ReservedName.csv`. The six
entity files share a 28-column core, with the upstream header names:

    EntityID, Name, Status, StatusReason, Status Date, Duration, IncorpDate, IncorpState,
    IndustryCode, Street1, Street2, City, State, Zip, PrinOffEffDate, RA-Name, RA-Street1,
    RA-Street2, RA-City, RA-State, RA-Zip, RA-EffDate, RA-Status, RA-Loc, StockInd, TotalShares,
    MergerInd, AssessInd

`Corp.csv` adds `Stock1`; `LLC.csv` adds `Is Series LLC`, `Is Protected Series`, `Series LLC ID`.
crump notes the values "still carry" fixed-width padding, that `Status`/`StatusReason` are
"pre-expanded" (spelled out) upstream, and that `State` and `IncorpState` are full state names.

Adapter mapping (`read_entities`): `EntityID` → `registry_number` (jurisdiction `us-va`); `Name`
→ `legal_name`; `IncorpState` → `state_of_formation` as a USPS code (full names translated; a
non-US name yields `None`); `Street1`, `Street2`, `City`, `State`, `Zip` → `mailing_address`;
`Status` → snake_case `status`. `Officer.csv` (natural persons) is never opened. Everything is
whitespace-squeezed. Rows with a blank `EntityID` or name are yielded blank so the registry counts
them as `skipped_invalid`.

## Gates (anything that needs a person)

1. **Reachability.** `cis.scc.virginia.gov` does not answer from the collector's network. A person
   should try the home page and robots.txt from another network, and, if the site blocks
   automated clients, ask the Clerk's Office for a route (or whether the file may be fetched by a
   bot at all).
2. **Cookie-consent click-through.** The download requires accepting the site's cookie banner
   first. The collector never accepts banners or terms (data policy §1). A person
   must read what that consent covers before it is accepted.
3. **Fee / agreement.** Confirm whether `DownloadBEDataSalesFile` is free and whether any
   agreement attaches, versus the $1,000/month FTP extract on the purchase page. If a purchase or
   agreement is required, it is a separate gate.
4. **Terms, AI use, redistribution.** None could be read. Record them, then set `verified: true`
   and add the file URL to `files` (note the collector will also need robots.txt to be readable
   or explicitly allowed).
5. **Layout check.** On the first real file, compare the headers with the list above and fix the
   adapter before trusting its output.

### Terms read 2026-11-03

This memo is research, not legal advice.

These three URLs did not load (curl 35, no HTTP status, read 2026-11-03). Consent banner and price list are NOT CONFIRMED. A person must open them:

- https://cis.scc.virginia.gov/
- https://cis.scc.virginia.gov/Cookie/CookieConsent
- https://appspre.scc.virginia.gov/clk/purch.aspx

The page that loaded, https://www.scc.virginia.gov/businesses/about-the-clerks-office/ (HTTP 200, read 2026-11-03):

> Business entity, Uniform Commercial Code and SCC case documents and information on file in the Office of the Clerk are in most instances open to public examination.

> The Clerk's Office operates under the Code of Virginia.

No bulk licence, price, or redistribution term was on that page. Not loaded.

Statute text was not fetched on 2026-11-03. A capture read 2026-11-02 quotes Va. Code § 2.2-3700(B) and § 2.2-3704, https://law.lis.virginia.gov/vacode/title2.2/chapter37/section2.2-3700/ and https://law.lis.virginia.gov/vacode/title2.2/chapter37/section2.2-3704/ . Contiguous pieces:

> available for inspection and copying upon request.

> a public body may make reasonable charges not to exceed its actual cost incurred in

As captured, those sections are silent on commercial use and on redistribution of an entity extract. They are not a price list for the Clerk's data file.

## Real run

None. No file was downloaded (gates above). The adapter's tests run on a synthetic fixture only
(`python/tests/test_adapter_va_scc_entities.py`): they exercise padding, state-name translation,
blank ids, the zip/directory readers, and `build()` with `link_owners()` against a synthetic
parcel owner (1 link, as designed). No count in this record comes from real SCC data.

For the scratch-registry link run with Fairfax County, see
[va-fairfax-assessor.md](va-fairfax-assessor.md): Fairfax publishes no owner names, so even with
SCC entities loaded `link_owners()` would have nothing to match there.

## Known gaps

- Everything above the adapter is unconfirmed: layout, encoding, date formats, status vocabulary.
- `IndustryCode`, registered agent fields, stock fields and series-LLC flags are not mapped.
- Foreign (non-Virginia) entities registered in Virginia are included by `IncorpState`, which is
  what the registry wants, but their home-state registry number is not in the file.
