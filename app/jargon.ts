// Players' words for kinds of card: "mana rocks", "board wipes", "blink effects".
//
// Nobody prints these words on a card, so neither the rules text nor its meaning finds them
// well. Scryfall's community tags do: people have marked which cards are mana rocks. A query
// that is one of these words is therefore read as a Scryfall-syntax query on those tags (the
// `otag:` keyword) and answered most played first, which puts the cards every player would
// name at the top: Sol Ring for mana rocks, Swords to Plowshares for removal.
//
// A colour in front narrows it to cards of exactly that colour ("white board wipes", "izzet
// counterspells"), and the kind of card behind it narrows it too ("bounce spells", "blink
// creatures").
//
// "land destruction" is left to its meaning on purpose: the tag holds every card that can
// deal with a land, and what the meaning finds (Erosion, Mana Vortex) is nearer what is asked.

import { COLOR_NAMES, COLOR_SETS } from "./lower.ts";

/** What players say (singular) and how it reads in Scryfall syntax. Each was looked at on the live index. */
const WORDS: [string[], string][] = [
  [["mana rock"], "otag:mana-rock"],
  [["mana dork"], "otag:mana-dork"],
  [["mana doubler"], "otag:mana-doubler"],
  // "ramp" is tagged on anything that gets ahead on mana; a land is not what is meant, nor a
  // removal spell that hands the opponent one
  [["ramp"], "otag:ramp -otag:removal -t:land"],
  [["ritual"], "otag:ritual"],
  [["cost reducer"], "otag:cost-reducer"],
  // the tag also holds every card that fetches a land, which players call ramp, not a tutor
  [["tutor"], "otag:tutor -otag:ramp -t:land"],
  [["fetch land", "fetchland", "fetch"], "otag:fetchland"],
  [["counterspell", "counter magic", "countermagic", "permission"], "otag:counterspell"],
  [["removal", "spot removal", "kill spell"], "otag:removal -otag:sweeper"],
  [["creature removal"], "otag:removal-creature -otag:sweeper"],
  [["artifact removal", "artifact hate"], "otag:removal-artifact -otag:sweeper"],
  [["enchantment removal", "enchantment hate"], "otag:removal-enchantment -otag:sweeper"],
  [["planeswalker removal"], "otag:removal-planeswalker -otag:sweeper"],
  [["board wipe", "boardwipe", "wipe", "wrath", "sweeper", "mass removal"], "otag:sweeper"],
  // without the lands that return one of your own lands to your hand
  [["bounce"], "otag:bounce -t:land"],
  [["blink", "flicker"], "otag:flicker"],
  [["cantrip"], "otag:cantrip"],
  [["card draw"], "otag:draw"],
  [["card advantage"], "otag:card-advantage"],
  [["wheel"], "otag:wheel"],
  [["looting", "loot", "looter"], "otag:loot"],
  [["rummage", "rummaging"], "otag:rummage"],
  [["reanimation", "reanimator"], "otag:reanimate"],
  [["recursion"], "otag:recursion"],
  [["graveyard hate"], "otag:graveyard-hate"],
  [["burn"], "otag:burn"],
  [["lifegain", "life gain"], "otag:lifegain"],
  [["mill"], "otag:mill"],
  [["discard"], "otag:discard"],
  [["fog"], "otag:fog"],
  [["lord"], "otag:lord t:creature"],
  [["anthem"], "otag:anthem -t:creature"],
  [["sac outlet", "sacrifice outlet"], "otag:sacrifice-outlet"],
  [["tax effect", "tax"], "otag:tax"],
  [["extra turn"], "otag:extra-turn"],
  [["extra combat"], "otag:extra-combat"],
  [["clone"], "otag:clone"],
  [["combat trick"], "otag:combat-trick"],
  [["protection"], "otag:protection"],
  [["untapper"], "otag:untapper"],
  [["hatebear"], "otag:hatebear"],
  [["pillow fort", "pillowfort"], "otag:pillowfort"],
  [["group hug"], "otag:group-hug"],
  [["win condition", "wincon", "alt win", "alternate win condition"], "otag:win-condition"],
];
const READS = new Map(WORDS.flatMap(([said, reads]) => said.map((word) => [word, reads] as const)));

// A word after the term that says which kind of card is wanted. "effects" and "cards" say nothing.
const KINDS: Record<string, string> = {
  spell: "(t:instant or t:sorcery)",
  instant: "t:instant",
  sorcery: "t:sorcery",
  creature: "t:creature",
  artifact: "t:artifact",
  enchantment: "t:enchantment",
  land: "t:land",
  effect: "",
  card: "",
  piece: "",
};
const COLOURS = new Set([...Object.keys(COLOR_NAMES), ...Object.keys(COLOR_SETS).filter((name) => COLOR_SETS[name].length <= 3)]);
// Words in front that ask for nothing in particular.
const FILLERS = new Set(["a", "an", "the", "some", "any", "all", "good", "best", "more", "my"]);

/** The singular of the last word: "wipes" -> "wipe", "sorceries" -> "sorcery". Other words are left alone. */
function singular(phrase: string): string {
  if (phrase.endsWith("ies")) return `${phrase.slice(0, -3)}y`;
  if (phrase.endsWith("s") && !phrase.endsWith("ss")) return phrase.slice(0, -1);
  return phrase;
}

/**
 * The colour words as one condition: cards of exactly those colours. "black removal" is not
 * asking for black-and-green cards, and "red and white" asks for cards that are both.
 */
function colour(words: string[]): string {
  if (!words.length) return "";
  if (words.some((word) => word.startsWith("colo"))) return "c=colorless";
  const letters = new Set(words.flatMap((word) => [...(COLOR_NAMES[word] ?? COLOR_SETS[word])]));
  return `c=${[..."WUBRG"].filter((letter) => letters.has(letter)).join("").toLowerCase()}`;
}

export type Reading = {
  /** The players' word that was recognised, as the dictionary has it: "board wipe". */
  term: string;
  /** The Scryfall-syntax query it is read as. */
  reads: string;
};

/**
 * A query that is a players' word for a kind of card, read as Scryfall syntax; or null if it
 * is anything else, including such a word inside a longer sentence.
 */
export function jargon(query: string): Reading | null {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  while (words.length && FILLERS.has(words[0])) words.shift();
  // colours in front, said one after another or with "and": "red and white board wipes"
  const colours: string[] = [];
  while (words.length > 1) {
    if (COLOURS.has(words[0]) || words[0] === "colorless" || words[0] === "colourless") colours.push(words.shift()!);
    else if (colours.length && words[0] === "and" && COLOURS.has(words[1] ?? "")) words.shift();
    else break;
  }
  if (!words.length || words.length > 4) return null;
  const narrowed = (term: string, kind: string): Reading => ({
    term,
    reads: [READS.get(term), kind, colour(colours)].filter(Boolean).join(" "),
  });
  // the whole phrase is the word ("board wipes"), or the word and then a kind ("bounce spells")
  const whole = [words.join(" "), singular(words.join(" "))].find((phrase) => READS.has(phrase));
  if (whole) return narrowed(whole, "");
  const kind = KINDS[singular(words[words.length - 1])];
  if (kind === undefined || words.length < 2) return null;
  const rest = words.slice(0, -1).join(" ");
  const term = [rest, singular(rest)].find((phrase) => READS.has(phrase));
  return term ? narrowed(term, kind) : null;
}

/** Every word the dictionary knows, for the tests: each has to find cards on the live index. */
export const JARGON_WORDS = [...READS.keys()];
