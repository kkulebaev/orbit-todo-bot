import { describe, expect, it } from 'vitest';
import { parseAddCommandText } from './bot-logic.js';

describe('bot-logic', () => {
  describe('parseAddCommandText', () => {
    it('returns null on empty', () => {
      expect(parseAddCommandText('')).toBeNull();
      expect(parseAddCommandText('   ')).toBeNull();
    });

    it('parses add as self (assignment disabled)', () => {
      expect(parseAddCommandText('купить молоко')).toEqual({ kind: 'self', title: 'купить молоко' });
      expect(parseAddCommandText('@kkulebaev купить молоко')).toEqual({ kind: 'self', title: '@kkulebaev купить молоко' });
    });
  });
});
