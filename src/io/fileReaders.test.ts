import { describe, expect, it } from 'vitest';
import {
  consumeInputFiles,
  decodeTextBufferSmart,
  readTargetFilesFromBrowser,
  readWordlistFilesFromBrowser,
} from './fileReaders';

function makeLiveInputStub(
  initialFiles: File[],
): Pick<HTMLInputElement, 'files' | 'value'> {
  let backing = [...initialFiles];
  const liveFileList: Record<string | symbol, unknown> = {
    get length() {
      return backing.length;
    },
    item(index: number) {
      return backing[index] ?? null;
    },
    *[Symbol.iterator]() {
      for (const f of backing) yield f;
    },
  };

  const syncIndices = () => {
    for (const k of Object.keys(liveFileList)) {
      if (/^\d+$/.test(k)) delete liveFileList[k];
    }
    backing.forEach((f, idx) => {
      liveFileList[idx] = f;
    });
  };
  syncIndices();

  let currentValue = initialFiles.map((f) => `C:\\fakepath\\${f.name}`).join(', ');
  return {
    files: liveFileList as unknown as FileList,
    get value() {
      return currentValue;
    },
    set value(next: string) {
      currentValue = next;
      if (next === '') {
        // Simulate Chromium/Electron clearing the live FileList when input.value is reset
        backing = [];
        syncIndices();
      }
    },
  };
}

function encodeUtf16LeWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[2 + i * 2 + 1] = (code >> 8) & 0xff;
  }
  return bytes;
}

function encodeUtf16BeWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = (code >> 8) & 0xff;
    bytes[2 + i * 2 + 1] = code & 0xff;
  }
  return bytes;
}

describe('fileReaders', () => {
  it('consumeInputFiles snapshots File objects before resetting input.value clears the live FileList', () => {
    const file1 = new File(['First passage'], 'passage1.txt', {
      type: 'text/plain',
    });
    const file2 = new File(['Second passage'], 'passage2.txt', {
      type: 'text/plain',
    });
    const input = makeLiveInputStub([file1, file2]);

    const taken = consumeInputFiles(input);

    expect(input.value).toBe('');
    expect(input.files?.length).toBe(0);
    expect(taken).toHaveLength(2);
    expect(taken[0]).toBe(file1);
    expect(taken[1]).toBe(file2);
  });

  it('consumeInputFiles handles null files gracefully', () => {
    const input = { files: null, value: 'anything' };
    const taken = consumeInputFiles(input);
    expect(taken).toEqual([]);
    expect(input.value).toBe('');
  });

  it('readTargetFilesFromBrowser reads UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, and normalizes CRLF', async () => {
    const utf8File = new File(['Line 1\r\nLine 2\rLine 3'], 'utf8.txt', {
      type: 'text/plain',
    });

    const utf8BomBytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('Hello BOM\r\nWorld'),
    ]);
    const utf8BomFile = new File([utf8BomBytes], 'utf8_bom.txt', {
      type: 'text/plain',
    });

    const utf16LeFile = new File(
      [encodeUtf16LeWithBom('English passage\r\n한글 제목')],
      'utf16le.txt',
      { type: 'text/plain' },
    );

    const utf16BeFile = new File(
      [encodeUtf16BeWithBom('Big endian\r\nText')],
      'utf16be.txt',
      { type: 'text/plain' },
    );

    const report = await readTargetFilesFromBrowser([
      utf8File,
      utf8BomFile,
      utf16LeFile,
      utf16BeFile,
    ]);

    expect(report.errors).toEqual([]);
    expect(report.items).toHaveLength(4);
    expect(report.items.map((i) => i.sourceType)).toEqual([
      'txt',
      'txt',
      'txt',
      'txt',
    ]);
    expect(report.items[0].content).toBe('Line 1\nLine 2\nLine 3');
    expect(report.items[1].content).toBe('Hello BOM\nWorld');
    expect(report.items[2].content).toBe('English passage\n한글 제목');
    expect(report.items[3].content).toBe('Big endian\nText');
  });

  it('decodeTextBufferSmart strips BOMs cleanly', () => {
    const utf16LeBuf = encodeUtf16LeWithBom('\uFEFFSample').buffer;
    expect(decodeTextBufferSmart(utf16LeBuf as ArrayBuffer)).toBe('Sample');
  });

  it('readWordlistFilesFromBrowser reads .txt wordlist files properly', async () => {
    const wlFile = new File(['apple\r\nbanana\r\ncherry'], 'custom_list.txt', {
      type: 'text/plain',
    });
    const res = await readWordlistFilesFromBrowser([wlFile]);
    expect(res.errors).toEqual([]);
    expect(res.lists).toHaveLength(1);
    expect(res.lists[0]).toEqual({
      name: 'custom_list',
      path: 'custom_list.txt',
      content: 'apple\nbanana\ncherry',
    });
  });
});
