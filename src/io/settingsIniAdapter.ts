import { validateAndCompileTokenRegex } from '../core/tokenizer';
import type { ListFormatMode, MainTabId, ProfilerSettings } from '../types/domain';
import { triggerBrowserDownload } from './docExporters';

export interface ExportedConfigPayload {
  settings: ProfilerSettings;
  extraIgnoreWords: string[];
  activePresetId: string | null;
}

export function serializeToAntWordProfilerIni(
  payload: ExportedConfigPayload,
): string {
  const { settings, extraIgnoreWords } = payload;
  const defaultTabInt = settings.defaultTab === 'statistics' ? 1 : 0;
  const ptSize = Math.max(8, Math.round(settings.fontSizePx * 0.75));
  const lines = [
    '[DEFAULT]',
    `TOKEN_DEFINITION = ${settings.tokenDefinition}`,
    `IGNORE_CASE = ${settings.ignoreCase ? 'True' : 'False'}`,
    'TARGET_FILES_FOLDER = ""',
    'MASTER_LIST = ""',
    'LEVEL_LISTS_FOLDER = ""',
    'IGNORE_LIST_PATH = ""',
    `IGNORE_LIST_EXTRAS = ${JSON.stringify(extraIgnoreWords)}`,
    `SHOW_LEVELS = ${settings.showLevels ? 'True' : 'False'}`,
    `DEFAULT_TAB = ${defaultTabInt}`,
    `NATION_FORMAT = "${settings.nationFormat}"`,
    'SYSTEM_FONT_NAME = "Inter"',
    `SYSTEM_FONT_SIZE = ${ptSize}`,
    `STRIP_CURRICULUM_ANNOTATIONS = ${settings.stripCurriculumAnnotations ? 'True' : 'False'}`,
  ];
  return lines.join('\n') + '\n';
}

function unquote(val: string): string {
  const t = val.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function normalizeExtraIgnoreWords(raw: unknown[]): string[] {
  return raw.map((w) => String(w).trim()).filter(Boolean);
}

function clampFontSizePx(val: number): number {
  return Math.min(32, Math.max(14, Math.round(val)));
}

export function parseSettingsFileContent(
  content: string,
  currentSettings: ProfilerSettings,
): { settings: ProfilerSettings; extraIgnoreWords?: string[]; warnings: string[] } {
  const trimmed = content.trim();
  const warnings: string[] = [];

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Partial<ExportedConfigPayload>;
    const rawSettings =
      parsed.settings && typeof parsed.settings === 'object'
        ? (parsed.settings as Partial<Record<keyof ProfilerSettings, unknown>>)
        : {};
    const next: ProfilerSettings = { ...currentSettings };

    if (typeof rawSettings.ignoreCase === 'boolean') {
      next.ignoreCase = rawSettings.ignoreCase;
    }
    if (typeof rawSettings.showLevels === 'boolean') {
      next.showLevels = rawSettings.showLevels;
    }
    if (
      rawSettings.defaultTab === 'profiler' ||
      rawSettings.defaultTab === 'statistics'
    ) {
      next.defaultTab = rawSettings.defaultTab;
    }
    if (
      rawSettings.nationFormat === 'auto' ||
      rawSettings.nationFormat === 'rows' ||
      rawSettings.nationFormat === 'trees'
    ) {
      next.nationFormat = rawSettings.nationFormat;
    }
    if (typeof rawSettings.stripCurriculumAnnotations === 'boolean') {
      next.stripCurriculumAnnotations = rawSettings.stripCurriculumAnnotations;
    }
    if (
      typeof rawSettings.fontSizePx === 'number' &&
      Number.isFinite(rawSettings.fontSizePx) &&
      rawSettings.fontSizePx > 0
    ) {
      next.fontSizePx = clampFontSizePx(rawSettings.fontSizePx);
    }
    if (typeof rawSettings.showFullPathsInStats === 'boolean') {
      next.showFullPathsInStats = rawSettings.showFullPathsInStats;
    }
    if (typeof rawSettings.tokenDefinition === 'string') {
      const candidateTokenDef = rawSettings.tokenDefinition.trim();
      const check = validateAndCompileTokenRegex(
        candidateTokenDef,
        next.ignoreCase,
      );
      if (check.ok) {
        next.tokenDefinition = candidateTokenDef;
      } else {
        warnings.push(`TOKEN_DEFINITION이 유효하지 않아 기존 설정을 유지했습니다 (${check.error}).`);
      }
    }

    return {
      settings: next,
      extraIgnoreWords: Array.isArray(parsed.extraIgnoreWords)
        ? normalizeExtraIgnoreWords(parsed.extraIgnoreWords)
        : undefined,
      warnings,
    };
  }

  // Parse Python configparser INI (`[DEFAULT]`)
  const next: ProfilerSettings = { ...currentSettings };
  let rawTokenDef: string | null = null;
  let extraIgnoreWords: string[] | undefined;

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[') || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toUpperCase();
    const rawVal = line.slice(eqIdx + 1).trim();

    switch (key) {
      case 'TOKEN_DEFINITION':
        if (rawVal) rawTokenDef = unquote(rawVal).trim();
        break;
      case 'IGNORE_CASE': {
        const lower = rawVal.toLowerCase();
        if (lower === 'true' || lower === 'false') {
          next.ignoreCase = lower === 'true';
        }
        break;
      }
      case 'SHOW_LEVELS': {
        const lower = rawVal.toLowerCase();
        if (lower === 'true' || lower === 'false') {
          next.showLevels = lower === 'true';
        }
        break;
      }
      case 'DEFAULT_TAB': {
        const n = Number(rawVal);
        if (n === 0 || n === 1) {
          const tab: MainTabId = n === 1 ? 'statistics' : 'profiler';
          next.defaultTab = tab;
        }
        break;
      }
      case 'NATION_FORMAT': {
        const fmt = unquote(rawVal).toLowerCase();
        if (fmt === 'auto' || fmt === 'rows' || fmt === 'trees') {
          next.nationFormat = fmt as ListFormatMode;
        }
        break;
      }
      case 'SYSTEM_FONT_SIZE': {
        const pt = Number(rawVal);
        if (Number.isFinite(pt) && pt > 0) {
          next.fontSizePx = clampFontSizePx(pt * (4 / 3));
        }
        break;
      }
      case 'STRIP_CURRICULUM_ANNOTATIONS': {
        const lower = rawVal.toLowerCase();
        if (lower === 'true' || lower === 'false') {
          next.stripCurriculumAnnotations = lower === 'true';
        }
        break;
      }
      case 'IGNORE_LIST_EXTRAS':
        try {
          const arr = JSON.parse(rawVal.replace(/'/g, '"'));
          if (Array.isArray(arr)) {
            extraIgnoreWords = normalizeExtraIgnoreWords(arr);
          }
        } catch {
          // ignore malformed array
        }
        break;
    }
  }

  if (rawTokenDef !== null) {
    const check = validateAndCompileTokenRegex(rawTokenDef, next.ignoreCase);
    if (check.ok) {
      next.tokenDefinition = rawTokenDef;
    } else {
      warnings.push(`TOKEN_DEFINITION이 유효하지 않아 기존 설정을 유지했습니다 (${check.error}).`);
    }
  }

  return { settings: next, extraIgnoreWords, warnings };
}

export function exportSettingsFile(
  payload: ExportedConfigPayload,
  format: 'ini' | 'json',
): void {
  if (format === 'ini') {
    const ini = serializeToAntWordProfilerIni(payload);
    triggerBrowserDownload(
      new Blob([ini], { type: 'text/plain;charset=utf-8' }),
      'antwordprofiler_settings.ini',
    );
    return;
  }
  const json = JSON.stringify(payload, null, 2);
  triggerBrowserDownload(
    new Blob([json], { type: 'application/json;charset=utf-8' }),
    'antwordprofiler_settings.json',
  );
}

