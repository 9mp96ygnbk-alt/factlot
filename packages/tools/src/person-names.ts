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
 * - it holds no organisation word at all ("EXAMPLE, PAT", "PAT M EXAMPLE", "EXAMPLE TRUST");
 * - a piece between markers read on the raw string is not an organisation. After a marker that routes to, acts for or
 *   holds an account for another party (C/O, C O, CARE OF, ATTN, ATTEN, ATT:, %, BY after a company, FBO, CFBO,
 *   U/W/O, UNDER WILL OF, IRA) every piece must be an organisation, whatever its words, once a person's roles
 *   (MEMBER, MANAGER, OFFICER, REFEREE, RECEIVER, PRESIDENT, ...) are read away. Between separators that also stand
 *   inside companies' names (A/K/A, F/K/A, "/", ";", " - ", a parenthetical) a piece counts only when it is shaped
 *   like a person's name (a given name, an initial, "SURNAME, GIVEN", a person's role);
 * - after a legal form, two or more plain words ("ACME LLC EXAMPLE PAT QUIN"); after REALTY, PROPERTIES,
 *   PARTNERSHIP, ASSOCIATES, PARTNERS or HOLDINGS, a given name or a comma and a name ("12 EXAMPLE REALTY, PAT
 *   EXAMPLE"); each co-owner after "&" or AND following a company is read on its own;
 * - a person comes first, then a company ("EXAMPLE PAT Q & ACME REALTY"), or a surname that is an organisation word
 *   comes before a given name ("CHURCH PAT Q", "CITY PAT & MARY EXAMPLE");
 * - after "doing business as", a marker piece names a person ("ACME INC DBA BETA INC ATTN: PAT EXAMPLE").
 */
import { ownerNamesAPerson } from "./owners.ts";

/** Common given names: the Python rule's list (``_TRADE_NAME_GIVEN_NAMES``, ``_MORE_GIVEN_NAMES``), common US given names
 *  curated by hand, leaving out names that are also places, months, virtues or common surnames ("AUSTIN", "JUNE",
 *  "GRACE" aside, "WILSON"). The same list is in Python. */
const GIVEN = new Set(
  "AARON ABBY ABE ABEL ABIGAIL ABRAHAM ADA ADAM ADELE ADOLFO ADRIAN ADRIANA ADRIENNE AGNES AHMED AIDA AILEEN AL ALAN ALBERT ALBERTO ALDO ALEC ALEJANDRA ALEJANDRO ALEX ALEXANDER ALEXANDRA ALEXIS ALFONSO ALFRED ALFREDO ALI ALICE ALICIA ALINE ALISON ALLAN ALLISON ALMA ALVIN ALYSSA AMANDA AMBER AMELIA AMIR AMIT AMOS AMY ANA ANDRE ANDREA ANDRES ANDREW ANDY ANGELA ANGELICA ANGELO ANGIE ANIL ANITA ANJALI ANN ANNA ANNE ANNETTE ANNIE ANTHONY ANTOINE ANTONIA ANTONIO ARCHIE ARIEL ARLENE ARMANDO ARNOLD ARON ARTHUR ARTURO ARUN ARYEH ASHISH ASHLEY ASHOK AUDREY AVA AVI AVRAHAM BARBARA BARRY BART BEATRICE BECKY BELINDA BEN BENITO BENJAMIN BENNETT BERNARD BERNICE BERT BERTHA BESSIE BETH BETSY BETTY BEVERLY BHARAT BILL BILLIE BILLY BINYAMIN BLAKE BLANCA BOB BOBBIE BOBBY BONNIE BORIS BORUCH BOYD BRAD BRADFORD BRADLEY BRANDI BRANDON BRANDY BRENDA BRENDAN BRENT BRET BRETT BRIAN BRIDGET BRITTANY BRUCE BRUNO BRYCE BYRON CALEB CALVIN CAMILLE CANDACE CANDICE CARA CARL CARLA CARLO CARLOS CARLTON CARMEN CARMINE CAROL CAROLE CAROLINE CAROLYN CARRIE CASEY CASSANDRA CATHERINE CATHY CECIL CECILIA CEDRIC CELIA CESAR CHAD CHAIM CHANA CHARLENE CHARLES CHARLIE CHARLOTTE CHAYA CHELSEA CHERYL CHESTER CHRIS CHRISTIAN CHRISTIE CHRISTINA CHRISTINE CHRISTOPHER CHRISTY CINDY CLAIRE CLARA CLARENCE CLAUDE CLAUDIA CLAUDIO CLINT CLYDE CODY COLE COLIN COLLEEN CONCETTA CONNIE CONRAD CONSTANCE CORA COREY CORY COURTNEY CRAIG CRISTINA CURT CURTIS CYNTHIA DALE DAMIAN DAN DANA DANIEL DANIELA DANIELLE DANNY DARLENE DARREN DARRYL DARYL DAVE DAVID DEAN DEANNA DEBBIE DEBORAH DEBRA DEEPAK DELIA DELORES DENISE DENNIS DEREK DESMOND DIANA DIANE DIANNE DICK DIEGO DINA DINESH DOLORES DOMENICO DOMINIC DOMINICK DON DONALD DONNA DORA DOREEN DORIS DOROTHY DOUG DOUGLAS DOV DOVID DUANE DUNG DUSTIN DWAYNE DWIGHT DYLAN EARL EARNEST ED EDDIE EDGAR EDITH EDMUND EDNA EDUARDO EDWARD EDWIN EFRAIN EILEEN ELAINE ELEANOR ELENA ELI ELIAS ELIEZER ELIJAH ELISA ELIYAHU ELIZABETH ELLA ELLEN ELLIOT ELLIOTT ELMER ELSA ELSIE ELVIRA EMANUEL EMIL EMILIO EMILY EMMA EMMANUEL ENRIQUE ERIC ERICA ERIK ERIKA ERIN ERNEST ERNESTO ERNIE ERVIN ESTELLE ESTHER ETHAN ETHEL EUGENE EUNICE EVA EVAN EVELYN FAYE FELICIA FELIPE FELIX FERNANDO FLORENCE FLOYD FRANCES FRANCESCA FRANCESCO FRANCINE FRANCIS FRANCISCO FRANK FRANKIE FRED FREDA FREDDIE FREDERICK GABRIEL GABRIELA GAETANO GAIL GARRETT GARY GAURAV GAVIN GENE GENEVIEVE GENNARO GEOFFREY GEORGE GERALD GERALDINE GERARD GERARDO GERTRUDE GILBERT GILBERTO GINA GIOVANNI GIUSEPPE GLADYS GLENDA GLENN GLORIA GRACE GRADY GREG GREGG GREGORY GRETCHEN GUADALUPE GUILLERMO GUS GWEN HANK HANNAH HARESH HARISH HAROLD HARRIET HARRY HARVEY HAZEL HEATHER HECTOR HEIDI HELEN HELENA HENRY HERBERT HERMAN HERSHEL HILDA HITESH HOMER HORACE HOWARD HUBERT HUGH HUGO HUNG HUONG IAN IDA IGNACIO IGOR IRENE IRMA IRVING ISAAC ISABEL ISABELLA ISIDRO ISMAEL IVAN JACK JACKIE JACOB JACQUELINE JACQUES JAGDISH JAIME JAKE JAMES JAMIE JAN JANA JANE JANET JANICE JANIS JARED JASMINE JASON JAVIER JAYESH JEAN JEANETTE JEANNE JEANNIE JEFF JEFFERY JEFFREY JENNA JENNIE JENNIFER JENNY JEREMIAH JEREMY JEROME JERRY JESS JESSE JESSICA JESUS JILL JIM JIMMIE JIMMY JO JOAN JOANN JOANNA JOANNE JODI JODY JOE JOEL JOEY JOHANNA JOHN JOHNNIE JOHNNY JON JONATHAN JORGE JOSE JOSEF JOSEPH JOSEPHINE JOSH JOSHUA JOSIE JOYCE JUAN JUANA JUANITA JUDITH JUDY JULIA JULIAN JULIE JULIO JULIUS JUSTIN KALPESH KAMAL KARA KAREN KARI KARL KARLA KATE KATHERINE KATHLEEN KATHRYN KATHY KATIE KAYLA KEITH KELLEY KELLI KELLY KEN KENNETH KENNY KENT KERRY KETAN KEVIN KIM KIMBERLY KIRAN KIRK KISHORE KRISTA KRISTEN KRISTIN KRISTINA KRISTY KURT KYLE LANCE LARRY LAURA LAUREN LAURIE LAVERNE LAWRENCE LEAH LEIB LEIGH LELAND LENA LEO LEON LEONARD LEONARDO LEROY LESLIE LESTER LETICIA LEWIS LILA LILLIAN LILLIE LINDA LINDSAY LINDSEY LIONEL LISA LLOYD LOIS LONNIE LORENA LORENZO LORETTA LORI LORRAINE LOU LOUIS LOUISE LUCAS LUCILLE LUCY LUIS LUKE LUPE LUZ LYDIA LYLE LYNDA LYNN MABEL MADELINE MAE MAGGIE MAHESH MALCOLM MANDY MANISH MANOJ MANUEL MARC MARCEL MARCIA MARCO MARCOS MARCUS MARCY MARGARET MARGARITA MARGIE MARGO MARIA MARIAN MARIANNE MARIE MARILYN MARIO MARISA MARISOL MARJORIE MARK MARLA MARLENE MARSHA MARTA MARTHA MARTIN MARTY MARVIN MARY MATHEW MATT MATTHEW MAUREEN MAURICE MAURICIO MAXINE MAYUR MEGAN MEIR MELANIE MELINDA MELISSA MELVIN MENACHEM MEREDITH MICHAEL MICHEL MICHELE MICHELLE MIGUEL MIKE MILDRED MILLIE MILTON MINDY MINH MIRIAM MITCHELL MOHAMMAD MOHAMMED MOISES MOLLY MONICA MONIQUE MORDECHAI MOSES MOSHE MUKESH MURIEL MYRA MYRON NADIA NAFTALI NANCY NAOMI NARESH NATALIE NATHAN NATHANIEL NEAL NED NEIL NELLIE NICHOLAS NICK NICOLAS NICOLE NIKHIL NIKKI NINA NITIN NOAH NOEL NOLAN NORA NORMA NORMAN NUNZIO OLGA OLIVER OLIVIA OMAR ORLANDO OSCAR OTIS OTTO OWEN PABLO PAMELA PANKAJ PARESH PASQUALE PAT PATRICIA PATRICK PATSY PATTY PAUL PAULA PAULINE PEDRO PEGGY PERCY PERRY PETE PETER PHIL PHILIP PHILLIP PHUONG PHYLLIS PIERRE PRADEEP PRAKASH PRAVIN PRISCILLA PRIYA QUANG QUENTIN RACHEL RAFAEL RAHUL RAJ RAJENDRA RAJESH RAJIV RAKESH RALPH RAMESH RAMON RANDALL RANDY RAQUEL RAUL RAVI RAY RAYMOND REBECCA REGINA REGINALD RENE RENEE REUBEN REYNALDO RHONDA RICARDO RICH RICHARD RICK RICKY RITA RIVKA ROBBIE ROBERT ROBERTA ROBERTO ROBIN ROBYN ROCCO RODNEY RODOLFO RODRIGO ROGELIO ROGER ROHIT ROLAND ROLANDO RON RONALD RONNIE ROSA ROSALIE ROSANNE ROSARIO ROSEMARY ROXANNE ROY RUBEN RUDOLPH RUDY RUSS RUSSELL RUTH RYAN SABRINA SADIE SALLY SALVADOR SALVATORE SAM SAMANTHA SAMEER SAMUEL SANDEEP SANDRA SANJAY SANTIAGO SANTOS SARA SARAH SATISH SAUL SCOTT SEAN SERGIO SETH SHAILESH SHANE SHANKAR SHANNON SHARON SHAWN SHEILA SHELBY SHELDON SHELLEY SHELLY SHERI SHERRI SHERRY SHIRLEY SHLOMO SHMUEL SHYAM SIDNEY SILVIA SIMON SOFIA SONIA SONYA SOPHIA SOPHIE STACEY STACY STANLEY STELLA STEPHAN STEPHANIE STEPHEN STEVE STEVEN SUDHIR SUE SUNIL SUNITA SURESH SUSAN SUSIE SUZANNE SYDNEY SYLVIA TAMARA TAMMY TANYA TARA TED TEDDY TERESA TERRANCE TERRENCE TERRI TERRY THANH THELMA THEODORE THERESA THOMAS TIFFANY TIM TIMMY TIMOTHY TINA TODD TOM TOMAS TOMMY TONI TONY TONYA TRACEY TRACY TRANG TRENT TREVOR TRICIA TROY TRUDY TUAN TYLER TYRONE UMESH URSULA VALERIE VANESSA VAUGHN VERA VERNA VERONICA VICKI VICKIE VICKY VICTOR VIJAY VIKRAM VINCENT VINCENZO VINOD VIOLA VIPUL VIRGIL VIRGINIA VIVIAN WALT WALTER WANDA WARREN WAYNE WENDELL WENDY WESLEY WILBUR WILLARD WILLIAM WILLIE WILLIS WILMA WINIFRED WINSTON YAAKOV YEHOSHUA YEHUDA YISROEL YITZCHAK YITZCHOK YOGESH YOLANDA YOSEF YOSSI YVETTE YVONNE ZACHARY ZEV".split(
    " ",
  ),
);
const QUALIFIER =
  "(?:CO|SUCCESSOR|SUC|SUCC|SOLE|SPECIAL|TEMPORARY|TEMPOARY|TEMP|PRELIMINARY|INDEPENDENT|ANCILLARY|SUBSTITUTE|ALTERNATE|INTERIM|ACTING|DOMICILIARY|JOINT)";
const CO_ROLE = `(?:${QUALIFIER} )*(?:TRUSTEES?|TRUSTEER|TRS?|TRU|TTEES?|TRUS|TRUSTS?|TRST|TRSUTEES?|GENERAL PARTNERS?|PARTNER|OWNERS?|TENANTS?|ADMIN|EXEC|EXE|EXECUT|EXECUTORS?|EXECUTRIX|EXRS?|ADMINISTRATORS?|ADMINISTRATRIX|ADMRS?|PERSONAL REPRESENTATIVES?|PERSONAL REP|GUARDIANS?|CONSERVATORS?|COMMITTEE|RECEIVERS?|T$)\\b`;
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
    "\\b(?:\\w*BANK\\w*|BANC\\w*|TRUST|SAVINGS|FINANCIAL|NATIONAL|CITIZENS|MELLON|MBNA)\\b.*\\bN A$",
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
/** Organisation words that end a company's name like a legal form: what follows them is read like what follows a
 *  legal form ("<NUMBER> <WORD> REALTY, PAT EXAMPLE", "<WORD> ASSOCIATES PAT EXAMPLE"). */
const ANCHOR = new RegExp(
  `${LEGAL_FORM.source}|\\b(?:REALTY|RLTY|PROPERTIES|PPTIES|PARTNERSHIP|PTNRSHP|PRTNRSHP|PTNRSHIP|PRTNRSHIP|PTSHP|PRTSHP|ASSOCIATES|ASSOCS|PARTNERS|PTNRS|HOLDINGS)\\b`,
  "g",
);
/** Place words that may follow a company's name ("... HOLDINGS NORTH AMERICA", "... INC TEXAS"). */
const PLACE_WORDS = new Set(
  "NORTH SOUTH EAST WEST NORTHEAST NORTHWEST SOUTHEAST SOUTHWEST CENTRAL NEW YORK JERSEY HAMPSHIRE MEXICO CAROLINA DAKOTA RHODE ISLAND WEST ALABAMA ALASKA ARIZONA ARKANSAS CALIFORNIA COLORADO CONNECTICUT DELAWARE FLORIDA GEORGIA HAWAII IDAHO ILLINOIS INDIANA IOWA KANSAS KENTUCKY LOUISIANA MAINE MARYLAND MASSACHUSETTS MICHIGAN MINNESOTA MISSISSIPPI MISSOURI MONTANA NEBRASKA NEVADA OHIO OKLAHOMA OREGON PENNSYLVANIA TENNESSEE TEXAS UTAH VERMONT VIRGINIA WASHINGTON WISCONSIN WYOMING AMERICA AMERICAS USA US CANADA EUROPE ASIA PACIFIC ATLANTIC GLOBAL WORLDWIDE".split(
    " ",
  ),
);
const STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);
/** Before a given name, words that make it part of a place's or a surname's name ("SAN ANTONIO", "D'ANGELO"). */
const NOT_BEFORE_GIVEN = new Set(
  "SAN SANTA ST SAINT FORT FT PORT MOUNT MT LAKE CAPE A AN D O MORGAN VIRGIN".split(
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
  const forms = [...s.matchAll(ANCHOR)];
  if (forms.length === 0) return false;
  const last = forms[forms.length - 1]!;
  const head = s.slice(0, last.index).split(" ");
  const tail = s
    .slice(last.index! + last[0].length)
    .replace(
      /\b(?:ET ALS?|ETAL|ETALS|ET UX|ETUX|ET VIR|ETVIR|C O|ATTN|ATTENTION|ATT|CARE OF|BY)\b/g,
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
  // "... PROPERTIES OF <PLACE>", "... LLC, A DELAWARE ...", "... PARTNERSHIP TO END ...", "... LLC AS TO 50%"
  if (/^(?:OF|A|AN|TO|FOR|IN|AT|ON|AS|ITS|FKA|AKA|NKA|F|N)$/.test(tail[0]!))
    return false;
  // "N V", "S A" (a foreign legal form), "III A GP" (a fund's number and its general partner)
  if (
    tail.every(
      (t) =>
        t.length === 1 ||
        /^(?:I|II|III|IV|V|VI|GP|LC|PS|PC|NV|SA|BV|AG)$/.test(t),
    )
  )
    return false;
  if (/^(?:CORP|LLC|INC|LTD|LLP|LP|CO)$/.test(tail.join(""))) return false; // "... COR P": a legal form cut in two
  // Each co-owner after AND is read on its own; a piece of plain words that are not the company's own is a person.
  const pieces = tail
    .join(" ")
    .split(/\bAND\b/)
    .map((p) =>
      p
        .trim()
        .split(" ")
        .filter((t) => t !== "" && t !== "THE"),
    )
    .filter((p) => p.length > 0);
  return pieces.some((p) => {
    if (
      p.some(
        (t) =>
          /\d/.test(t) ||
          NOT_A_PERSON_TAIL.has(t) ||
          COMPANY_ROLE_WORDS.has(t) ||
          DESCRIPTOR_WORDS.has(t),
      )
    )
      return false;
    const words = p.filter((t) => !PLACE_WORDS.has(t) && !ROLE_WORDS.has(t));
    if (words.length === 0) return false;
    if (words.some((t) => GIVEN.has(t))) return true;
    if (ORGANIZATION.test(words.join(" "))) return false;
    const own = words.filter((t) => t.length > 2);
    if (own.length > 0 && own.every((t) => head.includes(t))) return false; // "ACME WEST LLC & ACME WEST"
    // after a bare "CO" (also a county's abbreviation: "<NAME> CO WATER CONTROL") or an organisation word that is
    // not a legal form ("... REALTY <PROPERTY LABEL>") only a given name, or a comma (personAfterComma), says person
    return (
      words.length >= 2 &&
      last[0] !== "CO" &&
      new RegExp(`^(?:${LEGAL_FORM.source})$`).test(last[0])
    );
  });
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

/** Roles a person holds in a company's name, read away before a piece is judged ("PAT EXAMPLE, SOLE MEMBER"). */
const ROLE_WORDS = new Set(
  "AS ITS SOLE MEMBER MEMBERS MANAGING MANAGER MANAGERS MGR MGMR OFFICER OFFICERS REFEREE RECEIVER PRESIDENT PRES VICE VP CEO CFO COO ESQ ESQUIRE MR MRS MS DR AUTHORIZED SIGNATORY SIGNER PARTNER GENERAL OWNER".split(
    " ",
  ),
);
/** Words that make a piece a routing or a share, never a name ("20% INT", "UNDIVIDED INTEREST", "ET AL"). */
const NEUTRAL_WORDS = new Set(
  "ET AL ETAL ETALS ETUX INT INTEREST INTERESTS UNDIVIDED PCT PERCENT TIC THE OF AND A AN ITS NOMINEE AGENT FKA AKA NKA F K N".split(
    " ",
  ),
);
/** A company's own roles after a comma ("ACME LLC, SUCCESSOR TRUSTEE", "ACME INC, AS AGENT"). */
const COMPANY_ROLE_WORDS = new Set(
  "ATTORNEY FACT TRUSTEE TRUSTEES TTEE TR SUCCESSOR ADMINISTRATOR ADMINISTRATIVE COLLATERAL INDENTURE EXECUTOR CUSTODIAN SERVICER SUBSERVICER AGENT NOMINEE LENDER BORROWER GRANTOR GRANTEE ASSIGNEE ASSIGNOR SUCCESSORS ASSIGNS".split(
    " ",
  ),
);
/** Words of a routing or a description, never of a name ("REAL ESTATE DEPARTMENT", "TAX DEPT", "SERIES A"). */
const DESCRIPTOR_WORDS = new Set(
  "COMMERCIAL INDUSTRIAL RETAIL LAND CATTLE FEE BAPTIST METHODIST CATHOLIC LUTHERAN PRESBYTERIAN PENTECOSTAL EPISCOPAL EVANGELICAL FELLOWSHIP MINISTRY MINISTRIES TABERNACLE ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN FORTY INCOME CHAPEL COMMUNITY HOME LOAN LENDING FUNDING MORTGAGE SHARE SEPARATE GP CREDIT PREDECESSOR SUCCESSOR ISAOA ATIMA LIABILITY COMP COMPA COMPAN CORPORA CORPORAT CORPORATIO PLAN PLANS PROFIT SHARING RETIREMENT PENSION EMPLOYEES NONPROFIT BRANCH CUSTODIAN CUST CLUB DEPT DEPARTMENT DIV DIVISION TAX TAXES ACCOUNTS ACCOUNTING PAYABLE LEGAL COUNSEL OFFICE SERIES PHASE UNIT SUITE STE FLOOR BUILDING BLDG LOT TRACT PARCEL STORE BRANCH PROPCO OPCO HOLDCO SUB SUBSIDIARY WATER CONTROL ISO COMPANIES INDUSTRIES SUPPLY SYSTEMS SOLUTIONS TECHNOLOGIES REFINING REFG CHEM CHEMICAL STATION STUDENTS DATA CENTERS".split(
    " ",
  ),
);
/** Generic words that may follow "&" in a company's own name ("SMITH & SONS", "EXAMPLE BANK & TRUST"). */
const GENERIC_AFTER_AND = new Set(
  "AFFILIATES AFFILIATE SUBSIDIARIES SUBSIDIARY OTHERS ASSIGNS ASSIGNEES SUCCESSORS SUCCESSOR HEIRS COMPANIES ENTITIES CO COMPANY SON SONS BROTHERS BROS DAUGHTERS TRUST TR SAVINGS LOAN ASSOCIATES ASSOCS PARTNERS ASSOCIATION NA N A".split(
    " ",
  ),
);

/** The legal form or organisation word at the end of a piece, after which "&" starts a new owner. */
const ENDS_LIKE_ORGANIZATION = new RegExp(
  `(?:${ANCHOR.source}|\\b(?:FOUNDATION|ASSOCIATION|CHURCH|UNIVERSITY|COLLEGE|HOSPITAL|SOCIETY|FUND|BANK|CONGREGATION|SYNAGOGUE|TEMPLE|MINISTRIES)\\b)\\.?\\s*,?\\s*$`,
);

/** The raw name, upper case, with apostrophes dropped and dotted legal forms joined ("L.L.C.", "L.P.", "P/S"). */
function rawUpper(value: string): string {
  return value
    .toUpperCase()
    .replace(/['‘’`]/g, "")
    .replace(/\bP\s*\/\s*S\b/g, " PARTNERSHIP ")
    .replace(/\bU\.?\s?S\.?(?=\s|$)/g, "US")
    .replace(/\bL\.\s*L\.\s*C\.?/g, " LLC ")
    .replace(/\bL\.\s*P\./g, " LP ");
}

/** Markers that route to, act for or hold an account for another party: what follows names that party, so every
 *  piece between them must be an organisation, whatever its words ("ACME LLC C/O PAT EXAMPLE", "ACME INC BY PAT
 *  EXAMPLE", "EXAMPLE TRUST CO FBO PAT EXAMPLE", "EXAMPLE TRUST U/W/O PAT EXAMPLE"). */
const STRONG_MARKER = new RegExp(
  [
    "\\bC\\s*/\\s*O\\b",
    "\\bC\\.\\s*O\\.",
    `(?<=(?:${LEGAL_FORM.source})\\.?,?)\\s+C\\s+O\\b`,
    "\\bCARE\\s+OF\\b",
    "\\bATTN\\b:?",
    "\\bATTEN\\b:?",
    "\\bATTENTION\\b:?",
    "\\bATT\\s*:",
    "%",
    `(?<=(?:${LEGAL_FORM.source})\\.?\\s*,?)\\s+BY\\b:?`,
    ",\\s*BY\\b:?",
    "\\bC?F\\s*/?\\s*B\\s*/?\\s*O\\b",
    "\\bU\\s*/\\s*W\\s*/?\\s*O?\\b(?:\\s+OF\\b)?",
    "\\bUWO\\b",
    "\\bUNDER\\s+(?:THE\\s+)?(?:LAST\\s+)?WILL\\s+(?:AND\\s+TESTAMENT\\s+)?OF\\b",
    "\\bIRA\\b(?!\\s+(?:INC|LLC|LP|LTD|CORP|CO|COMPANY|SERVICES|SERVICING|ADMINISTRATION|ADMINISTRATORS?|TRUST\\s+CO|TRUST\\s+COMPANY|INNOVATIONS|CAPITAL|HOLDINGS|PARTNERS|FINANCIAL|ADVISORS|INVESTMENTS?|RESOURCES|GROUP)\\b)",
  ].join("|"),
  "g",
);
/** Separators that may also stand inside a company's own name ("ACME/BETA LLC", "ACME LLC - SERIES A", "ACME (USA)
 *  INC", "RGV CU AKA <WORD> CREDIT UNION"): a piece between them is a person only when it is shaped like one. */
const WEAK_SEPARATOR = new RegExp(
  [
    "\\bA\\s*/\\s*K\\s*/\\s*A\\b",
    "\\bAKA\\b",
    "\\bF\\s*/\\s*K\\s*/\\s*A\\b",
    "\\bFKA\\b",
    "\\bN\\s*/\\s*K\\s*/\\s*A\\b",
    // a slash or a parenthesis between words, not inside markup or "ALERT(1)"
    "(?<=[A-Z0-9.,]{2}|\\s)/(?=\\s|[A-Z0-9]{2})",
    ";",
    "\\s-\\s",
  ].join("|"),
  "g",
);

function splitOn(text: string, re: RegExp): string[] {
  return text
    .split(re)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** A piece shaped like a person's name: a given name ("PAT EXAMPLE"), an initial beside a word ("EXAMPLE PAT Q"),
 *  "SURNAME, GIVEN", or a person's role ("..., SOLE MANAGER"). */
function personShaped(piece: string): boolean {
  if (/[A-Z]{2,}\s*,\s*[A-Z]{2,}/.test(piece)) return true;
  const t = clean(piece).split(" ");
  if (
    t.some(
      (x) => ROLE_WORDS.has(x) && !/^(?:AS|ITS|GENERAL|PARTNER|OWNER)$/.test(x),
    )
  )
    return true;
  return t.some(
    (x, i) =>
      (GIVEN.has(x) && !(i > 0 && NOT_BEFORE_GIVEN.has(t[i - 1]!))) ||
      (/^[B-HJ-Z]$/.test(x) &&
        (/^[A-Z]{2,}$/.test(t[i - 1] ?? "") ||
          /^[A-Z]{2,}$/.test(t[i + 1] ?? ""))),
  );
}

/** Whether one marker piece names a natural person: what is left once its role words are read away is not an
 *  organisation. A piece that is only a share, a number, a street, a routing, a role or initials names no one. */
function pieceIsPerson(piece: string): boolean {
  const words = clean(piece)
    .split(" ")
    .filter((t) => t !== "" && !ROLE_WORDS.has(t));
  if (words.length === 0) return false;
  if (words.some((t) => /\d/.test(t))) return false; // a share, an account number or a street
  if (words.every((t) => NEUTRAL_WORDS.has(t) || t.length === 1)) return false;
  if (
    words.every(
      (t) =>
        NOT_A_PERSON_TAIL.has(t) ||
        DESCRIPTOR_WORDS.has(t) ||
        NEUTRAL_WORDS.has(t),
    )
  )
    return false; // a routing or a description: "REAL ESTATE DEPARTMENT", "SERIES A"
  if (
    words.some(
      (t) =>
        DESCRIPTOR_WORDS.has(t) || (NOT_A_PERSON_TAIL.has(t) && t !== "CO"),
    ) &&
    !words.some((t) => GIVEN.has(t) || t === "AND")
  )
    return false; // a company's own words: "C/O EXAMPLE MANAGEMENT"
  if (words.length === 1 && !GIVEN.has(words[0]!)) return false; // one word: a fragment, not a name
  if (STATE_CODES.has(words[words.length - 1]!)) return false; // "(EXAMPLEVILLE TX)": a place
  return (
    coOwnerIsPerson(words.join(" ")) || wholeReadsAsPerson(words.join(" "))
  );
}

/** Whether any piece of a raw name, between strong markers and then weak separators, names a person. */
function piecesNameAPerson(value: string): boolean {
  // A parenthetical is read alone ("ACME LLC (PAT Q EXAMPLE, SOLE MANAGER)"); the name around it stays one
  // ("EXAMPLE (USA) INC").
  const asides: string[] = [];
  const outside = rawUpper(value).replace(
    /\(([^()]*)\)?/g,
    (_, inner: string) => {
      asides.push(inner);
      return " ";
    },
  );
  if (
    asides.some(
      (a) =>
        clean(a).split(" ").length >= 2 && personShaped(a) && pieceIsPerson(a),
    )
  )
    return true;
  // "EXAMPLE PAT & EST MARY (INC)": a legal form in parentheses after persons' names
  if (
    asides.length > 0 &&
    asides.every((a) =>
      /^(?:LLC|INC|CORP|LTD|LP|LLP|CO|PC|PLLC)?$/.test(clean(a)),
    ) &&
    clean(outside) !== "" &&
    !ORGANIZATION.test(clean(outside))
  )
    return true;
  const strong = splitOn(outside, STRONG_MARKER);
  for (const s of strong) {
    // a slash between two letters is an abbreviation ("R/E", "S/C", "A/C"), not a separator
    const weak = splitOn(
      s.replace(/(?<!\/\s*)\b([A-Z])\s*\/\s*([A-Z])\b(?!\s*\/)/g, "$1$2"),
      WEAK_SEPARATOR,
    );
    if (strong.length > 1 && weak.length === 1 && pieceIsPerson(s)) return true;
    if (
      weak.length > 1 &&
      weak.some(
        (w) =>
          clean(w).split(" ").length >= 2 &&
          personShaped(w) &&
          pieceIsPerson(w),
      )
    )
      return true;
    if (
      strong.length > 1 &&
      weak.length > 1 &&
      pieceIsPerson(weak.join(" ")) &&
      personShaped(s)
    )
      return true;
  }
  return false;
}

/** "&" after a company's name starts a new owner: "ACME LLC & PAT EXAMPLE", "EXAMPLE FOUNDATION AND PAT EXAMPLE". */
function coOwnerIsPerson(value: string): boolean {
  const parts = value.toUpperCase().split(/\s*(?:&|\bAND\b)\s*/);
  // A person first, then a company: "EXAMPLE PAT Q & ACME REALTY", "EXAMPLE, PAT & ACME LLC" (not "PAT EXAMPLE &
  // SONS INC", "SMITH C AND G PROPERTIES LTD", "THE PAT & MARY EXAMPLE FOUNDATION").
  if (parts.length > 1) {
    const raw0 = parts[0]!.replace(/\([^()]*\)?/g, " ");
    const first = clean(raw0).split(" ");
    const second = clean(parts[1]!);
    if (
      !ORGANIZATION.test(first.join(" ")) &&
      !first.some((t) => NOT_A_PERSON_TAIL.has(t)) &&
      ((first.length >= 3 &&
        first.length <= 4 &&
        /^[B-HJ-Z]$/.test(first[first.length - 1]!) &&
        first.some((t) => GIVEN.has(t))) ||
        /^[A-Z'-]{2,}\s*,\s*[A-Z]{2,}/.test(raw0.trim())) &&
      second
        .split(" ")
        .filter(
          (t) =>
            !/^(?:LLC|LLP|LP|INC|CORP|LTD|PLLC|PC|CO|PROFESSIONAL)$/.test(t),
        ).length >= 2 &&
      ORGANIZATION.test(second)
    )
      return true;
  }
  for (let i = 1; i < parts.length; i++) {
    const before = clean(parts[i - 1]!);
    if (!ENDS_LIKE_ORGANIZATION.test(before)) continue;
    if (ORGANIZATION.test(clean(parts[i]!))) continue;
    const words = clean(parts[i]!)
      .split(" ")
      .filter((t) => t !== "" && !NEUTRAL_WORDS.has(t));
    if (words.length === 0 || words.every((t) => GENERIC_AFTER_AND.has(t)))
      continue;
    if (
      words.some(
        (t) =>
          /\d/.test(t) || NOT_A_PERSON_TAIL.has(t) || DESCRIPTOR_WORDS.has(t),
      )
    )
      continue;
    if (ORGANIZATION.test(words.join(" "))) continue;
    // one plain word after "&" following a company is a person's name ("ACME LLC & ZEBEDIAH"), not a company's word
    if (words.every((t) => PLACE_WORDS.has(t))) continue;
    // an affiliate repeating the company's own words: "ACME WEST LLC & ACME WEST"
    const head = clean(parts.slice(0, i).join(" ")).split(" ");
    const own = words.filter((t) => t.length > 2);
    if (own.length > 0 && own.every((t) => head.includes(t))) continue;
    return true;
  }
  return false;
}

/** A surname that is also an organisation word, first, before a given name: "CHURCH PAT Q", "CITY PAT & QUIN EXAMPLE". */
function surnameCollision(s: string): boolean {
  const t = s.split(" ");
  if (!/^(?:CHURCH|CITY|COUNTY|STATE|BANK)$/.test(t[0] ?? "")) return false;
  if (!GIVEN.has(t[1] ?? "") || t[1] === "JESUS") return false;
  if (t.some((x) => DESCRIPTOR_WORDS.has(x))) return false;
  const rest = t.slice(1).filter((x) => x !== "AND");
  return (
    !rest.includes("OF") &&
    rest.every((x) => /^[A-Z]+$/.test(x) && !NOT_A_PERSON_TAIL.has(x)) &&
    !ORGANIZATION.test(rest.join(" "))
  );
}

/** A person at the head of a name before "OF" a company ("PAT Q EXAMPLE OF ACME LLC, RECEIVER"). */
function personAtHead(s: string): boolean {
  const t = s.split(" ");
  return (
    GIVEN.has(t[0] ?? "") &&
    /^[A-Z]$/.test(t[1] ?? "") &&
    /^[A-Z]{2,}$/.test(t[2] ?? "") &&
    !NOT_A_PERSON_TAIL.has(t[2]!) &&
    (t.length === 3 || t[3] === "OF")
  );
}

/** A comma after a company's organisation word, then a name: "<NUMBER> <WORD> REALTY, PAT", "ASSOCIATES, PAT Q". */
function personAfterComma(value: string): boolean {
  const u = value.toUpperCase().replace(/['\u2018\u2019`]/g, "");
  if (
    /^\s*(?:ASSOCIATES|REALTY|PROPERTIES|PARTNERS|HOLDINGS|PARTNERSHIP)\s*,\s*[A-Z]/.test(
      u,
    )
  )
    return true;
  const m =
    /\b(?:REALTY|RLTY|PROPERTIES|PPTIES|PARTNERSHIP|PTNRSHP|ASSOCIATES|ASSOCS|PARTNERS|PTNRS|HOLDINGS|LLC|INC|CORP|CO|LTD|LP)\.?\s*,\s*([A-Z][A-Z .]*)$/.exec(
      u,
    );
  if (!m) return false;
  const words = clean(m[1]!)
    .split(" ")
    .filter((t) => t !== "" && !ROLE_WORDS.has(t) && !NEUTRAL_WORDS.has(t));
  if (words.length === 0) return false;
  if (
    words.some(
      (t) =>
        NOT_A_PERSON_TAIL.has(t) ||
        PLACE_WORDS.has(t) ||
        COMPANY_ROLE_WORDS.has(t) ||
        DESCRIPTOR_WORDS.has(t),
    )
  )
    return false;
  if (ORGANIZATION.test(words.join(" "))) return false;
  if (words.every((t) => t.length === 1)) return false; // "L L C", "L C", "N A": a legal form
  return words.length >= 2 || GIVEN.has(words[0]!);
}

/** Whether an owner-of-record or document-party name reads as a natural person (see the module comment). */
export function nameReadsAsPerson(value: string): boolean {
  // Only markers are read after "doing business as": a trade name is often a plain word ("ACME LLC DBA PAT'S PIZZA").
  const [main, ...tails] = value.split(/\bD\s*[/.]?\s*B\s*[/.]?\s*A\b/i);
  for (const tail of tails) {
    const pieces = splitOn(rawUpper(tail), STRONG_MARKER);
    if (pieces.length > 1 && pieces.slice(1).some(pieceIsPerson)) return true;
  }
  if (!/[A-Z]/i.test(main!)) return true;
  if (piecesNameAPerson(main!)) return true;
  if (coOwnerIsPerson(main!) || personAfterComma(main!)) return true;
  // the whole, with its markers and separators read as spaces
  const whole = splitOn(
    splitOn(rawUpper(main!).replace(/[()]/g, " "), STRONG_MARKER).join(" "),
    WEAK_SEPARATOR,
  ).join(" ");
  return wholeReadsAsPerson(whole);
}

/** The reading of one name, or one marker piece, without its markers. */
function wholeReadsAsPerson(value: string): boolean {
  const cleaned = clean(value);
  if (surnameCollision(cleaned) || personAtHead(cleaned)) return true;
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
  const s = cleaned;
  if (s === "") return true;
  if (personAfterCompany(s)) return true;
  return !ORGANIZATION.test(s);
}
