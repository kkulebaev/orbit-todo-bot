import { describe, expect, it } from 'vitest';
import { clipTitle, parseAddCommandText } from './bot-logic.js';

describe('bot-logic', () => {
  describe('parseAddCommandText', () => {
    it('returns null on empty', () => {
      expect(parseAddCommandText('')).toBeNull();
      expect(parseAddCommandText('   ')).toBeNull();
    });

    it('parses self add', () => {
      expect(parseAddCommandText('купить молоко')).toEqual({ kind: 'self', title: 'купить молоко' });
    });

    it('parses assign add', () => {
      expect(parseAddCommandText('@kkulebaev купить молоко')).toEqual({
        kind: 'assign',
        username: 'kkulebaev',
        title: 'купить молоко',
      });
    });

    it('does not parse too-short usernames as assign', () => {
      // Telegram usernames must be 5+ chars; this should fall back to self.
      expect(parseAddCommandText('@abc task')).toEqual({ kind: 'self', title: '@abc task' });
    });

    it('trims title for assign case', () => {
      expect(parseAddCommandText('@username   task   ')).toEqual({
        kind: 'assign',
        username: 'username',
        title: 'task',
      });
    });
  });

  it('clipTitle trims and clips', () => {
    expect(clipTitle('  a  ', 2)).toBe('a');
    expect(clipTitle('abcdef', 3)).toBe('abc');
  });
});
