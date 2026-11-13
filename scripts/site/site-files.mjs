// Which files of site/ the build copies into the published folder as they are.

/**
 * True when `rel`, a path under site/, is published. A name that starts with "_" at any depth is
 * kept out (the fragments in _content, the data in _data, and anything else set beside the pages
 * that way), and so is a Markdown note.
 */
export const published = (rel) =>
  !rel.split(/[\\/]/).some((part) => part.startsWith("_")) &&
  !rel.endsWith(".md");
