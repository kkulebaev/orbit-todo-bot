import { describe, expect, it } from 'vitest';
import { fromApiTask } from './task-view.js';
import type { TaskDto } from '@orbit/contracts';

describe('fromApiTask', () => {
  it('converts ISO dueAt string to Date with same epoch ms', () => {
    const isoStr = '2024-03-15T10:30:00.000Z';
    const dto: TaskDto = {
      numId: 99,
      title: 'Review PR',
      status: 'open',
      dueAt: isoStr,
      dueHasTime: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      doneAt: null,
    };
    const view = fromApiTask(dto);
    expect(view.dueAt).toBeInstanceOf(Date);
    expect(view.dueAt!.getTime()).toBe(new Date(isoStr).getTime());
    expect(view.createdAt).toBeInstanceOf(Date);
  });

  it('maps null dueAt and doneAt to null', () => {
    const dto: TaskDto = {
      numId: 3,
      title: 'Write tests',
      status: 'open',
      dueAt: null,
      dueHasTime: false,
      createdAt: '2024-06-01T08:00:00.000Z',
      doneAt: null,
    };
    const view = fromApiTask(dto);
    expect(view.dueAt).toBeNull();
    expect(view.doneAt).toBeNull();
    expect(view.numId).toBe(3);
    expect(view.title).toBe('Write tests');
    expect(view.status).toBe('open');
  });

  it('converts doneAt ISO string to Date for done tasks', () => {
    const doneAt = '2024-01-20T15:30:00.000Z';
    const dto: TaskDto = {
      numId: 7,
      title: 'Deploy app',
      status: 'done',
      dueAt: null,
      dueHasTime: false,
      createdAt: '2024-01-10T12:00:00.000Z',
      doneAt,
    };
    const view = fromApiTask(dto);
    expect(view.doneAt).toBeInstanceOf(Date);
    expect(view.doneAt!.getTime()).toBe(new Date(doneAt).getTime());
    expect(view.status).toBe('done');
  });
});
