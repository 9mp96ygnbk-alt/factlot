"""FactLot Registry: cited public-record facts about commercial property, keyed by FactLot IDs.

See docs/registry/ for the data policy and source catalog. Source adapters map each publisher's
file layout to ``ParcelRecord`` / ``EntityRecord``; this package handles provenance, scope,
privacy, owner resolution, storage, and queries.
"""

from .normalize import COMMERCIAL_CATEGORIES, is_commercial, is_organization, normalize_address, normalize_name
from .store import EntityRecord, IngestStats, ParcelFacts, ParcelRecord, Registry, Snapshot, Source, file_document_id

__all__ = [
    "COMMERCIAL_CATEGORIES",
    "EntityRecord",
    "IngestStats",
    "ParcelFacts",
    "ParcelRecord",
    "Registry",
    "Snapshot",
    "Source",
    "file_document_id",
    "is_commercial",
    "is_organization",
    "normalize_address",
    "normalize_name",
]
