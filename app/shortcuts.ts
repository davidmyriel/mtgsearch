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

// "... is also a Cleric, Rogue, Warrior, and Wizard."
const ALL_FOUR: IR = ["has", "oracle_lc", "is also a cleric, rogue, warrior, and wizard"];
// The melded side of a meld pair has no mana cost and cannot be cast, so it leads nothing.
const CASTABLE: IR = ["not", ["and", [["in", "flags", "meld"], ["eq", "m0_key", "none"]]]];
// A Background that is not also a creature cannot lead a deck on its own.
const NOT_ONLY_BACKGROUND: IR = ["not", ["and", [["in", "type_words", "background"], ["not", ["in", "type_words", "creature"]]]]];

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
  // lands that turn themselves into creatures, or into a copy of one
  creatureland: land(
    String.raw`(~|it) becomes? an? [^\n]*creature[^\n]*still an? [a-z ]*land|~ becomes an? [^\n.]*creature in addition to its other types|~ becomes a copy of target creature`,
  ),

  // groups defined by a rule
  // creatures of a party type; a changeling is every type, and a few cards say they are all four
  party: both(typeWord("creature"), either(typeWord("cleric"), typeWord("rogue"), typeWord("warrior"), typeWord("wizard"), keyword("changeling"), ALL_FOUR)),
  outlaw: either(typeWord("assassin"), typeWord("mercenary"), typeWord("pirate"), typeWord("rogue"), typeWord("warlock"), keyword("changeling"), ALL_FOUR),
  companion: keyword("companion"),
  // cards that share the command zone: legendary partners of every kind, Backgrounds, and the
  // Doctors, who pair with a Doctor's companion
  partner: either(
    both(flag("commander"), either(keyword("partner"), keyword("partner with"), keyword("friends forever"), keyword("choose a background"), keyword("doctor's companion"))),
    typeWord("background"),
    both(typeWord("time"), typeWord("lord"), typeWord("doctor")),
  ),
  // a planeswalker on the front face
  oathbreaker: both(["re", "type_lc", String.raw`^[^/]*planeswalker`], legal("oathbreaker"), CASTABLE),
  // Duel Commander marks cards banned as commander as "restricted". Scryfall also lets any
  // legendary Spacecraft lead there, with or without a power and toughness.
  duelcommander: both(
    either(flag("commander"), both(typeWord("legendary"), typeWord("spacecraft"))),
    legal("duel"),
    ["not", ["in", "restricted", "duel"]],
    NOT_ONLY_BACKGROUND,
    CASTABLE,
  ),
  brawler: both(either(flag("commander"), ["re", "type_lc", String.raw`^[^/]*legendary[^/]*planeswalker`]), legal("brawl"), NOT_ONLY_BACKGROUND, CASTABLE),
  // a number of modes to choose, listed with bullets; Spree and the Seasons list them as costs
  modal: either(
    both(["has", "fulloracle_lc", "•"], ["re", "fulloracle_lc", String.raw`chooses? (one|two|three|four|five|six|seven|any number|up to|x\b)`]),
    keyword("spree"),
    ["has", "fulloracle_lc", "worth of modes"],
  ),
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
