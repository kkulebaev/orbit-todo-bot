import { describe, expect, it } from 'vitest';
import { fromApiUser } from './viewer-view.js';
import type { UserDto } from '@orbit/contracts';

describe('fromApiUser', () => {
  it('casts telegramUserId string back to BigInt and clears id', () => {
    const dto: UserDto = {
      numId: 9,
      telegramUserId: '987654321',
    };
    const v = fromApiUser(dto);
    expect(v.id).toBe('');
    expect(v.numId).toBe(9);
    expect(v.telegramUserId).toBe(BigInt('987654321'));
  });
});
