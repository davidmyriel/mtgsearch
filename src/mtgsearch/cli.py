"""Command line: mtgsearch ingest | catalog | search | serve | conformance | eval."""

import argparse
from pathlib import Path

from . import config


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mtgsearch", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="refresh the TopK collection from Scryfall's bulk files")
    ingest.add_argument("--dry-run", action="store_true", help="build documents and report, send nothing")
    ingest.add_argument("--full", action="store_true", help="re-send every card, not just changed ones")

    sub.add_parser("catalog", help="regenerate the type-word catalogue from the bulk data")

    search = sub.add_parser("search", help="run one query")
    search.add_argument("query")
    search.add_argument("-k", type=int, default=10)

    conformance = sub.add_parser("conformance", help="compare syntax queries with Scryfall's API")
    conformance.add_argument("queries", nargs="?", default="conformance/queries.txt")
    conformance.add_argument("--out", default=None)

    evaluate = sub.add_parser("eval", help="score ranking strategies on the frozen query set")
    evaluate.add_argument("queries", nargs="?", default="eval/queries.json")
    evaluate.add_argument("--out", default=None)
    evaluate.add_argument("--classes", nargs="*", default=None)

    serve = sub.add_parser("serve", help="run the web app (needs the 'web' extra)")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)

    args = parser.parse_args(argv)

    if args.command == "ingest":
        from . import ingest as ingest_module

        ingest_module.run(config.DATA_DIR, dry_run=args.dry_run, full=args.full)
    elif args.command == "catalog":
        from . import catalog, scryfall

        cards = scryfall.read_jsonl_gz(scryfall.download_bulk("oracle_cards", config.DATA_DIR))
        words = catalog.build(cards)
        target = Path(catalog.__file__).with_name(catalog.FILE)
        target.write_text("\n".join(words) + "\n", encoding="utf-8")
        print(f"wrote {len(words)} type words to {target}")
    elif args.command == "search":
        from .search import search as run_search

        result = run_search(args.query, args.k)
        total = f", {result.total} total" if result.total is not None else ""
        print(f"[{result.mode}{total}] {result.note}")
        for hit in result.hits:
            score = f"{hit['score']:.3f}  " if "score" in hit else ""
            print(f"  {score}{hit['name']}  {hit.get('mana_cost', '')}  {hit.get('type_line', '')}")
    elif args.command == "conformance":
        from . import conformance as conformance_module

        results = conformance_module.run(Path(args.queries), Path(args.out) if args.out else None)
        if any(r.status != "pass" for r in results):
            raise SystemExit(1)
    elif args.command == "serve":
        import uvicorn

        uvicorn.run("mtgsearch.web:app", host=args.host, port=args.port)
    elif args.command == "eval":
        from . import evaluate as evaluate_module

        evaluate_module.run(Path(args.queries), Path(args.out) if args.out else None, args.classes)


if __name__ == "__main__":
    main()
