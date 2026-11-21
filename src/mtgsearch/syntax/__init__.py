"""Scryfall query syntax: parse to an AST, lower to a predicate IR, run on TopK or in Python."""

from .backends import evaluate, to_topk
from .lower import Options, lower
from .parser import QueryError, Unsupported, parse


def compile_query(query: str):
    """Parse and lower a Scryfall-syntax query. Returns (ir, options)."""
    return lower(parse(query))


__all__ = ["QueryError", "Unsupported", "Options", "compile_query", "evaluate", "lower", "parse", "to_topk"]
