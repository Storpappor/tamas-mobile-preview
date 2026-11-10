// Player-facing copy that differs from the internal strings. The code, the enemy types, the
// dialogue constants and the asset files keep their internal names and their original lines;
// only what the player reads goes through here. Two rules (docs/ui-display-names.md):
//  - names: the boss is presented as Råttfällan;
//  - language: story, narration and character lines are Swedish, menus and system UI English.
// The narrative lines that live in the gameplay files (which stay identical to main) are
// translated here at presentation time: the stage banner and the boss's dialogue line.
export const DISPLAY_NAMES = {
  'Master Kage': 'Råttfällan',
};
export const NARRATIVE = {
  'MASTER KAGE APPROACHES': 'RÅTTFÄLLAN NÄRMAR SIG',
  'MASTER KAGE: POWER CREATES RESPECT.': 'RÅTTFÄLLAN: MAKT SKAPAR RESPEKT.',
};

// Replacements in order: whole narrative lines first, then the full internal name, then the
// bare surname, in both cases.
const RULES = [
  ...Object.entries(NARRATIVE).map(([from, to]) => [new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to]),
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
