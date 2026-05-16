import type { Task as PrismaTask } from '@prisma/client';
import type { TaskDto } from '@orbit/contracts';

export type TaskView = {
  numId: number;
  title: string;
  status: 'open' | 'done';
  dueAt: Date | null;
  dueHasTime: boolean;
  createdAt: Date;
  doneAt: Date | null;
};

export function fromPrismaTask(t: PrismaTask): TaskView {
  return {
    numId: t.numId,
    title: t.title,
    status: t.status as 'open' | 'done',
    dueAt: t.dueAt,
    dueHasTime: t.dueHasTime,
    createdAt: t.createdAt,
    doneAt: t.doneAt,
  };
}

export function fromApiTask(dto: TaskDto): TaskView {
  return {
    numId: dto.numId,
    title: dto.title,
    status: dto.status,
    dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
    dueHasTime: dto.dueHasTime,
    createdAt: new Date(dto.createdAt),
    doneAt: dto.doneAt ? new Date(dto.doneAt) : null,
  };
}
