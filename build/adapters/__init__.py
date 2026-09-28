"""Adapters wrap every external tool/data source behind a small interface.

Each adapter output carries `source` and `confidence` (1.0 for curated data).
Priority everywhere: curated > human-edited data > rules > models.
"""
