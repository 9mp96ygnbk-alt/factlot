"""Source adapters: each maps one publisher's file layout to ``ParcelRecord`` / ``EntityRecord``.

An adapter reads an archived snapshot (as the collector stores it) and yields records; the
registry core applies scope, privacy, and provenance rules. Adapters never invent values: a field
the publisher leaves blank stays ``None``.
"""
