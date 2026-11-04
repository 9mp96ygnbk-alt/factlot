-- FactLot Registry schema (SQLite). Shared by the Python ingest pipeline and the TypeScript server.
-- Every fact cites a content-addressed snapshot of the public record it came from.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sources (
  source_id      TEXT PRIMARY KEY,               -- e.g. "tx-harris-cad-appraisal-roll"
  publisher      TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  state_fips     TEXT NOT NULL,
  county_fips    TEXT,                           -- NULL for statewide sources
  license        TEXT NOT NULL,
  ai_use         TEXT NOT NULL CHECK (ai_use IN ('permitted', 'prohibited', 'unknown')),
  redistribution TEXT NOT NULL CHECK (redistribution IN ('permitted', 'attribution_required', 'prohibited', 'unknown')),
  attribution    TEXT,
  terms_reviewed TEXT                            -- date the terms were reviewed (policy §5)
);

CREATE TABLE IF NOT EXISTS snapshots (
  document_id  TEXT PRIMARY KEY,                 -- fl:document:sha256-<hex of the file>
  source_id    TEXT NOT NULL REFERENCES sources(source_id),
  retrieved_at TEXT NOT NULL,
  as_of        TEXT NOT NULL,                    -- date the data describes (e.g. roll certification date)
  filename     TEXT,
  bytes        INTEGER
);

CREATE TABLE IF NOT EXISTS subjects (
  urn   TEXT PRIMARY KEY,
  kind  TEXT NOT NULL,                           -- parcel | entity | building | ...
  short TEXT NOT NULL UNIQUE,
  label TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  fact_id     TEXT PRIMARY KEY,                  -- hash of (subject, predicate, value, document)
  subject     TEXT NOT NULL REFERENCES subjects(urn),
  predicate   TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  unit        TEXT,
  as_of       TEXT NOT NULL,
  method      TEXT NOT NULL,
  confidence  REAL,
  document_id TEXT NOT NULL REFERENCES snapshots(document_id),
  locator     TEXT                               -- record key within the document, e.g. "account 0420150000012"
);
CREATE INDEX IF NOT EXISTS facts_subject ON facts(subject, predicate, as_of);

CREATE TABLE IF NOT EXISTS relationships (
  from_urn    TEXT NOT NULL,
  type        TEXT NOT NULL,                     -- owns | controls | located_on | ...
  to_urn      TEXT NOT NULL,
  as_of       TEXT NOT NULL,
  method      TEXT NOT NULL,
  confidence  REAL,
  document_id TEXT NOT NULL REFERENCES snapshots(document_id),
  basis       TEXT,                              -- why the link exists, e.g. "exact normalized name match"
  PRIMARY KEY (from_urn, type, to_urn, document_id)
);
CREATE INDEX IF NOT EXISTS relationships_to ON relationships(to_urn, type);

CREATE TABLE IF NOT EXISTS crosswalk (
  system      TEXT NOT NULL,                     -- e.g. "tx-harris-cad-account", "tx-comptroller-taxpayer"
  external_id TEXT NOT NULL,
  urn         TEXT NOT NULL REFERENCES subjects(urn),
  PRIMARY KEY (system, external_id)
);
CREATE INDEX IF NOT EXISTS crosswalk_urn ON crosswalk(urn);

-- Which snapshot covered which subject. A fact is current only if the latest snapshot of its
-- source that covered the subject restated it; otherwise it is history (e.g. a sold parcel's old owner).
CREATE TABLE IF NOT EXISTS coverage (
  subject     TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  as_of       TEXT NOT NULL,
  document_id TEXT NOT NULL,
  present     INTEGER NOT NULL DEFAULT 1,      -- 0: absent from a full snapshot that should have listed it; 2: an enrichment source
                                               -- (zoning, sales) added facts to a parcel another source created: its facts follow the
                                               -- usual currency rule, but it does not keep a retired parcel 'current'
  PRIMARY KEY (subject, source_id, document_id)
);

-- Facts that are current under the coverage rule.
CREATE VIEW IF NOT EXISTS current_facts AS
SELECT f.* FROM facts f JOIN snapshots s ON s.document_id = f.document_id
WHERE f.as_of = (SELECT MAX(c.as_of) FROM coverage c WHERE c.subject = f.subject AND c.source_id = s.source_id);

-- Search indexes. Natural persons are never added to name_index (data policy §3).
CREATE TABLE IF NOT EXISTS name_index (key TEXT NOT NULL, urn TEXT NOT NULL, PRIMARY KEY (key, urn));
CREATE TABLE IF NOT EXISTS address_index (key TEXT NOT NULL, urn TEXT NOT NULL, PRIMARY KEY (key, urn));

-- Token index over entity names for fuzzy owner matching (schema version 2). One row per
-- distinctive token (stop tokens such as LLC or PROPERTIES are never indexed); the normalized
-- key is repeated so a candidate pool can be scored without touching name_index.
CREATE TABLE IF NOT EXISTS name_tokens (
  token TEXT NOT NULL,
  urn   TEXT NOT NULL,
  key   TEXT NOT NULL,
  PRIMARY KEY (token, urn)
);

-- Human review queue for owner-of-record names that did not match exactly one entity.
-- One row per (owner name, candidate entity). Nothing here links anything: an 'owns'
-- relationship is written only when a reviewer accepts a row (data policy §4). Rows are never
-- deleted, so a rejected pair is never queued again.
CREATE TABLE IF NOT EXISTS owner_match_review (
  review_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_name   TEXT NOT NULL,                  -- owner of record as written on the roll
  owner_key    TEXT NOT NULL,                  -- its normalized name; a decision applies to every parcel with this key
  parcel_urn   TEXT NOT NULL,                  -- a representative parcel, for context
  parcel_count INTEGER NOT NULL DEFAULT 1,     -- parcels with this owner of record when queued
  entity_urn   TEXT NOT NULL,
  score        REAL NOT NULL,                  -- similarity in [0, 1]
  reason       TEXT NOT NULL,                  -- JSON: rule, ratio, token_overlap, shared_tokens
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  queued_at    TEXT NOT NULL,
  decided_at   TEXT,
  decided_by   TEXT,
  UNIQUE (owner_key, entity_urn)
);
CREATE INDEX IF NOT EXISTS owner_match_review_status ON owner_match_review(status, score);
