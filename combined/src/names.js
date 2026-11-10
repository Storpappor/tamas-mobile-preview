// Player-facing names that differ from the internal identifiers. The code, the enemy types,
// the dialogue constants and the asset files keep their internal names; only what the player
// reads goes through here. Recorded for the enemy-art workstream in docs/ui-display-names.md.
export const DISPLAY_NAMES = {
  'Master Kage': 'Råttfällan',
};

// Replacements in order: the full internal name first, then the bare surname, in both cases.
const RULES = [
  [/MASTER KAGE/g, 'RÅTTFÄLLAN'],
  [/Master Kage/g, 'Råttfällan'],
  [/\bKAGE\b/g, 'RÅTTFÄLLAN'],
  [/\bKage\b/g, 'Råttfällan'],
];

// Maps internal names inside any player-facing string (banners, dialogue lines, labels).
export function displayText(text) {
  let s = String(text);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}
