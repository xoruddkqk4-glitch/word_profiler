import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, X } from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';
import { VirtualStatsTable } from '../stats/VirtualStatsTable';

export const CoverageContentModal: React.FC = () => {
  const modal = useProfilerStore((s) => s.coverageModal);
  const close = useProfilerStore((s) => s.closeCoverageModal);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' }>({
    col: 2,
    dir: 'desc',
  });

  useEffect(() => {
    if (modal) {
      setFilter('');
      setSort({ col: 2, dir: 'desc' });
    }
  }, [modal]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, close]);

  const rows = useMemo(() => {
    if (!modal) return [];
    const q = filter.trim().toLowerCase();
    const raw = modal.words.map((w) => [w.item, w.headword, w.frequency]);
    const filtered = q
      ? raw.filter((r) => String(r[0]).toLowerCase().includes(q) || String(r[1]).toLowerCase().includes(q))
      : raw;

    return [...filtered].sort((a, b) => {
      const va = a[sort.col];
      const vb = b[sort.col];
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [modal, filter, sort]);

  if (!modal) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal-card"
        style={{ maxWidth: 620 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coverage-content-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="coverage-content-title" className="modal-title">
              {modal.title}
            </h2>
            <div className="modal-subtitle">{modal.subtitle}</div>
          </div>
          <button
            type="button"
            className="mini-icon-btn"
            aria-label="닫기"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="modal-toolbar-row">
            <input
              type="text"
              className="text-input text-input-sm"
              style={{ width: 248 }}
              placeholder="출현 단어 / 대표어 필터..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="file-summary-meta tabular-nums">
              Showing {rows.length.toLocaleString()} items
            </span>
          </div>

          <div className="modal-table-frame">
            <VirtualStatsTable
              columns={[
                { key: 'item', label: 'Item' },
                { key: 'headword', label: 'Headword' },
                { key: 'freq', label: 'Frequency', numeric: true },
              ]}
              rows={rows}
              sortColIndex={sort.col}
              sortDir={sort.dir}
              onSortChange={(col) =>
                setSort((p) => ({
                  col,
                  dir: p.col === col && p.dir === 'asc' ? 'desc' : 'asc',
                }))
              }
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            disabled={rows.length === 0}
            onClick={() => {
              const tsv = [
                'Item\tHeadword\tFrequency',
                ...rows.map((r) => r.join('\t')),
              ].join('\n');
              void navigator.clipboard.writeText(tsv);
            }}
          >
            <Copy size={15} /> Copy List
          </button>
          <button type="button" className="btn btn-primary" onClick={close}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

