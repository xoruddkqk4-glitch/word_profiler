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

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.min(255, Math.max(0, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * Ensures a color has >= 4.5:1 contrast on white (#ffffff) for light mode and
 * Word/HTML exports by reducing HSL lightness while preserving hue.
 */
export function ensureReadableOnLight(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return hex;
  if (relativeLuminance(...rgb) <= 0.18) {
    return rgbToHex(...rgb);
  }
  const [h, s, initialL] = rgbToHsl(...rgb);
  for (let l = Math.min(initialL, 55); l >= 12; l -= 2) {
    const candidate = hslToHex(h, s, l);
    const cRgb = parseHexRgb(candidate)!;
    if (relativeLuminance(...cRgb) <= 0.175) {
      return candidate;
    }
  }
  return hslToHex(h, s, 24);
}

/**
 * Ensures a color has readable contrast against dark surfaces by raising HSL
 * lightness when a dark-theme or light-mode swatch is too dim for dark mode.
 */
export function ensureReadableOnDark(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return hex;
  if (relativeLuminance(...rgb) >= 0.34) {
    return rgbToHex(...rgb);
  }
  const [h, s, initialL] = rgbToHsl(...rgb);
  for (let l = Math.max(initialL, 58); l <= 88; l += 2) {
    const candidate = hslToHex(h, s, l);
    const cRgb = parseHexRgb(candidate)!;
    if (relativeLuminance(...cRgb) >= 0.35) {
      return candidate;
    }
  }
  return hslToHex(h, s, 74);
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

