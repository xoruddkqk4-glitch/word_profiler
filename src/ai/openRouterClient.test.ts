import { describe, expect, it } from 'vitest';
import { DEFAULT_OPENROUTER_MODEL } from '../types/ai';
import { resolveStoredOpenRouterModelId } from './openRouterClient';

describe('resolveStoredOpenRouterModelId', () => {
  it('keeps still-valid older presets', () => {
    expect(resolveStoredOpenRouterModelId('google/gemini-2.5-flash')).toBe(
      'google/gemini-2.5-flash',
    );
    expect(resolveStoredOpenRouterModelId('openai/gpt-4o-mini')).toBe(
      'openai/gpt-4o-mini',
    );
  });

  it('migrates retired slugs to the current default', () => {
    expect(resolveStoredOpenRouterModelId('anthropic/claude-3.5-haiku')).toBe(
      DEFAULT_OPENROUTER_MODEL,
    );
  });

  it('falls back for empty values', () => {
    expect(resolveStoredOpenRouterModelId('')).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveStoredOpenRouterModelId(null)).toBe(DEFAULT_OPENROUTER_MODEL);
  });
});
