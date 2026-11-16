import { describe, expect, it } from 'vitest';
import type { ProfilerSettings } from '../types/domain';
import { parseSettingsFileContent } from './settingsIniAdapter';

const currentSettings: ProfilerSettings = {
  tokenDefinition: '[\\p{L}]+',
  ignoreCase: true,
  showLevels: true,
  defaultTab: 'profiler',
  nationFormat: 'auto',
  stripCurriculumAnnotations: true,
  fontSizePx: 18,
  showFullPathsInStats: false,
};

describe('parseSettingsFileContent', () => {
  it('validates regex and clamps font size when importing INI settings', () => {
    const ini = [
      '[DEFAULT]',
      'TOKEN_DEFINITION = [unclosed',
      'SYSTEM_FONT_SIZE = 100',
      'IGNORE_CASE = False',
      'IGNORE_LIST_EXTRAS = ["Alpha", "  ", "Beta"]',
    ].join('\n');

    const res = parseSettingsFileContent(ini, currentSettings);
    expect(res.settings.tokenDefinition).toBe(currentSettings.tokenDefinition);
    expect(res.settings.fontSizePx).toBe(32);
    expect(res.settings.ignoreCase).toBe(false);
    expect(res.extraIgnoreWords).toEqual(['Alpha', 'Beta']);
    expect(res.warnings.length).toBe(1);
  });

  it('clamps fontSizePx and rejects invalid types in JSON settings', () => {
    const json = JSON.stringify({
      settings: {
        tokenDefinition: '',
        fontSizePx: 6,
        defaultTab: 'invalid_tab',
        nationFormat: 'trees',
      },
      extraIgnoreWords: ['foo', '', 'bar'],
    });

    const res = parseSettingsFileContent(json, currentSettings);
    expect(res.settings.tokenDefinition).toBe(currentSettings.tokenDefinition);
    expect(res.settings.fontSizePx).toBe(14);
    expect(res.settings.defaultTab).toBe('profiler');
    expect(res.settings.nationFormat).toBe('trees');
    expect(res.extraIgnoreWords).toEqual(['foo', 'bar']);
    expect(res.warnings.length).toBe(1);
  });
});
