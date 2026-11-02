"""FactLot collector: polite, auditable archiving of public property-data releases.

See core.py for the rules it enforces and docs/registry/collection.md for how it runs.
"""

from .core import CollectorConfig, PoliteFetcher, SourceSpec, discover, load_sources, snapshot

__all__ = ["CollectorConfig", "PoliteFetcher", "SourceSpec", "discover", "load_sources", "snapshot"]
