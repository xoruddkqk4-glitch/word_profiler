import JSZip from 'jszip';
import type { ExportedLevelGroup } from '../types/workerMessages';
import { triggerBrowserDownload } from './docExporters';

export function formatLevelGroupContent(
  group: ExportedLevelGroup,
  mode: 'rows' | 'trees',
): string {
  if (mode === 'rows') {
    return (
      group.families.map((f) => f.members.join('\t')).join('\n') + '\n'
    );
  }

  // Paul Nation Tree format: HEADWORD at col 0, followed by \tMEMBER lines
  const chunks: string[] = [];
  for (const fam of group.families) {
    chunks.push(fam.headword);
    for (const m of fam.members) {
      if (m !== fam.headword) {
        chunks.push(`\t${m}`);
      }
    }
  }
  return chunks.join('\n') + '\n';
}

export async function exportLevelGroupsArchive(
  groups: ExportedLevelGroup[],
  mode: 'rows' | 'trees',
): Promise<void> {
  if (groups.length === 0) return;

  if (groups.length === 1) {
    const content = formatLevelGroupContent(groups[0], mode);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerBrowserDownload(blob, `${groups[0].listName}_${mode}.txt`);
    return;
  }

  const zip = new JSZip();
  groups.forEach((group, idx) => {
    const safeName = group.listName.replace(/[\\/:*?"<>|]+/g, '_');
    const filename = `${idx + 1}_${safeName}.txt`;
    zip.file(filename, formatLevelGroupContent(group, mode));
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBrowserDownload(blob, `antwordprofiler_level_lists_${mode}.zip`);
}

