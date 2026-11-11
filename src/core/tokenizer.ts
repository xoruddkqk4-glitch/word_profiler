export interface LosslessTokenPiece {
  token: string;
  lookupKey: string;
  trailingWs: string;
}

export interface LosslessTokenization {
  leadingWs: string;
  pieces: LosslessTokenPiece[];
}

export type RegexValidationResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string };

/**
 * Compiles AntWordProfiler token definitions (default `[\p{L}]+`) into a
 * Unicode-aware JavaScript RegExp with zero-length infinite-loop protection.
 */
export function validateAndCompileTokenRegex(
  pattern: string,
  ignoreCase: boolean,
): RegexValidationResult {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return { ok: false, error: '토큰 정규식이 비어 있습니다. 예: [\\p{L}]+' };
  }

  const flags = ignoreCase ? 'giu' : 'gu';
  try {
    const regex = new RegExp(trimmed, flags);
    if (regex.test('')) {
      return {
        ok: false,
        error: '빈 문자열(길이 0)과 일치하는 정규식은 사용할 수 없습니다. + 또는 {1,} 수량자를 확인해 주세요.',
      };
    }
    regex.lastIndex = 0;
    return { ok: true, regex };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `유효하지 않은 정규식입니다: ${msg}` };
  }
}

/**
 * Splits `text` into `leadingWs` + `[{ token, lookupKey, trailingWs }, ...]`
 * such that `leadingWs + pieces.map(p => p.token + p.trailingWs).join('') === text`.
 */
export function tokenizeLossless(
  text: string,
  pattern: string,
  ignoreCase: boolean,
): LosslessTokenization {
  if (!text) {
    return { leadingWs: '', pieces: [] };
  }

  const compiled = validateAndCompileTokenRegex(pattern, ignoreCase);
  const regex = compiled.ok
    ? compiled.regex
    : new RegExp('[\\p{L}]+', ignoreCase ? 'giu' : 'gu');

  const matches: { value: string; start: number; end: number }[] = [];
  regex.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const value = m[0];
    if (value.length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    matches.push({
      value,
      start: m.index,
      end: m.index + value.length,
    });
  }

  if (matches.length === 0) {
    return { leadingWs: text, pieces: [] };
  }

  const leadingWs = text.slice(0, matches[0].start);
  const pieces: LosslessTokenPiece[] = new Array(matches.length);

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : text.length;
    pieces[i] = {
      token: cur.value,
      lookupKey: ignoreCase ? cur.value.toLowerCase() : cur.value,
      trailingWs: text.slice(cur.end, nextStart),
    };
  }

  return { leadingWs, pieces };
}

/**
 * Extracts unique normalized word tokens from arbitrary pasted text
 * (used by Extra Ignore Words smart paste).
 */
export function extractUniqueTokensFromText(
  text: string,
  pattern: string,
  ignoreCase: boolean,
): string[] {
  const { pieces } = tokenizeLossless(text, pattern, ignoreCase);
  const unique = new Set<string>();
  for (const p of pieces) {
    unique.add(p.lookupKey);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

