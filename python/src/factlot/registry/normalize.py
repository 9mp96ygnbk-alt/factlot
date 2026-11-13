"""Name, address, and property-class normalization for the registry, plus name similarity."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from ..ids import address_tokens

# Texas State Property Tax Code categories kept by default (data policy §3):
# B multifamily, F1 commercial real property, F2 industrial/manufacturing real property.
COMMERCIAL_CATEGORIES = frozenset({"B", "F1", "F2"})

_SUFFIXES = [
    (r"\bLIMITED LIABILITY COMPANY\b", "LLC"),
    (r"\bL L C\b", "LLC"),
    (r"\bLIMITED LIABILITY PARTNERSHIP\b", "LLP"),
    (r"\bL L P\b", "LLP"),
    (r"\bLIMITED PARTNERSHIP\b", "LP"),
    (r"\bL P\b", "LP"),
    (r"\bINCORPORATED\b", "INC"),
    (r"\bCORPORATION\b", "CORP"),
    (r"\bCOMPANY\b", "CO"),
    (r"\bLIMITED\b", "LTD"),
]

# Tokens that mark an organisation rather than a natural person. "CO" followed by a fiduciary or
# ownership role is a person's role ("SMITH JOHN CO-TRUSTEE", "DOE JANE CO TRS"), not "Company".
_ENTITY_TOKENS = re.compile(
    r"\b(LLC|LLP|LP|INC|CORP|CO(?! (?:TRUSTEES?|TRS?|TTEES?|OWNERS?|TENANTS?|EXECUTORS?|EXRS?|"
    r"EXECUTRIX|ADMINISTRATORS?|ADMRS?|PERSONAL REPRESENTATIVES?)\b)|LTD|PLLC|PC|PARTNERS|PARTNERSHIP|PROPERTIES|PROPERTY|HOLDINGS|"
    r"REALTY|INVESTMENTS?|FUND|CAPITAL|VENTURES?|ASSOCIATES|GROUP|BANK|CHURCH|ASSOCIATION|"
    r"FOUNDATION|DISTRICT|AUTHORITY|ISD|COUNTY|CITY|STATE|UNIVERSITY|HOSPITAL|REIT|"
    r"REAL ESTATE INVESTMENT TRUST)\b"
)


# Apostrophes are dropped, not turned into spaces: rolls write "OREILLY" and "CHILDRENS" where the
# registration says "O'REILLY" and "CHILDREN'S".
_APOSTROPHES = re.compile("['\u2018\u2019`\u00b4]")

# What follows the owner on a roll but is not part of the owner's name: a "doing business as" trade
# name, "ET AL" (other co-owners are listed elsewhere), and a connector left dangling when the
# publisher truncated the line ("ACME HOLDINGS LLC &", "SMITH FAMILY LP THE").
_NAME_TAIL = re.compile(r"\s(?:DBA|D B A|ET AL|ETAL|ET UX|ETUX|ET VIR|ETVIR)\b.*$")
_DANGLING = re.compile(r"\s(?:AND|THE)$")
# "NO 1" and "1" name the same series entity.
_NUMBER_WORD = re.compile(r"\b(?:NO|NUMBER)\s+(?=\d)")

# One spelling per abbreviation that publishers use inconsistently, applied to whole tokens on both
# sides of a comparison (so the choice of spelling does not matter, only that it is single). Words
# whose abbreviation is ambiguous (ASSOC: associates or association; INV: investment or
# investments) and words that are also initials (directions) are left alone.
NAME_TOKEN_CANON = {
    "PPTY": "PROPERTY", "PPTIES": "PROPERTIES", "PPRTIES": "PROPERTIES", "PPTYS": "PROPERTIES",
    "CTR": "CENTER", "CTRS": "CENTERS", "PTNR": "PARTNER", "PTNRS": "PARTNERS", "PRTNRS": "PARTNERS",
    "PTNRSHP": "PARTNERSHIP", "PTNRSHIP": "PARTNERSHIP", "PRTNRSHP": "PARTNERSHIP", "APTS": "APARTMENTS",
    "MGMT": "MANAGEMENT", "MGT": "MANAGEMENT", "DEVEL": "DEVELOPMENT", "BLDG": "BUILDING",
    "BLDGS": "BUILDINGS", "INTL": "INTERNATIONAL", "HLDGS": "HOLDINGS", "HLDG": "HOLDING", "RLTY": "REALTY",
    # street types, to the short form addresses use ("123 MAIN STREET LLC" is "123 MAIN ST LLC")
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD", "PARKWAY": "PKWY",
    "HIGHWAY": "HWY",
}


def _canonical_tokens(s: str) -> str:
    return " ".join(NAME_TOKEN_CANON.get(t, t) for t in s.split())


def _join_initials(s: str) -> str:
    """Run together consecutive single letters: ``W G G PROPERTIES`` (from ``W.G.G.``) is ``WGG PROPERTIES``."""
    out: list[str] = []
    run = ""
    for t in s.split():
        if len(t) == 1 and "A" <= t <= "Z":
            run += t
            continue
        if run:
            out.append(run)
            run = ""
        out.append(t)
    if run:
        out.append(run)
    return " ".join(out)


def normalize_name(name: str) -> str:
    """Comparable key for an organisation name: 'Acme Properties, L.L.C.' -> 'ACME PROPERTIES LLC'.

    Besides case, punctuation and entity-type suffixes (LLC, LP, INC, ...), the key drops what a
    roll appends to an owner ("ET AL", a "DBA" trade name, a dangling "&" or "THE"), removes
    apostrophes, reads "NO 1" as "1", runs consecutive initials together ("W.G.G." and "WGG"), and
    spells common abbreviations one way (``NAME_TOKEN_CANON``).
    The TypeScript mirror (``normalizeName`` in packages/tools) must agree; ``spec/registry/normalize.json``
    holds the shared vectors.
    """
    s = _APOSTROPHES.sub("", name.upper()).replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pattern, repl in _SUFFIXES:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"^THE ", "", s)
    if (tail := _NAME_TAIL.sub("", s)):  # never reduce a name to nothing
        s = tail
    while (trimmed := _DANGLING.sub("", s)) != s and trimmed:
        s = trimmed
    s = _NUMBER_WORD.sub("", s)
    return _canonical_tokens(_join_initials(re.sub(r"\s+", " ", s).strip()))


# A "doing business as" marker (DBA, D/B/A, D.B.A.): what follows it is a trade name.
_DBA = re.compile(r"\bD\s*[/.]?\s*B\s*[/.]?\s*A\b")
# "L.P." written with a dot is a partnership; bare spaced "L P" is usually a person's initials.
_DOTTED_LP = re.compile(r"\bL\s*\.\s*P\b")


# Words that mark a spaced "L P" as a partnership rather than a person's two middle initials when
# the name has no number ("BROAD PLAZA L P"). Only words a surname is unlikely to be belong here.
_LP_CONTEXT = frozenset(
    "PLAZA CENTER CENTERS TOWER TOWERS ENTERPRISES ENTERPRISE ASSOC ASSOCS ASSOCIATES INVESTORS INTERESTS "
    "APARTMENTS APARTMENT APTS APT STREET ST AVENUE AVE ROAD RD VILLAGE COMMONS TERRACE GARDENS MANOR HOUSING "
    "SENIORS OPERATING OPERATIONS MANAGEMENT DEVELOPMENT ACQUISITIONS ACQUISITION MEDICAL OFFICE BUILDING "
    "BUILDINGS TELEVISION VIDEO PIPELINE LANDFILL STABLES MARINA HOMES TOWNHOMES CAPITAL RESIDENCE HOTEL "
    "RETAIL INDUSTRIAL WAREHOUSE STORAGE PARKING".split()
)
_SPACED_LP = re.compile(r"\bL P\b")


# A trust named for a person ("DOE JANE SEPARATE PROPERTY TRUST", "SMITH JOHN A REVOCABLE REALTY") is that
# person's holding, and the words PROPERTY and REALTY in it do not make it a business. Without a word
# that makes the owner a company (below), such a name is read as a person.
_PERSONAL_TRUST = re.compile(
    r"\b(?:SEPARATE PROPERTY|COMMUNITY PROPERTY|REVOCABLE|IRREVOCABLE|LIVING TRUST|LIFE ESTATE|ESTATE OF|HEIRS|"
    r"DECEASED|TESTAMENTARY|BYPASS TRUST|SURVIVORS? TRUST)\b")
_COMPANY_WORD = re.compile(
    r"\b(?:LLC|LLP|LP|INC|CORP|LTD|PLLC|PC|BANK|CHURCH|FUND|ASSOCIATION|FOUNDATION|REIT|COMPANY|PARTNERSHIP|"
    r"PARTNERS|VENTURES?|CAPITAL|GROUP)\b")


def _spaced_lp_is_partnership(s: str) -> bool:
    """Whether the last bare ``L P`` in a cleaned name is "L.P." written without dots.

    A person's roll entry can end in two middle initials ("GARCIA MARIA L P", "LOPEZ MARIA ELENA L P"),
    so the name is read as a partnership only on evidence: a number ("400 NUECES L P") or a word
    that names a property or a business ("BROAD PLAZA L P"). A name with neither ("GSGB L P") stays
    unread, which loses a partnership's owner name but never stores a person's.
    """
    matches = list(_SPACED_LP.finditer(s))
    if not matches:
        return False
    head = s[: matches[-1].start()].split()
    if not head:
        return False
    if any(any(c.isdigit() for c in t) for t in head):
        return True
    return any(t in _LP_CONTEXT for t in head)


# Organisations whose name carries no entity-type word but a legal form or structure no natural person's name
# has. Each alternative is a whole phrase, never a word that can also be a surname ("BANK", "CHURCH", "COUNTY",
# "TEMPLE", "PARK"): a credit union, a federal savings bank, a government body ("CITY OF ...", "SECRETARY
# OF ...", "BOARD OF MANAGERS"), a condominium, a securitization trust, a foreign "GMBH" or "PLC". Left out on
# purpose, because a person's name can look like them: "FANNIE MAE" (also a woman's given name), a bare "NV",
# "SA", "BV" or "AG" (initials, or a Korean given name), a bare "NA", and "AS NOMINEE FOR".
_STRUCTURAL_ORGANIZATION = re.compile(
    r"\bCREDIT UNION\b|\bFCU\b|\bFSB\b|\bHDFC\b|\bHOUSING DEVELOPMENT FUND\b"
    r"|\b(?:GMBH|PLC|SARL|AKTIENGESELLSCHAFT)\b"
    r"|\b(?:BOARD|BD|BRD|BOM) (?:OF )?(?:MANAGERS?|MGRS?|MNGRS?|DIRECTORS)\b"
    r"|^(?:THE )?(?:CITY|COUNTY|TOWN|VILLAGE|BOROUGH|STATE|COMMONWEALTH|PEOPLE|SECRETARY|DEPARTMENT|DEPT|BOARD|"
    r"BD|BRD|COMMISSIONERS?|ATTORNEY GENERAL) OF\b"
    r"|^(?:THE )?UNITED STATES\b|\bPOSTAL SERVICE\b"
    r"|\bMORTGAGE ELECTRONIC REGISTRATION\b|^MERS$|\bMERS AS (?:NOMINEE|MORTGAGEE)\b"
    r"|\bFEDERAL NATIONAL MORTGAGE\b|\bFEDERAL HOME LOAN MORTGAGE\b|\bGOVERNMENT NATIONAL MORTGAGE\b"
    r"|\bPASS THROUGH\b|\bASSET BACKED\b|\bMORTGAGE (?:LOAN |SECURITIES |ASSET )?TRUST\b|\bCERTIFICATES SERIES\b"
    r"|\bBUSINESS TRUST\b|\bSTATUTORY TRUST\b|\bDST\b|\b(?:TITLE|SAVINGS|GUARANTY) (?:AND )?TRUST\b"
    r"|\bHOA\b|\bHOMEOWNERS\b|\bHOME OWNERS\b|\bPROPERTY OWNERS\b|\bOWNERS (?:ASSN|ASSOCIATION)\b"
)
# "N.A." (national association) ends the name of a bank, but it also reads as a person's two initials
# ("DOE JOHN N A"), so it counts only after a word that names a bank: CITIBANK, CITIMORTGAGE, a savings or
# trust bank.
_NATIONAL_ASSOCIATION = re.compile(r"\bN A$")
_BANKING_WORD = re.compile(
    r"^(?:\w+(?:BANK|BANC|BANCORP|MORTGAGE)|TRUST|SAVINGS|FINANCIAL|NATIONAL|CITIZENS|JPMORGAN|HSBC|MBNA|"
    r"BANKUNITED|BANKBOSTON|BANKNORTH)$")

# A person named with a title of a board ("DANNY F. ASHKENASI, PRESIDENT BD OF MANAGERS") or a trust named for a
# person whose trustee is a savings bank ("JANE B. DOE GRANTOR TRUST, FSB") is a person, whatever follows.
_PERSON_MARKER = re.compile(
    r"\bPRESIDENT(?! (?:STREET|ST|PLAZA|AVENUE|AVE)\b)|\b(?:TREASURER|CHAIRMAN|CHAIRPERSON)\b|\bGRANTOR TRUST\b")

# A condominium is a building's name ("THE CAST IRON HOUSE CONDOMINIUM"); a name that is only a person's given
# names and initials with the word ("JOHN JAMES CONDOMINIUM") is not read as one.
_CONDOMINIUM = re.compile(r"\bCONDOMINIUMS?\b")

# Words in ``_ENTITY_TOKENS`` that are also surnames. A name of nothing but given names, initials and one of
# them ("JOHN BANK", "MARY A CHURCH", "BANK, JOHN") is a person. Given names that are also well-known
# institutions or places (FRANKLIN, HAMILTON, GRACE, FAITH, ROSE, ...) are not on the list, so "GRACE CHURCH"
# stays an organisation.
_SURNAME_WORDS = frozenset("BANK CHURCH CITY COUNTY STATE".split())
_NAME_SUFFIXES = frozenset("JR SR II III IV".split())
_GIVEN_NAMES = frozenset(
    "JOHN JAMES ROBERT MICHAEL WILLIAM DAVID RICHARD JOSEPH THOMAS CHARLES CHRISTOPHER DANIEL MATTHEW ANTHONY "
    "MARK DONALD STEVEN PAUL ANDREW JOSHUA KENNETH KEVIN BRIAN GEORGE EDWARD RONALD TIMOTHY JASON JEFFREY RYAN "
    "JACOB GARY NICHOLAS ERIC JONATHAN STEPHEN LARRY JUSTIN SCOTT BRANDON BENJAMIN SAMUEL GREGORY FRANK ALEXANDER "
    "RAYMOND PATRICK JACK DENNIS JERRY TYLER AARON JOSE ADAM NATHAN HENRY PETER ZACHARY DOUGLAS HAROLD KYLE "
    "CARL ARTHUR GERALD ROGER KEITH JEREMY TERRY LAWRENCE SEAN ALBERT JOE CHRISTIAN WILLIE RALPH ROY LOUIS "
    "EUGENE PHILIP BOBBY JOHNNY BRUCE WAYNE RUSSELL VINCENT HOWARD FRED WALTER NORMAN MARTIN ERNEST STANLEY "
    "LEONARD CLARENCE LEON LEWIS SALVATORE ANGELO ABRAHAM ISAAC MOSES PIERRE JEAN MARIO "
    "MARY PATRICIA JENNIFER LINDA ELIZABETH BARBARA SUSAN JESSICA SARAH KAREN LISA NANCY BETTY MARGARET SANDRA "
    "ASHLEY KIMBERLY EMILY DONNA MICHELLE DOROTHY CAROL AMANDA MELISSA DEBORAH STEPHANIE REBECCA SHARON LAURA "
    "CYNTHIA KATHLEEN AMY ANGELA SHIRLEY ANNA BRENDA PAMELA EMMA NICOLE HELEN SAMANTHA KATHERINE CHRISTINE "
    "DEBRA RACHEL CAROLYN JANET CATHERINE MARIA HEATHER DIANE RUTH JULIE OLIVIA JOYCE VIRGINIA KELLY "
    "LAUREN CHRISTINA JOAN EVELYN JUDITH ANDREA HANNAH MEGAN CHERYL JACQUELINE MARTHA GLORIA TERESA ANN SARA "
    "FRANCES KATHRYN JANICE ABIGAIL ALICE JULIA JUDY SOPHIA DENISE AMBER DORIS MARILYN "
    "DANIELLE BEVERLY ISABELLA THERESA DIANA NATALIE BRITTANY CHARLOTTE MARIE KAYLA ALEXIS LORI JANE JILL KATE KATIE "
    "JIM JIMMY TOM TIMMY BILL BOB MIKE DAVE STEVE CHRIS NICK PETE TONY ANDY DAN SAM BEN MATT".split()
)


def _is_surname_collision(s: str) -> bool:
    """Whether a cleaned name is a person whose surname is one of ``_SURNAME_WORDS``."""
    tokens = s.split()
    if sum(t in _SURNAME_WORDS for t in tokens) != 1 or not 2 <= len(tokens) <= 4:
        return False
    rest = [t for t in tokens if t not in _SURNAME_WORDS]
    return _only_given_names(rest)


def _only_given_names(tokens: list[str]) -> bool:
    return any(t in _GIVEN_NAMES for t in tokens) and all(
        t in _GIVEN_NAMES or t in _NAME_SUFFIXES or (len(t) == 1 and t.isalpha()) for t in tokens)


# A sole proprietor's trade name is often the owner's own name and a generic business word: "SMITH JOHN
# PROPERTIES", "GARCIA JOSE INVESTMENTS", "PATEL RAJESH HOLDINGS". Such a name identifies a natural person, so it
# is read as one. The words are those ``_ENTITY_TOKENS`` would otherwise count as an organisation (and a few that
# it does not, so the list says what the rule means): a generic word, not a legal form.
_GENERIC_BUSINESS_WORDS = frozenset(
    "PROPERTIES PROPERTY HOLDINGS HOLDING INVESTMENTS INVESTMENT ENTERPRISES ENTERPRISE RENTALS RENTAL REALTY "
    "VENTURES VENTURE GROUP CO ASSOCIATES CAPITAL FARMS FARM RANCH RANCHES INTERESTS LAND MANAGEMENT".split()
)
# Given names that, beside a surname, make the name part a person's: ``_GIVEN_NAMES`` and common given names it
# leaves out (Spanish, South Asian, Vietnamese and short English forms). A name part without one ("PACIFIC COAST",
# "UNION STATION", "SUMMIT GROVE") keeps the usual reading, so an organisation named for two places or words is
# not lost; a person whose given name is not listed is not caught by this rule.
_TRADE_NAME_GIVEN_NAMES = _GIVEN_NAMES | frozenset(
    "JUAN CARLOS LUIS JORGE MIGUEL JESUS ANTONIO FRANCISCO MANUEL PEDRO RAMON RAUL RICARDO ROBERTO RAFAEL "
    "FERNANDO SERGIO ARTURO ALEJANDRO EDUARDO ENRIQUE JAVIER HECTOR ARMANDO OSCAR RUBEN ALFREDO GUILLERMO "
    "GUADALUPE ROSA CARMEN ANA JUANA ELENA YOLANDA ALMA LETICIA LUZ VERONICA MARTA GABRIELA "
    "RAJESH RAJ RAVI SANJAY SURESH RAMESH AMIT ANIL SUNIL VIJAY ASHOK MAHESH DINESH PRAKASH MUKESH NARESH "
    "HARESH HITESH KISHORE MANOJ RAKESH SATISH PRIYA ANITA SUNITA "
    "MINH TUAN THANH HUNG DUNG QUANG PHUONG TRANG HUONG "
    "DON JON TED ED AL HANK RICK RICH DICK JEFF GREG RON KEN JOHNNIE "
    "BETH SUE PAT PEGGY "
    "RANDY RANDALL CURTIS TROY DALE GLENN CRAIG TODD BRAD BRETT DEAN DUANE DWAYNE CLINT CODY JOEL MARCUS "
    "RICKY TOMMY BILLY DANNY LANCE NEIL PHIL GRACE TAMMY TINA WENDY VICKI CINDY SHERRY TERRI SHEILA RHONDA "
    "BONNIE".split()
)
# Words a person's name part never holds here: legal forms, connectors, ordinals, directions, and words that name
# an institution, a place or a business (with ``NAME_STOP_TOKENS``, ``_LP_CONTEXT`` and ``_ENTITY_TOKENS``).
_NOT_A_NAME_WORD = frozenset(
    "LLC LLP LLLP LP INC CORP LTD PLLC PC PA NA REIT TRUST TRUSTS TRUSTEE TRUSTEES TR TRS TTEE TTEES PARTNERSHIP "
    "PARTNERS ASSOCIATION FOUNDATION FUND AND OF THE DBA ETAL "
    "FIRST SECOND THIRD FOURTH FIFTH SIXTH SEVENTH EIGHTH NINTH TENTH "
    "NORTH SOUTH EAST WEST NORTHEAST NORTHWEST SOUTHEAST SOUTHWEST "
    "CHRIST BAPTIST METHODIST CATHOLIC LUTHERAN PRESBYTERIAN EPISCOPAL MINISTRY MINISTRIES SCHOOL COLLEGE "
    "ACADEMY INSTITUTE SOCIETY CLUB LODGE COUNCIL HOSPITAL UNIVERSITY ENERGY OIL GAS PETROLEUM".split()
)


def _sole_proprietor_trade_name(s: str) -> bool:
    """Whether a cleaned name is a person's name and a generic business word (``_GENERIC_BUSINESS_WORDS``).

    The name, without a trailing "ET AL", must be two name words (surname and given name, either order, the given
    name one of ``_TRADE_NAME_GIVEN_NAMES``), at most one middle initial or suffix (JR, SR, II, ...), then one
    generic business word. Any legal form, "AND", "OF",
    a digit, an ordinal or a word that names a place, an institution or a business keeps the usual reading.
    """
    tokens = re.sub(r"\s(?:ET AL|ETAL)$", "", s).split()
    if not 3 <= len(tokens) <= 4 or tokens[-1] not in _GENERIC_BUSINESS_WORDS:
        return False
    head = tokens[:-1]
    names = [t for t in head if len(t) > 1 and t not in _NAME_SUFFIXES]
    extras = [t for t in head if len(t) == 1 or t in _NAME_SUFFIXES]
    if any(not t.isalpha() for t in head) or _ENTITY_TOKENS.search(" ".join(head)):
        return False
    # A surname and two initials ("SMITH J R PROPERTIES") is how a roll writes a person with no given name.
    if len(names) == 1 and len(extras) == 2 and all(len(t) == 1 for t in extras):
        t = names[0]
        return not (t in _NOT_A_NAME_WORD or t in NAME_STOP_TOKENS or t in _LP_CONTEXT
                    or t in _GENERIC_BUSINESS_WORDS)
    if len(names) != 2 or len(extras) > 1:
        return False
    if not any(t in _TRADE_NAME_GIVEN_NAMES for t in names):
        return False
    return not any(t in _NOT_A_NAME_WORD or t in NAME_STOP_TOKENS or t in _LP_CONTEXT
                   or t in _GENERIC_BUSINESS_WORDS for t in names)


def _structurally_organization(s: str) -> bool:
    if _PERSON_MARKER.search(s):
        return False
    if _STRUCTURAL_ORGANIZATION.search(s):
        return True
    if _CONDOMINIUM.search(s):
        return not _only_given_names([t for t in s.split() if not _CONDOMINIUM.fullmatch(t)])
    if not _NATIONAL_ASSOCIATION.search(s):
        return False
    head = s[:-4]
    return head.endswith("WELLS FARGO") or any(_BANKING_WORD.match(t) for t in head.split())


# --- names that carry a natural person inside an organisation-style wrapper ----------------------
#
# A probate form ("ESTATE OF ...", "HEIRS OF ..."), a personal trust ("... REV TR DTD ...", "... FAMILY TRUST"),
# a trustee named in person ("<person> TRUSTEE", "TRUSTEES OF <person>") or a company followed by any of these
# ("<company> LLC <person> REV TR") names a natural person, whatever organisation word it also holds. Such a name is
# rejected whole (``person_carrying_class``): cutting it down to its leading organisation would rest on reading where
# the person's name starts, and a wrong cut would store it.

# Probate and life-interest forms. "ESTATE OF" at the start or the end of a name, or before no legal form, is probate;
# inside a company's name ("<word> ESTATE OF <place> LLC", "REAL ESTATE OF ...") or before a number it is not.
_PROBATE = re.compile(
    r"^(?:THE )?(?:ESTATE|EST) OF\b(?! \d)|\b(?:ESTATE|EST) OF$"
    r"|(?<!\bREAL )\b(?:ESTATE|EST) OF\b(?! \d)(?!.*\b(?:LLC|LLLP|LLP|LP|INC|CORP|LTD|PLLC|CO)\b)|\bHEIRS (?:OF|AT LAW)\b|\bUNKNOWN HEIRS\b|\bLIFE (?:ESTATE|EST|TENANTS?)\b"
    r"|\bDECEASED\b|\bDECD\b|\bDEC D\b")
_TRUST_WORD = r"(?:TRUSTS?|TRST|TR)"
# Personal trusts, written out or as the rolls abbreviate them. Apostrophes have become spaces ("SURVIVOR S").
_PERSONAL_TRUST_MARK = re.compile(
    r"\b(?:REVOCABLE|IRREVOCABLE|REVOC|IRREVOC|IRREV|INTER ?VIVOS|TESTAMENTARY|TESTAMENTRY|QTIP|QPRT|CRUT|CRAT)\b"
    r"|\bREV (?:LIV|LIVING|LVG|TR|TRUST|TRST|FAM|FAMILY|DEC|DECL|DECLARATION)\b|\bIRR (?:TR|TRUST)\b"
    r"|(?<!\bSENIOR )(?<!\bASSISTED )(?<!\bINDEPENDENT )\b(?:LIVING|LIV|LVG) (?:TR|TRUST|TRST|REV)\b"
    rf"|\b(?:FAMILY|FAM) (?:{_TRUST_WORD}|REV|LIV|LIVING|IRREV)\b"
    rf"|\b(?:MARITAL|SURVIVORS?|SURVIVOR S|EXEMPTION|EXEMPT|BYPASS|BY PASS|CREDIT SHELTER|DISCLAIMER|RESIDUARY|"
    rf"DECEDENTS?|DECEDENT S|SPOUSAL|DYNASTY|GRANTOR|SPECIAL NEEDS|SUPPLEMENTAL NEEDS|CHILDRENS|CHILDREN S|"
    rf"GRANDCHILDRENS|GRANDCHILDREN S|SPENDTHRIFT|GENERATION SKIPPING|GST|CHARITABLE REMAINDER(?: UNITRUST)?"
    rf"(?: ANNUITY)?|CHARITABLE LEAD(?: ANNUITY)?) {_TRUST_WORD}\b|\bMARITAL DEDUCTION\b|\bUNITRUST\b"
    r"|\b(?:SEPARATE|COMMUNITY) PROPERTY\b")
# Dated or "under agreement" forms: personal when the name also has a trust or trustee word.
_TRUST_INSTRUMENT_MARK = re.compile(
    r"\b(?:DTD|U A|U T A|U D T|U A D|U W|UTA|UDT|UTD|UAD|UTAD|DATED|AGREEMENT DATED|DECLARATION OF TRUST)\b")
# Written run together, UTA and UDT are also words in companies' names ("<number> UTA LLC"), so only the spaced
# "U/T/A" and "U/D/T" count as a trust on their own.
_ANY_TRUST_WORD = re.compile(r"\b(?:TRUSTS?|TRST|TR|TRS|TRUSTEES?|TTEES?|TRSTEES?|TRUSTE|U T A|U D T)\b")
# A trustee, written out or abbreviated, with its role words; "BOARD OF TRUSTEES" is a body, kept as one unit.
_BOARD_OF_TRUSTEES = re.compile(r"\b(?:THE )?(?:BOARD|BD|BRD) OF (?:TRUSTEES|TRS|TTEES)\b(?: OF)?(?: THE)?")
_TRUSTEE = re.compile(
    r"\b(?:AS )?(?:(?:SUCCESSOR|SUC|SUCC|CO|SOLE|SPECIAL|INDIVIDUALLY AND AS|INDIVIDUALLY AND|INDENTURE|COLLATERAL|OWNER|"
    r"SEPARATE|CERTIFICATE|INSTITUTIONAL|LIQUIDATING|PLAN|DELAWARE|ADMINISTRATIVE) )?"
    r"(?:TRUSTEES?|TTEES?|TRSTEES?|TRSTE|TRUSTE|TRS)\b(?! (?:CO|COMPANY|CORP|SERVICES|SERVICING)\b)"
    r"(?: (?:OF|FOR|UNDER|U A|U T A|UNDER THE|OF THE|FOR THE|OF THAT|U D T))?")
# "<x> TRUST CO TRUSTEES OF ...": the CO is the trust company's, not a co-trustee's.
_COMPANY_BEFORE_TRUSTEE = re.compile(
    r"\b(TRUST|BANK|TITLE|SAVINGS|GUARANTY|FIDUCIARY|ABSTRACT) CO (?=(?:AS )?(?:SUCCESSOR )?(?:TRUSTEES?|TTEES?|TRS)\b)")
# A company named as a trustee company: "100 EXAMPLE TRUSTEE LLC", "EXAMPLE TRUSTEES INC".
_TRUSTEE_COMPANY = re.compile(r"\b(?:TRUSTEES?|TTEES?|TRS) (?:SERVICES |SERVICING |SOLUTIONS )?(?:LLC|LLLP|LLP|LP|INC|CORP|LTD|PLLC|CO)$")
# Legal forms that end a company's name; what follows the last one is not part of that name.
_LEGAL_FORM = re.compile(r"\b(?:LLC|LLLP|LLP|LP|INC|CORP|LTD|PLLC|PC|CO(?! (?:TRUSTEES?|TRS?|TTEES?)\b))\b")
# A land trust identified by number only ("TRUST NO 12345", "LAND TRUST 4021") names no person.
_NUMBERED_TRUST = re.compile(r"^(?:THE )?(?:LAND )?TRUST (?:NO |NUMBER )?\d[\d A-Z]*$")
# Securitisation and fund wording after "AS TRUSTEE FOR ...": certificate holders, a series, a numbered trust.
_SECURITIZATION = re.compile(
    r"\bCERTIFICATE ?HOLDERS\b|\bNOTE ?HOLDERS\b|\bBOND ?HOLDERS\b|\bHOLDERS OF\b|\bREGISTERED HOLDERS\b|\bSERIES\b"
    r"|\bPASS THROUGH\b|\bASSET BACKED\b|\bSECURITIES\b|\bMORTGAGE (?:LOAN |ASSET )?TRUST\b|\bTRUST \d{4}\b"
    r"|\bCERTIFICATES\b|\bSECURITIZATION\b")
# Words that make a trustee's or a trust's side an institution: banks and trust companies, schools, churches,
# hospitals, funds and plans, unions, districts and other public bodies. None is a common surname on its own.
_INSTITUTION_WORD = re.compile(
    r"\b(?:BANK|BANC|BANCORP|BANKING|TRUST COMPANY|TRUST CO|TITLE|SAVINGS|FIDUCIARY|NATIONAL ASSOCIATION|FSB|"
    r"COLLEGE|UNIVERSITY|SCHOOLS?|ACADEMY|SEMINARY|INSTITUTE|LIBRARY|MUSEUM|CEMETERY|SYNAGOGUE|CONGREGATION|PARISH|"
    r"DIOCESE|ARCHDIOCESE|MOSQUE|CATHEDRAL|CHURCH|CHAPEL|TABERNACLE|MINISTRY|MINISTRIES|FELLOWSHIP|BAPTIST|"
    r"METHODIST|CATHOLIC|LUTHERAN|PRESBYTERIAN|EPISCOPAL|EVANGELICAL|HOSPITAL|MEDICAL CENTER|HEALTH|FUND|FUNDS|"
    r"PENSION|RETIREMENT|ANNUITY|WELFARE|BENEFITS?|PROFIT SHARING|UNION|LOCAL \d+|DISTRICT|ISD|AUTHORITY|COUNTY|"
    r"CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|STATE|COMMONWEALTH|UNITED STATES|GOVERNMENT|COMMISSION|SOCIETY|LODGE|"
    r"LEGION|FOUNDATION|ASSOCIATION|CHARITABLE|CHARITIES|ESTATE BELONGING|CORPORATION|INC|LLC|LP|CORP|CO)\b")
# Connectors and descriptors that may sit around a trustee or a trust without naming anyone.
_FILLER = frozenset("THE OF FOR AND AS ET AL ETAL A AN UNDER TRUST TRUSTS TR AGREEMENT DATED DTD U W NO NUMBER "
                    "SUCCESSOR BY MERGER TO IN INTEREST".split())
# A bank or trust company: as trustee it often stands before a securitisation's name that the record cuts short.
_FINANCIAL = re.compile(r"\b(?:BANK|BANC|TRUST (?:CO|COMPANY)|NATIONAL ASSOCIATION|NATIONAL TRUST|TRUST N A|TRUST NA|"
                        r"WELLS FARGO|JPMORGAN|CITIBANK|HSBC|DEUTSCHE|LASALLE|BNY|MELLON|WILMINGTON TRUST|BANKERS TRUST)\b")
# What follows "<bank> AS TRUSTEE ..." in a securitisation's name, even where the record cuts it short.
_SECURITIZATION_WORD = re.compile(
    r"\b(?:ON BEHALF|BEHALF|HOLDERS|PASS|MORTGAGE|MORTGAGES|CERTIFICATES?|SERIES|ASSET|LOAN|LOANS|SECURITIES|REMIC|"
    r"CMBS|COMMERCIAL|RESIDENTIAL|FUNDING|ACCEPTANCE|ACQUISITION|MASTER|PARTICIPATION|NOTEHOLDERS|REGISTERED|"
    r"SECURITIZATION|RECEIVABLES)\b|\bTRUST \d")


def _segment_names_no_person(seg: str) -> bool:
    """Whether one side of a trustee construct is an institution, an organisation or a numbered trust (no person)."""
    tokens = [t for t in seg.split()]
    while tokens and tokens[0] in _FILLER:
        tokens.pop(0)
    while tokens and tokens[-1] in _FILLER:
        tokens.pop()
    seg = " ".join(tokens)
    if not seg:
        return True
    if all(t.isdigit() or t in _FILLER for t in tokens) or _NUMBERED_TRUST.match(seg) or _SECURITIZATION.search(seg):
        return True
    if _PERSONAL_TRUST_MARK.search(seg) or _PROBATE.search(seg):
        return False
    forms = list(_LEGAL_FORM.finditer(seg))
    if forms:
        after = seg[forms[-1].end():].split()
        tail = [t for t in after if t not in _FILLER and not t.isdigit()]
        of_place = bool(after) and after[0] == "OF" and not any(t in _TRADE_NAME_GIVEN_NAMES for t in tail)
        financial = bool(_FINANCIAL.search(seg)) and not any(t in _TRADE_NAME_GIVEN_NAMES for t in tail)
        if tail and not of_place and not financial and not _INSTITUTION_WORD.search(" ".join(tail)):
            return False  # "ACME LLC JOHN DOE": a name follows the company's
    if any(t in _TRADE_NAME_GIVEN_NAMES for t in tokens) and not _organization_reading(seg):
        return False
    if _organization_reading(seg):
        return True
    m = _INSTITUTION_WORD.search(seg)
    return bool(m) and not _only_given_names([t for t in tokens if not _INSTITUTION_WORD.fullmatch(t)])


def _wrapper_tail(s: str) -> bool:
    """Whether a personal trust, a trustee or a probate form follows a company's legal form ("ACME LLC DOE J REV TR")."""
    forms = list(_LEGAL_FORM.finditer(s))
    if not forms:
        return False
    first_end = forms[0].end()
    tail = s[first_end:]
    trustee = bool(_TRUSTEE.search(tail)) and not _trustee_company(s)
    return bool(_PERSONAL_TRUST_MARK.search(tail) or _PROBATE.search(tail) or trustee or _personal_instrument(tail))


def _company_estate(s: str) -> bool:
    """The estate of a company, as a bankruptcy estate is written: "THE ESTATE OF EXAMPLE GROUP LLC". What follows
    "ESTATE OF" is one company's name with no given name or family word and nothing person-carrying."""
    m = re.match(r"^(?:THE )?(?:ESTATE|EST) OF (.+)$", s)
    if not m:
        return False
    rest = m.group(1)
    forms = list(_LEGAL_FORM.finditer(rest))
    if not forms or forms[-1].end() != len(rest) or len(forms) > 1:
        return False
    tokens = rest.split()
    return (not any(t in _TRADE_NAME_GIVEN_NAMES or t in _FAMILY_WORDS for t in tokens)
            and not (_PERSONAL_TRUST_MARK.search(rest) or _PROBATE.search(rest) or _TRUSTEE.search(rest)
                     or _ANY_TRUST_WORD.search(rest))
            and _organization_reading(rest))


def _trustee_company(s: str) -> bool:
    """A company whose name holds a trustee word: "100 EXAMPLE TRUSTEE LLC", "EXAMPLE TRS 12 LLC" (a REIT's taxable
    subsidiary). The name ends in a legal form, and only TRS may stand anywhere but just before it."""
    if _TRUSTEE_COMPANY.search(s):
        return True
    forms = list(_LEGAL_FORM.finditer(s))
    if not forms or forms[-1].end() != len(s) or not re.search(r"\bTRS\b", s):
        return False
    rest = re.sub(r"\bTRS\b", " ", s)
    return not (_TRUSTEE.search(rest) or _PERSONAL_TRUST_MARK.search(s) or _PROBATE.search(s)
                or any(t in _TRADE_NAME_GIVEN_NAMES for t in s.split()))


def _personal_instrument(s: str) -> bool:
    """A dated or "under agreement" trust ("... TR DTD 1 2 2003", "... TRUST U A") that is not an organisation's.

    It is an organisation's when what precedes the instrument words is a named organisation trust with no given name
    and no FAMILY ("<number> <street> REALTY TRUST U A D ...", "EXAMPLE HOLDINGS TRUST NO 2 DATED ..."), a numbered
    land trust, or a securitisation."""
    m = _TRUST_INSTRUMENT_MARK.search(s)
    if not m or not _ANY_TRUST_WORD.search(s) or _SECURITIZATION.search(s):
        return False
    head = s[:m.start()].strip()
    tokens = head.split()
    if re.search(r"\bTRUST (?:NO |NUMBER )?\d", s):
        return False
    if (tokens and not any(t in _TRADE_NAME_GIVEN_NAMES or t in _FAMILY_WORDS for t in tokens)
            and not _TRUSTEE.search(head) and not _PERSONAL_TRUST_MARK.search(head) and _organization_reading(head)):
        return False
    return True


def _personal_trust_is_a_company_name(s: str) -> bool:
    """A personal-trust word inside a company's own name: "SMITH REVOCABLE HOLDINGS LLC", "SMITH FAMILY TRUST LP".

    The name must end in a legal form, and between the last personal-trust word and that form there may be only
    generic business words and trust words, so "DOE JANE REV TR ACME LLC" (a trust and a company) is not one."""
    forms = list(_LEGAL_FORM.finditer(s))
    if not forms or forms[-1].end() != len(s):
        return False
    marks = list(_PERSONAL_TRUST_MARK.finditer(s))
    if not marks:
        return False
    between = s[marks[-1].end():forms[-1].start()].split()
    trust_at = [i for i, t in enumerate(between) if t in ("TRUST", "TRUSTS", "TR", "TRST")]
    if marks[-1].group().split()[-1] in ("TRUST", "TRUSTS", "TR", "TRST"):
        trust_at = [-1] + trust_at
    if not trust_at:
        return True  # an adjective in the company's own name: "SEPARATE PROPERTY INVESTORS LP"
    return all(t in _GENERIC_BUSINESS_WORDS or t == "THE" for t in between[trust_at[-1] + 1:])


def _person_carrying(s: str) -> str | None:
    """The class of natural person a cleaned name carries, or None: ``estate``, ``personal_trust``,
    ``trustee_person`` or ``wrapper`` (any of the first three after a company's legal form)."""
    s = _COMPANY_BEFORE_TRUSTEE.sub(r"\1 COMPANY ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if _company_estate(s):
        return None
    if _wrapper_tail(s) and not _segment_names_no_person_after_trustees(s):
        return "wrapper"
    if _PROBATE.search(s):
        return "estate"
    if (_PERSONAL_TRUST_MARK.search(s) and not _personal_trust_is_a_company_name(s)
            and not (_SECURITIZATION.search(s) and {m.group() for m in _PERSONAL_TRUST_MARK.finditer(s)}
                     <= {"GRANTOR TRUST", "GRANTOR TR"})):
        return "personal_trust"  # a securitisation's "GRANTOR TRUST SERIES ..." is not a person's
    if _personal_instrument(s):
        return "personal_trust"
    if _trustee_company(s) and _organization_reading(s):
        return None  # a company whose name holds the word: "100 EXAMPLE TRUSTEE LLC"
    if _BOARD_OF_TRUSTEES.search(s) or _TRUSTEE.search(s):
        if not _segment_names_no_person_after_trustees(s):
            return "trustee_person"
        return None
    # A bare trailing "TR" or "TRUST" after a person's name: "SMITH JOHN PROPERTIES TRUST" is the person's.
    m = re.match(rf"^(.*\S) {_TRUST_WORD}(?: THE)?$", s)
    if (m and not _organization_reading(m.group(1)) and not _INSTITUTION_WORD.search(m.group(1))
            and not _structurally_organization(s) and not _NUMBERED_TRUST.match(s)):
        return "personal_trust"
    return None


def _segment_names_no_person_after_trustees(s: str) -> bool:
    """Split a name at its trustee words and board-of-trustees phrases; True when no side names a person."""
    parts = [p for p in re.split(_TRUSTEE, _BOARD_OF_TRUSTEES.sub(" | ", s).replace("|", " ")) if p is not None]
    if not (_BOARD_OF_TRUSTEES.search(s) or _TRUSTEE.search(s)):
        parts = [s]
    sides = [p.strip() for p in parts if p and p.strip()]
    if not sides:
        return False  # "TRUSTEE" alone names nobody, and nothing makes it an organisation
    if _personal_instrument(s):
        return False
    board = bool(_BOARD_OF_TRUSTEES.search(s))
    lenient = bool(_FINANCIAL.search(s)) or board
    if all(_segment_names_no_person(side) or (lenient and _unnamed_side(side, board)) for side in sides):
        return True
    # A company as trustee of a trust named for a number or an address ("ACME LLC TRUSTEE FOR 1234 MAIN ST TRUST").
    if len(sides) == 2 and _segment_names_no_person(sides[0]) and _organization_reading(sides[0]):
        other = [t for t in sides[1].split() if t not in _FILLER]
        return (any(t[:1].isdigit() for t in other[:1]) and not any(t in _TRADE_NAME_GIVEN_NAMES or t in _FAMILY_WORDS
                                                                   for t in other)
                and not (_PERSONAL_TRUST_MARK.search(sides[1]) or _PROBATE.search(sides[1])))
    return False


def _unnamed_side(side: str, board: bool) -> bool:
    """The other side of a bank's or a board's trusteeship that names no one: a word or two cut short by the record
    ("WELLS FARGO BANK N A AS TRUSTEE FOR THE <word>"), a numbered series, or a board's institution."""
    tokens = [t for t in side.split() if t not in _FILLER]
    if any(t in _TRADE_NAME_GIVEN_NAMES for t in tokens) or _PERSONAL_TRUST_MARK.search(side) or _PROBATE.search(side):
        return False
    return (board or len(tokens) <= 1 or any(any(c.isdigit() for c in t) for t in tokens)
            or bool(_SECURITIZATION_WORD.search(side)) or bool(_FINANCIAL.search(side)))


def person_carrying_class(name: str) -> str | None:
    """Why ``is_organization`` rejects a name that holds an organisation word, or None.

    ``estate`` ("ESTATE OF <person>", "HEIRS OF <person>", "<person> LIFE ESTATE"), ``personal_trust``
    ("<person> REV TR DTD ...", "<person> FAMILY TRUST", "<person> PROPERTIES TRUST"), ``trustee_person``
    ("<person> TRUSTEE", "TRUSTEES OF <person>", "<bank> AS TRUSTEE OF <person> TRUST") or ``wrapper`` ("<company>
    LLC <person> REV TR"). For the measurement and the purge report; ``is_organization`` is the rule.
    """
    return _person_carrying(_clean_for_rule(name))


# How a withheld party is described in place of its name (``organization_part``): what kind of party it was, never who.
WITHHELD_KINDS = {"estate": "estate", "personal_trust": "personal trust", "trustee_person": "trustee",
                  "wrapper": "company with a personal trust", None: "person"}


def organization_part(name: str) -> tuple[str | None, str | None]:
    """``(name to store, kind withheld)`` for one party of a recorded document.

    An organisation is stored as written: ``(name, None)``. A wrapper ("<company> LLC <person> REV TR") keeps its
    leading company, cut at that company's first legal form, when the cut part is an organisation that carries no
    person (``(company, "company with a personal trust")``); the person's part is withheld. Any other rejected name is
    withheld whole: ``(None, kind)`` with kind one of ``WITHHELD_KINDS`` ("estate", "personal trust", "trustee",
    "person"). The kind says a party existed and what it was, never who.
    """
    if is_organization(name):
        return name, None
    cls = person_carrying_class(name)
    kind = WITHHELD_KINDS.get(cls, "person")
    if cls == "wrapper":
        words = name.split()
        for i in range(1, len(words)):
            head = " ".join(words[:i]).rstrip(" ,;&-/")
            cleaned = _clean_for_rule(head)
            forms = list(_LEGAL_FORM.finditer(cleaned))
            if forms and forms[-1].end() == len(cleaned):
                if is_organization(head) and not _person_carrying(cleaned):
                    return head, kind
                break
    return None, kind


def _clean_for_rule(name: str) -> str:
    raw = _DBA.split(name.upper().replace("&", " AND "), maxsplit=1)[0]
    s = re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]+", " ", raw)).strip()
    spaced_lp = bool(_SPACED_LP.search(s)) and not _DOTTED_LP.search(raw) and _spaced_lp_is_partnership(s)
    for pattern, repl in _SUFFIXES:
        if pattern == r"\bL P\b" and not (_DOTTED_LP.search(raw) or spaced_lp):
            continue
        s = re.sub(pattern, repl, s)
    return _canonical_tokens(s)


def _organization_reading(s: str) -> bool:
    """The organisation reading of a cleaned name, before the person-carrying check (``is_organization``)."""
    if _PERSONAL_TRUST.search(s) and not _COMPANY_WORD.search(s):
        return False
    if _is_surname_collision(s):
        return False
    if _sole_proprietor_trade_name(s):
        return False
    return (bool(_ENTITY_TOKENS.search(s)) or _structurally_organization(s) or bool(_NUMBERED_TRUST.match(s))
            or _institution_as_trustee(s))


def _institution_as_trustee(s: str) -> bool:
    """An institution acting as or through trustees, with no person on any side: "EXAMPLE COLLEGE BOARD OF
    TRUSTEES", "TRUSTEES OF EXAMPLE UNIVERSITY", "EXAMPLE TRUST CO AS TRUSTEE"."""
    if not (_BOARD_OF_TRUSTEES.search(s) or _TRUSTEE.search(s)) or _TRUSTEE_COMPANY.search(s):
        return False
    s = re.sub(r"\s+", " ", _COMPANY_BEFORE_TRUSTEE.sub(r"\1 COMPANY ", s)).strip()
    if _PERSONAL_TRUST_MARK.search(s) or _PROBATE.search(s) or not _segment_names_no_person_after_trustees(s):
        return False
    return bool(_INSTITUTION_WORD.search(_TRUSTEE.sub(" ", _BOARD_OF_TRUSTEES.sub(" ", s))))


def is_organization(name: str) -> bool:
    """Conservative: anything not clearly an organisation is treated as a natural person.

    Family and personal trusts ("SMITH FAMILY TRUST") are treated as persons; real estate
    investment trusts are organisations. Only the part before a "DBA" counts, since a sole
    proprietor's trade name ("JOHN SMITH DBA SMITH PROPERTIES") does not make them an
    organisation, and neither does a trade name that is a person's own name and a generic business
    word ("SMITH JOHN PROPERTIES", ``_sole_proprietor_trade_name``). An apostrophe separates words here ("OWNERS'CORP" ends in CORP), unlike in
    ``normalize_name``, where it is dropped. "L.P." with a dot, "LP", and "Limited Partnership" are partnerships. A bare spaced
    "L P" is a partnership only with evidence (``_spaced_lp_is_partnership``), because it is also
    how a roll writes a person's initials ("GARCIA MARIA L P").

    A name that carries a natural person inside an organisation-style wrapper is a person whatever else it holds
    (``person_carrying_class``): a probate form ("ESTATE OF <person>"), a personal trust ("<person> REV TR DTD ...",
    "<person> FAMILY TRUST"), a trustee named in person ("<person> TRUSTEE", "TRUSTEES OF <person>") and a company
    followed by any of these ("<company> LLC <person> REV TR"). A bank or trust company acting as trustee with no
    person named, a numbered land trust, a board of trustees of an institution and a REIT, business or statutory
    trust stay organisations.
    """
    s = _clean_for_rule(name)
    if _person_carrying(s):
        return False
    return _organization_reading(s)


# Words that make an organisation's name read as a family's or a person's: its mailing address is likely a home.
_FAMILY_WORDS = frozenset("FAMILY FAMILIES ESTATE HEIRS".split())


def personal_style_organization(name: str) -> bool:
    """Whether an organisation's name reads as a person's or a family's ("JOHN SMITH LLC", "SMITH FAMILY LP",
    "SMITH J R HOLDINGS LLC"): the name is an organisation (``is_organization``), and apart from its legal form
    and business words it holds a given name (``_TRADE_NAME_GIVEN_NAMES``), FAMILY/ESTATE/HEIRS, or is one
    surname and two initials. Such an owner is kept (it is a legal organisation), but its mailing address is not stored or
    served, because for a one-person company it is most often the person's home (data policy section 3).
    Deliberately broad: a company named for its founder ("DAVID WEEKLEY HOMES") loses only its mailing address.
    """
    if not is_organization(name):
        return False
    raw = _DBA.split(name.upper().replace("&", " AND "), maxsplit=1)[0]
    tokens = re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]+", " ", raw)).split()
    words = [t for t in tokens if t not in _NOT_A_NAME_WORD and t not in NAME_STOP_TOKENS
             and t not in _GENERIC_BUSINESS_WORDS and t not in _LP_CONTEXT]
    if any(t in _FAMILY_WORDS for t in tokens) or _PERSONAL_TRUST_MARK.search(" ".join(tokens)):
        return True  # "SMITH FAMILY LP", "SMITH REVOCABLE HOLDINGS LLC"
    if any(t in _TRADE_NAME_GIVEN_NAMES for t in words):
        return True
    # A surname and two initials ("SMITH J R"), nothing else: "J P MORGAN CHASE BANK" and "A T T" are not.
    initials = [t for t in words if len(t) == 1 and t.isalpha()]
    others = [t for t in words if len(t) > 1 and t not in _NAME_SUFFIXES]
    return len(initials) == 2 and len(others) == 1


def legacy_name_key(name: str) -> str:
    """The key ``normalize_name`` made before 2026-11-03 (name key version 1).

    Kept so a registry built under it can be re-keyed in place (``Registry.rebuild_name_index``):
    a stored key is rewritten only if it is this function's output for the entity's current name.
    """
    s = name.upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pattern, repl in _SUFFIXES:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"^THE ", "", s)
    return re.sub(r"\s+", " ", s).strip()


NAME_KEY_VERSION = "2"


# --- name similarity (fuzzy owner matching) ---------------------------------------------------

# Tokens too common in organisation names to identify one: entity-type suffixes and generic
# real-estate words. They are dropped from the token index and from the token-overlap score,
# but they still take part in the character-level ratio, so "PROPERTIES" vs "PROPERTY" costs a little.
NAME_STOP_TOKENS = frozenset(
    "LLC LP LLP LLLP INC CORP CO LTD PLLC PC PA NA AND OF THE A DBA ETAL ET AL TR TRUST TRUSTEE TRUSTEES "
    "PROPERTIES PROPERTY HOLDINGS HOLDING INVESTMENTS INVESTMENT PARTNERS PARTNERSHIP GROUP REALTY REAL "
    "ESTATE DEVELOPMENT MANAGEMENT ENTERPRISES ENTERPRISE VENTURES VENTURE CAPITAL ASSOCIATES ASSOCIATION "
    "FUND EQUITIES EQUITY LAND HOMES APARTMENTS APARTMENT CENTER PLAZA PARK INTERNATIONAL SERVICES SERVICE "
    "TX TEXAS USA US AMERICA AMERICAN NATIONAL FAMILY".split()
)

# How the fuzzy score is built; recorded with every candidate so a reviewer knows what 0.91 means.
NAME_MATCH_RULE = "fuzzy_name_v1"
NAME_RATIO_WEIGHT = 0.7
NAME_OVERLAP_WEIGHT = 0.3
_TOKEN_ALIKE_RATIO = 0.8


def distinctive_tokens(key: str) -> list[str]:
    """Tokens of a normalized name that can identify it, in order, without duplicates.

    ``distinctive_tokens("ACME PROPERTIES LLC") == ["ACME"]``. Names made only of stop tokens
    (``"TEXAS PROPERTIES LLC"``) have none, so they are never fuzzy-matched.
    """
    out: list[str] = []
    for t in key.split():
        if t not in NAME_STOP_TOKENS and t not in out:
            out.append(t)
    return out


def _tokens_alike(a: str, b: str) -> bool:
    """Equal, or (for tokens of four or more characters) a near-equal spelling: OFFICE / OFICE."""
    if a == b:
        return True
    if len(a) < 4 or len(b) < 4:
        return False
    return SequenceMatcher(None, a, b, autojunk=False).ratio() >= _TOKEN_ALIKE_RATIO


def name_similarity(key_a: str, key_b: str) -> dict:
    """Deterministic similarity of two normalized names, in [0, 1], with its reasons.

    ``score = 0.7 * ratio + 0.3 * token_overlap`` where

    - ``ratio`` is ``difflib.SequenceMatcher`` over the two names with their tokens sorted, so a
      transposed word costs nothing and a typo or a singular/plural drift costs a little;
    - ``token_overlap`` is the Jaccard overlap of the distinctive tokens (stop tokens removed),
      counting near-equal spellings as the same token. It is what separates "ACME PROPERTIES LLC"
      from "ACME PROPERTIES II LLC" (0.80) while leaving "ACME PROPERTY LLC" (0.92) a candidate.

    Standard library only; the same inputs always give the same score.
    """
    tokens_a, tokens_b = key_a.split(), key_b.split()
    dist_a = distinctive_tokens(key_a) or tokens_a
    dist_b = distinctive_tokens(key_b) or tokens_b
    used: set[int] = set()
    shared: list[str] = []
    for t in dist_a:
        for j, u in enumerate(dist_b):
            if j not in used and _tokens_alike(t, u):
                used.add(j)
                shared.append(t)
                break
    union = len(dist_a) + len(dist_b) - len(shared)
    overlap = len(shared) / union if union else 0.0
    ratio = SequenceMatcher(None, " ".join(sorted(tokens_a)), " ".join(sorted(tokens_b)), autojunk=False).ratio()
    return {
        "score": round(NAME_RATIO_WEIGHT * ratio + NAME_OVERLAP_WEIGHT * overlap, 4),
        "ratio": round(ratio, 4),
        "token_overlap": round(overlap, 4),
        "shared_tokens": shared,
        "rule": NAME_MATCH_RULE,
    }


# Address search keys. Version 2 (2026-11-03) reads directionals and drops a unit, suite, "#" or
# floor designator with its value (``address_tokens`` in factlot.ids, shared with building IDs);
# a file built before keeps version 1 keys until ``Registry.rebuild_address_index`` re-keys it.
ADDRESS_KEY_VERSION = "2"

_STREET = {
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD",
    "LANE": "LN", "PARKWAY": "PKWY", "HIGHWAY": "HWY", "FREEWAY": "FWY", "COURT": "CT",
    "PLACE": "PL", "CIRCLE": "CIR", "TRAIL": "TRL", "SUITE": "STE", "NORTH": "N",
    "SOUTH": "S", "EAST": "E", "WEST": "W", "EXPRESSWAY": "EXPY",
}


def normalize_address(address: str) -> str:
    """Comparable key for a street address: '1200 Main Street NW, Suite 400' -> '1200 MAIN ST NW'.

    "Northwest", "North West" and "N.W." are "NW" (all eight directionals, before or after the
    street); a unit, suite, apartment, "#" or floor designator and its value are dropped. The
    TypeScript mirror (``normalizeAddress`` in packages/tools) must agree; ``spec/registry/normalize.json``
    holds the shared vectors.
    """
    return " ".join(address_tokens(address))


def legacy_address_key(address: str) -> str:
    """The key ``normalize_address`` made before 2026-11-03 (address key version 1)."""
    s = re.sub(r"[^A-Z0-9 ]+", " ", address.upper())
    return " ".join(_STREET.get(w, w) for w in s.split())


# Street types a query without a house number must name ("Ontario Rd", not "Ontario"): STREET_TYPES in
# packages/tools/src/registry.ts.
SEARCH_STREET_TYPES = frozenset(
    "ALY AVE BLVD BYP CIR CSWY CT DR EXPY FWY HWY LN LOOP PATH PIKE PKWY PL PLZ RD ROW RUN SQ ST TER TPKE TRL "
    "WALK WAY XING".split())


def address_query(query: str) -> dict:
    """How address search reads a query (``addressQuery`` in packages/tools): ``{"mode", "tokens"}``.

    ``tokens`` are the words of the street line (before the first comma) as the address index writes
    them. ``mode`` is ``house_number`` when the first word is a number, ``street`` when the words
    include a street type, else None: a city ("Ontario") or a part of a word does not search.
    """
    tokens = address_tokens(query.split(",")[0])
    if tokens and tokens[0][0] in "0123456789":
        mode = "house_number"
    elif any(t in SEARCH_STREET_TYPES for t in tokens):
        mode = "street"
    else:
        mode = None
    return {"mode": mode, "tokens": tokens}


_ORDINAL_WORD = re.compile(r"^([0-9]+)(?:ST|ND|RD|TH)$")


def address_words_without_ordinals(words: list[str]) -> list[str] | None:
    """The words of a street line with the ordinal endings of its street numbers dropped ("W 42ND ST" → "W 42 ST"),
    or None when no word after the first has one (``addressWordsWithoutOrdinals`` in packages/tools).

    Some rolls write numbered streets bare ("136 WEST 42 STREET", "350 5 AVENUE"), so a query that found nothing is
    searched once more this way. The first word is left alone: there it is a house number or the leading word.
    """
    return _ordinals_dropped(words, 1)


def _ordinals_dropped(words: list[str], start: int) -> list[str] | None:
    out = [m.group(1) if i >= start and (m := _ORDINAL_WORD.match(w)) else w for i, w in enumerate(words)]
    return out if out != words else None


# --- building roll-up: the street line and ZIP code of a situs address --------------------------

# Street types that end a street name, for situs lines written without a comma before the city.
_STREET_TYPES = frozenset("ST AVE RD DR BLVD LN PKWY HWY FWY EXPY CT PL CIR TRL TER SQ PLZ ALY WAY".split())
_DIRECTIONALS = frozenset("N S E W NE NW SE SW".split())
_ZIP_AFTER_COMMA = re.compile(r"\b([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")
_STATE_ZIP_TAIL = re.compile(r"\s([A-Z]{2})\s+([0-9]{5}(?:[- ]?[0-9]{1,4})?|[0-9]{1,4})\s*$")


def situs_street_and_zip(situs: str | None) -> tuple[str, str, str] | None:
    """``(street line, ZIP code, how the street line was found)`` of a situs address, or None.

    With a comma, the street line is what precedes the first comma (``"before_comma"``). Without
    one ("208 MASSACHUSETTS AVE NE # E WASHINGTON DC 20002"), the line must end in a state and ZIP
    code, and the street is taken to end at the first street type after the street name, with a
    directional right after it (``"street_type_end"``): an inference, labelled as such. The ZIP
    code is its first five digits; where the publisher cut the line short inside the ZIP code
    ("... WASHINGTON DC 2003") it is the one to four digits left, which the building roll-up may
    complete from other parcels at the same street line. A situs with no ZIP digits, or no street
    type to end on, gives None.
    """
    if not situs:
        return None
    s = situs.upper()
    if "," in s:
        street, rest = s.split(",", 1)
        m = _ZIP_AFTER_COMMA.search(rest)
        return (street.strip(), m.group(1), "before_comma") if m else None
    m = _STATE_ZIP_TAIL.search(s)
    if not m or m.group(1).lower() not in STATES:
        return None
    tokens = address_tokens(s[:m.start()])
    end = next((i for i in range(2, len(tokens)) if tokens[i] in _STREET_TYPES), None)
    if end is None or not tokens[0][:1].isdigit():
        return None
    if end + 1 < len(tokens) and tokens[end + 1] in _DIRECTIONALS:
        end += 1
    return " ".join(tokens[:end + 1]), m.group(2)[:5], "street_type_end"


_UNIT_MARK = re.compile(r"(?:^|\s)(?:#|STE|SUITE|UNIT|APT|APARTMENT)(?:\s|\.|$)")


def situs_names_unit(situs: str | None) -> bool:
    """True when a situs address carries a unit, suite, apartment or "#" designator."""
    return bool(situs) and bool(_UNIT_MARK.search(situs.upper().replace("#", " # ")))


def is_commercial(state_category: str | None) -> bool:
    """True for Texas state property categories in the registry's commercial scope.

    Appraisal districts subdivide the Comptroller's categories with extra digits: Harris codes
    multifamily B1–B4, Dallas codes F10, F20, B11, and B12. The letter and first digit decide;
    every subclass of category B is multifamily.
    """
    m = re.fullmatch(r"([A-Z])(\d*)", (state_category or "").strip().upper())
    if not m:
        return False
    letter, digits = m.groups()
    return letter == "B" or f"{letter}{digits[:1]}" in COMMERCIAL_CATEGORIES


# --- US states, for owner linking across jurisdictions ------------------------------------------

STATE_BY_FIPS = {
    "01": "al", "02": "ak", "04": "az", "05": "ar", "06": "ca", "08": "co", "09": "ct", "10": "de",
    "11": "dc", "12": "fl", "13": "ga", "15": "hi", "16": "id", "17": "il", "18": "in", "19": "ia",
    "20": "ks", "21": "ky", "22": "la", "23": "me", "24": "md", "25": "ma", "26": "mi", "27": "mn",
    "28": "ms", "29": "mo", "30": "mt", "31": "ne", "32": "nv", "33": "nh", "34": "nj", "35": "nm",
    "36": "ny", "37": "nc", "38": "nd", "39": "oh", "40": "ok", "41": "or", "42": "pa", "44": "ri",
    "45": "sc", "46": "sd", "47": "tn", "48": "tx", "49": "ut", "50": "vt", "51": "va", "53": "wa",
    "54": "wv", "55": "wi", "56": "wy", "72": "pr",
}
STATES = frozenset(STATE_BY_FIPS.values())
_STATE_ZIP = re.compile(r"\b([A-Z]{2})(?:\s+\d{5}(?:\s?-?\s?\d{4})?)?\s*$")


def parcel_state(parcel_urn: str) -> str | None:
    """Two-letter state of a parcel URN (``fl:parcel:us-48201:…`` → ``tx``), or None."""
    m = re.match(r"fl:parcel:us-(\d{2})\d{3}:", parcel_urn)
    return STATE_BY_FIPS.get(m.group(1)) if m else None


def entity_state(entity_urn: str) -> str | None:
    """Registry state of an entity URN (``fl:entity:us-ny:…`` → ``ny``), or None (e.g. ``lei``)."""
    m = re.match(r"fl:entity:us-([a-z]{2}):", entity_urn)
    return m.group(1) if m and m.group(1) in STATES else None


def address_state(address: str | None) -> str | None:
    """State at the end of a US mailing address (``PO BOX 1, HOUSTON, TX 77002-1234`` → ``tx``), or None."""
    if not address:
        return None
    s = re.sub(r"[^A-Z0-9 ]+", " ", address.upper()).strip()
    m = _STATE_ZIP.search(s)
    st = m.group(1).lower() if m else None
    return st if st in STATES else None


# --- contact names inside mailing addresses -----------------------------------------------------

# "ATTN JANE DOE", "ATTENTION: TAX DEPT", "C/O ACME MANAGEMENT LLC", "CARE OF ...": a routing line that
# can name a natural person. The name runs to a comma or to the next address part (a number, a unit or
# post-office box word).
_CONTACT_MARK = re.compile(r"(?<![A-Z0-9])(?:ATTN|ATTENTION|C\s*/\s*O|CARE\s+OF)(?![A-Z0-9])\s*:?\s*", re.I)
_ADDRESS_PART = re.compile(r"(?:\d\S*|#\S*|(?:STE|SUITE|UNIT|APT|FL|FLR|FLOOR|RM|ROOM|BLDG|PO|P\.O\.?|BOX|PMB|DRAWER)"
                           r"\b\.?)$", re.I)
# An entity suffix written after a comma ("NATIONAL REGISTERED AGENTS, INC."): still part of the name.
_SUFFIX_SEGMENT = re.compile(r",\s*(?:INC|INCORPORATED|LLC|L\.\s*L\.\s*C|LP|L\.\s*P|LLP|PLLC|PC|CORP|CORPORATION|CO|"
                             r"COMPANY|LTD|LIMITED|N\.?\s*A)\.?(?=\s*(?:,|$))", re.I)


def scrub_mailing_address(address: str | None) -> tuple[str | None, int]:
    """A mailing address without the contact names in it that are not clearly organisations.

    Data policy: owners of record are kept only for organisations, never natural persons, and the
    same holds for a person named on an organisation's mailing address ("ATTN JANE DOE", "C/O JOHN
    SMITH"). A contact that ``is_organization`` reads as an organisation ("C/O ACME MANAGEMENT LLC")
    stays; any other ("ATTN TAX DEPT" too, conservatively) is removed with its marker. Returns the
    address (None when nothing is left) and the number of contacts removed.
    """
    if not address:
        return address, 0
    out, removed, pos = [], 0, 0
    for m in _CONTACT_MARK.finditer(address):
        if m.start() < pos:
            continue
        rest = address[m.end():]
        stop = len(rest)
        comma = rest.find(",")
        while comma >= 0:
            suffix = _SUFFIX_SEGMENT.match(rest, comma)
            if not suffix:
                break
            comma = rest.find(",", suffix.end())
        if comma >= 0:
            stop = comma
        for w in re.finditer(r"\S+", rest[:stop]):
            if _ADDRESS_PART.match(w.group()):
                stop = w.start()
                break
        name = rest[:stop].strip()
        out.append(address[pos:m.start()])
        if not name:  # a marker with no name after it ("C/O BOX 118"): drop the marker only
            pos = m.end()
            continue
        if is_organization(name):
            out.append(address[m.start():m.end() + stop])
        else:
            removed += 1
        pos = m.end() + stop
    out.append(address[pos:])
    if not removed:
        return address, 0
    text = re.sub(r"\s+", " ", "".join(out))
    text = re.sub(r"\s*,\s*(?:,\s*)*", ", ", text).strip(" ,")
    return (text or None), removed


# --- entity standing, for disambiguating same-name entities ------------------------------------

# Status words the adapters write (lower case, underscores), grouped by whether the entity still
# exists as a legal person. A status that fits neither group is unknown and never used to decide.
_ENDED = re.compile(r"dissol|revoked|withdrawn|merge|converted|consolidated|terminated|cancel|expired|"
                    r"forfeit|inactive|surrender|closed|struck|liquidat|effectiveness_prevented|domesticated|dead")
_LIVE = re.compile(r"active|good_standing|exists|listed|delinquent|noncompliant|current|registered|"
                   r"in_existence|pending|resigned|reinstated|suspended")
# Texas "forfeited franchise tax": the right to transact business is forfeited, the entity is not.
# A negated status ("not_in_good_standing", "unregistered") says nothing reliable either way.
_UNDECIDED = re.compile(r"franchise|(?:^|_)not_|(?:^|_)un(?!der)")


def entity_standing(status: str | None) -> str | None:
    """``"live"`` or ``"ended"`` from an adapter's status word, or None when it says neither.

    Ended wins when both match ("active_pending_dissolution" is ended); "domesticated" counts as
    ended in the registry that used it (the entity continues under another registration); a
    Texas franchise-tax forfeiture is neither, since the entity still exists.
    """
    if not status:
        return None
    s = status.strip().lower().replace(" ", "_").replace("-", "_")
    if _UNDECIDED.search(s):
        return None
    if _ENDED.search(s):
        return "ended"
    return "live" if _LIVE.search(s) else None


# --- the place an address query names after its street line ---------------------------------------
# (``addressPlace`` and friends in packages/tools/src/registry.ts; the shared fixture test holds them alike)

STATE_NAMES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI",
    "MINNESOTA": "MN", "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA", "PUERTO RICO": "PR",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
    "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV", "WISCONSIN": "WI",
    "WYOMING": "WY",
}

# Unit, floor, suite, box, room, building and number words: a comma part holding one is a unit, not a place.
_UNIT_WORDS = frozenset("# APT BLDG BOX BUILDING DEPT FL FLOOR FLR LOT NO NUM NUMBER PO RM ROOM SPACE SPC STE SUITE "
                        "UNIT".split())
_ORDINAL_UNIT = re.compile(r"[0-9]+(?:ST|ND|RD|TH)")
_COUNTRY_TAILS = (("UNITED", "STATES", "OF", "AMERICA"), ("UNITED", "STATES"), ("U", "S", "A"), ("U", "S"), ("USA",),
                  ("US",))
_POSTAL = frozenset(s.upper() for s in STATE_BY_FIPS.values())
_WORDS = re.compile(r"[^A-Z0-9]+")
_PLACE_WORDS = re.compile(r"[^A-Z0-9#]+")
# A street-type word alone ("Loop") is matched among this many matches only (after those whose address is that word
# exactly) when the query names a place: the hosted index keeps no more (ADDRESS_ONE_WORD_CANDIDATES in TS).
ADDRESS_ONE_WORD_CANDIDATES = 100


def _words(text: str) -> list[str]:
    return [w for w in _WORDS.split(text.upper()) if w]


def _is_unit_word(w: str) -> bool:
    """A unit word, or a floor ordinal ("12th" in "12th Fl")."""
    return w in _UNIT_WORDS or bool(_ORDINAL_UNIT.fullmatch(w))


def _is_city_words(w: list[str] | None) -> bool:
    """A city: one to five words of letters, none a unit word."""
    return bool(w) and len(w) <= 5 and all(re.fullmatch(r"[A-Z]+", x) and not _is_unit_word(x) for x in w)


def address_place(query: str) -> dict[str, Any]:
    """The place an address query names after its street line (``addressPlace`` in TS): ``{"city", "state", "zip"}``,
    read conservatively from the end of the part after the first comma: a trailing country ("USA", "U.S.A.", "US",
    "United States") is dropped and "D.C." is DC; a ZIP code is a 5-digit number (or ZIP+4) that ends the query and
    does not follow a unit, suite, box, room, building or number word, and only orders the matches (a number of 4 or 6
    to 9 digits there, or "6103.0", is a ZIP code written wrongly and is passed over); a state (two
    letters, or the full name) counts only when it follows a city, in its comma part or the one before, and never
    after a unit word or floor ordinal, and is the only part that filters; the city is the comma part left at the
    end, and only orders. Anything else is ignored; a query without a comma names no place.
    """
    none = {"city": None, "state": None, "zip": None}
    if "," not in query:
        return none
    parts = [w for w in ([x for x in _PLACE_WORDS.split(p.upper().replace("#", " # ")) if x]
                         for p in query.split(",")[1:]) if w]

    def drop(n: int) -> None:
        del parts[-1][len(parts[-1]) - n:]
        if not parts[-1]:
            parts.pop()

    def tail(w: list[str], k: int) -> str:
        return " ".join(w[len(w) - k:])

    if parts:
        c = next((t for t in _COUNTRY_TAILS if len(parts[-1]) >= len(t) and tail(parts[-1], len(t)) == " ".join(t)),
                 None)
        if c:
            drop(len(c))
    # "D.C." and "D C" are DC.
    for w in parts:
        for i in range(len(w) - 2, -1, -1):
            if w[i] == "D" and w[i + 1] == "C":
                w[i:i + 2] = ["DC"]
    zip5 = None
    if parts:
        w = parts[-1]
        n = len(w)
        if n >= 2 and re.fullmatch(r"[0-9]{5}", w[-2]) and re.fullmatch(r"[0-9]{4}", w[-1]):
            k = 2
        elif re.fullmatch(r"[0-9]{5}", w[-1]):
            k = 1
        else:
            k = 0
        # A ZIP code written wrongly ("6103.0", "60701822", "7700"): not a ZIP code, and not read as anything else.
        if k:
            bad = 0
        elif n >= 2 and re.fullmatch(r"[0-9]{4}", w[-2]) and w[-1] == "0":
            bad = 2
        elif re.fullmatch(r"[0-9]{4}|[0-9]{6,9}", w[-1]):
            bad = 1
        else:
            bad = 0
        if k or bad:
            m = k or bad
            before = w[n - m - 1] if n - m - 1 >= 0 else None
            # "Suite 12345", "PO Box 12345": a unit's number, and the part is no place.
            if before is not None and before != "FL" and _is_unit_word(before):
                return none
            if k:
                zip5 = w[n - k]
            drop(m)
    state = None
    if parts:
        w = parts[-1]
        k, st = 0, None
        end = w[-1]
        if len(end) == 2 and end in _POSTAL:
            k, st = 1, end
        else:
            for j in range(min(3, len(w)), 0, -1):
                if tail(w, j) in STATE_NAMES:
                    k, st = j, STATE_NAMES[tail(w, j)]
                    break
        if st is not None:
            rest = w[:len(w) - k]
            before = rest[-1] if rest else None
            city = _is_city_words(rest) if rest else (len(parts) >= 2 and _is_city_words(parts[-2]))
            if (before is None or not _is_unit_word(before)) and city:
                state = st
                drop(k)
    c = parts[-1] if parts else None
    return {"city": " ".join(c) if _is_city_words(c) else None, "state": state, "zip": zip5}


_LABEL_ZIP_AFTER_COMMA = re.compile(r"(?:^|[^0-9A-Z_])([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")
_LABEL_STATE_ZIP_TAIL = re.compile(r"\s[A-Z]{2}\s+([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")


def _label_zip5(label: Any) -> str | None:
    """The 5-digit ZIP code of a situs label (``situs_zip5`` in tx_equity, ``situsZip5`` in TS)."""
    if not isinstance(label, str):
        return None
    s = label.upper().strip()
    m = _LABEL_ZIP_AFTER_COMMA.search(s.split(",", 1)[1]) if "," in s else _LABEL_STATE_ZIP_TAIL.search(s)
    return m.group(1) if m else None


def _label_in_city(label: Any, city: str) -> bool:
    """Whether a situs label is in ``city`` (``labelInCity`` in TS): after the street line, with the ZIP code and
    state dropped from the end, the last comma part is the city; a label without a comma ends with the city, a
    state and a ZIP code."""
    if not isinstance(label, str):
        return False
    s = label.upper()
    parts = [w for w in (_words(p) for p in (s.split(",")[1:] if "," in s else [s])) if w]
    while parts and parts[-1][-1].isdigit():
        parts[-1].pop()
        if not parts[-1]:
            parts.pop()
    had_state = bool(parts) and parts[-1][-1] in _POSTAL
    if had_state:
        parts[-1].pop()
        if not parts[-1]:
            parts.pop()
    w = parts[-1] if parts else []
    if "," in s:
        return " ".join(w) == city
    # No comma ("633 3RD ST NW WASHINGTON DC 20001"): the words before the state end with the city.
    c = city.split(" ")
    return had_state and len(w) > len(c) and " ".join(w[-len(c):]) == city


def address_place_rank(place: dict[str, Any], urn: str, label: Any) -> int:
    """Where a match goes in the answer to a query naming ``place`` (``addressPlaceRank`` in TS): -1 when the place
    names a state (or county) the match is not in (from its URN), else 0 when its label has the place's ZIP code, 1 when its
    label is in the place's city, 2 otherwise."""
    if place["state"] is not None:
        m = re.match(r"fl:[a-z]+:us-([0-9]{2})", urn)
        st = STATE_BY_FIPS.get(m.group(1)) if m else None
        if st is None or st.upper() != place["state"]:
            return -1
    if place.get("county") is not None:
        m = re.match(r"fl:[a-z]+:us-([0-9]{5})", urn)
        if not m or m.group(1) != place["county"]:
            return -1
    if place["zip"] is not None and _label_zip5(label) == place["zip"]:
        return 0
    if place["city"] is not None and _label_in_city(label, place["city"]):
        return 1
    return 2


def address_place_top(place: dict[str, Any]) -> int:
    """The rank of the first group a place can fill (``addressPlaceTop`` in TS)."""
    return 0 if place["zip"] is not None else 1 if place["city"] is not None else 2



# --- other spellings of a query's street line (``addressSearchForms`` and friends in TS) -----------------------------

_TENS_WORDS = {"TWENTY": 20, "THIRTY": 30, "FORTY": 40, "FOURTY": 40, "FIFTY": 50, "SIXTY": 60, "SEVENTY": 70,
               "EIGHTY": 80, "NINETY": 90}
_TENS_ORDINAL_WORDS = {"THIRTIETH": 30, "FORTIETH": 40, "FOURTIETH": 40, "FIFTIETH": 50, "SIXTIETH": 60,
                       "SEVENTIETH": 70, "EIGHTIETH": 80, "NINETIETH": 90}
_DIGIT_WORDS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6, "SEVEN": 7, "EIGHT": 8, "NINE": 9}


def ordinal_of(n: int) -> str:
    """"5TH", "42ND", "101ST" (``ordinalOf`` in TS)."""
    if 11 <= n % 100 <= 13:
        return f"{n}TH"
    return f"{n}" + {1: "ST", 2: "ND", 3: "RD"}.get(n % 10, "TH")


def _ordinal_value(w: str | None) -> int | None:
    if w is None:
        return None
    m = _ORDINAL_WORD.match(w)
    if m:
        return int(m.group(1))
    return _TENS_ORDINAL_WORDS.get(w)


def address_words_numbered(words: list[str]) -> list[str] | None:
    """The words of a street line with a numbered street written in words made one ordinal ("FORTY 2ND ST" → "42ND ST";
    "ONE HUNDRED TWENTY 5TH" → "125TH"; "FORTIETH" → "40TH"), or None when there is none (``addressWordsNumbered``)."""
    out: list[str] = []
    changed = False
    i = 0
    n = len(words)
    while i < n:
        w = words[i]
        j, hundreds = i, 0
        if w in _DIGIT_WORDS and i + 1 < n and words[i + 1] == "HUNDRED":
            hundreds = _DIGIT_WORDS[w] * 100
            j = i + 2
            if j < n and words[j] == "AND":
                j += 1
        tens = _TENS_WORDS.get(words[j], 0) if j < n else 0
        k = j + 1 if tens else j
        ord_ = _ordinal_value(words[k] if k < n else None)
        value = None
        if tens and ord_ is not None and 1 <= ord_ <= 9 and _ORDINAL_WORD.match(words[k]):
            value = hundreds + tens + ord_
        elif not tens and hundreds and ord_ is not None and ord_ < 100:
            value = hundreds + ord_
        elif not tens and not hundreds and w in _TENS_ORDINAL_WORDS:
            value = _TENS_ORDINAL_WORDS[w]
        if value is None:
            out.append(w)
            i += 1
            continue
        out.append(ordinal_of(value))
        changed = True
        i = k + 1
    return out if changed else None


def address_words_with_ordinals(words: list[str]) -> list[str] | None:
    """The words of a street line with each bare street number before a street type given its ordinal ending
    ("350 5 AVE" → "350 5TH AVE"), or None when there is none (``addressWordsWithOrdinals`` in TS)."""
    out = [ordinal_of(int(w)) if i > 0 and re.fullmatch(r"[0-9]+", w) and i + 1 < len(words)
           and words[i + 1] in SEARCH_STREET_TYPES else w for i, w in enumerate(words)]
    return out if out != words else None


def address_search_forms(words: list[str]) -> list[list[str]]:
    """The spellings a street line is searched by (``addressSearchForms`` in TS): as written first, then a numbered
    street in words as one ordinal, and the street numbers with and without their ordinal endings."""
    forms = [words]
    seen = {" ".join(words)}

    def add(w: list[str] | None) -> None:
        if w is not None and " ".join(w) not in seen:
            seen.add(" ".join(w))
            forms.append(w)

    n = address_words_numbered(words) or words
    add(n)
    # Manhattan's Sixth Avenue is "AVENUE OF THE AMERICAS" on the roll, mostly cut to "AVENUE OF THE AMER".
    aoa = next((i for i in range(len(n) - 3) if n[i:i + 4] == ["AVE", "OF", "THE", "AMERICAS"]), -1)
    if aoa >= 0:
        add(n[:aoa + 3] + ["AMER"] + n[aoa + 4:])
    six = next((i for i in range(len(n) - 1) if n[i] in ("6", "6TH") and n[i + 1] == "AVE"
                and (i > 0 or not (words and words[0][:1].isdigit()))), -1)
    if six >= 0:
        for end in ("AMER", "AMERICAS"):
            add(n[:six] + ["AVE", "OF", "THE", end] + n[six + 2:])
    # "Eye Street" is also written "I Street" (Washington, DC writes I).
    eye = [i for i, w in enumerate(n) if w == "EYE" and i + 1 < len(n) and n[i + 1] in SEARCH_STREET_TYPES]
    if eye:
        add(["I" if i in eye else w for i, w in enumerate(n)])
    # San Francisco writes "03RD ST" for 3rd Street.
    lead = not (words and words[0][:1].isdigit())
    padded = ["0" + w if (i > 0 or lead) and re.fullmatch(r"[1-9](?:ST|ND|RD|TH)", w) else w for i, w in enumerate(n)]
    if padded != n:
        add(padded)
    # Without a house number, the first word may be the street number itself ("42ND ST").
    add(_ordinals_dropped(n, 1 if words and words[0][:1].isdigit() else 0))
    add(address_words_with_ordinals(n))
    return forms


def _upper_ascii(s: str) -> str:
    return re.sub(r"[a-z]+", lambda m: m.group(0).upper(), s)


def address_key_matches(mode: str, words: list[str], key: str) -> bool:
    """Whether an address key matches a query's words under ``mode`` (``addressKeyMatches`` in TS): the search's LIKE
    rule on whole words."""
    k = _upper_ascii(key)
    spaced = f" {k} "
    if mode == "street":
        return f" {' '.join(words)} " in spaced
    if not f"{k} ".startswith(f"{words[0]} "):
        return False
    return all(f" {w} " in spaced for w in words[1:])


_DIRECTIONAL_WORDS = frozenset("N S E W NE NW SE SW".split())
# Counties whose hyphenated house numbers are one number, never a range (Queens, NY: "37-20 80 Street").
HYPHENATED_HOUSE_NUMBER_COUNTIES = frozenset({"36081"})
_LABEL_RANGE = re.compile(r"^\s*([0-9]+)-([0-9]+)\s")


def address_range(urn: str, label: Any, key: str) -> tuple[int, int, bool] | None:
    """A parcel's house-number range ``(low, high, one side)`` (``addressRange`` in TS), or None."""
    if not isinstance(label, str):
        return None
    m = _LABEL_RANGE.match(label)
    if not m:
        return None
    c = re.match(r"fl:[a-z]+:us-([0-9]{5}):", urn)
    if c and c.group(1) in HYPHENATED_HOUSE_NUMBER_COUNTIES:
        return None
    k = _upper_ascii(key).split(" ")
    if len(k) < 2 or k[0] != m.group(1) or k[1] != m.group(2):
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    return (lo, hi, lo % 2 == hi % 2) if lo < hi else None


def address_range_matches(words: list[str], urn: str, label: Any, key: str) -> bool:
    """Whether a query with a house number falls inside a parcel's house-number range (``addressRangeMatches``)."""
    if len(words) < 2 or not re.fullmatch(r"[0-9]+", words[0]):
        return False
    r = address_range(urn, label, key)
    if r is None:
        return False
    lo, hi, side = r
    n = int(words[0])
    if n <= lo or n > hi or (side and n % 2 != lo % 2):
        return False
    k = _upper_ascii(key).split(" ")
    # The street starts with the same word (the hosted index lists a range under it).
    if address_range_list_key(words, 1) != address_range_list_key(k, 2):
        return False
    rest = " " + " ".join(k[2:]) + " "
    return all(f" {w} " in rest for w in words[1:])


def address_range_list_key(words: list[str], start: int) -> str | None:
    """The hosted index's list of house-number ranges (``addressRangeListKey`` in TS)."""
    for w in words[start:]:
        if w not in _DIRECTIONAL_WORDS and w != "":
            return f"R:{w}"
    return None


def address_forms(runs: list[list[str]]) -> dict[str, list[list[str]]]:
    """``address_search_forms`` of each key version's words, the written ones first (``addressForms`` in TS)."""
    seen = {" ".join(w) for w in runs}
    other: list[list[str]] = []
    for run in runs:
        for f in address_search_forms(run)[1:]:
            if " ".join(f) not in seen:
                seen.add(" ".join(f))
                other.append(f)
    return {"first": runs, "other": other}


def address_row_tier(mode: str, forms: dict[str, list[list[str]]], urn: str, label: Any,
                     key: str) -> tuple[int, bool] | None:
    """How one index row matches a search (``addressRowTier`` in TS): (0, exact) as written, (1, exact) another
    spelling or a house-number range, else None."""
    for w in forms["first"]:
        if address_key_matches(mode, w, key):
            return 0, any(" ".join(x) == key for x in forms["first"])
    hit = any(address_key_matches(mode, w, key) for w in forms["other"])
    if not hit and mode == "house_number":
        hit = any(address_range_matches(w, urn, label, key) for w in forms["first"] + forms["other"])
    return (1, any(" ".join(x) == key for x in forms["other"])) if hit else None


def address_street_words(words: list[str]) -> list[str] | None:
    """The street of a query with a house number (``addressStreetWords`` in TS), or None."""
    if not words or not re.fullmatch(r"[0-9]+", words[0]):
        return None
    for i in range(1, len(words)):
        if words[i] in SEARCH_STREET_TYPES:
            end = i + 2 if i + 1 < len(words) and words[i + 1] in _DIRECTIONAL_WORDS else i + 1
            street = words[1:end]
            return street if len(street) >= 2 else None
    return None


def address_list_key(mode: str, words: list[str]) -> str | None:
    """The hosted index list a query's matches all appear in, or None (``addressListKey`` in TS)."""
    if not words or any(w == "" for w in words):
        return None
    if mode == "house_number":
        return f"F:{words[0]}"
    if len(words) == 1:
        return f"U:{words[0]}"
    for i in range(1, len(words)):
        if words[i] in SEARCH_STREET_TYPES:
            return f"B:{words[i - 1]} {words[i]}"
    return f"A:{words[0]} {words[1]}" if words[0] in SEARCH_STREET_TYPES else None


def address_hint_streets(mode: str, forms: dict[str, list[list[str]]]) -> list[tuple[list[str], str]]:
    """The street spellings a miss reads for its hint, each with its hosted index list (``addressHintStreets``)."""
    if mode != "house_number":
        return []
    out: list[tuple[list[str], str]] = []
    seen: set[str] = set()
    for f in forms["first"] + forms["other"]:
        street = address_street_words(f)
        if street is None or " ".join(street) in seen:
            continue
        lst = address_list_key("street", street)
        if lst is None or lst.startswith("U:"):
            continue
        seen.add(" ".join(street))
        out.append((street, lst))
    return out


# A miss reads a street's addresses for the nearest house numbers only when its hosted list has at most this many rows.
ADDRESS_STREET_HINT_ROWS = 5000


def address_street_hint_from(number: str, place: dict[str, Any],
                             lists: list[tuple[list[str], int, list[tuple[str, Any, str]] | None]]) -> dict | None:
    """The street hint of a miss (``addressStreetHintFrom`` in TS): ``lists`` holds each street spelling, its list's
    row count, and its rows (urn, label, key) when that is at most ADDRESS_STREET_HINT_ROWS."""
    if not lists:
        return None
    n = int(number)
    by_rank: list[list[int]] = [[], [], []]
    held: bool | None = False
    street = None
    for words, _count, rows in lists:
        if rows is None:
            if held is False:
                held = None
            continue
        for urn, label, key in rows:
            if not address_key_matches("street", words, key):
                continue
            rank = address_place_rank(place, urn, label)
            if rank < 0:
                continue
            held = True
            if street is None:
                street = " ".join(words)
            k = _upper_ascii(key).split(" ")
            r = address_range(urn, label, key)
            nums = [r[0], r[1]] if r else [int(k[0])] if re.fullmatch(r"[0-9]+", k[0]) else []
            by_rank[rank].extend(x for x in nums if x > 0 and x != n)
    best = next((i for i, g in enumerate(by_rank) if g), None)
    nums = by_rank[best] if best is not None else []
    below = [x for x in nums if x < n]
    above = [x for x in nums if x > n]
    nearest = ([max(below)] if below else []) + ([min(above)] if above else [])
    return {"street": street if street is not None else " ".join(lists[0][0]), "number": number, "held": held,
            "nearest": nearest if held else [], "rank": best}


# --- what tells parcels at one address apart (``addressCard`` in TS) ------------------------------------------------

ADDRESS_CARD_PREDICATES = ("parcel.apn", "parcel.state_property_category", "parcel.local_use_code",
                           "parcel.improvement_area_sf", "parcel.year_built")
_LABEL_UNIT = re.compile(r"(?:^|\s)(?:#|STE|SUITE|UNIT|APT|APARTMENT|ROOM|SPC)(?:\.|(?=[\s#]))\s*#?\s*([A-Z0-9][A-Z0-9-]*)")


def _card_text(v: Any) -> str | None:
    if isinstance(v, str) and v != "":
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf")):
        return _js_number(v)
    return None


def _js_number(v: float) -> str:
    """A number as JavaScript's String() writes it, for the values rolls hold (integers and plain decimals)."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return repr(v) if isinstance(v, float) else str(v)


def address_unit(text: Any) -> str | None:
    """The unit a label or query names after a designator in its street line ("Unit 101", "#103"), or None
    (``addressUnit`` in TS)."""
    if not isinstance(text, str):
        return None
    m = _LABEL_UNIT.search(_upper_ascii(text.split(",")[0]).replace("#", " # "))
    return m.group(1) if m else None


def address_card(label: Any, facts: list[dict[str, Any]]) -> dict[str, Any]:
    """What tells a search result apart from others at the same address (``addressCard`` in TS): account, property
    category, use code, improvement area, land only (no improvement area and no year built) and the unit its label
    names. Never an owner."""
    first: dict[str, Any] = {}
    for f in facts:
        first.setdefault(str(f["predicate"]), f["value"])
    area = first.get("parcel.improvement_area_sf")
    improvement = area if isinstance(area, (int, float)) and not isinstance(area, bool) else None
    built = first.get("parcel.year_built")
    return {
        "account": _card_text(first.get("parcel.apn")),
        "property_category": _card_text(first.get("parcel.state_property_category")),
        "use_code": _card_text(first.get("parcel.local_use_code")),
        "improvement_area_sf": improvement,
        "land_only": not (improvement is not None and improvement > 0) and built is None,
        "unit": address_unit(label),
    }


def address_card_key(urn: str, card: dict[str, Any]) -> tuple:
    """The order of parcels sharing one label (``addressCardCompare`` in TS): improved first, the largest improvement
    area first (none last), then URN."""
    area = card["improvement_area_sf"]
    return (card["land_only"], area is None, -(area or 0), _code_points(urn))


def _code_points(s: str) -> tuple:
    """SQLite's BINARY order of a string (code point order, as ``binaryCompare`` in TS)."""
    return tuple(ord(c) for c in s)


def address_match_key(m: dict[str, Any]) -> tuple:
    """The order of an address search's matches (``addressMatchCompare`` in TS): place group, the words as written
    first, exact address first, the label naming the query's unit first, then label (null first), then URN."""
    label = m["label"]
    return (m["rank"], m["tier"], not m["exact"], not m["unit"], label is not None,
            _code_points(label) if label is not None else (), _code_points(m["urn"]))


def _same_label_run(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return a["rank"] == b["rank"] and a["tier"] == b["tier"] and a["exact"] == b["exact"] and a["label"] == b["label"]


def address_window_end(ordered: list[dict[str, Any]], limit: int) -> int:
    """How many sorted matches to take cards for: the first ``limit`` and the rest of the last one's label."""
    end = min(limit, len(ordered))
    while 0 < end < len(ordered) and _same_label_run(ordered[end - 1], ordered[end]):
        end += 1
    return end


def address_result_rows(items: list[tuple[dict[str, Any], dict[str, Any]]], limit: int) -> list[dict[str, Any]]:
    """The answer's rows from (match, card) pairs of the window (``addressResultRows`` in TS)."""
    out = list(items)
    i = 0
    while i < len(out):
        j = i + 1
        while j < len(out) and _same_label_run(out[i][0], out[j][0]):
            j += 1
        if j - i > 1:
            out[i:j] = sorted(out[i:j], key=lambda mc: address_card_key(mc[0]["urn"], mc[1]))
        i = j
    return [{"urn": m["urn"], "label": m["label"], **card} for m, card in out[:limit]]


# --- the call's place parameters (``AddressWhere`` in TS) -----------------------------------------------------------

def state_code(s: str) -> str | None:
    """A state's two-letter code from its code or full name ("tx", "Texas", "D.C."), or None (``stateCode`` in TS)."""
    w = re.sub(r"[^A-Z]+", " ", s.upper()).strip()
    joined = w.replace(" ", "")
    if len(joined) == 2 and joined in _POSTAL:
        return joined
    return STATE_NAMES.get(w)


def address_where_of(args: dict[str, Any]) -> dict[str, str]:
    """The place parameters of a call's input (``addressWhereOf`` in TS)."""
    return {k: args[k] for k in ("state", "city", "postal_code", "county_fips") if isinstance(args.get(k), str)}


def address_where_issues(where: dict[str, str]) -> list[dict[str, str]]:
    """Problems with a call's place parameters, as input issues (``addressWhereIssues`` in TS)."""
    out: list[dict[str, str]] = []
    st = state_code(where["state"]) if "state" in where else None
    if "state" in where and st is None:
        out.append({"path": "state", "message": "expected a US state's two-letter code or full name"})
    if "postal_code" in where and not re.fullmatch(r"[0-9]{5}(?:-?[0-9]{4})?", where["postal_code"].strip()):
        out.append({"path": "postal_code", "message": "expected a 5-digit ZIP code or ZIP+4"})
    if "county_fips" in where:
        c = where["county_fips"].strip()
        if not re.fullmatch(r"[0-9]{3}(?:[0-9]{2})?", c):
            out.append({"path": "county_fips",
                        "message": "expected a 5-digit county FIPS code (state and county), or 3 digits with state"})
        elif len(c) == 3 and "state" not in where:
            out.append({"path": "county_fips", "message": "a 3-digit county FIPS code needs state"})
        elif len(c) == 5 and c[:2] not in STATE_BY_FIPS:
            out.append({"path": "county_fips", "message": f"{c} is in no US state"})
        elif len(c) == 5 and st is not None and STATE_BY_FIPS[c[:2]].upper() != st:
            out.append({"path": "county_fips", "message": f"{c} is not in {st}"})
    return out


_FIPS_BY_POSTAL = {v.upper(): k for k, v in STATE_BY_FIPS.items()}


def address_place_with(query: str, where: dict[str, str] | None = None) -> dict[str, Any]:
    """The place of a query with the call's place parameters (``addressPlaceWith`` in TS)."""
    where = where or {}
    out = dict(address_place(query))
    if "state" in where:
        out["state"] = state_code(where["state"])
    if "city" in where:
        c = " ".join(x for x in _PLACE_WORDS.split(where["city"].upper().replace("#", " # ")) if x)
        out["city"] = c or None
    if "postal_code" in where:
        out["zip"] = where["postal_code"].strip()[:5]
    if "county_fips" in where:
        c = where["county_fips"].strip()
        out["county"] = c if len(c) == 5 else _FIPS_BY_POSTAL.get(out["state"] or "", "00") + c
        if out["state"] is None:
            st = STATE_BY_FIPS.get(out["county"][:2])
            out["state"] = st.upper() if st else None
    return out


def address_query_with_place(query: str) -> str:
    """A query with a house number and no comma whose street line goes on after its street type with a place ending in a
    state or a ZIP code, with a comma put before the place (``addressQueryWithPlace`` in TS); any other unchanged."""
    if "," in query:
        return query
    q = address_query(query)
    if q["mode"] != "house_number":
        return query
    street = address_street_words(q["tokens"])
    if street is None:
        return query
    end = 1 + len(street)
    rest = q["tokens"][end:]
    if not rest:
        return query
    place = address_place("x, " + " ".join(rest))
    if place["state"] is None and place["zip"] is None:
        return query
    return " ".join(q["tokens"][:end]) + ", " + " ".join(rest)
