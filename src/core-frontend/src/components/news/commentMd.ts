/** The few Markdown marks a comment may have: **bold**, *italic*, `code`, [text](https://link), bare links, > quotes, @nicks. Pure, no HTML. */

export type Tok =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'code' | 'mention'; v: string }
  | { t: 'link'; v: string; href: string };

export interface Block { quote: boolean; toks: Tok[] }

const INLINE = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)|(?<=^|[\s(])@([\p{L}\p{N}_.-]{2,32})/gu;

export function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ t: 'text', v: line.slice(at, i) });
    if (m[1] !== undefined) out.push({ t: 'b', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'i', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'code', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'link', v: m[4], href: m[5] });
    else if (m[6] !== undefined) {
      // the punctuation that ends a sentence is not a part of the address
      const url = m[6].replace(/[.,;:!?)\]]+$/, '');
      out.push({ t: 'link', v: url, href: url });
      if (url.length < m[6].length) out.push({ t: 'text', v: m[6].slice(url.length) });
    } else out.push({ t: 'mention', v: m[7] });
    at = i + m[0].length;
  }
  if (at < line.length) out.push({ t: 'text', v: line.slice(at) });
  return out;
}

/** lines → blocks: a line that starts with «> » is a quote, the others are plain lines */
export function parseComment(text: string): Block[] {
  return text.split('\n').map((line) => {
    const quote = /^>\s?/.test(line);
    return { quote, toks: tokenize(quote ? line.replace(/^>\s?/, '') : line) };
  });
}

export type CommentSort = 'new' | 'old' | 'top';

export interface CommentItem {
  id: number;
  parentId: number | null;
  author: string;
  role: 'admin' | 'moderator' | 'user';
  mine: boolean;
  text: string;
  hidden: boolean;
  deleted: boolean;
  hideReason: string;
  pinned: boolean;
  createdAt: number;
  editedAt: number | null;
  canEdit: boolean;
  reactions: Record<string, number>;
  myReaction: string | null;
  flagged: boolean;
  flags?: number;
}

const score = (c: CommentItem) => Object.values(c.reactions).reduce((a, b) => a + b, 0);

/** the thread as a tree: the pinned comment first, then the top-level ones in the chosen order; replies oldest first */
export function buildThread(items: CommentItem[], sort: CommentSort): { top: CommentItem; replies: CommentItem[] }[] {
  const tops = items.filter((c) => c.parentId == null);
  const byTime = (a: CommentItem, b: CommentItem) => a.createdAt - b.createdAt || a.id - b.id;
  tops.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'old' ? byTime(a, b) : sort === 'top' ? score(b) - score(a) || byTime(b, a) : byTime(b, a)));
  return tops.map((top) => ({ top, replies: items.filter((c) => c.parentId === top.id).sort(byTime) }));
}

/** the number in the head of the block: comments that are not deleted or hidden */
export const visibleCount = (items: CommentItem[]) => items.filter((c) => !c.deleted && !c.hidden).length;
