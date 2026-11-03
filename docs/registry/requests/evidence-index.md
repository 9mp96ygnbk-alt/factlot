# Evidence index, Tier 1 gates pass

Every page fetched for this pass, one plain GET each (one retry only after a transport error or timeout), read 2026-11-03. The saved page bodies stay on the review box (`/workspace/factlot-tier1/lanes/<lane>/evidence/`) and are not committed, because some contain officials' names. HTTP code is what the server returned; a 200 can still be a JavaScript or challenge shell, which the memo that relies on the page says.

This memo is research, not legal advice; the founder holds no attorney or real estate license.

| lane | saved as | HTTP | URL | what it is |
| --- | --- | --- | --- | --- |
| A | fl-dor-contact.html | 200 | https://floridarevenue.com/property/Pages/contactUs.aspx | FDOR Property Tax Oversight contact page |
| A | fl-dor-dataportal.html | 200 | https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx | FDOR Download Assessment Roll and GIS Data page |
| A | il-cook-foia.html | 200 | https://www.cookcountyassessoril.gov/foia-freedom-information | CCAO Freedom of Information page |
| A | il-cook-pabr-t5kh.json | 200 | https://datacatalog.cookcountyil.gov/api/views/pabr-t5kh.json | Socrata metadata Assessor Parcel Universe Current |
| A | il-cook-uzyt-m557.json | 200 | https://datacatalog.cookcountyil.gov/api/views/uzyt-m557.json | Socrata metadata Assessor Assessed Values |
| A | il-cook-3723-97qp.json | 200 | https://datacatalog.cookcountyil.gov/api/views/3723-97qp.json | Socrata metadata Assessor Parcel Addresses |
| A | il-cook-csik-bsws.json | 200 | https://datacatalog.cookcountyil.gov/api/views/csik-bsws.json | Socrata metadata Assessor Commercial Valuation Data |
| A | il-ptc-9.html | 000 | https://www.ilga.gov/legislation/ILCS/details?MajorTopic=&Ch… (Radware challenge redirect, truncated) | 35 ILCS 200 sections including 9-20 and 9-25 |
| A | pa-phila-open-records.html | 200 | https://www.phila.gov/open-records-policy/ | City of Philadelphia Open Records Policy |
| A | pa-odp-about.html | 200 | https://opendataphilly.org/about/ | OpenDataPhilly about and terms |
| A | ga-ag-law.html | 200 | https://law.georgia.gov/key-issues/open-government/law | Georgia AG Open Government The Law page |
| A | ga-ag-ora.pdf | 403 | https://law.georgia.gov/sites/law.georgia.gov/files/AG-%23872100-v1-OPENGOV__Open_Records_Act_March_2016.pdf | Georgia AG Open Records Act PDF March 2016 |
| A | ga-ag-ora-agr.pdf | 200 | https://agr.georgia.gov/sites/default/files/documents/assets/AG-872100-v1-OPENGOV__Open_Records_Act_March_2016%20%282%29.pdf | Open Records Act PDF mirrored on agr.georgia.gov |
| A | ga-fulton-ora-2024.pdf | 200 | https://www.fultoncountyga.gov/-/media/Files/Open-Records-Act-October-2024.pdf | Fulton County copy of Open Records Act October 2024 |
| A | ga-legis-t50.pdf | 200 | https://www.legis.ga.gov/api/document/docs/default-source/joint-features-document-library/t50-ch13-40-%28v38a%29-pdf.pdf | Georgia General Assembly Title 50 code PDF |
| A | ga-fulton-boa.html | 200 | https://www.fultoncountyga.gov/boardofassessors | Fulton County Board of Assessors page |
| A | ga-fulton-orr.html | 200 | https://www.fultoncountyga.gov/Inside-Fulton-County/Fulton-County-Departments/Office-of-the-County-Attorney/Open-Records-Requests | Fulton County open records requests page |
| A | fl-dos-downloads.html | 200 | https://dos.fl.gov/sunbiz/other-services/data-downloads/ | Sunbiz Data Downloads |
| A | fl-dos-quarterly.html | 200 | https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/ | Sunbiz Quarterly Data |
| A | fl-dos-daily.html | 200 | https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/ | Sunbiz Daily Data |
| A | fl-dos-address.html | 200 | https://dos.fl.gov/sunbiz/contact/address-phone-numbers/ | DOS Division of Corporations addresses on dos.fl.gov |
| A | fl-dos-address-myflorida.html | 200 | https://dos.fl.gov/sunbiz/contact/address-phone-numbers/ | DOS Division of Corporations addresses on dos.myflorida.com |
| A | fl-stat-15-16.html | 200 | https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0015/Sections/0015.16.html | Fla. Stat. s. 15.16 |
| A | fl-stat-607-0120.html | 200 | https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0600-0699/0607/Sections/0607.0120.html | Fla. Stat. s. 607.0120 |
| A | il-ptc-9.html | 000 | https://www.ilga.gov/legislation/ILCS/details?MajorTopic=&Ch… (Radware challenge redirect, truncated) | RETRY once: 35 ILCS 200 sections including 9-20 and 9-25 |
| A | ga-ag-ora-here3.pdf | 200 | https://law.georgia.gov/document/here-3/download | Georgia AG Open Records Act PDF linked from The Law page |
| A | pa-rtkl-act-3-of-2008.txt | local | repo:docs/registry/requests/forms/pa-rtkl-act-3-of-2008.pdf | pdftotext of Act 3 of 2008 PDF already saved 2026-11-02; not re-fetched |
| A | fl-dos-usage.html | 200 | https://dos.fl.gov/sunbiz/other-services/data-downloads/data-usage-guide/ | Sunbiz Data Usage Guide linked from Data Downloads |
| A | pa-odp-dataset.html | 200 | https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/ | OpenDataPhilly dataset page Philadelphia Properties and Assessment History |
| B | wayne-foia.html | 403 | https://www.waynecountymi.gov/Services/Records/FOIA-Request-Form-General | Wayne County FOIA request form page; Access Denied |
| B | alameda-contact.html | 403 | https://www.acassessor.org/about-us/visit-or-contact-us/ | Alameda County Assessor contact page; 403 Forbidden |
| B | riverside-mapbook.html | 200 | https://www.rivcoacr.org/mapbookchanges | Riverside County Assessor map-book page with mailing address |
| B | sb-office.html | 200 | https://arc.sbcounty.gov/san-bernardino-assessor-district-office/ | San Bernardino Assessor district office address |
| B | ca-gov-7921.000.html | 403 | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=7921.000. | Gov. Code 7921.000; Cloudflare Just a moment |
| B | alameda-feeschedule.pdf | 200 | https://www.acgov.org/forms/assessor/feeschedule.pdf | Alameda County Assessor fee schedule PDF, effective 2016-01-01 |
| B | wayne-foia-summary.pdf | 403 | https://www.waynecountymi.gov/files/assets/mainsite/v/1/clerk/documents/records/summary_of_foia_procedures_and_guidelines.pdf | Wayne County FOIA procedures summary; Access Denied HTML saved under this name |
| B | alameda-assessor.html | 403 | https://assessorprd.wpengine.com/ | Requested https://www.acgov.org/assessor/ ; final host 403 Forbidden |
| B | wayne-nextrequest.html | 204 | https://waynecountymi.nextrequest.com/ | Wayne County NextRequest portal; empty body |
| C | clark-datafiles.html | 200 | https://www.clarkcountynv.gov/government/assessor/datafiles | Clark County Assessor data files landing page |
| C | nc-subscription.html | 200 | https://www.sosnc.gov/online_services/data_subscriptions/business_registration_data_subscriptions | NC SOS business registration data subscription page |
| C | nc-about.html | 200 | https://www.sosnc.gov/online_services/data_subscriptions/about_the_data | NC SOS about the data page |
| C | nc-fees.html | 200 | https://www.sosnc.gov/fees/by_title/_data_subscriptions | NC SOS data subscription fees |
| C | nc-disclaimer.html | 200 | https://www.sosnc.gov/Home/Disclaimer | NC SOS disclaimer and privacy |
| C | nc-dictionaries.html | 200 | https://www.sosnc.gov/online_services/data_subscriptions/data_dictionaries | NC SOS data dictionaries |
| C | scc-bulk.html | 403 | https://asr.santaclaracounty.gov/about-us/purchase-data/bulk-data | Santa Clara Assessor bulk data order page |
| C | scc-subset.html | 403 | https://asr.santaclaracounty.gov/about-us/purchase-data/bulk-data-by-jurisdiction | Santa Clara Assessor subset data order page |
| C | scc-fees.html | 403 | https://asr.santaclaracounty.gov/about-us/purchase-data/fee-schedule | Santa Clara Assessor fee schedule page |
| C | oc-roll.html | 200 | https://www.ocassessor.gov/page/assessor-roll-products | Orange County Assessor roll products |
| C | oc-pra.html | 200 | https://www.ocassessor.gov/contact-us/assessor-public-records | Orange County Assessor public records |
| C | oc-privacy.html | 200 | https://www.ocassessor.gov/news-information/privacy-statement | Orange County Assessor privacy statement |
| C | oc-property.html | 200 | https://www.ocassessor.gov/page/property-information-and-parcel-maps | Orange County property information and ParcelQuest handoff |
| C | sd-property.html | 200 | https://www.sdarcc.gov/content/arcc/home/divisions/assessor/property-records.html | San Diego ARCC property records |
| C | sd-fees.html | 200 | https://www.sdarcc.gov/content/arcc/home/wantto/assessor-fee-schedule.html | San Diego ARCC assessor fee schedule |
| C | sd-pq.html | 200 | https://www.sdarcc.gov/content/arcc/home/divisions/assessor/parcel-quest-disclaimer.html | San Diego ARCC ParcelQuest disclaimer |
| C | sangis-home.html | 200 | https://www.sangis.org/ | SanGIS home |
| C | sangis-download.html | 200 | https://www.sangis.org/pages/download-data | SanGIS download data |
| C | sangis-legal-old.html | 404 | https://www.sangis.org/Legal_Notice.htm | SanGIS legal notice legacy URL |
| C | la-datasales.html | 200 | https://assessor.lacounty.gov/real-estate-toolkit/data-sales | LA County Assessor data sales page |
| C | ca-sos-records.html | 200 | https://www.sos.ca.gov/business-programs/business-entities/information-requests | CA SOS business entities records request |
| C | ca-sos-info.html | 200 | https://www.sos.ca.gov/business-programs/business-entities/information-requests | CA SOS information requests |
| C | ma-corp.html | 200 | https://www.sec.state.ma.us/divisions/corporations/corporations.htm | MA Corporations Division page |
| C | ma-law.html | 403 | https://www.mass.gov/info-details/massachusetts-law-about-corporations | Mass.gov corporations law page |
| C | nv-commercial.html | 200 | https://www.nvsos.gov/sos/commercial-recordings | NV SOS commercial recordings |
| C | nv-prr.html | 200 | https://www.nvsos.gov/sos-information/public-records-requests | NV SOS public records requests |
| C | nv-pricing.html | 200 | https://www.nvsos.gov/SOSServices/AnonymousAccess/PricingGuide.aspx | NV SOS bulk data pricing guide |
| C | nv-forms.html | 200 | https://www.nvsos.gov/businesses/commercial-recordings/forms-fees | NV SOS commercial recordings forms and fees |
| C | ga-bulk.html | 200 | https://georgia.gov/bulk-corporations-data | Georgia bulk corporations data page |
| C | az-prr.html | 200 | https://azcc.gov/public-records-request | Arizona Corporation Commission public records request page |
| C | mn-data.html | 200 | https://validate.perfdrive.com/?ssa=9bce7061-f8c3-457a-98cf-… (Radware challenge redirect, truncated) | Minnesota SOS business data available page |
| C | clark-fee-schedule.pdf | 200 | https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:b0ee0f69-d7f2-4964-9270-62bb255d8bea/original/as/fee-schedule-rev-07-01-24.pdf | Clark Assessor fee schedule effective 2024-07-01 |
| C | clark-request-for-data.pdf | 200 | https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:abd79829-9f33-4654-9bd3-6f4f715ce4e4/original/as/request-for-data.pdf | Clark Assessor request-letter requirements |
| C | clark-data-notice.pdf | 200 | https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:0f43eec9-ecbe-4d85-aa6c-5a19a1edd6f4/original/as/data-notice.pdf | Clark Assessor data notice |
| C | clark-data-request-form.pdf | 200 | https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:48f47366-82d9-459a-bbc6-5594e33020ee/original/as/data-request-form19-editable.pdf | Clark Assessor data request form |
| C | clark-aoextract-description.pdf | 200 | https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:97e18ac2-17dd-4389-a037-7f92214d53f9/original/as/aoextract-description.pdf | Clark AOExtract description |
| C | la-order-form.pdf | 200 | https://res.cloudinary.com/los-angeles-county-assessor/image/upload/v1628093490/Form/Standard_Order_Form.pdf | LA County Assessor data sales order form and agreement |
| C | scc-order-form-2021.pdf | 403 | https://asr.santaclaracounty.gov/ | Santa Clara Data File Order Form 2021 |
| C | scc-fy2526-fee-schedule.pdf | 403 | https://files.santaclaracounty.gov/exjcpb1531/2026-02/fy-2025-2026-countywide-master-fee-schedule.pdf?VersionId=JJDcTGki15sFK.2nqOtSbbYc05LtUa7j | Santa Clara County FY2025-2026 countywide master fee schedule |
| C | az-m027.pdf | 200 | https://www.azcc.gov/docs/default-source/corps-files/forms/m027-database-extraction-request4afa009930ae4583a9310593ba4c65ce.pdf?sfvrsn=73637fee_6 | Arizona Corporation Commission form m027 database extraction |
| C | ga-agreement.pdf | 200 | https://georgia.gov/document/document/bulk-corporations-data-sales-agreement/download | Georgia Technology Authority bulk corporate data sales agreement |
| C | mn-commercial.pdf | 200 | https://www.sos.mn.gov/media/5124/bulkrequestcorp_commercialusers.pdf | Minnesota SOS commercial bulk order form |
| C | mn-noncommercial.pdf | 200 | https://www.sos.mn.gov/media/5123/bulkrequestcorp_non-paying.pdf | Minnesota SOS noncommercial bulk order form |
| C | mn-license.pdf | 200 | https://www.sos.mn.gov/media/5125/business-bulk-la.pdf | Minnesota SOS electronic media license |
| C | sd-fee-schedule.pdf | 200 | https://www.sdarcc.gov/content/dam/arcc/assessor/forms/other-assessor-forms/PUB%20INFO%20FEE%20SCHEDULE.pdf | San Diego ARCC public information fee schedule PDF |
| C | sangis-privacy.html | 404 | https://sangis.org/privacy.html | SanGIS privacy policy |
| C | sangis-pricelist.pdf | 200 | https://gis.sangis.org/Documents/services/PriceList.pdf | SanGIS services price list |
| C | ca-sos-be-records.html | 200 | https://www.sos.ca.gov/administration/public-records-act-requests/business-entity-records | CA SOS business entity records and bulk order page |
| C | ca-sos-bizfile-terms.html | 200 | https://www.sos.ca.gov/business-programs/bizfile/privacy-warning-terms-and-conditions-use | CA SOS bizfile privacy warning and terms |
| C | ca-sos-bizfile.html | 200 | https://www.sos.ca.gov/business-programs/bizfile | CA SOS bizfile hub |
| C | ca-sos-help.pdf | 200 | https://bpd.cdn.sos.ca.gov/ucc/ucc-online-help.pdf | CA SOS bizfile online portal manual |
| C | ma-113-15.html | 200 | https://www.law.cornell.edu/regulations/massachusetts/950-CMR-113.15 | Cornell LII copy of 950 CMR 113.15 |
| C | ma-cmr-official.html | 403 | https://www.mass.gov/regulations/950-CMR-11300 | Mass.gov 950 CMR 113 regulations |
| C | nrs-239.html | 200 | https://www.leg.state.nv.us/nrs/nrs-239.html | Nevada NRS chapter 239 public records |
| C | nc-132-1.html | 200 | https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_132/GS_132-1.html | N.C.G.S. 132-1 public records |
| C | nc-132-6-2.html | 200 | https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_132/GS_132-6.2.html | N.C.G.S. 132-6.2 database copies |
| C | ars-39-121-03.html | 200 | https://www.azleg.gov/ars/39/00121-03.htm | A.R.S. 39-121.03 commercial purpose |
| C | mn-13-03.html | 200 | https://www.revisor.mn.gov/statutes/cite/13.03 | Minn. Stat. 13.03 access to government data |
| C | ca-gov-7922-530.html | 403 | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=7922.530. | Cal. Gov. Code 7922.530 |
| C | ca-rtc-408.html | 403 | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=RTC&sectionNum=408. | Cal. Rev. and Tax. Code 408 |
| C | ca-rtc-408-3.html | 403 | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=RTC&sectionNum=408.3. | Cal. Rev. and Tax. Code 408.3 |
| C | ca-gov-7928-205.html | 403 | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=7928.205. | Cal. Gov. Code 7928.205 |
| C | pq-orange.html | 200 | https://assr.parcelquest.com/Home/UserAgreement/iFrame%3d0 | Orange County ParcelQuest continue link; redirected to user-agreement shell; I Accept not clicked |
| C | pq-sandiego.html | 200 | https://assr.parcelquest.com/Home/UserAgreement/iFrame%3d0 | San Diego County ParcelQuest continue link; same shell; I Accept not clicked |
| C | pq-disclaimer.html | 200 | https://assr.parcelquest.com/Home/Disclaimer?iframe=2 | ParcelQuest Lite user agreement text returned by GET; I Accept not clicked |
| D | az-ars-39-121-03.html | 200 | https://www.azleg.gov/ars/39/00121-03.htm | A.R.S. 39-121.03 |
| D | wa-king-download.html | 200 | https://info.kingcounty.gov/assessor/DataDownload/default.aspx | King County Assessor data-download acknowledgement |
| D | wa-king-terms.html | 200 | https://kingcounty.gov/en/shared-topics/about-king-county/website/terms-of-use | King County website terms of use |
| D | wa-rcw-42-56-070.html | 200 | https://app.leg.wa.gov/rcw/default.aspx?cite=42.56.070 | RCW 42.56.070 |
| D | wa-king-contact.html | 200 | https://kingcounty.gov/en/dept/assessor/about-king-county/about-king-county-assessor/contact | King County Assessor contact |
| D | wa-king-prr.html | 200 | https://kingcounty.gov/en/dept/assessor/about-king-county/about-king-county-assessor/public-records-requests | King County Assessor public records requests |
| D | va-cis.html | CURL_35 | https://cis.scc.virginia.gov/ | Virginia SCC CIS home |
| D | va-cookie.html | CURL_35 | https://cis.scc.virginia.gov/Cookie/CookieConsent | Virginia SCC cookie consent |
| D | va-purch.html | CURL_35 | https://appspre.scc.virginia.gov/clk/purch.aspx | Virginia SCC data purchase page |
| D | va-clerk.html | 200 | https://www.scc.virginia.gov/businesses/about-the-clerks-office/ | Virginia SCC Clerk office page |
| D | bcad-pia.html | 403 | https://help.bcad.org/hc/en-us/articles/55264219130899-What-is-a-Public-Information-Act-Request | Bexar CAD public information help article |
| D | bcad-pir-form.pdf | 200 | https://bcad.org/wp-content/uploads/2025/10/Public_Information_Request_10-2025.pdf | Bexar CAD public information request form |
| D | tx-gv-552.html | 200 | https://statutes.capitol.texas.gov/Docs/GV/htm/GV.552.htm | Texas Government Code chapter 552 |
| D | datasf-terms.html | 200 | https://www.sf.gov/reports--april-2017--datasf-terms-use | DataSF terms of use |
| D | dc-data-terms.html | 200 | https://dc.gov/page/terms-and-conditions-use-district-data | DC terms for District data |
| D | tyler-socrata.html | 200 | https://www.tylertech.com/terms/socrata-terms-of-service | Tyler Socrata terms of service |
| D | ilsos-privacy.html | CURL_92 | https://www.ilsos.gov/privacypolicy.html | Illinois SOS privacy policy and terms of use |
| D | esri-e204.pdf | 200 | https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf | Esri E204 click-through master agreement |
| D | ilsos-privacy.html | CURL_28 | https://www.ilsos.gov/privacypolicy.html | Illinois SOS privacy policy and terms of use (HTTP/1.1 after HTTP/2 abort) |
| D | ilsos-data.html | CURL_28 | https://www.ilsos.gov/data/bus-serv-home.html | Illinois SOS Data Transparency Act page |
| D | ilsos-bs.html | CURL_28 | https://www.ilsos.gov/departments/business-services.html | Illinois SOS Business Services index |
| D | esri-e300.pdf | 200 | https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf | Esri E300 product-specific terms |
| D | esri-master.html | 200 | https://www.esri.com/en-us/legal/terms/master-agreement | Esri master agreement index |
| D | esri-scope.html | 200 | https://www.esri.com/en-us/legal/terms/product-specific-scope-of-use | Esri product-specific scope of use page |
| D | mi-corps.html | 200 | https://www.michigan.gov/lara/bureau-list/cscl/corps | Michigan LARA Corporations Division |
| D | mi-datasets.html | 200 | https://www.michigan.gov/lara/about/reports-data-sets | Michigan LARA reports and data sets |
| D | mi-foia.pdf | 200 | https://www.michigan.gov/-/media/Project/Websites/lara/Folder6/FOIA_Procedure_and_Guidelines.pdf?rev=52c103df14ab44b19a78a11ee52f2b6b | LARA FOIA procedures and guidelines |
| D | bcad-home.html | 200 | https://bcad.org/ | Bexar Appraisal District home |
| D | bcad-pia-2026.pdf | 200 | https://bcad.org/wp-content/uploads/2026/04/BCAD-Public-Information-Act-Request.pdf | Bexar CAD Open Records Request form linked from homepage |
| X | tx-552-2615.html | 200 | https://texas.public.law/statutes/tex._gov't_code_section_552.2615 | Gov't Code 552.2615, unofficial compilation (used because the official page is a JS shell) |
| X | not saved (WebFetch) | 200 | https://law.georgia.gov/document/here-3/download | Georgia AG Open Records Act compilation (O.C.G.A. 50-18-70, -71) |
| X | not saved | none | https://www.ilsos.gov/data/bus-serv-home.html | Illinois SOS bulk data page; timed out, zero bytes |
| X | tx-gv-552.pdf | 200 | statutes.capitol.texas.gov (ch. 552 PDF path; exact path not recorded) | Official Gov't Code ch. 552 PDF path; returned the site's HTML shell, not a PDF |
