// nameReadsAsPerson (person-names.ts): the answer-time person rule for owner and document-party names.
// Every name here is invented; none is a real person's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nameReadsAsPerson } from "./person-names.ts";

describe("nameReadsAsPerson: persons", () => {
  const persons = [
    // a trust or a fiduciary role after a person's name, "CO" read as the role's
    "EXAMPLE, PAT CO TRUST",
    "PAT EXAMPLE CO TR",
    "PAT QUIN CO-SUCCESSOR TRUSTEE",
    "PAT EXAMPLE, AS CO-SUCCESSOR TRUSTEE",
    "EXAMPLE, AS SUCCESSOR CO-TRUS, PAT LEE",
    "EXAMPLE, AS TEMPORARY CO-GUARDIAN, PAT",
    "PAT EXAMPLE, CO-GUARDIAN",
    "EXAMPLE, CO INDEPENDENT EXECUTOR, PAT",
    "PAT EXAMPLE, AS CO-PRELIMINARY EXECUTOR",
    "EXAMPLE (CO-ADMIN), PAT Q ESQ.",
    "PAT EXAMPLE CO-EXEC",
    "EXAMPLE PROPERTY GUARDIAN, QUIN",
    "QUIN ROE, AS GUARDIAN OF THE PROPERTY OF",
    "ADMINISTRATOR OF EXAMPLE COUNTY, PAT Q ROE PUBLIC",
    "PAT EXAMPLE PERSONAL REPRESENTATIVE",
    "PAT EXAMPLE TRUSTEE",
    "PAT EXAMPLE FAMILY TRUST",
    "PAT EXAMPLE LIVING TRUST",
    "EXAMPLE PAT REVOCABLE TRUST",
    "EXAMPLE TRUST",
    "ESTATE OF PAT EXAMPLE",
    "HEIRS OF PAT EXAMPLE",
    "QUIN ROE EXAMPLE SOLE HEIR",
    // bare persons
    "EXAMPLE, PAT",
    "PAT M EXAMPLE",
    "EXAMPLE QUIN",
    // a legal form written first is a surname
    "CO, PAT Q",
    "CORP, QUIN ROE",
    "LLC, PAT",
    // a person after the company
    "ACME LLC & PAT EXAMPLE",
    "ACME HOLDINGS LTD & QUIN ROE",
    "ACME INC ETAL EXAMPLE, CHRISTOPHER A",
    "ACME LLC C/O PAT Q EXAMPLE",
    "ACME LLC ATTN: MARY EXAMPLE",
    "EXAMPLE TRUST COMPANY CUSTODIAN FBO PAT Q EXAMPLE IRA",
    "ACME PROPERTIES LP EXAMPLE, MARY H HEIRS",
    "EXAMPLE BANK NA AS TRUSTEE FOR PAT EXAMPLE",
    "PAT EXAMPLE, AS TRUSTEE",
    "ACME LLC PAT EXAMPLE TRUSTEE",
  ];
  for (const name of persons)
    it(`"${name}" is a person`, () =>
      assert.equal(nameReadsAsPerson(name), true));
});

describe("nameReadsAsPerson: organisations", () => {
  const organisations = [
    "ACME CO",
    "SMITH & CO",
    "JONES CO",
    "ACME CO INC",
    "ACME COMPANY",
    "EXAMPLE TRUST CO",
    "EXAMPLE TRUST COMPANY, CO-EXECUTOR",
    "EXAMPLE TRUST COMPANY ADMIN",
    "ACME PROPERTIES LLC",
    "Acme Holdings, L.L.C.",
    "EXAMPLE PLAZA L.P.",
    "EXAMPLE BANK NA AS TRUSTEE",
    "EXAMPLE BANK, N.A., AS TRUSTEE",
    "EXAMPLE BANK NATIONAL ASSOCIATION AS TRUSTEE FOR EXAMPLE MORTGAGE TRUST 2006-1",
    "EXAMPLE SAVINGS FUND SOCIETY, FSB, AS TRUSTEE",
    "BANK OF EXAMPLE, EXECUTOR",
    "BOARD OF TRUSTEES OF EXAMPLE COLLEGE",
    "TRUSTEES OF EXAMPLE UNIVERSITY",
    "EXAMPLE TRUSTEE LLC",
    "EXAMPLE FAMILY TRUST LLC",
    "EXAMPLE REALTY TRUST LLC",
    "EXAMPLE REAL ESTATE INVESTMENT TRUST",
    "THE GUARDIAN EXAMPLE INSURANCE COMPANY OF AMERICA",
    "GUARDIAN EXAMPLE HOMES INC",
    "101 GUARDIAN LLC",
    "PUBLIC ADMINISTRATOR OF EXAMPLE COUNTY",
    "CITY OF EXAMPLEVILLE",
    "EXAMPLE FEDERAL CREDIT UNION",
    "THE EXAMPLE HOUSE CONDOMINIUM",
    "MERS AS NOMINEE FOR EXAMPLE BANK, N.A.",
    "ACME LLC & BETA HOLDINGS LLC",
    "ACME WEST LLC & ACME WEST",
    "ACME LLC - 300 EXAMPLE DR",
    "ACME INC OF SAN ANTONIO",
    "THE ESTATE OF EXAMPLE GROUP LLC",
    "REAL ESTATE OF EXAMPLE STREET LP",
    "EXAMPLE TRUST, INC., AS TRUSTEE",
    "EXAMPLE CAPITAL CORPORATION, AS ADMIN AGENT",
    "EXAMPLE SERVICES LLC, SUCCESSOR TRUSTEE",
    "EXAMPLE REALTY CP",
    "EXAMPLE PPTIES",
    "EXAMPLE BANKNORTH, N.A.",
    "EXAMPLE BANK NA, AS TRUSTEE FOR THE HOLDERS OF THE",
  ];
  for (const name of organisations)
    it(`"${name}" is an organisation`, () =>
      assert.equal(nameReadsAsPerson(name), false));
});
