import { useEffect, useState } from 'react';

import type { ApiViewerClient } from '@orbit/api-client';
import type { TaskDto } from '@orbit/contracts';

export type TaskMode = 'my' | 'done';

export type TasksState = {
  items: TaskDto[];
  total: number;
  loading: boolean;
  error: string | null;
};

const INITIAL: TasksState = { items: [], total: 0, loading: true, error: null };

export function useTasks(
  client: ApiViewerClient,
  mode: TaskMode,
  page: number,
  refreshKey: number,
): TasksState {
  const [state, setState] = useState<TasksState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    client
      .listTasks({ mode, page })
      .then((resp) => {
        if (cancelled) return;
        setState({
          items: resp.items,
          total: resp.total,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ items: [], total: 0, loading: false, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [client, mode, page, refreshKey]);

  return state;
}
