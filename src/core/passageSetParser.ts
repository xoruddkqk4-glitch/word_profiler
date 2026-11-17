import { countWordsMsWordStyle } from './tokenizer';

export interface PassageItem {
  /** 0-based passage index within the set */
  index: number;
  /** Human-readable item label (e.g. "[18]", "문항 1", "Passage 2") */
  label: string;
  /** Exact raw prefix (dividers, headers, leading newlines) before `content` */
  leadingRaw: string;
  /** Clean passage text to profile and edit */
  content: string;
  /** Exact raw suffix (trailing newlines/dividers) after `content` */
  trailingRaw: string;
}

interface LineSpan {
  lineIndex: number;
  text: string;
  start: number;
  end: number;
  fullEnd: number;
}

function splitLinesLossless(raw: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let pos = 0;
  let lineIndex = 0;
  const len = raw.length;

  while (pos <= len) {
    const nlIdx = raw.indexOf('\n', pos);
    if (nlIdx === -1) {
      const text = raw.slice(pos);
      spans.push({
        lineIndex,
        text,
        start: pos,
        end: len,
        fullEnd: len,
      });
      break;
    }

    const hasCr = nlIdx > pos && raw.charCodeAt(nlIdx - 1) === 13; // '\r'
    const textEnd = hasCr ? nlIdx - 1 : nlIdx;
    spans.push({
      lineIndex,
      text: raw.slice(pos, textEnd),
      start: pos,
      end: textEnd,
      fullEnd: nlIdx + 1,
    });
    pos = nlIdx + 1;
    lineIndex += 1;
    if (pos === len) {
      break;
    }
  }

  return spans;
}

const PURE_DIVIDER_RE = /^[ \t]*(?:={3,}|-{3,}|\*{3,}|_{3,})[ \t]*$/u;
const TITLED_DIVIDER_RE =
  /^[ \t]*(?:={2,}[ \t]*([^=\r\n]+?)[ \t]*={2,}|-{3,}[ \t]*([^-\r\n]+?)[ \t]*-{3,})[ \t]*$/u;

function matchDividerLine(text: string): { isDivider: true; title: string | null } | null {
  if (PURE_DIVIDER_RE.test(text)) {
    return { isDivider: true, title: null };
  }
  const m = TITLED_DIVIDER_RE.exec(text);
  if (m) {
    const title = (m[1] ?? m[2] ?? '').trim();
    return { isDivider: true, title: title || null };
  }
  return null;
}

interface HeaderMatch {
  label: string;
  /** Length of header prefix within `line.text` */
  prefixLen: number;
  /** Remaining text on the same line after the header prefix */
  rest: string;
  /** Whether the entire line is a standalone header (no inline passage body on same line) */
  standaloneLine: boolean;
}

const BRACKET_HEADER_RE =
  /^([ \t]*(\[\s*(?:문항|지문|세트|번|Q|Question|Passage|Item|Text|#)?\s*\d+(?:\s*[-~]\s*\d+)?\s*번?\s*\])[ \t]*)(.*)$/iu;

const HASH_HEADER_RE =
  /^[ \t]*#{1,4}[ \t]*((?:(?:문항|지문|세트|Passage|Item|Question|Text|Q)[ \t]*\d+(?:\s*[-~]\s*\d+)?|\d+(?:\s*[-~]\s*\d+)?(?:\s*번|[.)])?)(?:[ \t]*[^\r\n]*)?)$/iu;

const KEYWORD_STANDALONE_RE =
  /^[ \t]*((?:문항|지문|세트|Passage|Item|Question)[ \t]*\d+(?:\s*[-~]\s*\d+)?[ \t]*번?)[ \t]*$/iu;

const KEYWORD_DELIMITED_RE =
  /^([ \t]*((?:문항|지문|세트|Passage|Item|Question)[ \t]*\d+(?:\s*[-~]\s*\d+)?[ \t]*번?)[ \t]*[:.)\-][ \t]*)(.*)$/iu;

const BARE_NUMBER_HEADER_RE =
  /^([ \t]*(\d{1,3}(?:\s*[-~]\s*\d{1,3})?\s*(?:번[.)]?|[.)]))[ \t]*)(.*)$/u;

function matchExplicitHeader(lineText: string): HeaderMatch | null {
  const bracket = BRACKET_HEADER_RE.exec(lineText);
  if (bracket) {
    const rawLabel = bracket[2].replace(/\s+/g, ' ').trim();
    const rest = bracket[3] ?? '';
    return {
      label: rawLabel,
      prefixLen: bracket[1].length,
      rest,
      standaloneLine: rest.trim().length === 0,
    };
  }

  const hash = HASH_HEADER_RE.exec(lineText);
  if (hash) {
    return {
      label: hash[1].replace(/\s+/g, ' ').trim(),
      prefixLen: lineText.length,
      rest: '',
      standaloneLine: true,
    };
  }

  const kwStandalone = KEYWORD_STANDALONE_RE.exec(lineText);
  if (kwStandalone) {
    return {
      label: kwStandalone[1].replace(/\s+/g, ' ').trim(),
      prefixLen: lineText.length,
      rest: '',
      standaloneLine: true,
    };
  }

  const kwDelim = KEYWORD_DELIMITED_RE.exec(lineText);
  if (kwDelim) {
    const rest = kwDelim[3] ?? '';
    return {
      label: kwDelim[2].replace(/\s+/g, ' ').trim(),
      prefixLen: kwDelim[1].length,
      rest,
      standaloneLine: rest.trim().length === 0,
    };
  }

  return null;
}

function matchBareNumberHeader(
  lineText: string,
  prevLineBlank: boolean,
): HeaderMatch | null {
  const m = BARE_NUMBER_HEADER_RE.exec(lineText);
  if (!m) return null;
  const rest = m[3] ?? '';
  const standaloneLine = rest.trim().length === 0;
  if (!standaloneLine && !prevLineBlank) {
    return null;
  }
  const token = m[2].replace(/\s+/g, '').replace(/[.)]$/, '');
  const label = token.endsWith('번') ? token : `${token}번`;
  return {
    label,
    prefixLen: m[1].length,
    rest,
    standaloneLine,
  };
}

function buildItemFromChunk(
  raw: string,
  lines: readonly LineSpan[],
  chunkStart: number,
  chunkEnd: number,
  bodyLineStartIdx: number,
  bodyLineEndIdx: number,
  index: number,
  fallbackLabel: string,
  headerHint?: HeaderMatch | null,
): PassageItem {
  // Find first and last non-blank line inside [bodyLineStartIdx .. bodyLineEndIdx]
  let firstIdx = bodyLineStartIdx;
  while (firstIdx <= bodyLineEndIdx && lines[firstIdx].text.trim().length === 0) {
    firstIdx += 1;
  }
  let lastIdx = bodyLineEndIdx;
  while (lastIdx >= firstIdx && lines[lastIdx].text.trim().length === 0) {
    lastIdx -= 1;
  }

  if (firstIdx > lastIdx) {
    return {
      index,
      label: fallbackLabel,
      leadingRaw: raw.slice(chunkStart, chunkEnd),
      content: '',
      trailingRaw: '',
    };
  }

  const firstLine = lines[firstIdx];
  const detectedHeader =
    headerHint !== undefined
      ? headerHint
      : matchExplicitHeader(firstLine.text) ??
        matchBareNumberHeader(firstLine.text, true);

  let label = fallbackLabel;
  let contentStart = firstLine.start;

  if (detectedHeader) {
    label = detectedHeader.label || fallbackLabel;
    if (detectedHeader.standaloneLine) {
      // Advance to first non-blank line after standalone header, if one exists
      let afterHeaderIdx = firstIdx + 1;
      while (
        afterHeaderIdx <= lastIdx &&
        lines[afterHeaderIdx].text.trim().length === 0
      ) {
        afterHeaderIdx += 1;
      }
      if (afterHeaderIdx <= lastIdx) {
        contentStart = lines[afterHeaderIdx].start;
      } else {
        contentStart = firstLine.end;
      }
    } else {
      contentStart = firstLine.start + detectedHeader.prefixLen;
    }
  }

  const contentEnd = Math.max(contentStart, lines[lastIdx].end);

  return {
    index,
    label,
    leadingRaw: raw.slice(chunkStart, contentStart),
    content: raw.slice(contentStart, contentEnd),
    trailingRaw: raw.slice(contentEnd, chunkEnd),
  };
}

/**
 * Automatically detects whether `rawContent` contains multiple passages/items
 * (via `---`/`===` dividers, `[18]`/`#1`/`문항 1`/`18.` headers, or 2+ blank lines)
 * and splits them losslessly so:
 *   `reconstructPassageSet(parsePassageSet(rawContent)) === rawContent`
 */
export function parsePassageSet(rawContent: string): PassageItem[] {
  if (!rawContent || rawContent.trim().length === 0) {
    return [
      {
        index: 0,
        label: '문항 1',
        leadingRaw: '',
        content: rawContent,
        trailingRaw: '',
      },
    ];
  }

  const lines = splitLinesLossless(rawContent);

  // 1. Priority 1: Explicit Horizontal Dividers (---, ===, ***, ___)
  const dividerIndices: { lineIdx: number; title: string | null }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const d = matchDividerLine(lines[i].text);
    if (d) {
      dividerIndices.push({ lineIdx: i, title: d.title });
    }
  }

  if (dividerIndices.length > 0) {
    const rawRanges: {
      startLine: number;
      endLine: number;
      dividerBeforeLine: number | null;
      dividerTitle: string | null;
    }[] = [];

    let curStart = 0;
    let prevDivLine: number | null = null;
    let prevDivTitle: string | null = null;

    for (const div of dividerIndices) {
      rawRanges.push({
        startLine: curStart,
        endLine: div.lineIdx - 1,
        dividerBeforeLine: prevDivLine,
        dividerTitle: prevDivTitle,
      });
      curStart = div.lineIdx + 1;
      prevDivLine = div.lineIdx;
      prevDivTitle = div.title;
    }
    rawRanges.push({
      startLine: curStart,
      endLine: lines.length - 1,
      dividerBeforeLine: prevDivLine,
      dividerTitle: prevDivTitle,
    });

    const nonEmptyRanges = rawRanges.filter((r) => {
      for (let i = r.startLine; i <= r.endLine; i++) {
        if (lines[i] && lines[i].text.trim().length > 0) return true;
      }
      return false;
    });

    if (nonEmptyRanges.length >= 2) {
      const chunkStarts = nonEmptyRanges.map((r, idx) =>
        idx === 0
          ? 0
          : lines[r.dividerBeforeLine!].start,
      );

      return nonEmptyRanges.map((r, idx) => {
        const chunkStart = chunkStarts[idx];
        const chunkEnd =
          idx + 1 < nonEmptyRanges.length
            ? chunkStarts[idx + 1]
            : rawContent.length;
        const fallbackLabel = r.dividerTitle || `문항 ${idx + 1}`;
        return buildItemFromChunk(
          rawContent,
          lines,
          chunkStart,
          chunkEnd,
          r.startLine,
          r.endLine,
          idx,
          fallbackLabel,
        );
      });
    }
  }

  // 2. Priority 2A: Strong Explicit Item Headers ([1], [18], # 1, 문항 1, Passage 1)
  const explicitHits: { lineIdx: number; header: HeaderMatch }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = matchExplicitHeader(lines[i].text);
    if (h) {
      explicitHits.push({ lineIdx: i, header: h });
    }
  }

  const buildFromHeaderHits = (
    hits: { lineIdx: number; header: HeaderMatch }[],
  ): PassageItem[] | null => {
    if (hits.length < 2) return null;

    const sections: {
      startLine: number;
      endLine: number;
      header: HeaderMatch | null;
    }[] = [];

    const firstHitLine = hits[0].lineIdx;
    if (firstHitLine > 0) {
      const preLines = lines
        .slice(0, firstHitLine)
        .filter((l) => l.text.trim().length > 0);
      const preText = preLines.map((l) => l.text).join('\n').trim();
      const preWords = countWordsMsWordStyle(preText);
      const looksLikeStandalonePassage =
        preWords > 12 || /[.?!]["')\]]*$/.test(preText);

      if (preLines.length > 0 && looksLikeStandalonePassage) {
        sections.push({
          startLine: 0,
          endLine: firstHitLine - 1,
          header: null,
        });
      }
    }

    for (let k = 0; k < hits.length; k++) {
      const startLine = hits[k].lineIdx;
      const endLine =
        k + 1 < hits.length ? hits[k + 1].lineIdx - 1 : lines.length - 1;
      sections.push({
        startLine,
        endLine,
        header: hits[k].header,
      });
    }

    const items = sections.map((sec, idx) => {
      const chunkStart = idx === 0 ? 0 : lines[sec.startLine].start;
      const chunkEnd =
        idx + 1 < sections.length
          ? lines[sections[idx + 1].startLine].start
          : rawContent.length;
      return buildItemFromChunk(
        rawContent,
        lines,
        chunkStart,
        chunkEnd,
        sec.startLine,
        sec.endLine,
        idx,
        `문항 ${idx + 1}`,
        sec.header,
      );
    });

    if (items.some((it) => it.content.trim().length === 0)) {
      return null;
    }
    return items;
  };

  const fromExplicit = buildFromHeaderHits(explicitHits);
  if (fromExplicit && fromExplicit.length >= 2) {
    return fromExplicit;
  }

  // 2. Priority 2B: Bare Numbered Item Headers (1., 2., 18., 18번)
  const bareHits: { lineIdx: number; header: HeaderMatch }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prevBlank = i === 0 || lines[i - 1].text.trim().length === 0;
    const h = matchBareNumberHeader(lines[i].text, prevBlank);
    if (h) {
      bareHits.push({ lineIdx: i, header: h });
    }
  }

  if (bareHits.length >= 2) {
    const fromBare = buildFromHeaderHits(bareHits);
    if (fromBare && fromBare.length >= 2) {
      const allStandalone = bareHits.every((b) => b.header.standaloneLine);
      const maxWords = Math.max(
        ...fromBare.map((it) => countWordsMsWordStyle(it.content)),
      );
      if (allStandalone || maxWords >= 6) {
        return fromBare;
      }
    }
  }

  // 3. Priority 3: 2 or More Consecutive Blank Lines (\n\n\n+)
  const blocks: { startLine: number; endLine: number }[] = [];
  let idx = 0;
  while (idx < lines.length) {
    while (idx < lines.length && lines[idx].text.trim().length === 0) {
      idx += 1;
    }
    if (idx >= lines.length) break;

    const blockStart = idx;
    let blockEnd = idx;

    while (idx < lines.length) {
      if (lines[idx].text.trim().length > 0) {
        blockEnd = idx;
        idx += 1;
        continue;
      }
      // Count consecutive blank lines
      let blankEnd = idx;
      while (
        blankEnd < lines.length &&
        lines[blankEnd].text.trim().length === 0
      ) {
        blankEnd += 1;
      }
      const blankCount = blankEnd - idx;
      if (blankCount >= 2 || blankEnd >= lines.length) {
        idx = blankEnd;
        break;
      }
      // Single blank line = paragraph break within the same passage
      idx = blankEnd;
    }

    blocks.push({ startLine: blockStart, endLine: blockEnd });
  }

  if (blocks.length >= 2) {
    return blocks.map((b, k) => {
      const chunkStart = k === 0 ? 0 : lines[b.startLine].start;
      const chunkEnd =
        k + 1 < blocks.length
          ? lines[blocks[k + 1].startLine].start
          : rawContent.length;
      return buildItemFromChunk(
        rawContent,
        lines,
        chunkStart,
        chunkEnd,
        b.startLine,
        b.endLine,
        k,
        `문항 ${k + 1}`,
        null,
      );
    });
  }

  // Single passage fallback (100% identity)
  return [
    {
      index: 0,
      label: '문항 1',
      leadingRaw: '',
      content: rawContent,
      trailingRaw: '',
    },
  ];
}

export function reconstructPassageSet(passages: readonly PassageItem[]): string {
  let out = '';
  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    out += p.leadingRaw + p.content + p.trailingRaw;
  }
  return out;
}

export function updatePassageContentAt(
  rawContent: string,
  passageIndex: number,
  nextPassageContent: string,
): { fullText: string; passages: PassageItem[]; clampedIndex: number } {
  const parsed = parsePassageSet(rawContent);
  if (parsed.length <= 1) {
    return {
      fullText: nextPassageContent,
      passages: parsePassageSet(nextPassageContent),
      clampedIndex: 0,
    };
  }
  const clampedIndex = Math.max(0, Math.min(passageIndex, parsed.length - 1));
  const updated = parsed.map((item, idx) =>
    idx === clampedIndex ? { ...item, content: nextPassageContent } : item,
  );
  const fullText = reconstructPassageSet(updated);
  return {
    fullText,
    passages: updated,
    clampedIndex,
  };
}
