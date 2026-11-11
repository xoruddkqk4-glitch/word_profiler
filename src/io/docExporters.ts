import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
  resolveTokenHighlight,
  type LevelColorPair,
} from '../core/colorPalette';
import type {
  DocumentProfileResult,
  ReferenceListSource,
} from '../types/domain';

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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
        `<span style="color:${hl.color};font-weight:500" title="${escapeHtml(tok.listName)} (${escapeHtml(tok.headword)})">${escapeHtml(tok.token)}</span>`,
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
      return `<span class="chip"><span class="dot" style="background:${r.colorLight}"></span>${escapeHtml(r.name)} (${pct.toFixed(2)}%)</span>`;
    });

  if (options.ignoreEnabled) {
    legendItems.push(
      `<span class="chip"><span class="dot" style="background:${options.ignoreColor.light}"></span>ignored (${profile.ignoredSummary.percentage.toFixed(2)}%)</span>`,
    );
  }
  legendItems.push(
    `<span class="chip"><span class="dot" style="background:${options.showLevels ? '#64748b' : options.outColor.light}"></span>not in lists (${profile.outSummary.percentage.toFixed(2)}%)</span>`,
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
  const refMap = new Map(referenceLists.map((r) => [r.id, r]));
  const halfPoints = Math.max(18, Math.round(options.fontSizePx * 1.5)); // Word uses half-points (24 = 12pt)

  let currentRuns: TextRun[] = [];
  const paragraphs: Paragraph[] = [];

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

