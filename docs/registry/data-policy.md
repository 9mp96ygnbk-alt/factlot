# Registry data policy

The FactLot Registry is built only from data we are allowed to collect and allowed to share,
gathered in ways a data publisher would recognize as fair. These rules are binding for every
source adapter. When a rule and a deadline conflict, the rule wins.

## 1. Where data may come from

Allowed, in order of preference:

1. **Official bulk downloads and open-data portals.** Examples: appraisal-district data exports,
   state open-data portals, and statewide parcel datasets published by state GIS offices.
2. **Official public APIs**, used within their published terms and rate limits.
3. **Public-records requests.** For example, a Texas Public Information Act request (Gov't Code
   ch. 552) for data that is not published in bulk.
4. **Data contributed by customers about their own properties,** with permission recorded.
   Contributed data never becomes public without explicit consent.

Not allowed:

- **No circumventing access controls.** That rules out logging in with someone else's account,
  solving or bypassing CAPTCHAs, rotating IPs to evade rate limits, and spoofing identity.
- **No scraping where a site's terms or robots.txt forbid it.** If a site offers no bulk option and
  forbids automated access, we file a records request instead.
- **No purchased, leaked, or resold data whose license we cannot verify.**
- **No data whose license forbids redistribution or AI use** in the open registry. Data like that
  may only ever be used in a separate, licensed layer, and then only if the license allows it.

## 2. How we collect

- **Identify ourselves.** Every request carries a `User-Agent` of the form
  `FactLotRegistryBot/<version> (+https://factlot.com/registry; contact@factlot.com)`.
- **Be polite.** Download each dataset once per publication cycle. Send at most one request per
  second to any host unless the publisher says otherwise. Use off-peak hours for large files.
- **Keep the evidence.** Each downloaded file becomes a content-addressed snapshot
  (`fl:document:sha256-…`) with its source URL, retrieval time, and as-of date. Every fact derived
  from it cites that snapshot and the record it came from.

## 3. What we keep (commercial scope and privacy)

- **Commercial property only.** The registry ingests parcels whose Texas state property category
  is commercial (F1), industrial (F2), or multifamily (B), plus the legal entities that own them.
  Single-family homes and other residential property are excluded by default.
- **People are not the product.** When the owner of record is a natural person, the registry keeps
  the parcel but does not store the owner: the person's name, mailing address and any ownership
  link are dropped, not just left out of search. A name is read as a person unless it is clearly
  an organisation; a trade name that is a person's own name and a generic business word ("SMITH
  JOHN PROPERTIES") is read as a person. It never compiles profiles of individuals.
- **No person on a stored address.** An organisation's mailing address can name a person ("ATTN
  JANE DOE", "C/O JOHN SMITH"). Ingest removes each such contact, with its marker, unless the name
  is clearly an organisation ("C/O ACME MANAGEMENT LLC"). The rest of the address stays. For a file
  built before this rule, the maintenance step `--purge-persons` does the same.
- **No home address behind a person's company name.** An organisation whose name reads as a
  person's or a family's ("JOHN SMITH LLC", "SMITH FAMILY LP", "SMITH J R HOLDINGS LLC") is kept,
  because it is a legal organisation, but its mailing address is not stored or served: for a
  one-person company it is most often the person's home. The rule is deliberately broad, so a
  company named for its founder loses only its mailing address. `--purge-persons` applies it to
  files built earlier, and the hosted registry refuses to pack a file that still holds one.
- **No grouping by mailing address.** No registry tool finds or groups owners by mailing address:
  `registry_owned_by` follows ownership links to one registered entity, buildings group parcels by
  their situs address, and the owner-match review uses only the mailing address's state. A small
  organisation's mailing address can be a person's home, so a portfolio view built by shared
  mailing address could point at a person. Any such feature must stay limited to organisation
  owners, show the shared address only as a stored fact, and never list or rank the people behind it.
- **Raw archives stay private.** The collector's archived source files (the evidence each fact
  cites) are kept as draft releases that only maintainers can see, because complete appraisal
  rolls name natural-person owners. FactLot publishes the facts and their citations (document
  hash, publisher URL, record locator), not bulk copies of the rolls; anyone can fetch the same
  file from the publisher and check the hash.
- **Confidential owners stay confidential.** Texas Tax Code §25.025 lets certain people (for
  example peace officers, judges, and survivors of family violence) keep their information
  confidential. Appraisal districts withhold those records. The registry never tries to recover,
  infer, or cross-reference withheld owner information.
- **No guessed sale prices.** Texas does not require sale prices to be disclosed. The registry
  does not infer them.

## 4. What we claim

- **Facts are labelled by how they were made.** A fact read directly from a public record is
  `public_record`. A link we inferred is labelled `inferred` and carries a confidence score. An
  example is matching an owner-of-record name to a company registration.
- **Rights travel with every fact.** Each fact carries the source's license, AI-use status, and
  redistribution status, plus any attribution the publisher requires.
- **Corrections and takedowns.** Anyone can request a correction or removal by email to
  contact@factlot.com. Requests about natural persons are honoured promptly and without argument:
  the subject or owner name goes on a private removal list that every hosted registry build
  applies, so it is not served again after a rebuild.

## 5. Review before a source goes live

Before a new adapter's output is published, someone records the following in
[texas-sources.md](texas-sources.md), or the equivalent catalog for another state:

- the source's terms of use
- its license status
- its robots.txt status, if a download is automated
- the date of the review
