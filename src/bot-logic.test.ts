import { describe, expect, it } from 'vitest';
import { clipTitle, parseAddCommandText } from './bot-logic.js';

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

  it('clipTitle trims and clips', () => {
    expect(clipTitle('  a  ', 2)).toBe('a');
    expect(clipTitle('abcdef', 3)).toBe('abc');
  });
});
