/**
 * Whether an owner-of-record or recorded-document party name reads as a natural person: the answer-time twin of the
 * registry's person rule (Python ``factlot.registry.normalize.is_organization``), for a hosted answer to withhold such a
 * name even when a registry file built under an older rule still holds it. Conservative: a name with no word that makes
 * it an organisation is a person.
 *
 * A name reads as a person when:
 * - it is written like a person's estate, trust or fiduciary (``ownerNamesAPerson``): "ESTATE OF ...", "... FAMILY
 *   TRUST", "PAT EXAMPLE CO-SUCCESSOR TRUSTEE", "EXAMPLE, AS TEMPORARY CO-GUARDIAN, PAT";
 * - "CO" in it is a role, not "Company": followed by a trust or fiduciary word ("EXAMPLE, PAT CO TRUST", "... CO-TRUSTEE",
 *   "... CO-EXEC"). "ACME CO", "SMITH & CO" and "JONES CO" end in "CO" and are companies; "EXAMPLE TRUST CO" is a trust
 *   company;
 * - a legal form opens it before a comma, as a surname written first ("CO, PAT Q", "CORP, PAT");
 * - after its last legal form a person is named: an account held for one ("... FBO PAT EXAMPLE IRA"), a given name
 *   beside an initial ("ACME LLC C/O PAT Q EXAMPLE"), a given name with no organisation, street or property word ("ACME
 *   INC ETAL EXAMPLE, PAT"), or a co-owner of two to four plain words after "&" ("ACME LTD & QUIN EXAMPLE");
 * - it holds no organisation word at all ("EXAMPLE, PAT", "PAT M EXAMPLE", "EXAMPLE TRUST").
 */
import { ownerNamesAPerson } from "./owners.ts";

/** Common given names (the Python rule's ``_TRADE_NAME_GIVEN_NAMES``). */
const GIVEN = new Set(
  "AARON ABIGAIL ABRAHAM ADAM AL ALBERT ALEJANDRO ALEXANDER ALEXIS ALFREDO ALICE ALMA AMANDA AMBER AMIT AMY ANA ANDREA ANDREW ANDY ANGELA ANGELO ANIL ANITA ANN ANNA ANTHONY ANTONIO ARMANDO ARTHUR ARTURO ASHLEY ASHOK BARBARA BEN BENJAMIN BETH BETTY BEVERLY BILL BILLY BOB BOBBY BONNIE BRAD BRANDON BRENDA BRETT BRIAN BRITTANY BRUCE CARL CARLOS CARMEN CAROL CAROLYN CATHERINE CHARLES CHARLOTTE CHERYL CHRIS CHRISTIAN CHRISTINA CHRISTINE CHRISTOPHER CINDY CLARENCE CLINT CODY CRAIG CURTIS CYNTHIA DALE DAN DANIEL DANIELLE DANNY DAVE DAVID DEAN DEBORAH DEBRA DENISE DENNIS DIANA DIANE DICK DINESH DON DONALD DONNA DORIS DOROTHY DOUGLAS DUANE DUNG DWAYNE ED EDUARDO EDWARD ELENA ELIZABETH EMILY EMMA ENRIQUE ERIC ERNEST EUGENE EVELYN FERNANDO FRANCES FRANCISCO FRANK FRED GABRIELA GARY GEORGE GERALD GLENN GLORIA GRACE GREG GREGORY GUADALUPE GUILLERMO HANK HANNAH HARESH HAROLD HEATHER HECTOR HELEN HENRY HITESH HOWARD HUNG HUONG ISAAC ISABELLA JACK JACOB JACQUELINE JAMES JANE JANET JANICE JASON JAVIER JEAN JEFF JEFFREY JENNIFER JEREMY JERRY JESSICA JESUS JILL JIM JIMMY JOAN JOE JOEL JOHN JOHNNIE JOHNNY JON JONATHAN JORGE JOSE JOSEPH JOSHUA JOYCE JUAN JUANA JUDITH JUDY JULIA JULIE JUSTIN KAREN KATE KATHERINE KATHLEEN KATHRYN KATIE KAYLA KEITH KELLY KEN KENNETH KEVIN KIMBERLY KISHORE KYLE LANCE LARRY LAURA LAUREN LAWRENCE LEON LEONARD LETICIA LEWIS LINDA LISA LORI LOUIS LUIS LUZ MAHESH MANOJ MANUEL MARCUS MARGARET MARIA MARIE MARILYN MARIO MARK MARTA MARTHA MARTIN MARY MATT MATTHEW MEGAN MELISSA MICHAEL MICHELLE MIGUEL MIKE MINH MOSES MUKESH NANCY NARESH NATALIE NATHAN NEIL NICHOLAS NICK NICOLE NORMAN OLIVIA OSCAR PAMELA PAT PATRICIA PATRICK PAUL PEDRO PEGGY PETE PETER PHIL PHILIP PHUONG PIERRE PRAKASH PRIYA QUANG RACHEL RAFAEL RAJ RAJESH RAKESH RALPH RAMESH RAMON RANDALL RANDY RAUL RAVI RAYMOND REBECCA RHONDA RICARDO RICH RICHARD RICK RICKY ROBERT ROBERTO ROGER RON RONALD ROSA ROY RUBEN RUSSELL RUTH RYAN SALVATORE SAM SAMANTHA SAMUEL SANDRA SANJAY SARA SARAH SATISH SCOTT SEAN SERGIO SHARON SHEILA SHERRY SHIRLEY SOPHIA STANLEY STEPHANIE STEPHEN STEVE STEVEN SUE SUNIL SUNITA SURESH SUSAN TAMMY TED TERESA TERRI TERRY THANH THERESA THOMAS TIMMY TIMOTHY TINA TODD TOM TOMMY TONY TRANG TROY TUAN TYLER VERONICA VICKI VIJAY VINCENT VIRGINIA WALTER WAYNE WENDY WILLIAM WILLIE YOLANDA ZACHARY".split(
    " ",
  ),
);
const QUALIFIER =
  "(?:CO|SUCCESSOR|SUC|SUCC|SOLE|SPECIAL|TEMPORARY|TEMPOARY|TEMP|PRELIMINARY|INDEPENDENT|ANCILLARY|SUBSTITUTE|ALTERNATE|INTERIM|ACTING|DOMICILIARY|JOINT)";
const CO_ROLE = `(?:${QUALIFIER} )*(?:TRUSTEES?|TRS?|TTEES?|TRUS|TRUSTS?|TRST|TRSUTEES?|OWNERS?|TENANTS?|ADMIN|EXEC|EXE|EXECUT|EXECUTORS?|EXECUTRIX|EXRS?|ADMINISTRATORS?|ADMINISTRATRIX|ADMRS?|PERSONAL REPRESENTATIVES?|PERSONAL REP|GUARDIANS?|CONSERVATORS?|COMMITTEE|RECEIVERS?)\\b`;
/** "CO" is "Company" unless a role follows it; after TRUST or BANK it is always "Company". */
const CO = `(?:CO(?! ${CO_ROLE})|(?<=\\b(?:TRUST|BANK|TITLE|SAVINGS|GUARANTY|FIDUCIARY|ABSTRACT) )CO)`;
const LEGAL_FORM = new RegExp(
  `\\b(?:LLC|LLLP|LLP|LP|INC|CORP|LTD|PLLC|PC|${CO})\\b`,
  "g",
);
/** Words and phrases that make a name an organisation's (the Python rule's entity tokens and structural forms). */
const ORGANIZATION = new RegExp(
  [
    `\\b(?:LLC|LLLP|LLP|LP|INC|CORP|LTD|PLLC|PC|${CO}|PARTNERS|PARTNERSHIP|PROPERTIES|PROPERTY|HOLDINGS|REALTY|INVESTMENTS?|FUND|CAPITAL|VENTURES?|ASSOCIATES|GROUP|BANK|BANC|BANCORP|CHURCH|ASSOCIATION|FOUNDATION|DISTRICT|AUTHORITY|ISD|COUNTY|CITY|STATE|UNIVERSITY|HOSPITAL|REIT|REAL ESTATE INVESTMENT TRUST)\\b`,
    "\\bCREDIT UNION\\b|\\bFCU\\b|\\bFSB\\b|\\bHDFC\\b|\\bHOUSING DEVELOPMENT FUND\\b|\\b(?:GMBH|PLC|SARL)\\b",
    "\\b(?:BOARD|BD|BRD|BOM) (?:OF )?(?:MANAGERS?|MGRS?|MNGRS?|DIRECTORS|TRUSTEES)\\b|\\bCONDOMINIUMS?\\b",
    "^(?:THE )?(?:CITY|COUNTY|TOWN|VILLAGE|BOROUGH|STATE|COMMONWEALTH|PEOPLE|SECRETARY|DEPARTMENT|DEPT|BOARD|COMMISSIONERS?|ATTORNEY GENERAL) OF\\b",
    "^(?:THE )?UNITED STATES\\b|\\bPOSTAL SERVICE\\b|\\bMORTGAGE ELECTRONIC REGISTRATION\\b|^MERS\\b|\\bMERS AS\\b",
    "\\bFEDERAL NATIONAL MORTGAGE\\b|\\bFEDERAL HOME LOAN MORTGAGE\\b|\\bGOVERNMENT NATIONAL MORTGAGE\\b",
    "\\bPASS THROUGH\\b|\\bASSET BACKED\\b|\\bMORTGAGE (?:LOAN |SECURITIES |ASSET )?TRUST\\b|\\bCERTIFICATES\\b|\\bSERIES\\b",
    "\\bBUSINESS TRUST\\b|\\bSTATUTORY TRUST\\b|\\bDST\\b|\\b(?:TITLE|SAVINGS|GUARANTY) (?:AND )?TRUST\\b|\\bTRUST (?:CO|COMPANY)\\b|\\bNATIONAL ASSOCIATION\\b",
    "\\bHOA\\b|\\bHOMEOWNERS\\b|\\bHOME OWNERS\\b|\\bPROPERTY OWNERS\\b|\\bOWNERS (?:ASSN|ASSOCIATION)\\b",
    "\\b\\w*BANK\\w*\\b|\\bBANC\\w*\\b|\\b(?:CITIMORTGAGE|JPMORGAN|HSBC|WELLS FARGO)\\b",
    // abbreviations rolls use for the same words
    "\\b(?:PPTY|PPTYS|PPTIES|PPRTIES|RLTY|PTNR|PTNRS|PRTNRS|PTNRSHP|PRTNRSHP|PRTSP|PRTSHP|ASSOCS?|ASSN|HLDGS?|MGMT|APTS|CP|CRP|INVS?|INVTS|ENTS?|DEVEL|DEV)\\b",
  ].join("|"),
);
/** Words that make what follows a company's name an organisation, an institution, a street or a property, not a person. */
const NOT_A_PERSON_TAIL = new Set(
  "LLC LLP LP INC CORP CO LTD PLLC PC PARTNERS PARTNERSHIP PROPERTIES PROPERTY HOLDINGS HOLDING REALTY REAL ESTATE INVESTMENT INVESTMENTS FUND CAPITAL VENTURE VENTURES ASSOCIATES ASSOCIATION GROUP BANK CHURCH FOUNDATION DISTRICT AUTHORITY COUNTY CITY STATE UNIVERSITY HOSPITAL SCHOOL COLLEGE MANAGEMENT MGMT DEVELOPMENT ENTERPRISES ENTERPRISE APARTMENTS APARTMENT APTS CENTER PLAZA PARK HOUSING RESIDENTIAL COMMERCIAL TOWER TOWERS VILLAGE COMMONS TERRACE GARDENS MANOR HOMES HOTEL RETAIL INDUSTRIAL OFFICE STORAGE BUILDING ST STREET DR DRIVE AVE AVENUE RD ROAD BLVD BOULEVARD PKWY PARKWAY LN LANE WAY CT COURT HWY HIGHWAY FWY TRL TRAIL PL PLACE CIR LOOP SQ SQUARE JV ASSIGNS AGENT MISSION RIVER LAKE CREEK HILLS HILL RANCH FARMS FARM LAND TIC SERVICES SERVICE INTERNATIONAL NATIONAL AMERICA AMERICAN TEXAS US USA EQUITIES EQUITY OPERATING".split(
    " ",
  ),
);
/** Before a given name, words that make it part of a place's or a surname's name ("SAN ANTONIO", "D'ANGELO"). */
const NOT_BEFORE_GIVEN = new Set(
  "SAN SANTA ST SAINT FORT FT PORT MOUNT MT LAKE CAPE A AN D O MORGAN".split(
    " ",
  ),
);

function clean(value: string): string {
  return value
    .toUpperCase()
    .replace(/['\u2018\u2019`]/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bLIMITED LIABILITY COMPANY\b/g, "LLC")
    .replace(/\bL L C\b/g, "LLC")
    .replace(/\bLIMITED LIABILITY PARTNERSHIP\b/g, "LLP")
    .replace(/\bLIMITED PARTNERSHIP\b/g, "LP")
    .replace(/\bL P$/g, "LP")
    .replace(/\bINCORPORATED\b/g, "INC")
    .replace(/\bCORPORATION\b/g, "CORP")
    .replace(/\bCOMPANY\b/g, "CO")
    .replace(/\bLIMITED\b/g, "LTD");
}

/** A person named after the last legal form of `s` (see the module comment). */
function personAfterCompany(s: string): boolean {
  const forms = [...s.matchAll(LEGAL_FORM)];
  if (forms.length === 0) return false;
  const last = forms[forms.length - 1]!;
  const head = s.slice(0, last.index).split(" ");
  const tail = s
    .slice(last.index! + last[0].length)
    .replace(
      /\b(?:ET AL|ETAL|ETALS|ET UX|ETUX|ET VIR|ETVIR|C O|ATTN|ATTENTION|ATT|CARE OF|BY)\b/g,
      " ",
    )
    .split(" ")
    .filter((t) => t !== "");
  if (tail.length === 0) return false;
  const given = (i: number) =>
    GIVEN.has(tail[i]!) && !(i > 0 && NOT_BEFORE_GIVEN.has(tail[i - 1]!));
  const initial = (i: number) =>
    i >= 0 && i < tail.length && /^[B-Z]$/.test(tail[i]!);
  const text = tail.join(" ");
  if (
    /\b(?:FBO|F B O|CFBO|IRA|ROTH|HSA)\b/.test(text) &&
    tail.some((_, i) => given(i) || initial(i))
  )
    return true;
  const street = tail.some((t) =>
    /^(?:ST|STREET|DR|DRIVE|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|PKWY|PARKWAY|LN|LANE|WAY|CT|COURT|HWY|TRL|PL|CIR)$/.test(
      t,
    ),
  );
  if (
    !street &&
    !tail.some((t) => /\d/.test(t)) &&
    tail.some((_, i) => given(i) && (initial(i + 1) || initial(i - 1)))
  )
    return true;
  if (tail.some((t) => /\d/.test(t) || NOT_A_PERSON_TAIL.has(t))) return false;
  if (tail.some((_, i) => given(i))) return true;
  if (tail[0] === "AND") {
    const words = tail.slice(1);
    const own = words.filter((t) => t.length > 2);
    return (
      words.length >= 2 &&
      words.length <= 4 &&
      !(own.length > 0 && own.every((t) => head.includes(t)))
    );
  }
  return false;
}

/** A company whose own name holds a personal-trust or estate word: "EXAMPLE FAMILY TRUST LLC", "THE ESTATE OF EXAMPLE
 *  GROUP LLC" (a bankruptcy estate). It ends in a legal form, holds it once, and names no given name. */
function companyNamedLikeATrust(s: string): boolean {
  const forms = [...s.matchAll(LEGAL_FORM)];
  if (forms.length !== 1) return false;
  const form = forms[0]!;
  if (form.index! + form[0].length !== s.length) return false;
  const words = s.slice(0, form.index).trim().split(" ");
  if (words.some((t) => GIVEN.has(t))) return false;
  if (/^(?:THE )?(?:BANKRUPTCY )?(?:ESTATE|EST) OF \S/.test(s)) return true;
  return /\b(?:FAMILY|LIVING|REVOCABLE|IRREVOCABLE|REV|IRREV) (?:TRUST|TR)$/.test(
    words.join(" "),
  );
}

/** A company acting as trustee, administrator or agent with no one else named: "EXAMPLE TRUST INC AS TRUSTEE",
 *  "EXAMPLE CAPITAL CORP, AS ADMIN AGENT", "EXAMPLE SERVICES LLC, SUCCESSOR TRUSTEE". */
function companyAsTrustee(s: string): boolean {
  const m =
    /^(.+?) (?:AS )?(?:(?:SUCCESSOR|CO|SOLE|SPECIAL|ADMINISTRATIVE|COLLATERAL|INDENTURE|OWNER) )*(?:TRUSTEES?|TTEES?|TR|ADMIN|ADMINISTRATOR|ADMINISTRATIVE AGENT|AGENT|ADMIN AGENT|COLLATERAL AGENT)$/.exec(
      s,
    );
  if (!m) return false;
  const head = m[1]!;
  const forms = [...head.matchAll(LEGAL_FORM)];
  if (forms.length === 0) return false;
  const last = forms[forms.length - 1]!;
  if (last.index! + last[0].length !== head.length) return false; // the company's name ends at its legal form
  return (
    !head.split(" ").some((t) => GIVEN.has(t)) && !personAfterCompany(head)
  );
}

/** Whether an owner-of-record or document-party name reads as a natural person (see the module comment). */
export function nameReadsAsPerson(value: string): boolean {
  const cleaned = clean(value);
  if (
    !companyNamedLikeATrust(cleaned) &&
    !companyAsTrustee(cleaned) &&
    ownerNamesAPerson(value)
  )
    return true;
  // A legal form written first, before a comma, is a surname: "CO, PAT Q", "CORP, PAT".
  if (
    /^\s*(?:LLC|L\.?L\.?C\.?|INC\.?|CORP\.?|CO\.?|LP|L\.?P\.?|LTD\.?)\s*,/i.test(
      value,
    )
  )
    return true;
  const s = clean(value.split(/\bD\s*[/.]?\s*B\s*[/.]?\s*A\b/i)[0]!);
  if (s === "") return true;
  if (personAfterCompany(s)) return true;
  return !ORGANIZATION.test(s);
}
