import type {
  DocumentProfileResult,
  DuplicateEntryRecord,
} from '../types/domain';
import type { CorpusStatisticsBundle } from '../types/stats';
import type {
  ExportedLevelGroup,
  WorkerRequest,
  WorkerResponse,
} from '../types/workerMessages';

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

type PendingEntry = {
  resolve: (value: WorkerResponse) => void;
  reject: (err: Error) => void;
  onProgress?: (percent: number, stage: string) => void;
};

class ProfilerWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingEntry>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./profiler.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const entry = this.pending.get(msg.requestId);
        if (!entry) return;

        if (msg.type === 'PROGRESS') {
          entry.onProgress?.(msg.percent, msg.stage);
          return;
        }

        this.pending.delete(msg.requestId);
        if (msg.type === 'ERROR') {
          entry.reject(new Error(msg.message));
        } else {
          entry.resolve(msg);
        }
      };
      this.worker.onerror = (err) => {
        for (const entry of this.pending.values()) {
          entry.reject(new Error(err.message || 'Web Worker execution error'));
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private dispatch(
    payload: DistributiveOmit<WorkerRequest, 'requestId'>,
    onProgress?: (percent: number, stage: string) => void,
  ): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({ ...payload, requestId } as WorkerRequest);
    });
  }

  async profileDocument(
    payload: Omit<
      Extract<WorkerRequest, { type: 'PROFILE_DOCUMENT' }>,
      'type' | 'requestId'
    >,
    onProgress?: (percent: number, stage: string) => void,
  ): Promise<DocumentProfileResult> {
    const res = await this.dispatch(
      { ...payload, type: 'PROFILE_DOCUMENT' },
      onProgress,
    );
    if (res.type !== 'PROFILE_DOCUMENT_RESULT') {
      throw new Error('Unexpected worker response for PROFILE_DOCUMENT');
    }
    return res.result;
  }

  async computeAllStats(
    payload: Omit<
      Extract<WorkerRequest, { type: 'COMPUTE_ALL_STATS' }>,
      'type' | 'requestId'
    >,
    onProgress?: (percent: number, stage: string) => void,
  ): Promise<CorpusStatisticsBundle> {
    const res = await this.dispatch(
      { ...payload, type: 'COMPUTE_ALL_STATS' },
      onProgress,
    );
    if (res.type !== 'COMPUTE_ALL_STATS_RESULT') {
      throw new Error('Unexpected worker response for COMPUTE_ALL_STATS');
    }
    return res.bundle;
  }

  async validateLists(
    payload: Omit<
      Extract<WorkerRequest, { type: 'VALIDATE_LISTS' }>,
      'type' | 'requestId'
    >,
  ): Promise<{ duplicates: DuplicateEntryRecord[]; elapsedMs: number }> {
    const res = await this.dispatch({ ...payload, type: 'VALIDATE_LISTS' });
    if (res.type !== 'VALIDATE_LISTS_RESULT') {
      throw new Error('Unexpected worker response for VALIDATE_LISTS');
    }
    return { duplicates: res.duplicates, elapsedMs: res.elapsedMs };
  }

  async filterPastedIgnoreWords(
    payload: Omit<
      Extract<WorkerRequest, { type: 'FILTER_PASTED_IGNORE_WORDS' }>,
      'type' | 'requestId'
    >,
  ): Promise<{ candidates: string[]; skippedInListsCount: number }> {
    const res = await this.dispatch({
      ...payload,
      type: 'FILTER_PASTED_IGNORE_WORDS',
    });
    if (res.type !== 'FILTER_PASTED_IGNORE_WORDS_RESULT') {
      throw new Error(
        'Unexpected worker response for FILTER_PASTED_IGNORE_WORDS',
      );
    }
    return {
      candidates: res.candidates,
      skippedInListsCount: res.skippedInListsCount,
    };
  }

  async exportLevelGroups(
    payload: Omit<
      Extract<WorkerRequest, { type: 'EXPORT_LEVEL_GROUPS' }>,
      'type' | 'requestId'
    >,
  ): Promise<ExportedLevelGroup[]> {
    const res = await this.dispatch({
      ...payload,
      type: 'EXPORT_LEVEL_GROUPS',
    });
    if (res.type !== 'EXPORT_LEVEL_GROUPS_RESULT') {
      throw new Error('Unexpected worker response for EXPORT_LEVEL_GROUPS');
    }
    return res.groups;
  }
}

export const profilerWorkerClient = new ProfilerWorkerClient();

