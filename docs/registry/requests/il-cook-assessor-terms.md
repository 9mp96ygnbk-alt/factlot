# Cook County Assessor open data (`il-cook-assessor`): terms decision memo

Date read: 2026-11-03 (earlier captures 2026-11-02 as marked). Prepared for: the founder.
This memo is research, not legal advice; the founder holds no attorney or real estate license.

## What the publisher's terms say

Four view-metadata files on the Cook County Open Data portal, each read 2026-11-03, attribute the dataset to the Assessor and contain no key named license. Each file includes the line `"attribution" : "Cook County Assessor's Office",` and the line `"rights" : [ "read" ],`. That `rights` array is the permission flag printed in the metadata. It is not a copyright or redistribution clause. The dataset names and URLs are:

- "Assessor - Parcel Universe (Current)", https://datacatalog.cookcountyil.gov/api/views/pabr-t5kh.json
- "Assessor - Assessed Values", https://datacatalog.cookcountyil.gov/api/views/uzyt-m557.json
- "Assessor - Parcel Addresses", https://datacatalog.cookcountyil.gov/api/views/3723-97qp.json
- "Assessor - Commercial Valuation Data", https://datacatalog.cookcountyil.gov/api/views/csik-bsws.json

The portal's Terms of Use link goes to https://www.cookcountyil.gov/terms-use (read 2026-11-02). Section 7 includes "system. By use of this system and any data contained therein, you agree that your use shall" and "conform to all applicable laws and regulations and you shall not violate the rights of any" and "third parties." Section 10 includes "The content of County websites is copyrighted and may contain some third party content that is" and "the need to obtain permission from the copyright holder before reproducing or otherwise using" and "images/graphics from this website." The notes state: "Nothing in the ten sections addresses redistribution of datasets, automated access or AI use." AI use is not addressed. The copyright sentence that was read is about images and graphics.

The FOIA page, https://www.cookcountyassessoril.gov/foia-freedom-information (read 2026-11-03), says "Members of the public are encouraged to file FOIA requests via the GovQA platform linked here." Mail goes to "CCAO Freedom of Information Officer", "118 North Clark Street", "Chicago, Illinois 60602", and "Via Fax: (312) 603-3616". No public email is printed. The page says: "The Property Tax Code Section 9-20 allows a charging of a “…reasonable fee established by the custodian…” for property record cards." The full text of 35 ILCS 200/9-20 and 9-25 was NOT READ. Curl to the Illinois General Assembly page failed TLS verification twice (curl error 60; OpenSSL verify return code 21). The URL for the founder is https://www.ilga.gov/legislation/ILCS/details?ActID=596&ChapAct=35+ILCS+200%2F&SeqStart=12100000&SeqEnd=13500000.

## What the statute says

Illinois FOIA, 5 ILCS 140, as read 2026-11-02. Section 3(a), https://www.ilga.gov/Documents/legislation/ilcs/documents/000501400K3.htm, includes "or otherwise, the exclusive right to access and disseminate any public record as defined in". Section 3(c) includes "except to determine whether the records are requested for a commercial purpose or whether to" and "grant a request for a fee waiver."

Section 3.1, "Requests for commercial purposes", https://www.ilga.gov/Documents/legislation/ilcs/documents/000501400K3.1.htm, includes "commercial purpose without disclosing that it is for a commercial purpose, if requested to do so" and "by the public body." That is a disclosure rule for a request. The sections read are silent on redistribution of a record once obtained. Section 1, https://www.ilga.gov/Documents/legislation/ilcs/documents/000501400K1.htm, includes "commercial enterprise to unduly burden public resources". The four datasets are already posted. The draft letter discloses the commercial purpose anyway.

## Options

1. Use as a public record.
2. Ask the publisher for a written statement (letter: `il-cook-assessor-letter.md`).
3. Do not load.

## Recommendation

Send the letter and leave `verified` false until the Assessor's Office answers or you decide that public-record status is enough. No open-data license field is attached to the four views. Section 10 claims copyright and then tells users to presume they need permission before reproducing images and graphics. In the words read, it does not state a redistribution rule for these datasets.

## Risk if wrong

If you publish and a court treats the parcel tables as copyrighted "content" under section 10, the registry would be outside the permission language the County wrote for images and graphics. If you wait and section 10 covers only images and graphics, Cook County commercial parcels stay out of the published registry. Section 3.1 is a separate risk if a records request is made and the commercial purpose is withheld after the office asks.
