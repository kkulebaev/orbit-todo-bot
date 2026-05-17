import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import type { ApiViewerClient } from '@orbit/api-client';
import { PAGE_SIZE, type TaskDto } from '@orbit/contracts';

import { renderDueCell } from '../render/task.js';
import { useTasks, type TaskMode } from './use-tasks.js';

const MODES: readonly TaskMode[] = ['my', 'due-soon', 'done'];
const MODE_LABEL: Record<TaskMode, string> = {
  my: 'мои',
  'due-soon': 'скоро дедлайн',
  done: 'закрытые',
};

export type AppProps = {
  client: ApiViewerClient;
  idempotencyKey: () => string;
  now: Date;
  /** Disable real exit() for unit tests so the rendered frame survives 'q'. */
  exitOnQuit?: boolean;
};

export function App({
  client,
  idempotencyKey,
  now,
  exitOnQuit = true,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [mode, setMode] = useState<TaskMode>('my');
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const { items, total, loading, error } = useTasks(client, mode, page, refreshKey);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selected = items[cursor];

  // Reset page + cursor when mode changes.
  useEffect(() => {
    setPage(0);
    setCursor(0);
  }, [mode]);

  // Clamp cursor when items shrink.
  useEffect(() => {
    if (cursor >= items.length) setCursor(Math.max(0, items.length - 1));
  }, [items.length, cursor]);

  // Mirror reactive state into a ref so the (stable) input handler always
  // sees the latest values. Without this, ink's useInput effect re-attaches
  // after a re-render but on the React 18 scheduler — keystrokes that fire
  // before re-attach run against a stale closure (notably `items.length === 0`
  // right after the initial fetch). Tests confirmed the race directly.
  const stateRef = useRef({ items, cursor, view, mode, totalPages });
  stateRef.current = { items, cursor, view, mode, totalPages };

  const mutateStatus = useCallback(
    async (task: TaskDto, status: 'open' | 'done'): Promise<void> => {
      try {
        await client.updateTask(task.numId, { status }, idempotencyKey());
        setMessage(
          status === 'done'
            ? `#${task.numId} закрыто`
            : `#${task.numId} переоткрыто`,
        );
        setRefreshKey((k) => k + 1);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setMessage(`Ошибка: ${m}`);
      }
    },
    [client, idempotencyKey],
  );

  const handler = useCallback(
    (input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
      const s = stateRef.current;
      const selected = s.items[s.cursor];

      if (input === 'q') {
        if (s.view === 'detail') setView('list');
        else if (exitOnQuit) exit();
        return;
      }
      if (key.escape) {
        if (s.view === 'detail') setView('list');
        else if (exitOnQuit) exit();
        return;
      }

      if (s.view === 'detail') return;

      if (input === 'g' || input === 'r') {
        setRefreshKey((k) => k + 1);
        setMessage('Обновлено');
        return;
      }
      if (input === 'm') {
        const i = MODES.indexOf(s.mode);
        const next = MODES[(i + 1) % MODES.length]!;
        setMode(next);
        setMessage(`Режим: ${MODE_LABEL[next]}`);
        return;
      }
      if (key.leftArrow || input === 'h') {
        setPage((p) => Math.max(0, p - 1));
        setCursor(0);
        return;
      }
      if (key.rightArrow || input === 'l') {
        setPage((p) => (p + 1 < s.totalPages ? p + 1 : p));
        setCursor(0);
        return;
      }

      if (s.items.length === 0) return;

      if (key.upArrow || input === 'k') {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setCursor((c) => Math.min(s.items.length - 1, c + 1));
        return;
      }
      if (key.return) {
        if (selected) setView('detail');
        return;
      }
      if (input === 'd' && selected && selected.status === 'open') {
        void mutateStatus(selected, 'done');
        return;
      }
      if (input === 'o' && selected && selected.status === 'done') {
        void mutateStatus(selected, 'open');
        return;
      }
    },
    [exit, exitOnQuit, mutateStatus],
  );

  useInput(handler);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Orbit — {MODE_LABEL[mode]}</Text>
      </Box>
      {view === 'list' ? (
        <ListView
          items={items}
          cursor={cursor}
          loading={loading}
          error={error}
          now={now}
        />
      ) : selected ? (
        <DetailView task={selected} now={now} />
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          {view === 'list'
            ? `Страница ${page + 1} из ${totalPages} · всего ${total}`
            : 'Карточка задачи'}
        </Text>
      </Box>
      {message ? (
        <Box>
          <Text color="cyan">{message}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          {view === 'list'
            ? '↑↓ навигация · ←→ страница · enter открыть · d закрыть · o переоткрыть · m режим · g обновить · q выход'
            : 'esc/q назад'}
        </Text>
      </Box>
    </Box>
  );
}

function ListView({
  items,
  cursor,
  loading,
  error,
  now,
}: {
  items: TaskDto[];
  cursor: number;
  loading: boolean;
  error: string | null;
  now: Date;
}): React.JSX.Element {
  if (error) {
    return (
      <Box>
        <Text color="red">Ошибка: {error}</Text>
      </Box>
    );
  }
  if (loading && items.length === 0) {
    return (
      <Box>
        <Text dimColor>Загрузка…</Text>
      </Box>
    );
  }
  if (items.length === 0) {
    return (
      <Box>
        <Text dimColor>Нет задач.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {items.map((task, i) => {
        const sel = i === cursor;
        const due = task.dueAt ? renderDueCell(task, now) : '';
        const id = `#${task.numId}`;
        const mark = task.status === 'done' ? '✓' : ' ';
        return (
          <Box key={task.numId}>
            <Text inverse={sel}>
              {sel ? '> ' : '  '}
              {mark} {id.padEnd(5)} {task.title}
              {due ? `  (${due})` : ''}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function DetailView({
  task,
  now,
}: {
  task: TaskDto;
  now: Date;
}): React.JSX.Element {
  const due = task.dueAt ? renderDueCell(task, now) : '(нет)';
  return (
    <Box flexDirection="column">
      <Text bold>
        #{task.numId}  {task.title}
      </Text>
      <Text>Статус: {task.status}</Text>
      <Text>Срок:   {due}</Text>
      <Text>Создано: {task.createdAt}</Text>
      {task.doneAt ? <Text>Закрыто: {task.doneAt}</Text> : null}
    </Box>
  );
}
