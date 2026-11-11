import type { ProfileToken, ReferenceListSource } from '../types/domain';

export interface LevelColorPair {
  light: string;
  dark: string;
}

/**
 * Distinct, WCAG-accessible color pairs (>= 4.5:1 against white #ffffff in light mode
 * and against dark card surfaces oklch(0.3210 ...) in dark mode) for vocabulary levels.
 */
const PRESET_LEVEL_COLORS: LevelColorPair[] = [
  { light: '#1d4ed8', dark: '#93c5fd' }, // Level 1: Sapphire Blue
  { light: '#0f766e', dark: '#5eead4' }, // Level 2: Deep Teal
  { light: '#7c3aed', dark: '#d8b4fe' }, // Level 3: Royal Violet
  { light: '#b45309', dark: '#fcd34d' }, // Level 4: Warm Ochre
  { light: '#be185d', dark: '#f9a8d4' }, // Level 5: Rose Crimson
  { light: '#0369a1', dark: '#7dd3fc' }, // Level 6: Cerulean
  { light: '#4d7c0f', dark: '#bef264' }, // Level 7: Olive Moss
  { light: '#9a3412', dark: '#fdba74' }, // Level 8: Burnt Sienna
];

export const DEFAULT_IGNORE_COLOR: LevelColorPair = {
  light: '#15803d',
  dark: '#86efac',
};

export const DEFAULT_OUT_HIGHLIGHT_COLOR: LevelColorPair = {
  light: '#dc2626',
  dark: '#fca5a5',
};

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) =>
    lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function getDefaultLevelColorPair(index: number): LevelColorPair {
  if (index < PRESET_LEVEL_COLORS.length) {
    return PRESET_LEVEL_COLORS[index];
  }
  const hue = Math.round((index * 137.508) % 360);
  return {
    light: hslToHex(hue, 72, 36),
    dark: hslToHex(hue, 78, 72),
  };
}

export interface TokenHighlightStyle {
  color: string | null; // null = neutral body text color
  isHighlighted: boolean;
}

export function resolveTokenHighlight(
  token: Pick<ProfileToken, 'kind' | 'listId'>,
  refListsById: Map<string, ReferenceListSource>,
  options: {
    showLevels: boolean;
    ignoreEnabled: boolean;
    ignoreColor: LevelColorPair;
    outColor: LevelColorPair;
    theme: 'light' | 'dark';
  },
): TokenHighlightStyle {
  const { showLevels, ignoreEnabled, ignoreColor, outColor, theme } = options;

  if (showLevels) {
    if (token.kind === 'level' && token.listId) {
      const ref = refListsById.get(token.listId);
      if (ref && ref.enabled) {
        return {
          color: theme === 'dark' ? ref.colorDark : ref.colorLight,
          isHighlighted: true,
        };
      }
    }
    if (token.kind === 'ignored' && ignoreEnabled) {
      return {
        color: theme === 'dark' ? ignoreColor.dark : ignoreColor.light,
        isHighlighted: true,
      };
    }
    return { color: null, isHighlighted: false };
  }

  // Non-List Words mode (Out-of-List highlight)
  if (token.kind === 'out') {
    return {
      color: theme === 'dark' ? outColor.dark : outColor.light,
      isHighlighted: true,
    };
  }
  // If ignore is unchecked, ignored words behave like unhighlighted or out?
  // In AntWordProfiler, unchecked ignore list removes ignore words from level_lists so they become 'out' during profiling.
  return { color: null, isHighlighted: false };
}

