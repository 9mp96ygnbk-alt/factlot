export interface StoryFigure {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  rule: string;
  sources: {
    key: string;
    source_id: string;
    as_of: string;
    attribution: string;
  }[];
}
export interface Story {
  slug: string;
  title: string;
  description: string;
  county: { fips: string; name: string; state: string };
  period: {
    first_year: number;
    last_year: number;
    years: { year: number; preliminary: boolean }[];
  };
  value_type: string;
  options: { name_organisations: boolean };
  sentences: { id: string; text: string; figures: string[] }[];
  figures: StoryFigure[];
  tables: {
    id: string;
    title: string;
    rule: string;
    rows: unknown[][];
    columns: { label: string; unit: string }[];
    sources: { source_id: string; as_of: string }[];
  }[];
  sources: {
    source_id: string;
    attribution: string;
    tax_year?: number;
  }[];
  generator: { version: string };
}
export interface Stamp {
  verified_on: string;
  figures_checked: number;
  tables_checked: number;
}
export interface LoadedStory {
  story: Story;
  stamp: Stamp;
  sha256: string;
}
export function fmt(
  value: number | string | null | undefined,
  unit: string,
): string;
export function strayNumbers(story: Story): string[];
export function tableProblems(story: Story): string[];
export function loadStories(dir: string): LoadedStory[];
export function storyBody(
  story: Story,
  stamp: Stamp,
  texasSlug: string | null,
): string;
export function indexBody(stories: LoadedStory[]): string;
export const storyPath: (story: Story) => string;
export const storyTitle: (story: Story) => string;
export const indexTitle: string;
export const indexDescription: string;
export const longDate: (iso: string) => string;
