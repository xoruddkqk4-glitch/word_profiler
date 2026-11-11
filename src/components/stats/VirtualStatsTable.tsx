import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { CellValue } from '../../io/statsExporters';

export interface VirtualColumnDef {
  key: string;
  label: string;
  numeric?: boolean;
  decimals?: number;
}

export interface VirtualStatsTableProps {
  columns: VirtualColumnDef[];
  rows: CellValue[][];
  totalRow?: CellValue[] | null;
  sortColIndex: number;
  sortDir: 'asc' | 'desc';
  onSortChange: (colIndex: number) => void;
}

const ROW_HEIGHT = 38;
const OVERSCAN = 14;

export const VirtualStatsTable: React.FC<VirtualStatsTableProps> = ({
  columns,
  rows,
  totalRow,
  sortColIndex,
  sortDir,
  onSortChange,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateHeight = () => setViewportHeight(el.clientHeight || 520);
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll top when dataset length changes drastically
  useEffect(() => {
    if (scrollRef.current && scrollTop > rows.length * ROW_HEIGHT) {
      scrollRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [rows.length, scrollTop]);

  const totalRows = rows.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(totalRows, startIdx + visibleCount);

  const topSpacerHeight = startIdx * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalRows - endIdx) * ROW_HEIGHT);

  const renderCell = (val: CellValue, col: VirtualColumnDef) => {
    if (val === '') return '';
    if (typeof val === 'number') {
      if (col.decimals !== undefined) {
        return val.toFixed(col.decimals);
      }
      return val.toLocaleString();
    }
    return val;
  };

  return (
    <div
      ref={scrollRef}
      className="virtual-table-container"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <table className="stats-grid-table">
        <thead>
          <tr>
            {columns.map((col, idx) => {
              const active = sortColIndex === idx;
              return (
                <th
                  key={col.key}
                  className={col.numeric ? 'cell-num' : undefined}
                  onClick={() => onSortChange(idx)}
                >
                  <span className="th-sort-inner">
                    <span>{col.label}</span>
                    {active ? (
                      sortDir === 'asc' ? (
                        <ArrowUp size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )
                    ) : (
                      <ArrowUpDown size={13} style={{ opacity: 0.4 }} />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {totalRows === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty-cell">
                조건에 일치하는 행이 없습니다.
              </td>
            </tr>
          ) : (
            <>
              {topSpacerHeight > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length}
                    style={{
                      height: topSpacerHeight,
                      padding: 0,
                      border: 'none',
                    }}
                  />
                </tr>
              )}

              {rows.slice(startIdx, endIdx).map((row, offset) => {
                const absIndex = startIdx + offset;
                return (
                  <tr key={`${row[0]}-${absIndex}`}>
                    {columns.map((col, cIdx) => (
                      <td
                        key={col.key}
                        className={col.numeric ? 'cell-num' : undefined}
                      >
                        {renderCell(row[cIdx] ?? '', col)}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {bottomSpacerHeight > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length}
                    style={{
                      height: bottomSpacerHeight,
                      padding: 0,
                      border: 'none',
                    }}
                  />
                </tr>
              )}
            </>
          )}
        </tbody>

        {totalRow && (
          <tfoot>
            <tr>
              {columns.map((col, cIdx) => (
                <td
                  key={col.key}
                  className={col.numeric ? 'cell-num' : undefined}
                >
                  {renderCell(totalRow[cIdx] ?? '', col)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

