/**
 * An owner of record written in a way that usually carries a natural person's name although it reads as an
 * organisation to the registry's rule: an estate, heirs, a living, revocable, irrevocable or family trust, a
 * trust "dated" or "under agreement", or a named trustee. A board of trustees, or the trustees of an
 * institution, is an organisation. The public property pages and the property sheet print no owner (and no
 * linked entity) for such a name.
 */
const INSTITUTION =
  /\b(UNIVERSITY|COLLEGE|SCHOOLS?|ACADEMY|SEMINARY|CHURCH|DIOCESE|ARCHDIOCESE|PARISH|SYNAGOGUE|TEMPLE|MOSQUE|DISTRICT|AUTHORITY|FUND|FOUNDATION|ASSOCIATION|SOCIETY|HOSPITAL|MUSEUM|LIBRARY|PENSION)\b/;
const PERSON_STYLE: RegExp[] = [
  /(?<!\bREAL )\bESTATE OF\b/,
  /\bEST OF\b/,
  /\bLIFE ESTATE\b/,
  /\bHEIRS?\b/,
  /\b(LIVING|REVOCABLE|IRREVOCABLE|REV|REVOC|IRREV|IRREVOC|FAMILY|TESTAMENTARY|MARITAL|SURVIVORS?|BYPASS|CREDIT SHELTER)\b.*\b(TRUST|TR|TRST)\b/,
  /\b(TRUST|TR|TRST)\b.*\b(DTD|DATED|U A|UA|UTA|U T A|UAD|UDT|FBO)\b/,
  /\b(TR|TRS|TRSTEE|TTEE|TTEES)$/,
];
export function ownerNamesAPerson(value: string): boolean {
  const s = value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (PERSON_STYLE.some((p) => p.test(s))) return true;
  if (/\b(TRUSTEES?|TTEES?|TRSTEES?)\b/.test(s))
    return !(/\bBOARD OF TRUSTEES\b/.test(s) || INSTITUTION.test(s));
  return false;
}
