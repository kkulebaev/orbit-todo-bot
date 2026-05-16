import { describe, expect, it } from 'vitest';
import { fromApiUser, fromPrismaUser } from './viewer-view.js';
import type { UserDto } from '@orbit/contracts';

describe('fromPrismaUser', () => {
  it('maps all Prisma User fields, preserving BigInt and UUID', () => {
    const prismaUser = {
      id: '11111111-1111-1111-1111-111111111111',
      numId: 7,
      telegramUserId: BigInt('123456789'),
      username: 'kk',
      firstName: 'Konstantin',
      // Extra Prisma fields should be ignored.
      createdAt: new Date(),
    };
    const v = fromPrismaUser(prismaUser as any);
    expect(v).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      numId: 7,
      telegramUserId: BigInt('123456789'),
      username: 'kk',
      firstName: 'Konstantin',
    });
  });

  it('preserves null username and firstName', () => {
    const prismaUser = {
      id: 'uuid-x',
      numId: 1,
      telegramUserId: BigInt(42),
      username: null,
      firstName: null,
    };
    const v = fromPrismaUser(prismaUser as any);
    expect(v.username).toBeNull();
    expect(v.firstName).toBeNull();
  });
});

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
