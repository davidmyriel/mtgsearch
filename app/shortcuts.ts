// `is:` shortcuts that name a well-known group of cards: land cycles, and groups defined by
// a rule ("party" is the four party creature types).
//
// Scryfall publishes no definitions for these, so each one was matched against what its API
// returns (conformance/shortcuts.txt, which also runs nightly). Most land cycles coincide
// exactly with a community tag that the documents already carry in `otags`; the rest are
// rules over the type line, keywords and rules text.
import type { IR } from "./lower.ts";

const tag = (slug: string): IR => ["in", "otags", slug];
const either = (...tests: IR[]): IR => (tests.length === 1 ? tests[0] : ["or", tests]);
const both = (...tests: IR[]): IR => ["and", tests];
const typeWord = (word: string): IR => ["in", "type_words", word];
const keyword = (name: string): IR => ["in", "keywords_lc", name];
const flag = (name: string): IR => ["in", "flags", name];
const legal = (format: string): IR => ["in", "legal", format];
/** A land whose rules text (name written as ~, reminder text removed) matches a pattern. */
const land = (pattern: string): IR => both(typeWord("land"), ["re", "oracle_tilde_lc", pattern]);

const ALIASES: Record<string, string> = {
  karoo: "bounceland",
  cycleland: "bikeland",
  bicycleland: "bikeland",
  canland: "canopyland",
  horizonland: "canopyland",
  snarl: "shadowland",
  manland: "creatureland",
  battleland: "tangoland",
};

const SHORTCUTS: Record<string, IR> = {
  // land cycles that are exactly one or two community tags
  fetchland: tag("cycle-fetchland"),
  shockland: tag("cycle-shockland"),
  dual: tag("cycle-abu-dual-land"),
  checkland: tag("cycle-checkland"),
  fastland: tag("cycle-fastland"),
  painland: tag("cycle-painland"),
  bounceland: tag("karoo-land"),
  bikeland: tag("cycle-dual-cycling-land"),
  canopyland: tag("cycle-horizon-land"),
  gainland: either(tag("cycle-gainland"), tag("cycle-zen-refugeland")),
  scryland: tag("cycle-temple-land"),
  shadowland: tag("cycle-reveal-land"),
  triland: tag("cycle-triple-tapland"),
  tangoland: tag("cycle-tangoland"),
  triome: tag("tricycle-land"),
  slowland: tag("cycle-slowland"),
  bondland: tag("cycle-crowdland"),
  pathway: tag("cycle-pathway"),
  surveilland: tag("cycle-dual-surveil-land"),
  vergeland: tag("cycle-verge"),
  // land groups with no matching tag
  // "{1}, {T}: Add {U}{B}", the hybrid version, and the two five-colour ones
  filterland: land(String.raw`\{[^}]+\}, \{t\}: add (\{[wubrg]\}\{[wubrg]\}[,.]|five mana in any combination of colors|\{w\}\{u\}\{b\}\{r\}\{g\})`),
  // lands that bank storage counters: Fallen Empires, Time Spiral and two later ones
  storageland: land(String.raw`if ~ is tapped, put a storage counter on it|\{1\}, \{t\}: put a storage counter on ~`),
  // lands that turn themselves into creatures
  creatureland: land(String.raw`(~|it) becomes? an? [^\n]*creature[^\n]*still a land`),

  // groups defined by a rule
  party: either(typeWord("cleric"), typeWord("rogue"), typeWord("warrior"), typeWord("wizard"), keyword("changeling")),
  outlaw: either(typeWord("assassin"), typeWord("mercenary"), typeWord("pirate"), typeWord("rogue"), typeWord("warlock"), keyword("changeling")),
  companion: keyword("companion"),
  // cards that share the command zone: legendary partners of every kind, and Backgrounds
  partner: either(
    both(flag("commander"), either(keyword("partner"), keyword("partner with"), keyword("friends forever"), keyword("choose a background"), keyword("doctor's companion"))),
    typeWord("background"),
  ),
  // a planeswalker on the front face
  oathbreaker: both(["re", "type_lc", String.raw`^[^/]*planeswalker`], legal("oathbreaker")),
  duelcommander: both(flag("commander"), legal("duel")),
  brawler: both(either(flag("commander"), both(typeWord("legendary"), typeWord("planeswalker"))), legal("brawl")),
  // modes are listed with bullets; Spree lists them as extra costs
  modal: either(["has", "fulloracle_lc", "•"], keyword("spree")),
  adventure: ["eq", "layout", "adventure"],
  augmentation: either(["eq", "layout", "augment"], ["eq", "layout", "host"]),
  frenchvanilla: flag("frenchvanilla"),

  // about a printing
  masterpiece: ["eq", "set_type", "masterpiece"],
  colorshifted: ["in", "frame_effects", "colorshifted"],
  tombstone: ["in", "frame_effects", "tombstone"],
  firstprint: ["not", ["in", "pflags", "reprint"]],
};

/** The predicate for an `is:` shortcut, or null if the word is not one. */
export function shortcut(word: string): IR | null {
  const name = ALIASES[word] ?? word;
  return Object.hasOwn(SHORTCUTS, name) ? SHORTCUTS[name] : null;
}

export const SHORTCUT_NAMES = [...Object.keys(SHORTCUTS), ...Object.keys(ALIASES)];
