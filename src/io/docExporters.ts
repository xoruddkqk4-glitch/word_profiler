import {
  resolveTokenHighlight,
  type LevelColorPair,
} from '../core/colorPalette';
import type {
  DocumentProfileResult,
  ReferenceListSource,
} from '../types/domain';

export async function copyTextSafe(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to execCommand below
  }
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    }
  } catch {
    return false;
  }
  return false;
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeStem(name: string): string {
  const stripped = name.replace(/\.[^.]+$/, '').trim();
  return stripped || 'profiled_text';
}

export function exportProfileAsTxt(profile: DocumentProfileResult): void {
  const blob = new Blob([profile.originalText], {
    type: 'text/plain;charset=utf-8',
  });
  triggerBrowserDownload(blob, `${sanitizeStem(profile.sourceName)}_profile.txt`);
}

export function exportRawTextAsTxt(content: string, fileName: string): void {
  const blob = new Blob([content], {
    type: 'text/plain;charset=utf-8',
  });
  triggerBrowserDownload(blob, `${sanitizeStem(fileName)}.txt`);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlPreservingSpaces(raw: string): string {
  return escapeHtml(raw)
    .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
    .replace(/ {2,}/g, (spaces) => ` ${'&nbsp;'.repeat(spaces.length - 1)}`);
}

export interface RichCopyFormattingOptions {
  showLevels: boolean;
  ignoreEnabled: boolean;
  ignoreColor: LevelColorPair;
  outColor: LevelColorPair;
  plainFormatView?: boolean;
}

export interface RichClipboardPayload {
  plainText: string;
  htmlText: string;
}

const CLIPBOARD_BASE_FONT =
  "Calibri,'Malgun Gothic','Apple SD Gothic Neo',sans-serif";

export function buildRichProfileClipboardPayload(
  profile: DocumentProfileResult,
  referenceLists: ReferenceListSource[],
  options: RichCopyFormattingOptions,
  tokenRange?: { startTokenIdx: number; endTokenIdx: number },
): RichClipboardPayload {
  if (profile.tokens.length === 0) {
    const plain = tokenRange ? '' : profile.originalText;
    return {
      plainText: plain,
      htmlText: `<span style="font-family:${CLIPBOARD_BASE_FONT};font-size:11pt;color:#0f172a;">${escapeHtmlPreservingSpaces(plain)}</span>`,
    };
  }

  const refMap = new Map(referenceLists.map((r) => [r.id, r]));
  const isFullDocument = !tokenRange;
  const lo = tokenRange
    ? Math.max(
        0,
        Math.min(
          tokenRange.startTokenIdx,
          tokenRange.endTokenIdx,
          profile.tokens.length - 1,
        ),
      )
    : 0;
  const hi = tokenRange
    ? Math.max(
        lo,
        Math.min(
          Math.max(tokenRange.startTokenIdx, tokenRange.endTokenIdx),
          profile.tokens.length - 1,
        ),
      )
    : profile.tokens.length - 1;

  let plainText = '';
  const htmlLineChunks: string[][] = [[]];

  const appendSegment = (
    raw: string,
    hexColor: string | null,
    bold: boolean,
  ) => {
    if (!raw) return;
    plainText += raw;
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = normalized.split('\n');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.length > 0) {
        const escaped = escapeHtmlPreservingSpaces(part);
        if (hexColor && bold) {
          htmlLineChunks[htmlLineChunks.length - 1].push(
            `<span style="color:${escapeHtml(hexColor)};font-weight:700;"><b>${escaped}</b></span>`,
          );
        } else if (hexColor) {
          htmlLineChunks[htmlLineChunks.length - 1].push(
            `<span style="color:${escapeHtml(hexColor)};">${escaped}</span>`,
          );
        } else if (bold) {
          htmlLineChunks[htmlLineChunks.length - 1].push(
            `<span style="font-weight:700;"><b>${escaped}</b></span>`,
          );
        } else {
          htmlLineChunks[htmlLineChunks.length - 1].push(escaped);
        }
      }
      if (i < parts.length - 1) {
        htmlLineChunks.push([]);
      }
    }
  };

  if (isFullDocument && profile.leadingWs) {
    appendSegment(profile.leadingWs, null, false);
  }

  for (let i = lo; i <= hi; i++) {
    const tok = profile.tokens[i];
    const hl = options.plainFormatView
      ? { color: null, isHighlighted: false }
      : resolveTokenHighlight(tok, refMap, {
          showLevels: options.showLevels,
          ignoreEnabled: options.ignoreEnabled,
          ignoreColor: options.ignoreColor,
          outColor: options.outColor,
          theme: 'light',
        });

    // Highlighted words carry explicit #RRGGBB color + Bold (<b> + font-weight:700)
    // so MS Word, HWP (한글), Google Docs, and Notion preserve both color and weight.
    appendSegment(tok.token, hl.color, Boolean(hl.color));

    if (isFullDocument || i < hi) {
      appendSegment(tok.trailingWs, null, false);
    }
  }

  if (htmlLineChunks.length <= 1) {
    const inlineInner = (htmlLineChunks[0] ?? []).join('');
    return {
      plainText,
      htmlText: `<span style="font-family:${CLIPBOARD_BASE_FONT};font-size:11pt;color:#0f172a;font-weight:400;">${inlineInner}</span>`,
    };
  }

  const paragraphs = htmlLineChunks
    .map((chunks) => {
      const inner = chunks.join('');
      return `<p style="margin:0;font-family:${CLIPBOARD_BASE_FONT};font-size:11pt;color:#0f172a;font-weight:400;line-height:1.6;">${inner || '&nbsp;'}</p>`;
    })
    .join('');

  return {
    plainText,
    htmlText: `<div style="font-family:${CLIPBOARD_BASE_FONT};font-size:11pt;color:#0f172a;line-height:1.6;">${paragraphs}</div>`,
  };
}

export async function copyRichTextSafe(
  plainText: string,
  htmlText: string,
): Promise<boolean> {
  if (!plainText) return false;

  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.write &&
      typeof ClipboardItem !== 'undefined'
    ) {
      const item = new ClipboardItem({
        'text/html': new Blob([htmlText], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // Fall through to offscreen contenteditable execCommand('copy')
  }

  try {
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      const sel = window.getSelection();
      const savedRanges: Range[] = [];
      if (sel) {
        for (let i = 0; i < sel.rangeCount; i++) {
          savedRanges.push(sel.getRangeAt(i).cloneRange());
        }
      }

      const holder = document.createElement('div');
      holder.contentEditable = 'true';
      holder.innerHTML = htmlText;
      holder.style.position = 'fixed';
      holder.style.left = '-9999px';
      holder.style.top = '0';
      holder.style.opacity = '0';
      holder.style.pointerEvents = 'none';
      document.body.appendChild(holder);

      const range = document.createRange();
      range.selectNodeContents(holder);
      sel?.removeAllRanges();
      sel?.addRange(range);

      const ok = document.execCommand('copy');
      sel?.removeAllRanges();
      for (const r of savedRanges) {
        sel?.addRange(r);
      }
      document.body.removeChild(holder);
      if (ok) return true;
    }
  } catch {
    // Fall through to plain text fallback
  }

  return copyTextSafe(plainText);
}

export function exportProfileAsHtml(
  profile: DocumentProfileResult,
  referenceLists: ReferenceListSource[],
  options: {
    showLevels: boolean;
    ignoreEnabled: boolean;
    ignoreColor: LevelColorPair;
    outColor: LevelColorPair;
  },
): void {
  const refMap = new Map(referenceLists.map((r) => [r.id, r]));
  const bodyChunks: string[] = [];
  if (profile.leadingWs) {
    bodyChunks.push(escapeHtml(profile.leadingWs));
  }

  for (const tok of profile.tokens) {
    const hl = resolveTokenHighlight(tok, refMap, {
      ...options,
      theme: 'light',
    });
    if (hl.color) {
      bodyChunks.push(
        `<span style="color:${escapeHtml(hl.color)};font-weight:500" title="${escapeHtml(tok.listName)} (${escapeHtml(tok.headword)})">${escapeHtml(tok.token)}</span>`,
      );
    } else {
      bodyChunks.push(escapeHtml(tok.token));
    }
    if (tok.trailingWs) {
      bodyChunks.push(escapeHtml(tok.trailingWs));
    }
  }

  const legendItems = referenceLists
    .filter((r) => r.enabled)
    .map((r) => {
      const pct = profile.levelSummaries[r.id]?.percentage ?? 0;
      return `<span class="chip"><span class="dot" style="background:${escapeHtml(r.colorLight)}"></span>${escapeHtml(r.name)} (${pct.toFixed(2)}%)</span>`;
    });

  if (options.ignoreEnabled) {
    legendItems.push(
      `<span class="chip"><span class="dot" style="background:${escapeHtml(options.ignoreColor.light)}"></span>ignored (${profile.ignoredSummary.percentage.toFixed(2)}%)</span>`,
    );
  }
  legendItems.push(
    `<span class="chip"><span class="dot" style="background:${escapeHtml(options.showLevels ? '#64748b' : options.outColor.light)}"></span>not in lists (${profile.outSummary.percentage.toFixed(2)}%)</span>`,
  );

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(profile.sourceName)} — AntWordProfiler Profile</title>
<style>
  body { font-family: Poppins, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 840px; margin: 40px auto; padding: 0 24px; color: #0f172a; line-height: 1.8; }
  header { border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 1.25rem; margin: 0 0 8px 0; }
  .meta { font-size: 0.875rem; color: #475569; margin-bottom: 12px; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8125rem; padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 999px; background: #f8fafc; }
  .dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  main { white-space: pre-wrap; font-size: 1rem; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(profile.sourceName)}</h1>
    <div class="meta">${profile.totalTypes.toLocaleString()} types · ${profile.totalTokens.toLocaleString()} tokens · Total coverage: ${profile.totalCoveredPercentage.toFixed(2)}%</div>
    <div class="legend">${legendItems.join('')}</div>
  </header>
  <main>${bodyChunks.join('')}</main>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerBrowserDownload(blob, `${sanitizeStem(profile.sourceName)}_profile.html`);
}

export async function exportProfileAsDocx(
  profile: DocumentProfileResult,
  referenceLists: ReferenceListSource[],
  options: {
    showLevels: boolean;
    ignoreEnabled: boolean;
    ignoreColor: LevelColorPair;
    outColor: LevelColorPair;
    fontSizePx: number;
  },
): Promise<void> {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const refMap = new Map(referenceLists.map((r) => [r.id, r]));
  const halfPoints = Math.max(18, Math.round(options.fontSizePx * 1.5)); // Word uses half-points (24 = 12pt)

  let currentRuns: InstanceType<typeof TextRun>[] = [];
  const paragraphs: InstanceType<typeof Paragraph>[] = [];

  const pushTextWithNewlines = (raw: string, hexColor: string | null) => {
    if (!raw) return;
    const cleanHex = hexColor ? hexColor.replace(/^#/, '') : undefined;
    const parts = raw.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        currentRuns.push(
          new TextRun({
            text: parts[i],
            color: cleanHex,
            size: halfPoints,
            font: 'Calibri',
          }),
        );
      }
      if (i < parts.length - 1) {
        paragraphs.push(new Paragraph({ children: currentRuns }));
        currentRuns = [];
      }
    }
  };

  pushTextWithNewlines(profile.leadingWs, null);

  for (const tok of profile.tokens) {
    const hl = resolveTokenHighlight(tok, refMap, {
      showLevels: options.showLevels,
      ignoreEnabled: options.ignoreEnabled,
      ignoreColor: options.ignoreColor,
      outColor: options.outColor,
      theme: 'light',
    });
    pushTextWithNewlines(tok.token, hl.color);
    pushTextWithNewlines(tok.trailingWs, null);
  }

  if (currentRuns.length > 0 || paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: currentRuns }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerBrowserDownload(blob, `${sanitizeStem(profile.sourceName)}_profile.docx`);
}

