# fl-dos-entities: Florida Division of Corporations (Sunbiz) corporate data file

Review record for the source `fl-dos-entities` (data policy §5). Machine-readable copy:
[`registry/sources/fl/fl-dos-entities.json`](../../../registry/sources/fl/fl-dos-entities.json).
Adapter: `python/src/factlot/registry/adapters/fl_dos_entities.py`; tests:
`python/tests/test_adapter_fl_dos_entities.py`. Reviewed 2026-11-02. **Not verified** (see Gates).

## Publisher and URLs

- Publisher: Florida Department of State, Division of Corporations ("Sunbiz"). Help desk named in
  the SFTP welcome file: `corphelp@dos.myflorida.com`.
- Landing pages (all answer the collector with a Cloudflare challenge, see Gates):
  <https://dos.fl.gov/sunbiz/other-services/data-downloads/>,
  <https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/>,
  <https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/>.
- Layout: "Corporate File Definitions", <https://dos.sunbiz.org/data-definitions/cor.html> (the
  old `.../data-downloads/corporate-data-file/` URL redirects there with a 301).
- Files: the Division's public SFTP server `sftp.floridados.gov` (port 22), user `Public`, with
  the password the Division publishes on its Data Downloads page (a published anonymous access
  route; nothing is created or agreed to). Confirmed by a real login and listing on 2026-11-02:
  - `doc/quarterly/cor/cordata.zip`: 1,793,034,019 bytes, dated 2026-10-07, the full corporate
    data file (the Division's page says it is regenerated in January, April, July and October and
    is "broken into 10 smaller files", one per last digit of the document number);
  - `doc/quarterly/cor/corevent.zip`: 195,000,143 bytes, the corporate event file (not loaded);
  - `doc/cor/YYYYMMDDc.txt`: daily files of the records filed or changed that day, about 0.5 to
    4.4 MB each, 1,399 of them in the top folder plus year folders back to 2011;
  - `WELCOME.TXT`, `doc/cor/README.TXT`, `doc/cor/99-README.TXT` (the READMEs point older records
    at `ftp://ftp.dos.state.fl.us/pub/doc/`, which was not tried).

## Terms, license, robots

- Terms: no licence is stated. The Division's data-downloads pages say (as rendered by a search
  engine's summary of the page; the page itself could not be read, see Gates) that the downloads
  are offered for informational purposes, are "offered as is and may be changed, replaced or
  deleted at any time". The SFTP banner, shown at login, says the system "is for authorized use
  only" and that "Any and all uses of this system [...] may, at any time and without prior notice,
  be intercepted, monitored, searched, recorded, copied, inspected, reviewed, blocked, and/or
  disclosed"; the `WELCOME.TXT` on the server says "UNAUTHORIZED ACCESS IS PROHIBITED". Access with
  the published `Public` login is the authorized route the Division itself documents. The data is
  public record under Fla. Stat. ch. 119.
- AI use: not addressed.
- Redistribution: not addressed; public record.
- robots.txt: `dos.fl.gov/robots.txt` could not be read (Cloudflare challenge, HTTP 403; the
  collector treats a 4xx robots.txt as "no rules" but then gets the same 403 on every page).
  `dos.sunbiz.org/robots.txt` is `User-agent: * / Disallow: /`: the layout page there was read once
  by hand for this review and must not be fetched by the collector. There is no robots.txt on an
  SFTP server; the collector does not speak SFTP.

## What the file contains

Fixed-length ASCII records of 1,440 characters (LF-terminated in the daily files), one per
corporate record, the same layout in the quarterly and daily files. Positions (1-based) and
lengths from the publisher's "Corporate File Definitions" page:

| #     | Field                  | Start | Len | Notes                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ---------------------- | ----- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Corporation Number     | 1     | 12  | "The corporate document number" (e.g. `L26000540950`, `P98000012345`)                                                                                                                                                                                                                                                                                                 |
| 2     | Corporation Name       | 13    | 192 |                                                                                                                                                                                                                                                                                                                                                                       |
| 3     | Status                 | 205   | 1   | `A` active, `I` inactive                                                                                                                                                                                                                                                                                                                                              |
| 4     | Filing Type            | 206   | 15  | `DOMP` Domestic Profit, `DOMNP` Domestic Non-Profit, `FORP` Foreign Profit, `FORNP` Foreign Non-Profit, `DOMLP` Domestic Limited Partnership, `FORLP` Foreign Limited Partnership, `FLAL` Florida Limited Liability Co., `FORL` Foreign Limited Liability Co., `NPREG` Non-Profit Registration, `TRUST` Declaration of Trust, `AGENT` Designation of Registered Agent |
| 5-10  | Principal address      | 221   | 126 | Address 1 (42), Address 2 (42), City (28), State (2), Zip (10), Country (2)                                                                                                                                                                                                                                                                                           |
| 11-16 | Mailing address        | 347   | 126 | same shape                                                                                                                                                                                                                                                                                                                                                            |
| 17    | File Date              | 473   | 8   | formation filing date (MMDDYYYY in the real file, although the page does not say)                                                                                                                                                                                                                                                                                     |
| 18    | FEI Number             | 481   | 14  | federal employer identification number (not loaded)                                                                                                                                                                                                                                                                                                                   |
| 19    | More than six officers | 495   | 1   |                                                                                                                                                                                                                                                                                                                                                                       |
| 20    | Last Transaction Date  | 496   | 8   |                                                                                                                                                                                                                                                                                                                                                                       |
| 21    | State Country          | 504   | 2   | state or country of formation                                                                                                                                                                                                                                                                                                                                         |
| 22-30 | Annual reports         | 506   | 39  | three (year, filler, date) sets                                                                                                                                                                                                                                                                                                                                       |
| 31-36 | Registered agent       | 545   | 124 | name (42), type `P` person / `C` corporation, address, city, state, zip+4 (not loaded)                                                                                                                                                                                                                                                                                |
| 37-78 | Officers 1-6           | 669   | 768 | title (`P T C V S D`), type, name, address, city, state, zip+4 (not loaded)                                                                                                                                                                                                                                                                                           |
| 79    | Filler                 | 1437  | 4   |                                                                                                                                                                                                                                                                                                                                                                       |

The page warns that "data for addresses and listed officers may not reflect the most current
information on sunbiz.org because of the limited space in the file."

Mapping to `EntityRecord` (an entity register: every record is in scope):

| Field                | Source                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry_number`    | Corporation Number (registry jurisdiction `us-fl`; URN `fl:entity:us-fl:<number, lower-cased>`)                                                 |
| `legal_name`         | Corporation Name                                                                                                                                |
| `status`             | Status: `A` → `active`, `I` → `inactive`, blank → unknown                                                                                       |
| `state_of_formation` | `FL` for Filing Type `DOMP`, `DOMNP`, `DOMLP`, `FLAL`; otherwise State Country when it is a US state/territory code                             |
| `mailing_address`    | Mail Address 1, Mail Address 2, Mail City, Mail State Mail Zip[, Mail Country if not `US`/`UN`]; when blank, the principal address the same way |
| `taxpayer_number`    | none (the FEI number is deliberately not loaded)                                                                                                |
| `locator`            | `<member file name> document <number>`                                                                                                          |

Officers and registered agents are not read: the type flag shows most are natural persons.

## Gates

- **Terms could not be read at the source.** Every request to `dos.fl.gov` from the collector
  (`FactLotRegistryBot/0.1`), from plain `curl` with the same user agent, and from the WebFetch
  tool receives a Cloudflare managed challenge ("Just a moment... Enable JavaScript and cookies to
  continue", HTTP 403), including `/robots.txt`. The data policy forbids working around bot
  detection, so the Data Downloads, Quarterly Data and Daily Data pages were not read directly;
  their content above comes from a search engine's rendering. The source stays `verified: false`
  until a person reads those three pages, records the terms and confirms the published login.
- **The collector cannot archive SFTP.** The files are only on `sftp.floridados.gov`; the
  collector's `snapshot` speaks HTTP(S) and would record `error: unknown url type: sftp` for the
  listed files (on 2026-11-02 it stopped earlier, at "skipped: source not verified"). Until SFTP
  support is added, a person (or a one-off script) downloads `cordata.zip`,
  records its SHA-256 and retrieval time, and passes it to the adapter with `--retrieved-at`.
- No account, fee, form or click-through is involved in the SFTP route; the login is the one the
  Division publishes for the public.

### Terms read 2026-11-03 (gates pass)

The three data-download pages rendered on a plain GET. Each was HTTP 200 and was the Division's HTML, not a Cloudflare challenge. An earlier capture (`fl.hdr` / `fl.txt`) is the same Data Downloads page, also HTTP 200.

**Data Downloads.** https://dos.fl.gov/sunbiz/other-services/data-downloads/ — read 2026-11-03.

> The Division of Corporations offers free data downloads for informational purposes. Downloads are offered as is and may be changed, replaced or deleted at any time.

> Quarterly files are generated quarterly in January, April, July, and October and contain all active data at the time the file is generated.

> Host: https://sftp.floridados.gov

> Username: Public

A password is printed on the page. It is not copied here. Nothing was logged in.

**Quarterly data.** https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/ — read 2026-11-03.

> They contain all data on record at the time the file is generated.

> Corporate data includes corporations, limited liability companies and limited partnerships.

Quarterly corporate filings are listed as "cordata.zip" at "doc > quarterly > cor".

**Daily data.** https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/ — read 2026-11-03. Daily corporate filings are "yyyymmddc.txt" at "doc > cor".

**Data Usage Guide.** https://dos.fl.gov/sunbiz/other-services/data-downloads/data-usage-guide/ — read 2026-11-03, HTTP 200.

> We provide our data as-is.

The footer on these pages is "Copyright © 2026 State of Florida, Florida Department of State." That line states no terms for the data files. AI use is not addressed. The pages do not forbid commercial use and do not forbid redistribution, and they do not grant a license.

**Address.** https://dos.fl.gov/sunbiz/contact/address-phone-numbers/ — read 2026-11-03, HTTP 200 (the dos.myflorida.com URL redirected to this page). "2415 N. Monroe Street, Suite 810", "The Centre of Tallahassee", mail "P.O. Box 6327" for the "Public Access Account" and other listed sections. Decoding the saved markup for the "Internet Support Section" row yields corphelp@dos.fl.gov.

**Statute.** Section 15.16, Florida Statutes (2026), https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0015/Sections/0015.16.html — read 2026-11-03. The title on the page is "Reproduction of records; admissibility in evidence; electronic receipt and transmission of records; certification; acknowledgment."

> E-mail addresses collected by the Department of State pursuant to this subsection are exempt from s. 119.07(1) and s. 24(a), Art. I of the State Constitution.

Section 607.0120, https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0600-0699/0607/Sections/0607.0120.html — read 2026-11-03. The heading includes "Filing requirements."

> A document must satisfy the requirements of this section and of any other section that adds to or varies these requirements to be entitled to filing by the department.

Chapter 119, sections 119.01(1) and 119.07(1)(a), read 2026-11-02 and quoted in `fl-dor-nal-GATES-addendum.md`, are silent on commercial use and silent on redistribution after the copy is obtained. Section 15.16 and section 607.0120, as read, are also silent on commercial use of the corporate data file and silent on redistribution of it.

The download pages offer the files free, for informational purposes, as is. They do not restrict redistribution of the public fields. The founder decides whether that, with chapter 119, is enough to load the corporate files. `fl-dos-entities-letter.md` is optional and was not sent. This lane does not recommend leaving the source unloaded on the words that were read.

## Real run

Run on 2026-11-02 (US Eastern evening; UTC 2026-11-03). **Sample, not the full file:** the
machine used for this review had about 80 KB/s of shared bandwidth; `cordata.zip` (1.79 GB)
reached 3.6 MB in three minutes and was abandoned. Three daily files were fetched instead with
OpenSSH `sftp` (user `Public`, the published login), copied to `collected/fl-dos-entities/<sha16>/`
and recorded by hand in `collected/fl-dos-entities/manifest.jsonl` in the collector's shape
(`"collector": "manual-sftp"`):

| File (`doc/cor/`) | Bytes     | Document id                                                                           | Retrieved (UTC)     |
| ----------------- | --------- | ------------------------------------------------------------------------------------- | ------------------- |
| `20261027c.txt`   | 3,971,396 | `fl:document:sha256-b1898d630026176ca1e0c93b8cb933713b0864868e6bb29c9aabe382080ffbca` | 2026-11-03T01:28:04 |
| `20261028c.txt`   | 4,376,317 | `fl:document:sha256-8bec616f01f8c15bd0ca536d272159be45dd0b3de51da2b612fa86a31a17517d` | 2026-11-03T01:33:14 |
| `20261029c.txt`   | 4,054,974 | `fl:document:sha256-c0640c7279dfa808a2d99960d7f14f2c68d3adb6a1f42a49ec5684b478e89e97` | 2026-11-03T01:35:37 |

- Collector `discover` on the three landing pages: `error: HTTP Error 403: Forbidden` for each
  (the Cloudflare challenge), 0 links. `snapshot`: "skipped: source not verified".
- `fl_dos_entities.build(...)` once per file, in date order, into one registry (as-of = the
  file's date): 2,756 + 3,037 + 2,814 = **8,607 records read, 8,607 entities kept**, skipped
  invalid 0, facts written 13,780 + 15,184 + 14,069 = 43,033 (five facts per entity: legal name,
  registry number, state of formation, mailing address, status), owner links 0 (no parcel data
  in the test registry), under 1 second per file. Entity register, so no category split and no
  organisation-owner count. The three files hold 8,607 distinct document numbers (no entity
  appeared on two of the three days).
- In the sample: status active 8,607 (daily files carry new filings, so no inactive records
  appeared); filing types FLAL 7,608, DOMP 418, FORL 290, DOMNP 174, FORP 100, FORNP 8, DOMLP 5,
  FORLP 2, TRUST 1, AGENT 1; state of formation FL 8,206, DE 173, WY 29, TX 27, GA 14, NY 13;
  every record had a mailing address (none fell back to the principal address). Mail Country
  values seen: `US` 5,540, blank 2,736, `UN` 257, `Us` 17, `FL` 13, so the adapter ignores
  those four when deciding whether to append a country to an address.
- Extrapolated: the full quarterly file (about 13 million records) would ingest in roughly
  40 minutes at the sample's rate.

## Known gaps

- Sample only: the full `cordata.zip` (1.8 GB) could not be fetched on this machine's connection in
  the brief's time budget; the real run used daily files. A run on the quarterly file is needed for
  the full count (about 13 million records are expected from the file size; one secondary source
  reports a full parse of 12,987,601 records of the October 2026 file).
- Daily files carry filings and changes of the day; an entity appears in several daily files, and
  the later record wins when the files are ingested in date order.
- No entity-type field in `EntityRecord`: the Filing Type is parsed (`FILING_TYPES`) but not stored.
- File Date, Last Transaction Date, annual-report fields, FEI number, registered agent and
  officers are not stored.
- The principal-address State field is blank in the recent daily records (the city carries the
  state in the mailing block); addresses are kept as the publisher writes them.
- `corevent.zip` (name changes, mergers, dissolutions with dates) is not loaded; it would give
  historical names for owner matching.
