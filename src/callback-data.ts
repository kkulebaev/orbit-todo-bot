export type ListMode = 'my' | 'done';

export type ViewCallback =
  | { kind: 'v:list'; mode: ListMode; page: number }
  | { kind: 'v:add'; mode: ListMode; page: number }
  | { kind: 'v:cancel' }
  | { kind: 'v:addDraft'; action: 'confirm' | 'cancel' }
  | { kind: 'v:task'; taskNumId: number; mode: ListMode; page: number }
  | { kind: 'noop' };

export type TaskCallback =
  | { kind: 't:delask'; taskNumId: number; mode: ListMode; page: number }
  | { kind: 't:delyes'; taskNumId: number; mode: ListMode; page: number }
  | { kind: 't:edit'; taskNumId: number; mode: ListMode; page: number }
  | { kind: 't:done'; taskNumId: number; mode: ListMode; page: number }
  | { kind: 't:reopen'; taskNumId: number; mode: ListMode; page: number }
  ;

export type CallbackData = ViewCallback | TaskCallback;

function parseIntStrict(s: string) {
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function parseMode(s: string) {
  return s === 'my' || s === 'done' ? s : null;
}

export function parseCallbackData(raw: string): CallbackData | null {
  const s = raw.trim();
  if (!s) return null;

  if (s === 'noop') return { kind: 'noop' };
  if (s === 'v:cancel') return { kind: 'v:cancel' };

  // v:list:<mode>:<page>
  {
    const m = s.match(/^v:list:(my|done):(\d+)$/);
    if (m) return { kind: 'v:list', mode: m[1] as any, page: Number(m[2]) };
  }

  // v:add:<mode>:<page>
  {
    const m = s.match(/^v:add:(my|done):(\d+)$/);
    if (m) return { kind: 'v:add', mode: m[1] as any, page: Number(m[2]) };
  }

  // v:addDraft:(confirm|cancel)
  {
    const m = s.match(/^v:addDraft:(confirm|cancel)$/);
    if (m) return { kind: 'v:addDraft', action: m[1] as any };
  }

  // v:task:<taskNumId>:<mode>:<page>
  {
    const m = s.match(/^v:task:(\d+):(my|done):(\d+)$/);
    if (m) {
      return {
        kind: 'v:task',
        taskNumId: Number(m[1]),
        mode: m[2] as any,
        page: Number(m[3]),
      };
    }
  }

  // t:delask:<taskNumId>:<mode>:<page>
  {
    const m = s.match(/^t:delask:(\d+):(my|done):(\d+)$/);
    if (m) return { kind: 't:delask', taskNumId: Number(m[1]), mode: m[2] as any, page: Number(m[3]) };
  }

  // t:delyes:<taskNumId>:<mode>:<page>
  {
    const m = s.match(/^t:delyes:(\d+):(my|done):(\d+)$/);
    if (m) return { kind: 't:delyes', taskNumId: Number(m[1]), mode: m[2] as any, page: Number(m[3]) };
  }

  // t:edit:<taskNumId>:<mode>:<page>
  {
    const m = s.match(/^t:edit:(\d+):(my|done):(\d+)$/);
    if (m) return { kind: 't:edit', taskNumId: Number(m[1]), mode: m[2] as any, page: Number(m[3]) };
  }

  // t:(done|reopen):<taskNumId>:<mode>:<page>
  {
    const m = s.match(/^t:(done|reopen):(\d+):(my|done):(\d+)$/);
    if (m) {
      return {
        kind: `t:${m[1]}` as any,
        taskNumId: Number(m[2]),
        mode: m[3] as any,
        page: Number(m[4]),
      };
    }
  }


  return null;
}

export function formatCallbackData(d: CallbackData): string {
  switch (d.kind) {
    case 'noop':
      return 'noop';
    case 'v:cancel':
      return 'v:cancel';
    case 'v:list':
      return `v:list:${d.mode}:${d.page}`;
    case 'v:add':
      return `v:add:${d.mode}:${d.page}`;
    case 'v:addDraft':
      return `v:addDraft:${d.action}`;
    case 'v:task':
      return `v:task:${d.taskNumId}:${d.mode}:${d.page}`;
    case 't:delask':
      return `t:delask:${d.taskNumId}:${d.mode}:${d.page}`;
    case 't:delyes':
      return `t:delyes:${d.taskNumId}:${d.mode}:${d.page}`;
    case 't:edit':
      return `t:edit:${d.taskNumId}:${d.mode}:${d.page}`;
    case 't:done':
      return `t:done:${d.taskNumId}:${d.mode}:${d.page}`;
    case 't:reopen':
      return `t:reopen:${d.taskNumId}:${d.mode}:${d.page}`;
    default: {
      // Exhaustiveness
      const _x: never = d;
      return _x;
    }
  }
}
