/**
 * An owner of record written in a way that usually carries a natural person's name although it reads as an
 * organisation to the registry's rule: an estate, heirs, a living, revocable, irrevocable or family trust, a
 * trust "dated" or "under agreement", a named trustee, or an executor, administrator, personal representative,
 * guardian or conservator written as a role ("PAT EXAMPLE CO-SUCCESSOR TRUSTEE", "EXAMPLE, AS TEMPORARY
 * CO-GUARDIAN, PAT"). A board of trustees, the trustees of an institution, and a bank or trust company as trustee
 * or executor with no one else named ("EXAMPLE BANK NA AS TRUSTEE") are organisations. It is a backstop for display:
 * the registry's own rule (Python ``is_organization``) decides what is stored. The public property pages and the property sheet print no owner (and no
 * linked entity) for such a name.
 */
const INSTITUTION =
  /\b(UNIVERSITY|COLLEGE|SCHOOLS?|ACADEMY|SEMINARY|CHURCH|DIOCESE|ARCHDIOCESE|PARISH|SYNAGOGUE|TEMPLE|MOSQUE|DISTRICT|AUTHORITY|FUND|FOUNDATION|ASSOCIATION|SOCIETY|HOSPITAL|MUSEUM|LIBRARY|PENSION)\b/;
/** A bank or trust company: as trustee of nothing named, or of a securitisation, it names no person. */
const FINANCIAL =
  /\b(BANK|BANC|TRUST (CO|COMPANY)|NATIONAL ASSOCIATION|N A|NA|FSB|SAVINGS FUND SOCIETY)\b/;
const SECURITIZATION =
  /\b(CERTIFICATE ?HOLDERS|NOTE ?HOLDERS|HOLDERS|HOLDER|SERIES|PASS THROUGH|ASSET BACKED|SECURITIES|MORTGAGES?|LOANS?|TRUST \d{4}|CERTIFICATES?|FUNDING|MASTER|COMMERCIAL|RESIDENTIAL|REMIC|CMBS|ACCEPTANCE|RECEIVABLES|ON BEHALF)\b|\d/;
/** Qualifiers of a fiduciary's role: "CO-SUCCESSOR TRUSTEE", "TEMPORARY CO-GUARDIAN", "CO-PRELIMINARY EXECUTOR". */
const QUALIFIER =
  "(?:CO|SUCCESSOR|SUC|SUCC|SOLE|SPECIAL|TEMPORARY|TEMPOARY|TEMP|PRELIMINARY|INDEPENDENT|ANCILLARY|SUBSTITUTE|ALTERNATE|INTERIM|ACTING|DOMICILIARY|JOINT)";
const FIDUCIARY =
  "(?:EXECUTORS?|EXECUTRIX|EXECUTRICES|EXRS?|ADMINISTRATORS?|ADMINISTRATRIX|ADMRS?|ADMX|PERSONAL REPRESENTATIVES?|PERSONAL REP|GUARDIANS?|CONSERVATORS?|ADMIN|EXEC|EXECUT)";
/** An executor, administrator, personal representative, guardian or conservator, written as a role: after AS, CO or a
 *  qualifier, at the end of the name, or opening it ("ADMINISTRATOR OF ..."). "GUARDIAN LIFE INSURANCE CO" is not one. */
const FIDUCIARY_ROLE = new RegExp(
  `\\b(?:AS (?:${QUALIFIER} |PUBLIC |PLAN |PROPERTY )*|(?:${QUALIFIER} |PUBLIC |PLAN |PROPERTY )+)${FIDUCIARY}\\b|\\b${FIDUCIARY}$|^(?:THE )?${FIDUCIARY} (?:OF|FOR)\\b`,
);
const PERSON_STYLE: RegExp[] = [
  /(?<!\bREAL )\bESTATE OF\b/,
  /\bEST OF\b/,
  /\bLIFE ESTATE\b/,
  /\bHEIRS?\b/,
  /\b(LIVING|REVOCABLE|IRREVOCABLE|REV|REVOC|IRREV|IRREVOC|FAMILY|TESTAMENTARY|MARITAL|SURVIVORS?|BYPASS|CREDIT SHELTER)\b.*\b(TRUST|TR|TRST)\b/,
  /\b(TRUST|TR|TRST)\b.*\b(DTD|DATED|U A|UA|UTA|U T A|UAD|UDT|FBO)\b/,
  /\b(TR|TRS|TRSTEE|TTEE|TTEES)$/,
  /\bSOLE HEIRS?\b|\bDISTRIBUTEES?\b/,
  /\bCO (SUCCESSOR )?TRUS\b/,
];
export function ownerNamesAPerson(value: string): boolean {
  const s = value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (PERSON_STYLE.some((p) => p.test(s))) return true;
  // A company named as a trustee company ("EXAMPLE TRUSTEE LLC"), or a county's public administrator.
  if (/\b(TRUSTEES?|TTEES?|TRS) (LLC|INC|CORP|LP|LTD|CO)$/.test(s))
    return false;
  if (
    /^(THE )?PUBLIC ADMINISTRATOR OF (THE )?(COUNTY OF [A-Z]+( [A-Z]+)?|[A-Z]+( [A-Z]+)? COUNTY)$/.test(
      s,
    )
  )
    return false;
  const role =
    /\b(TRUSTEES?|TTEES?|TRSTEES?)\b/.exec(s) ?? FIDUCIARY_ROLE.exec(s);
  if (!role) return false;
  if (/\bBOARD OF TRUSTEES\b/.test(s) || INSTITUTION.test(s)) return false;
  // "<bank> AS TRUSTEE", "<bank> AS TRUSTEE FOR <securitisation>", "<bank>, EXECUTOR": the bank alone is named.
  const before = s.slice(0, role.index);
  const after = s
    .slice(role.index + role[0].length)
    .replace(/\b(OF|FOR|THE|UNDER|AS|ET AL)\b/g, " ")
    .trim();
  return !(
    FINANCIAL.test(before) &&
    // nothing named, one word left by a record cut short, or a securitisation
    (after === "" || !after.includes(" ") || SECURITIZATION.test(after))
  );
}
