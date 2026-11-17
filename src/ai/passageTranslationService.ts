import {
  alignEnglishAndKoreanText,
  assembleKoreanFullTextFromPairs,
  extractSavedTranslationFromPassage,
  segmentEnglishSentences,
} from '../core/sentenceSegmenter';
import {
  getActiveAiModelId,
  getActiveAiProvider,
  type BilingualSentencePair,
  type OpenRouterConfig,
  type SavedPassageTranslation,
} from '../types/ai';
import { callOpenRouterJson } from './openRouterClient';

const PROMPT_STORAGE_KEY = 'antwordprofiler_translation_prompt_v1';
const ALIGN_CACHE_STORAGE_KEY = 'antwordprofiler_bilingual_align_v1';
const RESULT_CACHE_STORAGE_KEY = 'antwordprofiler_translation_result_cache_v1';
const MAX_ALIGN_CACHE_ENTRIES = 60;
const MAX_RESULT_CACHE_ENTRIES = 30;
const MAX_CONCURRENT_BATCHES = 4;
const MIN_PARALLEL_BATCH_SIZE = 3;
const MAX_PARALLEL_BATCH_SIZE = 12;

export const DEFAULT_TRANSLATION_PROMPT = `우리말 해석 원칙
- 해석은 직역을 바탕으로 해서 이해할 수 있도록 하되 해석에서 빠트리는 단어가 없어야 한다.
- 학습 편의성을 위하여 전문 해석은 문장의 의미를 구문 구조와 관련해 이해가 쉽도록 직역을 원칙으로 한다. 단, 직역이 어색하여 의미 전달이 어려운 경우에 한하여 자연스럽게 의역하거나 직역 후 괄호를 사용하여 의역을 제시한다.
- 지나치게 어렵거나 지칭하는 것이 무엇인지 혼동되는 부분은 괄호를 주어 그 안에 의역이나 추가로 설명을 덧붙인다. 이 경우 괄호는 앞 내용의 끝에 띄어쓰기 없이 붙여준다. (예: 그것(자기 편견)은 사건들에 대한 ~) 반면, 본문에 없는 단어를 우리말 해석상 필요에 의해 추가할 때는 앞 단어와 한 칸 띄운 후 괄호 안에 적어준다. (예: 범지구적인 (빙하의) 융해가 진행되는 것을 ~)
- 문장이 길 경우, 주술 호응을 확인하여 비문이 되지 않도록 유의한다.
- 영문의 한 문장은 우리말에서 되도록 한 문장으로 해석하지만, 어색한 경우 두 문장으로 나눌 수 있다. 콜론(:)이나 세미콜론(;)의 경우 그 의미를 살려본다.
- 조동사 등 단어나 표현이 해석에서 누락되지 않도록 한다. 단 대명사의 해석이 어색하고 문맥상 뚜렷한 경우 우리말의 자연스러움을 고려해 생략할 수 있다.
- 영문의 관사는 필요 시 그 의미를 밝히지만 그렇지 않은 경우 해석하지 않는다.
- 영문의 dash(—, 줄표)는 되도록 dash가 해석에 들어가지 않도록 쉼표를 이용하는 편이 좋지만, 자연스러운 경우 dash를 살려서 해석할 수 있다.
- 고유 명사(인명, 도시명 등)는 모두 원어를 그대로 제시하되, 일반화된 경우에만 우리말로 표기한다. (예시: 뉴욕, 런던)
- 대명사 해석에 유의한다. You가 일반인을 의미하면 ‘사람들’로, 독자를 가리킬 때는 ‘여러분’으로 해석하고, his or her는 소유격 대명사가 주어와 동일인을 가리킬 때는 ‘자기’나 ‘자신의’로 해석한다.
- 영문의 복수형은 우리말에서 일반적으로 단수형으로 해석하지만, 문맥상 명확히 할 필요가 있는 경우 복수형으로 해석한다.
- 영문 강조(‘ ’, “ ”, 이탤릭체, 대문자)는 우리글에서 작은따옴표(‘ ’)로 처리한다.
- 직접 인용은 큰따옴표(“ ”)로 표기한다.
- 영문 이탤릭체인 작품, 서적, 잡지 등은 ‘The Greatest Poetry’와 같이 작은따옴표를 이용한다.
- 인용문에 이탤릭체가 쓰인 경우, 문장 부호가 겹치더라도 모두 작은따옴표를 사용한다. (예시: The philosopher Nelson Godman argued that we should replace the question “What is art?” with the question “When is art?” - 철학자 Nelson Goodman은 ‘‘무엇’이 예술인가?’라는 질문을 ‘‘언제’가 예술인가?’라는 질문으로 대체해야 한다고 주장했다.)
- 다음 표현은 올바른 표현을 사용하자.
  잘못된 표현 → 올바른 표현
  $ 370 → $370
  건강검진 → 건강 검진
  지난 달 → 지난달
  지난 주 → 지난주
  지난 해 → 지난해
  이번달 → 이번 달
  이번주 → 이번 주
  이번해 → 이번 해
  다음달 → 다음 달
  다음주 → 다음 주
  다음해 → 다음 해
  봉사활동 → 봉사 활동
  자원 봉사 → 자원봉사
  자원 봉사자 → 자원봉사자
  상호작용 → 상호 작용
  의사 소통 → 의사소통
  소화장애 → 소화 장애
  신용카드 → 신용 카드
  아침식사 → 아침 식사
  점심식사 → 점심 식사
  저녁식사 → 저녁 식사
  이 곳 → 이곳
  저 곳 → 저곳
  준비사항 → 준비 사항
  지역사회 → 지역 사회
  토크쇼 → 토크 쇼
  휴대전화 → 휴대 전화
  가져다 주다 → 가져다주다
  데려다 주다 → 데려다주다
  수 천 년 → 수천 년
  물 속 → 물속`;

export function loadSavedTranslationPrompt(): string {
  if (typeof window === 'undefined') return DEFAULT_TRANSLATION_PROMPT;
  try {
    const raw = window.localStorage.getItem(PROMPT_STORAGE_KEY);
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }
  } catch {
    // ignore storage read restrictions
  }
  return DEFAULT_TRANSLATION_PROMPT;
}

export function saveTranslationPrompt(prompt: string): string {
  const value = prompt.trim().length > 0 ? prompt : DEFAULT_TRANSLATION_PROMPT;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PROMPT_STORAGE_KEY, value);
    } catch {
      // ignore storage quota errors
    }
  }
  return value;
}

export function resetTranslationPromptToDefault(): string {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(PROMPT_STORAGE_KEY);
    } catch {
      // ignore storage restrictions
    }
  }
  return DEFAULT_TRANSLATION_PROMPT;
}

function normalizeCacheText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function buildAlignmentCacheKey(
  englishText: string,
  koreanFullText: string,
): string {
  const normEn = normalizeCacheText(englishText);
  const normKo = normalizeCacheText(koreanFullText);
  return `${normEn.length}:${fnv1aHex(normEn)}|${normKo.length}:${fnv1aHex(normKo)}`;
}

function readAlignmentCacheMap(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ALIGN_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function saveAlignmentCacheEntry(
  englishText: string,
  koreanFullText: string,
  koList: string[],
): void {
  if (typeof window === 'undefined' || koList.length === 0) return;
  try {
    const key = buildAlignmentCacheKey(englishText, koreanFullText);
    const map = readAlignmentCacheMap();
    if (key in map) {
      delete map[key];
    }
    const entries = Object.entries(map);
    const trimmed =
      entries.length >= MAX_ALIGN_CACHE_ENTRIES
        ? Object.fromEntries(entries.slice(-(MAX_ALIGN_CACHE_ENTRIES - 1)))
        : map;
    trimmed[key] = koList;
    window.localStorage.setItem(
      ALIGN_CACHE_STORAGE_KEY,
      JSON.stringify(trimmed),
    );
  } catch {
    // ignore storage quota errors
  }
}

export function lookupAlignmentCacheEntry(
  englishText: string,
  koreanFullText: string,
  expectedCount: number,
): string[] | null {
  if (typeof window === 'undefined' || expectedCount <= 0) return null;
  const key = buildAlignmentCacheKey(englishText, koreanFullText);
  const map = readAlignmentCacheMap();
  const hit = map[key];
  if (
    Array.isArray(hit) &&
    hit.length === expectedCount &&
    hit.every((item) => typeof item === 'string')
  ) {
    return hit;
  }
  return null;
}

interface StoredTranslationResultEntry {
  koList: string[];
  modelLabel?: string;
  updatedAt: number;
}

function buildTranslationResultCacheKey(
  englishText: string,
  customPrompt: string,
): string {
  const cleanEn = extractSavedTranslationFromPassage(englishText).englishContent;
  const normEn = normalizeCacheText(cleanEn);
  const normPrompt = normalizeCacheText(
    customPrompt.trim() || DEFAULT_TRANSLATION_PROMPT,
  );
  return `${normEn.length}:${fnv1aHex(normEn)}|${normPrompt.length}:${fnv1aHex(normPrompt)}`;
}

function readTranslationResultCacheMap(): Record<
  string,
  StoredTranslationResultEntry
> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RESULT_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, StoredTranslationResultEntry>;
  } catch {
    return {};
  }
}

export function lookupCachedTranslationResult(
  englishText: string,
  customPrompt: string,
): SavedPassageTranslation | null {
  if (typeof window === 'undefined') return null;
  const cleanEnglish =
    extractSavedTranslationFromPassage(englishText).englishContent;
  const segments = segmentEnglishSentences(cleanEnglish);
  if (segments.length === 0) return null;

  const key = buildTranslationResultCacheKey(cleanEnglish, customPrompt);
  const hit = readTranslationResultCacheMap()[key];
  if (
    !hit ||
    !Array.isArray(hit.koList) ||
    hit.koList.length !== segments.length ||
    !hit.koList.every((item) => typeof item === 'string')
  ) {
    return null;
  }

  const pairs: BilingualSentencePair[] = segments.map((seg, idx) => ({
    index: seg.index,
    en: seg.en,
    ko: hit.koList[idx] ?? '',
    paragraphIndex: seg.paragraphIndex,
  }));

  return {
    sourceEnglishText: cleanEnglish,
    pairs,
    koreanFullText: assembleKoreanFullTextFromPairs(pairs),
    updatedAt: typeof hit.updatedAt === 'number' ? hit.updatedAt : Date.now(),
    modelLabel: hit.modelLabel ? `${hit.modelLabel} (캐시)` : '캐시에서 복원',
  };
}

function saveTranslationResultCacheEntry(
  englishText: string,
  customPrompt: string,
  result: SavedPassageTranslation,
): void {
  if (typeof window === 'undefined' || result.pairs.length === 0) return;
  try {
    const key = buildTranslationResultCacheKey(englishText, customPrompt);
    const map = readTranslationResultCacheMap();
    if (key in map) {
      delete map[key];
    }
    const entries = Object.entries(map);
    const trimmed =
      entries.length >= MAX_RESULT_CACHE_ENTRIES
        ? Object.fromEntries(entries.slice(-(MAX_RESULT_CACHE_ENTRIES - 1)))
        : map;
    trimmed[key] = {
      koList: result.pairs.map((p) => p.ko),
      modelLabel: result.modelLabel,
      updatedAt: result.updatedAt,
    };
    window.localStorage.setItem(
      RESULT_CACHE_STORAGE_KEY,
      JSON.stringify(trimmed),
    );
  } catch {
    // ignore storage quota errors
  }
}

export function hydrateSavedPassageTranslation(
  englishContent: string,
  koreanContent: string,
  modelLabel = '파일에서 불러옴',
): SavedPassageTranslation {
  const cleanEnglish = extractSavedTranslationFromPassage(englishContent).englishContent;
  const cleanKorean = koreanContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const segments = segmentEnglishSentences(cleanEnglish);
  const cachedKoList = lookupAlignmentCacheEntry(
    cleanEnglish,
    cleanKorean,
    segments.length,
  );

  const pairs: BilingualSentencePair[] = cachedKoList
    ? segments.map((seg, idx) => ({
        index: seg.index,
        en: seg.en,
        ko: cachedKoList[idx] ?? '',
        paragraphIndex: seg.paragraphIndex,
      }))
    : alignEnglishAndKoreanText(cleanEnglish, cleanKorean);

  return {
    sourceEnglishText: cleanEnglish,
    pairs,
    koreanFullText: cleanKorean || assembleKoreanFullTextFromPairs(pairs),
    updatedAt: Date.now(),
    modelLabel,
  };
}

type RawTranslationEntry =
  | string
  | {
      id?: number | string;
      ko?: string;
      translation?: string;
      korean?: string;
      text?: string;
    };

function extractBatchTranslations(
  raw: unknown,
  batchSize: number,
): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI 우리말 해석 응답 형식이 올바르지 않습니다.');
  }
  let obj = raw as Record<string, unknown>;
  if (
    obj.t === undefined &&
    obj.translations === undefined &&
    obj.items === undefined &&
    obj.sentences === undefined &&
    obj.results === undefined
  ) {
    const nested = obj.result ?? obj.data;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      obj = nested as Record<string, unknown>;
    }
  }

  const listRaw =
    obj.t ?? obj.translations ?? obj.items ?? obj.sentences ?? obj.results;
  if (!Array.isArray(listRaw)) {
    throw new Error('AI 응답에서 번역 문장 목록(t/translations)을 찾지 못했습니다.');
  }

  const byId = new Map<number, string>();
  const positional: string[] = [];

  for (const item of listRaw as RawTranslationEntry[]) {
    if (typeof item === 'string') {
      positional.push(item.trim());
      continue;
    }
    if (!item || typeof item !== 'object') {
      positional.push('');
      continue;
    }
    const text =
      typeof item.ko === 'string'
        ? item.ko
        : typeof item.translation === 'string'
          ? item.translation
          : typeof item.korean === 'string'
            ? item.korean
            : typeof item.text === 'string'
              ? item.text
              : '';
    const cleaned = text.trim();
    positional.push(cleaned);

    const parsedId =
      typeof item.id === 'number'
        ? item.id
        : typeof item.id === 'string' && /^\d+$/.test(item.id.trim())
          ? Number(item.id.trim())
          : NaN;
    if (Number.isInteger(parsedId) && parsedId >= 1 && parsedId <= batchSize) {
      if (!byId.has(parsedId)) {
        byId.set(parsedId, cleaned);
      }
    }
  }

  const out: string[] = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    out[i] = (byId.get(i + 1) ?? positional[i] ?? '').trim();
  }
  if (out.every((s) => s.length === 0)) {
    throw new Error('AI가 해석 문장을 생성하지 못했습니다. 다시 시도해 주세요.');
  }
  return out;
}

function partitionIntoParallelBatches<T>(
  items: readonly T[],
): { start: number; items: T[] }[] {
  const total = items.length;
  if (total === 0) return [];
  if (total <= MIN_PARALLEL_BATCH_SIZE) {
    return [{ start: 0, items: [...items] }];
  }

  const maxDirectTotal = MAX_CONCURRENT_BATCHES * MAX_PARALLEL_BATCH_SIZE;
  const batchSize =
    total <= maxDirectTotal
      ? Math.ceil(
          total /
            Math.min(
              MAX_CONCURRENT_BATCHES,
              Math.ceil(total / MIN_PARALLEL_BATCH_SIZE),
            ),
        )
      : MAX_PARALLEL_BATCH_SIZE;

  const batches: { start: number; items: T[] }[] = [];
  for (let start = 0; start < total; start += batchSize) {
    batches.push({
      start,
      items: items.slice(start, start + batchSize),
    });
  }
  return batches;
}

export async function translateEnglishPassage(params: {
  englishText: string;
  customPrompt: string;
  config: OpenRouterConfig;
  signal?: AbortSignal;
  bypassCache?: boolean;
  onPartialUpdate?: (
    partial: SavedPassageTranslation,
    completedSentences: number,
    totalSentences: number,
  ) => void;
}): Promise<SavedPassageTranslation> {
  const cleanEnglish = extractSavedTranslationFromPassage(
    params.englishText,
  ).englishContent;
  const segments = segmentEnglishSentences(cleanEnglish);
  if (segments.length === 0) {
    throw new Error('해석할 영어 문장이 없습니다.');
  }

  const effectivePrompt =
    params.customPrompt.trim() || DEFAULT_TRANSLATION_PROMPT;

  if (!params.bypassCache) {
    const cached = lookupCachedTranslationResult(cleanEnglish, effectivePrompt);
    if (cached) {
      return cached;
    }
  }

  const providerLabel =
    getActiveAiProvider(params.config) === 'gemini' ? 'Gemini' : 'OpenRouter';
  const modelLabel = `${providerLabel} · ${getActiveAiModelId(params.config)}`;

  const allKo: string[] = new Array(segments.length).fill('');
  const batches = partitionIntoParallelBatches(segments);
  let completedSentences = 0;

  const buildSnapshot = (): SavedPassageTranslation => {
    const pairs: BilingualSentencePair[] = segments.map((seg, idx) => ({
      index: seg.index,
      en: seg.en,
      ko: allKo[idx] ?? '',
      paragraphIndex: seg.paragraphIndex,
    }));
    return {
      sourceEnglishText: cleanEnglish,
      pairs,
      koreanFullText: assembleKoreanFullTextFromPairs(pairs),
      updatedAt: Date.now(),
      modelLabel,
    };
  };

  let nextBatchCursor = 0;
  const workerCount = Math.min(MAX_CONCURRENT_BATCHES, batches.length);

  const runWorker = async () => {
    while (nextBatchCursor < batches.length) {
      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const batch = batches[nextBatchCursor];
      nextBatchCursor += 1;

      const contextBefore =
        batch.start > 0
          ? segments
              .slice(Math.max(0, batch.start - 2), batch.start)
              .map((s) => s.en)
              .join(' ')
          : '';

      const numberedInput = batch.items.map((s, idx) => `${idx + 1}. ${s.en}`);
      const estimatedMaxTokens = Math.min(
        2200,
        Math.max(600, batch.items.length * 260),
      );

      const userContentParts = [
        '[적용할 우리말 해석 원칙]',
        effectivePrompt,
        '',
        contextBefore
          ? `[직전 문맥 (참고용 — 출력 제외)]\n${contextBefore}\n`
          : '',
        `[해석할 영어 문장 ${batch.items.length}개]`,
        numberedInput.join('\n'),
        '',
        '출력 형식 및 필수 규칙:',
        '1. 마크다운 코드 블록 없이 순수 RFC 8259 JSON 객체 하나만 반환하세요.',
        `2. 반환 스키마: { "t": ["1번 문장 우리말 해석", ...] } (문자열 배열 길이 정확히 ${batch.items.length}개)`,
        '3. 입력된 모든 문장을 빠짐없이 1:1 순서로 번역하세요. 두 문장을 합치거나 건너뛰지 마세요.',
        '4. 한 영어 문장이 어색해 두 문장의 우리말로 나누는 경우에도 반드시 해당 배열 요소 문자열 하나 안에 두 문장을 함께 작성하세요.',
        '5. 위 [적용할 우리말 해석 원칙]과 띄어쓰기·문장부호 표기 규칙을 철저히 지키세요.',
      ];

      const raw = await callOpenRouterJson<unknown>({
        config: params.config,
        temperature: 0.15,
        maxTokens: estimatedMaxTokens,
        attemptTimeoutMs: 20_000,
        signal: params.signal,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert English-to-Korean educational passage translator for Korean high school / CSAT English materials. Follow the user-provided Korean translation principles strictly and return ONLY one valid RFC 8259 JSON object without markdown fences.',
          },
          {
            role: 'user',
            content: userContentParts.filter(Boolean).join('\n'),
          },
        ],
      });

      if (params.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const batchKo = extractBatchTranslations(raw, batch.items.length);
      for (let i = 0; i < batch.items.length; i++) {
        allKo[batch.start + i] = batchKo[i] ?? '';
      }
      completedSentences += batch.items.length;
      if (params.onPartialUpdate && completedSentences < segments.length) {
        params.onPartialUpdate(
          buildSnapshot(),
          completedSentences,
          segments.length,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const finalResult = buildSnapshot();
  saveAlignmentCacheEntry(
    cleanEnglish,
    finalResult.koreanFullText,
    finalResult.pairs.map((p) => p.ko),
  );
  saveTranslationResultCacheEntry(cleanEnglish, effectivePrompt, finalResult);

  return finalResult;
}
