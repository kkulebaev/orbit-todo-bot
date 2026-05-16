import { describe, expect, it } from 'vitest';
import { fromApiUser } from './viewer-view.js';
import type { UserDto } from '@orbit/contracts';

describe('fromApiUser', () => {
  it('casts telegramUserId string back to BigInt and clears id', () => {
    const dto: UserDto = {
      numId: 9,
      telegramUserId: '987654321',
      username: 'alice',
      firstName: 'Alice',
    };
    const v = fromApiUser(dto);
    expect(v.id).toBe('');
    expect(v.numId).toBe(9);
    expect(v.telegramUserId).toBe(BigInt('987654321'));
    expect(v.username).toBe('alice');
    expect(v.firstName).toBe('Alice');
  });

  it('handles null username and firstName from UserDto', () => {
    const dto: UserDto = {
      numId: 2,
      telegramUserId: '1',
      username: null,
      firstName: null,
    };
    const v = fromApiUser(dto);
    expect(v.username).toBeNull();
    expect(v.firstName).toBeNull();
    expect(v.telegramUserId).toBe(BigInt(1));
  });
});
