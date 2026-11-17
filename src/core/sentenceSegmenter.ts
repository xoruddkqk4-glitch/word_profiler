import type { BilingualSentencePair } from '../types/ai';

export const SAVED_TRANSLATION_HEADER = '[우리말 해석]';

const TRANSLATION_HEADER_LINE_RE = /^[ \t]*\[우리말\s*해석\][ \t]*\r?$/mu;
const SALUTATION_OR_SIGNOFF_RE =
  /^(?:Dear|To|From|Subject|Re|Sincerely|Best|Warm|Yours|Regards|Respectfully)\b/i;

const COMMON_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'cf',
  'al',
  'fig',
  'no',
  'vol',
  'pp',
  'ch',
  'inc',
  'ltd',
  'co',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'u.s',
  'u.k',
  'a.m',
  'p.m',
  'ph.d',
  'b.c',
  'a.d',
]);

export function extractSavedTranslationFromPassage(rawPassageContent: string): {
  englishContent: string;
  koreanContent: string | null;
} {
  const match = TRANSLATION_HEADER_LINE_RE.exec(rawPassageContent);
  if (!match) {
    return { englishContent: rawPassageContent, koreanContent: null };
  }

  const englishContent = rawPassageContent
    .slice(0, match.index)
    .replace(/\s+$/, '');
  const koreanRaw = rawPassageContent
    .slice(match.index + match[0].length)
    .trim();

  return {
    englishContent,
    koreanContent: koreanRaw || null,
  };
}

export function formatPassageWithSavedTranslation(
  englishContent: string,
  koreanContent: string | null | undefined,
): string {
  const cleanEnglish = extractSavedTranslationFromPassage(englishContent).englishContent;
  if (!koreanContent || !koreanContent.trim()) {
    return cleanEnglish;
  }
  return `${cleanEnglish.trimEnd()}\n\n${SAVED_TRANSLATION_HEADER}\n${koreanContent.trim()}`;
}

function shouldMergeWrappedLines(curLine: string, nextLine: string): boolean {
  if (/[.?!]["'”’)\]}]*$/.test(curLine)) {
    return false;
  }
  if (SALUTATION_OR_SIGNOFF_RE.test(curLine) || SALUTATION_OR_SIGNOFF_RE.test(nextLine)) {
    return false;
  }
  const looksLikeHeading =
    curLine.length <= 45 &&
    !/[,;:\-—]$/.test(curLine) &&
    /^[A-Z"“‘(\[]/.test(nextLine) &&
    !/\b(?:and|or|but|that|which|who|where|when|while|if|as|for|to|of|in|on|at|with|by|from|into|is|are|was|were|be|been|has|have|had|can|could|will|would|should|may|might|must)\s*$/i.test(
      curLine,
    );
  if (looksLikeHeading) {
    return false;
  }
  return true;
}

function mergeParagraphWrappedLines(paragraphBlock: string): string[] {
  const rawLines = paragraphBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rawLines.length === 0) return [];

  const merged: string[] = [rawLines[0]];
  for (let i = 1; i < rawLines.length; i++) {
    const prev = merged[merged.length - 1];
    const next = rawLines[i];
    if (shouldMergeWrappedLines(prev, next)) {
      merged[merged.length - 1] = `${prev} ${next}`;
    } else {
      merged.push(next);
    }
  }
  return merged;
}

function isNonSplittingAbbreviation(beforePunct: string): boolean {
  const m = beforePunct.match(
    /(?:^|[\s("'“‘(\[{])([A-Za-z]+(?:\.[A-Za-z]+)*)$/,
  );
  if (!m) return false;
  const token = m[1];
  const lower = token.toLowerCase();
  if (COMMON_ABBREVIATIONS.has(lower)) return true;
  if (/^[A-Za-z]$/.test(token)) return true;
  if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(token)) return true;
  return false;
}

function splitChunkIntoSentences(chunk: string): string[] {
  const trimmed = chunk.trim();
  if (!trimmed) return [];

  const sentences: string[] = [];
  const boundaryRe = /([.?!]+)(["'”’)\]}]*)(?=\s|$)/g;
  let sentStart = 0;
  let m: RegExpExecArray | null;

  while ((m = boundaryRe.exec(trimmed)) !== null) {
    const punct = m[1];
    const closing = m[2];
    const matchEnd = m.index + m[0].length;

    if (punct === '.' && closing === '') {
      const beforePunct = trimmed.slice(0, m.index);
      if (isNonSplittingAbbreviation(beforePunct)) {
        continue;
      }
    }

    const rest = trimmed.slice(matchEnd);
    const wsMatch = rest.match(/^\s*/);
    const wsLen = wsMatch ? wsMatch[0].length : 0;
    const afterWs = rest.slice(wsLen);

    if (afterWs.length > 0) {
      const firstContentChar = afterWs.replace(/^["'“‘(\[{]+/, '').charAt(0);
      if (/^[a-z]/.test(firstContentChar)) {
        continue;
      }
    }

    const piece = trimmed.slice(sentStart, matchEnd).trim();
    if (piece) {
      sentences.push(piece);
    }
    sentStart = matchEnd + wsLen;
  }

  const tail = trimmed.slice(sentStart).trim();
  if (tail) {
    sentences.push(tail);
  }

  return sentences;
}

export interface SegmentedEnglishSentence {
  index: number;
  en: string;
  paragraphIndex: number;
}

export function segmentEnglishSentences(text: string): SegmentedEnglishSentence[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cleanEnglish = extractSavedTranslationFromPassage(normalized).englishContent;
  const rawParagraphs = cleanEnglish
    .split(/\n[ \t]*\n+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const result: SegmentedEnglishSentence[] = [];
  let paragraphIndex = 0;

  for (const para of rawParagraphs) {
    const chunks = mergeParagraphWrappedLines(para);
    let addedInParagraph = false;

    for (const chunk of chunks) {
      const sents = splitChunkIntoSentences(chunk);
      for (const s of sents) {
        result.push({
          index: result.length,
          en: s,
          paragraphIndex,
        });
        addedInParagraph = true;
      }
    }

    if (addedInParagraph) {
      paragraphIndex += 1;
    }
  }

  return result;
}

export function assembleKoreanFullTextFromPairs(
  pairs: readonly BilingualSentencePair[],
): string {
  if (pairs.length === 0) return '';

  const byParagraph = new Map<number, string[]>();
  for (const p of pairs) {
    const ko = p.ko.trim();
    if (!ko) continue;
    const list = byParagraph.get(p.paragraphIndex);
    if (list) {
      list.push(ko);
    } else {
      byParagraph.set(p.paragraphIndex, [ko]);
    }
  }

  return Array.from(byParagraph.keys())
    .sort((a, b) => a - b)
    .map((key) => byParagraph.get(key)!.join(' '))
    .filter((para) => para.length > 0)
    .join('\n\n');
}

function splitKoreanSentences(koreanParagraph: string): string[] {
  const trimmed = koreanParagraph.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.?!…]["'”’)\]}]*)\s+(?!라고|하고|라는|라며|고\s)/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function distributeKoreanSentences(
  enSentences: readonly SegmentedEnglishSentence[],
  koSentences: readonly string[],
): string[] {
  const enCount = enSentences.length;
  if (enCount === 0) return [];
  if (koSentences.length === 0) {
    return enSentences.map(() => '');
  }
  if (koSentences.length === enCount) {
    return [...koSentences];
  }
  if (koSentences.length < enCount) {
    return enSentences.map((_, i) => koSentences[i] ?? '');
  }

  const counts = new Array<number>(enCount).fill(1);
  const sortedIndices = enSentences
    .map((s, idx) => ({ idx, len: s.en.length }))
    .sort((a, b) => b.len - a.len || a.idx - b.idx)
    .map((item) => item.idx);

  let extra = koSentences.length - enCount;
  let cursor = 0;
  while (extra > 0) {
    counts[sortedIndices[cursor % sortedIndices.length]] += 1;
    cursor += 1;
    extra -= 1;
  }

  const distributed: string[] = new Array(enCount);
  let koOffset = 0;
  for (let i = 0; i < enCount; i++) {
    const take = counts[i];
    distributed[i] = koSentences.slice(koOffset, koOffset + take).join(' ');
    koOffset += take;
  }
  return distributed;
}

export function alignEnglishAndKoreanText(
  englishContent: string,
  koreanContent: string,
): BilingualSentencePair[] {
  const enSegments = segmentEnglishSentences(englishContent);
  if (enSegments.length === 0) return [];

  const cleanKo = koreanContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!cleanKo) {
    return enSegments.map((seg) => ({
      index: seg.index,
      en: seg.en,
      ko: '',
      paragraphIndex: seg.paragraphIndex,
    }));
  }

  const koParagraphs = cleanKo
    .split(/\n[ \t]*\n+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const enByPara = new Map<number, SegmentedEnglishSentence[]>();
  for (const seg of enSegments) {
    const group = enByPara.get(seg.paragraphIndex);
    if (group) {
      group.push(seg);
    } else {
      enByPara.set(seg.paragraphIndex, [seg]);
    }
  }
  const paraKeys = Array.from(enByPara.keys()).sort((a, b) => a - b);

  if (koParagraphs.length === paraKeys.length) {
    const pairs: BilingualSentencePair[] = [];
    for (let i = 0; i < paraKeys.length; i++) {
      const enGroup = enByPara.get(paraKeys[i])!;
      const koList = splitKoreanSentences(koParagraphs[i]);
      const mapped = distributeKoreanSentences(enGroup, koList);
      for (let j = 0; j < enGroup.length; j++) {
        pairs.push({
          index: enGroup[j].index,
          en: enGroup[j].en,
          ko: mapped[j] ?? '',
          paragraphIndex: enGroup[j].paragraphIndex,
        });
      }
    }
    return pairs;
  }

  const allKoSentences = koParagraphs.flatMap(splitKoreanSentences);
  const mappedAll = distributeKoreanSentences(enSegments, allKoSentences);
  return enSegments.map((seg, idx) => ({
    index: seg.index,
    en: seg.en,
    ko: mappedAll[idx] ?? '',
    paragraphIndex: seg.paragraphIndex,
  }));
}
