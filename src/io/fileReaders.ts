import type { TargetFileItem } from '../types/domain';

type MammothApi = {
  extractRawText: (input: {
    arrayBuffer: ArrayBuffer;
  }) => Promise<{ value: string }>;
};

let mammothPromise: Promise<MammothApi> | null = null;
function loadMammoth(): Promise<MammothApi> {
  if (!mammothPromise) {
    mammothPromise = import('mammoth').then((mod) => {
      const m = mod as unknown as { default?: MammothApi } & MammothApi;
      return m.default ?? m;
    });
  }
  return mammothPromise;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsLib, workerUrlMod]) => {
      // Bundle local PDF.js worker via Vite ?url asset import (no external CDN dependency)
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
      return pdfjsLib;
    });
  }
  return pdfjsPromise;
}

/**
 * Snapshots a `<input type="file">` element's live `FileList` into a static
 * `File[]` array *before* resetting `input.value = ''` (resetting `value`
 * mutates the live `FileList` to empty in Chromium/Electron).
 */
export function consumeInputFiles(
  input: Pick<HTMLInputElement, 'files' | 'value'>,
): File[] {
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  return files;
}

function normalizeDecodedText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function decodeTextBufferSmart(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Detect UTF-16 LE / BE BOMs (Windows Notepad / PowerShell Out-File)
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return normalizeDecodedText(
        new TextDecoder('utf-16le', { fatal: false }).decode(bytes),
      );
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return normalizeDecodedText(
        new TextDecoder('utf-16be', { fatal: false }).decode(bytes),
      );
    }
  }
  // Strip UTF-8 BOM if present
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return normalizeDecodedText(utf8);
  } catch {
    // Fallback for Korean EUC-KR / CP949 legacy text files
    try {
      const euckr = new TextDecoder('euc-kr', { fatal: false }).decode(bytes);
      return normalizeDecodedText(euckr);
    } catch {
      return normalizeDecodedText(
        new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      );
    }
  }
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const strings: string[] = [];
      let lastY: number | null = null;

      for (const item of content.items) {
        if ('str' in item) {
          const y = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
            strings.push('\n');
          } else if (strings.length > 0 && !strings[strings.length - 1].endsWith('\n')) {
            strings.push(' ');
          }
          strings.push(item.str);
          if (y !== null) lastY = y;
        }
      }
      pageTexts.push(strings.join('').replace(/[ \t]+\n/g, '\n').trim());
    }

    return pageTexts.filter(Boolean).join('\n\n');
  } finally {
    if (pdf) {
      await pdf.destroy().catch(() => {});
    }
    await loadingTask.destroy().catch(() => {});
  }
}

export function formatFileReadErrors(
  errors: readonly { fileName: string; reason: string }[],
): string | null {
  if (errors.length === 0) return null;
  const first = `${errors[0].fileName}: ${errors[0].reason}`;
  return errors.length === 1 ? first : `${first} (외 ${errors.length - 1}건 오류)`;
}

export interface ReadFilesReport {
  items: TargetFileItem[];
  errors: { fileName: string; reason: string }[];
}

export async function readTargetFilesFromBrowser(
  fileList: FileList | File[],
): Promise<ReadFilesReport> {
  const files = Array.from(fileList);
  const items: TargetFileItem[] = [];
  const errors: { fileName: string; reason: string }[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    const ext = lower.endsWith('.docx')
      ? 'docx'
      : lower.endsWith('.pdf')
        ? 'pdf'
        : lower.endsWith('.txt')
          ? 'txt'
          : null;

    if (!ext) {
      // Silently skip hidden OS metadata files (.DS_Store, desktop.ini) when importing a directory
      if (file.name.startsWith('.') || lower === 'desktop.ini' || lower === 'thumbs.db') {
        continue;
      }
      errors.push({
        fileName: file.name,
        reason: '지원하지 않는 확장자입니다 (.txt, .docx, .pdf 파일만 지원).',
      });
      continue;
    }

    try {
      const buffer = await file.arrayBuffer();
      let content = '';
      if (ext === 'txt') {
        content = decodeTextBufferSmart(buffer);
      } else if (ext === 'docx') {
        const mammoth = await loadMammoth();
        const res = await mammoth.extractRawText({ arrayBuffer: buffer });
        content = res.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      } else if (ext === 'pdf') {
        content = await extractPdfText(buffer);
      }

      const relPath =
        'webkitRelativePath' in file && file.webkitRelativePath
          ? file.webkitRelativePath
          : file.name;

      items.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        path: relPath,
        sourceType: ext,
        content,
        sizeBytes: file.size,
        addedAt: Date.now(),
      });
    } catch (err) {
      errors.push({
        fileName: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { items, errors };
}

export async function readWordlistFilesFromBrowser(
  fileList: FileList | File[],
): Promise<{
  lists: { name: string; path: string; content: string }[];
  errors: { fileName: string; reason: string }[];
}> {
  const files = Array.from(fileList);
  const lists: { name: string; path: string; content: string }[] = [];
  const errors: { fileName: string; reason: string }[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.txt') && !lower.endsWith('.tsv') && !lower.endsWith('.lst')) {
      if (file.name.startsWith('.') || lower === 'desktop.ini' || lower === 'thumbs.db') continue;
      errors.push({
        fileName: file.name,
        reason: '단어장은 .txt (탭 구분 또는 줄바꿈 구분) 형식이어야 합니다.',
      });
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const content = decodeTextBufferSmart(buffer);
      const stem = file.name.replace(/\.[^.]+$/, '');
      const relPath =
        'webkitRelativePath' in file && file.webkitRelativePath
          ? file.webkitRelativePath
          : file.name;
      lists.push({ name: stem, path: relPath, content });
    } catch (err) {
      errors.push({
        fileName: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { lists, errors };
}

