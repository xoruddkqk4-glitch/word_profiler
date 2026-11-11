import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Copy, X } from 'lucide-react';
import { useProfilerStore } from '../../store/useProfilerStore';
import { VirtualStatsTable } from '../stats/VirtualStatsTable';

export const ValidateListsModal: React.FC = () => {
  const modal = useProfilerStore((s) => s.validationModal);
  const close = useProfilerStore((s) => s.closeValidationModal);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' }>({
    col: 0,
    dir: 'asc',
  });

  useEffect(() => {
    if (modal) {
      setFilter('');
      setSort({ col: 0, dir: 'asc' });
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
    const mapped = modal.duplicates.map((d) => [
      d.id,
      d.entry,
      d.headwords.join(', '),
      d.listNames.join(', '),
    ]);
    const filtered = q
      ? mapped.filter((r) =>
          r.some((c) => String(c).toLowerCase().includes(q)),
        )
      : mapped;

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
        style={{ maxWidth: 760 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="validate-modal-title"
      >
        <div className="modal-header">
          <h2 id="validate-modal-title" className="modal-title">
            Level List Validation Results
          </h2>
          <button
            type="button"
            className="mini-icon-btn"
            aria-label="닫기"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {modal.duplicates.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 4px' }}>
              <CheckCircle2 size={24} style={{ color: 'var(--status-success)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>
                  All level lists are clean ({modal.checkedListCount} active lists checked).
                </div>
                <div className="modal-subtitle">
                  활성 레퍼런스 리스트 간에 중복 등재된 어형이 발견되지 않았습니다.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="modal-toolbar-row">
                <span className="help-prose">
                  총 <strong>{modal.duplicates.length.toLocaleString()}</strong>개의 중복 어형이 발견되었습니다. 프로파일링 시 가장 상위(선행) 레벨 리스트가 우선 적용됩니다.
                </span>
                <input
                  type="text"
                  className="text-input text-input-sm"
                  style={{ width: 220 }}
                  placeholder="중복 단어 검색..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>

              <div className="modal-table-frame">
                <VirtualStatsTable
                  columns={[
                    { key: 'id', label: 'ID', numeric: true },
                    { key: 'entry', label: 'Entry' },
                    { key: 'headwords', label: 'Headword(s)' },
                    { key: 'lists', label: 'Level Lists' },
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
            </>
          )}
        </div>

        <div className="modal-footer">
          {modal.duplicates.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const tsv = [
                  'ID\tEntry\tHeadword(s)\tLevel Lists',
                  ...rows.map((r) => r.join('\t')),
                ].join('\n');
                void navigator.clipboard.writeText(tsv);
              }}
            >
              <Copy size={15} /> Copy Duplicates (.tsv)
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={close}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

