#!/bin/zsh
# Re-run the Tier 1 quality pass (docs/registry/quality/tier1-2026-11-03.md) on built registry files.
#
# Every step is idempotent: re-ingesting a snapshot already in a file adds nothing, and the
# maintenance steps re-derive keys and links from what the file holds. Run from the repository
# root. Nothing here downloads: archived files come from the collector's output directory.
#
#   COLLECTED=/path/to/collected TEXAS_DB=texas.db TIER1_DB=tier1.db scripts/registry/tier1-quality.sh <step>...
#
# Steps: texas-ingest  texas-maintain  tier1-ingest  tier1-maintain  small-ingest  audit
set -eu
: ${COLLECTED:?directory the collector writes (collected/<source>/<sha16>/<file>, manifest.jsonl)}
export PYTHONPATH=${PYTHONPATH:-python/src}
AUDIT_DATE=${AUDIT_DATE:-$(date -u +%F)}

# archived <source_id> <sha16 prefix of the document>  ->  "<path>\t<retrieved_at>" from the manifest
archived() {
  python3 -I - "$COLLECTED" "$1" "$2" <<'PY'
import json, sys
root, source, prefix = sys.argv[1:4]
for line in open(f"{root}/{source}/manifest.jsonl"):
    r = json.loads(line)
    if r.get("document_id", "").startswith(f"fl:document:sha256-{prefix}") and r.get("path"):
        print(f"{root}/{r['path']}\t{r.get('checked_at', '')}")
        break
else:
    sys.exit(f"{source}: no archived document starting {prefix}")
PY
}

# ingest <adapter module> <source_id> <sha16> <as-of> <db> [adapter flags...]
ingest() {
  local module=$1 source=$2 prefix=$3 as_of=$4 db=$5; shift 5
  local row; row=$(archived $source $prefix)
  python3 -m factlot.registry.adapters.$module "${row%%$'\t'*}" $db --as-of $as_of --retrieved-at "${row##*$'\t'}" "$@"
}

for step in "$@"; do
  case $step in
    texas-ingest)  # the five Texas counties into one file, so owners link to the Comptroller's entities
      : ${TEXAS_DB:?}
      ingest tx_harris  tx-harris-cad  b74be6977d4f078d 2026-11-01 $TEXAS_DB
      ingest tx_dallas  tx-dallas-cad  b5d6913e4e69fb8e 2026-10-12 $TEXAS_DB
      ingest tx_tarrant tx-tarrant-ad  f887ad16a673c071 2026-11-02 $TEXAS_DB
      ingest tx_collin  tx-collin-cad  2181dacc20ec3c25 2026-11-02 $TEXAS_DB
      ingest tx_travis  tx-travis-cad  62d0d1cd22b03f31 2026-07-18 $TEXAS_DB      # certified roll, supplement 0
      ingest tx_travis  tx-travis-cad  63da76773f8a8652 2026-10-06 $TEXAS_DB      # supplement 3: a full re-export, newer
      ;;
    texas-maintain)
      : ${TEXAS_DB:?}
      python3 -m factlot.registry.maintain $TEXAS_DB --all --queue-fuzzy
      ;;
    tier1-ingest)  # re-ingest replaces what an earlier run wrote for the same snapshot (adapter fixes, owner rule)
      : ${TIER1_DB:?}
      ingest ny_nyc          ny-nyc-dof              c3d135953903eb22 2026-05-15 $TIER1_DB
      ingest co_denver       co-denver-assessor      b26caab122d3410d 2026-10-29 $TIER1_DB
      ingest co_denver       co-denver-assessor      1e10868d82885336 2026-10-29 $TIER1_DB --partial
      cama=$(archived dc-otr-real-property 8f7bcf285e147592); cama=${cama%%$'\t'*}
      ingest dc_otr          dc-otr-real-property    e2c6466c4fdcfb1f 2026-11-02 $TIER1_DB --cama $cama
      ingest mn_hennepin     mn-hennepin-assessor    7877c3f7393f9c55 2026-10-22 $TIER1_DB
      ingest nc_mecklenburg  nc-mecklenburg-assessor cc46ea8721837914 2026-11-02 $TIER1_DB
      ;;
    tier1-maintain)
      : ${TIER1_DB:?}
      python3 -m factlot.registry.maintain $TIER1_DB --all --queue-fuzzy
      ;;
    small-ingest)  # standalone files whose owners were dropped under an older person rule: re-ingest, then purge
      : ${BOSTON_DB:?} ${SF_DB:?}
      ingest ma_boston ma-boston-assessing d0b656f516162c56 2025-01-01 $BOSTON_DB
      python3 -m factlot.registry.maintain $BOSTON_DB --purge-persons
      python3 -m factlot.registry.maintain $SF_DB --purge-persons
      ;;
    audit)
      : ${AUDIT_OUT:?directory for the JSON reports}
      mkdir -p $AUDIT_OUT
      for db in ${=AUDIT_DBS:?space-separated registry files}; do
        python3 -m factlot.registry.audit $db --today $AUDIT_DATE --collected $COLLECTED --reread --out $AUDIT_OUT/${db:t:r}.json || true
      done
      ;;
    *) echo "unknown step: $step" >&2; exit 2;;
  esac
done
