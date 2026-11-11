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

export function parseSettingsFileContent(
  content: string,
  currentSettings: ProfilerSettings,
): { settings: ProfilerSettings; extraIgnoreWords?: string[] } {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Partial<ExportedConfigPayload>;
    return {
      settings: {
        ...currentSettings,
        ...(parsed.settings ?? {}),
      },
      extraIgnoreWords: Array.isArray(parsed.extraIgnoreWords)
        ? parsed.extraIgnoreWords.map(String)
        : undefined,
    };
  }

  // Parse Python configparser INI (`[DEFAULT]`)
  const next: ProfilerSettings = { ...currentSettings };
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
        if (rawVal) next.tokenDefinition = unquote(rawVal);
        break;
      case 'IGNORE_CASE':
        next.ignoreCase = rawVal.toLowerCase() === 'true';
        break;
      case 'SHOW_LEVELS':
        next.showLevels = rawVal.toLowerCase() === 'true';
        break;
      case 'DEFAULT_TAB': {
        const n = Number(rawVal);
        const tab: MainTabId = n === 1 ? 'statistics' : 'profiler';
        next.defaultTab = tab;
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
        if (Number.isFinite(pt) && pt >= 6 && pt <= 48) {
          next.fontSizePx = Math.round(pt * (4 / 3));
        }
        break;
      }
      case 'STRIP_CURRICULUM_ANNOTATIONS':
        next.stripCurriculumAnnotations = rawVal.toLowerCase() === 'true';
        break;
      case 'IGNORE_LIST_EXTRAS':
        try {
          const arr = JSON.parse(rawVal.replace(/'/g, '"'));
          if (Array.isArray(arr)) {
            extraIgnoreWords = arr.map(String);
          }
        } catch {
          // ignore malformed array
        }
        break;
    }
  }

  return { settings: next, extraIgnoreWords };
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

