import { describe, expect, it } from 'vitest';
import { buildThread, parseComment, tokenize, visibleCount, type CommentItem } from '../src/components/news/commentMd';

describe('comment markdown', () => {
  it('knows bold, italic, code and mentions', () => {
    expect(tokenize('a **b** *i* `c` @Alex')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'b', v: 'b' }, { t: 'text', v: ' ' }, { t: 'i', v: 'i' }, { t: 'text', v: ' ' }, { t: 'code', v: 'c' }, { t: 'text', v: ' ' }, { t: 'mention', v: 'Alex' },
    ]);
  });
  it('makes links only of http(s) addresses and keeps the end of a sentence out of them', () => {
    expect(tokenize('[сайт](https://a.ru/x)')).toEqual([{ t: 'link', v: 'сайт', href: 'https://a.ru/x' }]);
    expect(tokenize('см. https://a.ru/x.')).toEqual([{ t: 'text', v: 'см. ' }, { t: 'link', v: 'https://a.ru/x', href: 'https://a.ru/x' }, { t: 'text', v: '.' }]);
    expect(tokenize('[x](javascript:alert(1))').some((t) => t.t === 'link')).toBe(false);
  });
  it('never turns an e-mail into a mention', () => {
    expect(tokenize('me@site.ru').some((t) => t.t === 'mention')).toBe(false);
  });
  it('marks quote lines', () => {
    expect(parseComment('> цитата\nответ').map((b) => b.quote)).toEqual([true, false]);
  });
});

const c = (id: number, over: Partial<CommentItem> = {}): CommentItem => ({
  id, parentId: null, author: 'a', role: 'user', mine: false, text: 't', hidden: false, deleted: false, hideReason: '', pinned: false,
  createdAt: id * 1000, editedAt: null, canEdit: false, reactions: {}, myReaction: null, flagged: false, ...over,
});

describe('comment thread', () => {
  const items = [c(1), c(2, { reactions: { '👍': 3 } }), c(3, { pinned: true }), c(4, { parentId: 1, createdAt: 9000 }), c(5, { parentId: 1, createdAt: 5000 })];
  it('puts the pinned comment first and sorts the rest', () => {
    expect(buildThread(items, 'new').map((x) => x.top.id)).toEqual([3, 2, 1]);
    expect(buildThread(items, 'old').map((x) => x.top.id)).toEqual([3, 1, 2]);
    expect(buildThread(items, 'top').map((x) => x.top.id)).toEqual([3, 2, 1]);
  });
  it('lists replies oldest first', () => {
    expect(buildThread(items, 'new').find((x) => x.top.id === 1)?.replies.map((r) => r.id)).toEqual([5, 4]);
  });
  it('counts what is readable', () => {
    expect(visibleCount([c(1), c(2, { hidden: true }), c(3, { deleted: true })])).toBe(1);
  });
});
