/**
 * Notices a source's terms require wherever its data is shown, keyed by source id. The property pages
 * (property-pages.ts) show a notice when a fact from that source is on the page; `scope` names the parcel county
 * or entity registry the source covers, so a notice still shows when a document's source id cannot be read.
 * The texts are the same words the site's market pages use (scripts/site/market-pages.mjs on its branch).
 */

/** The State of Colorado's disclaimer, word for word as data.colorado.gov/terms requires it on sites using its data. */
export const CO_DISCLAIMER =
  "The data made available here has been modified for use from its original source, which is the State of Colorado. THE STATE OF COLORADO MAKES NO REPRESENTATIONS OR WARRANTY AS TO THE COMPLETENESS, ACCURACY, TIMELINESS, OR CONTENT OF ANY DATA MADE AVAILABLE THROUGH THIS SITE. THE STATE OF COLORADO EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE. The data is subject to change as modifications and updates are complete. It is understood that the information contained in the Web feed is being used at one's own risk.";

/** Denver's attribution under CC BY 3.0, with the change notice the licence asks for (trusted HTML). */
export const DENVER_NOTICE_HTML =
  'Denver parcel data: "City and County of Denver", from the Denver Open Data Catalog, used under the <a href="https://creativecommons.org/licenses/by/3.0/">Creative Commons Attribution 3.0</a> licence. FactLot has changed it: filtered to commercial, industrial and multifamily parcels, normalised, and linked to the Colorado Secretary of State entity file. The City does not endorse FactLot.';

export interface SourceNotice {
  /** The notice as trusted HTML (authored here, never from data). */
  html: string;
  /** Parcel counties ("us-08031") or entity registries ("us-co") whose shown facts need the notice. */
  scope: string[];
}

export const SOURCE_NOTICES: Readonly<Record<string, SourceNotice>> = {
  "co-denver-assessor": { html: DENVER_NOTICE_HTML, scope: ["us-08031"] },
  "co-sos-entities": {
    html: `State of Colorado disclaimer: ${CO_DISCLAIMER.replaceAll("'", "&#39;")}`,
    scope: ["us-co"],
  },
};

/**
 * The notices for a page, in SOURCE_NOTICES order: those whose source id is among `sourceIds`, or whose scope
 * holds one of `scopes` (the counties and entity registries of the facts shown).
 */
export function noticesFor(
  sourceIds: ReadonlySet<string>,
  scopes: ReadonlySet<string>,
): string[] {
  return Object.entries(SOURCE_NOTICES)
    .filter(
      ([id, n]) => sourceIds.has(id) || n.scope.some((s) => scopes.has(s)),
    )
    .map(([, n]) => n.html);
}
