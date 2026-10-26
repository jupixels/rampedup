// Rider progression: XP from riding, levels, and the cosmetics each level unlocks.
import { store } from './util.js';

// Every unlockable, with the level it opens at. Base palettes (level 1) live in ui.js.
export const UNLOCKS = [
  { level: 2, part: 'frame', value: '#c0c4ca', label: 'Raw steel', finish: 'raw' },
  { level: 2, part: 'helmet', value: '#2b6cff', label: 'Cobalt helmet' },
  { level: 3, part: 'rims', value: '#ff5a1f', label: 'Orange rims' },
  { level: 3, part: 'shirt', value: '#5b2a86', label: 'Grape jersey' },
  { level: 4, part: 'tires', value: '#c9a46a', label: 'Gum-wall tyres' },
  { level: 4, part: 'frame', value: '#0f0f10', label: 'Matte black', finish: 'matte' },
  { level: 5, part: 'bars', value: '#ffd21f', label: 'Yellow bars' },
  { level: 5, part: 'helmet', value: '#d4af37', label: 'Gold helmet', finish: 'metal' },
  { level: 6, part: 'rims', value: '#3fd4ff', label: 'Ice rims' },
  { level: 6, part: 'pants', value: '#7a2e1d', label: 'Rust pants' },
  { level: 7, part: 'frame', value: '#e8e8ea', label: 'Chrome', finish: 'chrome' },
  { level: 8, part: 'bars', value: '#ff2e8a', label: 'Hot pink bars' },
  { level: 8, part: 'tires', value: '#ff5a1f', label: 'Orange tyres' },
  { level: 9, part: 'rims', value: '#d4af37', label: 'Gold rims', finish: 'metal' },
  { level: 10, part: 'frame', value: '#d4af37', label: 'Gold frame', finish: 'gold' },
  { level: 12, part: 'helmet', value: '#e8e8ea', label: 'Chrome helmet', finish: 'chrome' },
  { level: 15, part: 'frame', value: '#7b5cff', label: 'Oil slick', finish: 'oilslick' },
];

export const BASE = {
  rims: ['#1b1c1f', '#e8e8ea'],
  tires: ['#1a1a1a'],
  bars: ['#d8d8dc', '#141416'],
};

export function xpForLevel(l) { return Math.round(600 * Math.pow(l - 1, 1.55)); } // total XP to reach level l

export class Progress {
  constructor(game) {
    this.game = game;
    this.xp = store('xp') || 0;
    this.level = this.levelFor(this.xp);
  }

  levelFor(xp) {
    let l = 1;
    while (xp >= xpForLevel(l + 1) && l < 50) l++;
    return l;
  }

  // fraction of the way to the next level
  frac() {
    const a = xpForLevel(this.level), b = xpForLevel(this.level + 1);
    return Math.min(1, (this.xp - a) / (b - a));
  }

  add(amount, reason = '') {
    amount = Math.round(amount);
    if (amount <= 0) return;
    this.xp += amount;
    store('xp', this.xp);
    const nl = this.levelFor(this.xp);
    if (nl > this.level) {
      const from = this.level;
      this.level = nl;
      const unlocked = UNLOCKS.filter((u) => u.level > from && u.level <= nl);
      this.game.onLevelUp(nl, unlocked);
    }
    this.game.ui.xpGain?.(amount, reason);
  }

  isUnlocked(part, value) {
    const u = UNLOCKS.find((x) => x.part === part && x.value === value);
    return !u || u.level <= this.level;
  }
}
