"""Command line for the ingest job: mtgsearch ingest | catalog.

Searching, the Scryfall comparison and the relevance evaluation live in the TypeScript app
(see package.json scripts).
"""

import argparse
import json

from . import config


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mtgsearch", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="refresh the TopK collection from Scryfall's bulk files")
    ingest.add_argument("--dry-run", action="store_true", help="build documents and report, send nothing")
    ingest.add_argument("--full", action="store_true", help="re-send every card, not just changed ones")

    sub.add_parser("catalog", help="regenerate app/type-words.json from the bulk data")

    args = parser.parse_args(argv)

    if args.command == "ingest":
        from . import ingest as ingest_module

        ingest_module.run(config.DATA_DIR, dry_run=args.dry_run, full=args.full)
    elif args.command == "catalog":
        from . import catalog, scryfall

        cards = scryfall.read_jsonl_gz(scryfall.download_bulk("oracle_cards", config.DATA_DIR))
        words = catalog.build(cards)
        catalog.OUTPUT.write_text(json.dumps(words, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {len(words)} type words to {catalog.OUTPUT}")


if __name__ == "__main__":
    main()
