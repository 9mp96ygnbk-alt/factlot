# Florida Division of Corporations, Sunbiz (`fl-dos-entities`): terms decision memo

Date read: 2026-11-03 (earlier captures 2026-11-02 as marked). Prepared for: the founder.
This memo is research, not legal advice; the founder holds no attorney or real estate license.

## What the publisher's terms say

The three pages the task named rendered on a plain GET on 2026-11-03. Each returned HTTP 200 and the Division's HTML, not a Cloudflare challenge:

- https://dos.fl.gov/sunbiz/other-services/data-downloads/
- https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/
- https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/

An earlier capture, `fl.hdr`, is HTTP 200, and `fl.txt` is that same page. This memo quotes this lane's fetch.

The Data Downloads page says: "The Division of Corporations offers free data downloads for informational purposes. Downloads are offered as is and may be changed, replaced or deleted at any time." It also says: "Quarterly files are generated quarterly in January, April, July, and October and contain all active data at the time the file is generated." The quarterly page says: "They contain all data on record at the time the file is generated." Both pages say: "Corporate data includes corporations, limited liability companies and limited partnerships." The quarterly corporate file is "cordata.zip" at "doc > quarterly > cor". Daily corporate filings are "yyyymmddc.txt" at "doc > cor".

The pages print "Host: https://sftp.floridados.gov" and "Username: Public", and a password. The password is not repeated in this memo.

The Data Usage Guide, https://dos.fl.gov/sunbiz/other-services/data-downloads/data-usage-guide/ (read 2026-11-03, HTTP 200), says "We provide our data as-is." It does not add a non-commercial limit, a redistribution ban, or a license grant. The footer on these pages is "Copyright © 2026 State of Florida, Florida Department of State." That line does not state terms for the data files. AI use is not addressed.

The contact page, https://dos.fl.gov/sunbiz/contact/address-phone-numbers/ (read 2026-11-03; the dos.myflorida.com URL redirected there), gives "2415 N. Monroe Street, Suite 810" and "The Centre of Tallahassee". Mail for listed sections, including the "Public Access Account", is "P.O. Box 6327". Section emails are obfuscated in the HTML. Decoding the saved markup for the "Internet Support Section" row yields corphelp@dos.fl.gov.

## What the statute says

Chapter 119, sections read 2026-11-02 and quoted in the Florida DOR memo, requires any person to be allowed to inspect and copy public records. Those sections are silent on commercial use and silent on redistribution after the copy is obtained.

Section 15.16, Florida Statutes (2026), https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0015/Sections/0015.16.html (read 2026-11-03), is titled "Reproduction of records; admissibility ; electronic receipt and transmission of records; certification; acknowledgment." It says the Department "may cause to be made copies of any records maintained by it". Subsection (3)(c)1 says: "E-mail addresses collected by the Department of State pursuant to this subsection are exempt from s. 119.07(1) and s. 24(a), Art. I of the State Constitution." The section is silent on commercial use of the corporate data file and silent on redistribution of it.

Section 607.0120, https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0600-0699/0607/Sections/0607.0120.html (read 2026-11-03), is headed "Filing requirements." It says "A document must satisfy the requirements of this section and of any other section that adds to or varies these requirements to be entitled to filing by the department." It is silent on bulk redistribution and silent on commercial use of filed records.

## Options

1. Use as a public record.
2. Ask the publisher for a written statement (letter: `fl-dos-entities-letter.md`).
3. Do not load.

## Recommendation

The pages that rendered do not forbid commercial use and do not forbid redistribution. They also do not grant a license. "for informational purposes" and "as is" are the only use words on the Data Downloads page. The one decision is whether chapter 119 is enough to load the corporate files. Send `fl-dos-entities-letter.md` only if you want a written answer before `verified` is set. This lane does not recommend option 3 on the words that were read.

## Risk if wrong

If "for informational purposes" is later read as a limit on building a commercial registry, publishing derived entity facts would be outside that phrase. If it is only a description of the download, waiting on a letter delays the Florida entity file for a clause that states no non-commercial limit and no redistribution ban. The SFTP password on the public page can change; this memo does not store it.
