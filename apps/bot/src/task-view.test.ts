import { describe, expect, it } from 'vitest';
import { fromApiTask, fromPrismaTask } from './task-view.js';
import type { TaskDto } from '@orbit/contracts';

describe('fromPrismaTask', () => {
  it('maps an open task with no dueAt', () => {
    const createdAt = new Date('2024-01-10T12:00:00.000Z');
    const prismaTask = {
      id: 'uuid-1',
      numId: 42,
      title: 'Buy milk',
      status: 'open' as const,
      dueAt: null,
      dueHasTime: false,
      createdAt,
      doneAt: null,
      createdById: 'user-1',
      assignedToId: 'user-1',
    };
    const view = fromPrismaTask(prismaTask as any);
    expect(view).toEqual({
      numId: 42,
      title: 'Buy milk',
      status: 'open',
      dueAt: null,
      dueHasTime: false,
      createdAt,
      doneAt: null,
    });
  });

  it('preserves dueAt and doneAt Date objects', () => {
    const createdAt = new Date('2024-01-10T12:00:00.000Z');
    const dueAt = new Date('2024-02-01T09:00:00.000Z');
    const doneAt = new Date('2024-01-20T15:30:00.000Z');
    const prismaTask = {
      id: 'uuid-2',
      numId: 7,
      title: 'Deploy app',
      status: 'done' as const,
      dueAt,
      dueHasTime: true,
      createdAt,
      doneAt,
      createdById: 'user-2',
      assignedToId: 'user-2',
    };
    const view = fromPrismaTask(prismaTask as any);
    expect(view.dueAt).toBe(dueAt);
    expect(view.doneAt).toBe(doneAt);
    expect(view.dueHasTime).toBe(true);
    expect(view.status).toBe('done');
  });
});

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
      createdByNumId: 1,
      assignedToNumId: 1,
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
      createdByNumId: 2,
      assignedToNumId: 2,
    };
    const view = fromApiTask(dto);
    expect(view.dueAt).toBeNull();
    expect(view.doneAt).toBeNull();
    expect(view.numId).toBe(3);
    expect(view.title).toBe('Write tests');
    expect(view.status).toBe('open');
  });
});
