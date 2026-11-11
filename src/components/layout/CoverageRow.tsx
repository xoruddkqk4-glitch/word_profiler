import React from 'react';
import { ArrowDown, ArrowUp, Info, X } from 'lucide-react';

export interface CoverageRowProps {
  label: string;
  tooltip?: string;
  checked: boolean;
  checkboxDisabled?: boolean;
  onToggleCheck?: () => void;
  swatchColor: string;
  swatchActive: boolean;
  allowColorChange: boolean;
  onChangeColor?: (hex: string) => void;
  percentage: number;
  barColor: string;
  onOpenInfo: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
}

export const CoverageRow: React.FC<CoverageRowProps> = ({
  label,
  tooltip,
  checked,
  checkboxDisabled,
  onToggleCheck,
  swatchColor,
  swatchActive,
  allowColorChange,
  onChangeColor,
  percentage,
  barColor,
  onOpenInfo,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}) => {
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div className="coverage-row">
      <div className="coverage-row-top">
        <div className="coverage-row-left">
          <input
            type="checkbox"
            checked={checked}
            disabled={checkboxDisabled}
            onChange={() => onToggleCheck?.()}
            aria-label={`${label} 활성화`}
          />

          <span
            className="color-swatch-btn"
            style={{
              backgroundColor: swatchActive ? swatchColor : 'transparent',
              opacity: swatchActive ? 1 : 0.42,
            }}
            title={
              allowColorChange
                ? `${label} 강조 색상 변경 (${swatchColor})`
                : label
            }
          >
            {allowColorChange && onChangeColor && (
              <input
                type="color"
                className="color-swatch-input"
                value={swatchColor}
                aria-label={`${label} 색상 선택`}
                onChange={(e) => onChangeColor(e.target.value)}
              />
            )}
          </span>

          <span
            className="coverage-name"
            data-muted={!checked && !checkboxDisabled}
            title={tooltip || label}
          >
            {label}
          </span>
        </div>

        <div className="coverage-row-actions">
          <button
            type="button"
            className="mini-icon-btn"
            title={`${label} 출현 어휘 보기`}
            aria-label={`${label} 출현 어휘 보기`}
            onClick={onOpenInfo}
          >
            <Info size={15} strokeWidth={1.85} />
          </button>

          {onMoveUp && (
            <button
              type="button"
              className="mini-icon-btn"
              disabled={!canMoveUp}
              title="우선순위 위로 이동"
              aria-label="위로 이동"
              onClick={onMoveUp}
            >
              <ArrowUp size={14} />
            </button>
          )}

          {onMoveDown && (
            <button
              type="button"
              className="mini-icon-btn"
              disabled={!canMoveDown}
              title="우선순위 아래로 이동"
              aria-label="아래로 이동"
              onClick={onMoveDown}
            >
              <ArrowDown size={14} />
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              className="mini-icon-btn"
              title="리스트 제거"
              aria-label="리스트 제거"
              onClick={onRemove}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="coverage-row-meter">
        <div className="coverage-bar-track">
          <div
            className="coverage-bar-fill"
            style={{
              width: `${clamped}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
        <span className="coverage-pct tabular-nums">
          {clamped.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};
