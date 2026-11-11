import React from 'react';
import { useProfilerStore } from '../../store/useProfilerStore';

export const StatusBar: React.FC = () => {
  const progressPercent = useProfilerStore((s) => s.progressPercent);
  const statusMessage = useProfilerStore((s) => s.statusMessage);
  const isBusy = useProfilerStore((s) => s.isBusy);

  return (
    <footer className="status-bar">
      <div className="status-progress-group">
        <span>Progress</span>
        <div
          className="status-progress-track"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="status-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="tabular-nums">{progressPercent}%</span>
      </div>

      <div className="status-message-text">
        {isBusy ? `처리 중 — ${statusMessage}` : statusMessage}
      </div>
    </footer>
  );
};

