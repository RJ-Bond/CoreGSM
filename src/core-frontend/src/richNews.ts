/**
 * The visual editor of a game message: the box shows colours, bold and italic as they look, and the text that is saved
 * and sent keeps the tags (<color=#RRGGBB>, <b>, <i>). These two functions are the bridge:
 *   renderInto(box, tags)  draws a tagged text into the editable box
 *   readFrom(box)          reads the box back into a tagged text
 */
import { parseNews, type Seg } from './gameNews';

type Style = Pick<Seg, 'color' | 'bold' | 'italic'>;

/** "#f50", "#FF5555" or "rgb(255, 85, 85)" -> "#FF5555"; null when it is not a colour we know */
export function normHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return `#${m[1].split('').map((c) => c + c).join('')}`.toUpperCase();
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return `#${m[1]}`.toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(s);
  if (m) {
    const h = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
    return `#${h}`.toUpperCase();
  }
  return null;
}

const same = (a: Style, b: Style) => a.color === b.color && a.bold === b.bold && a.italic === b.italic;

/** pieces of one style next to each other become one piece */
export function mergeSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && same(last, s)) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** pieces -> tagged text */
export function segsToTags(segs: Seg[]): string {
  return mergeSegs(segs)
    .map((s) => {
      let t = s.text;
      if (s.italic) t = `<i>${t}</i>`;
      if (s.bold) t = `<b>${t}</b>`;
      if (s.color) t = `<color=${s.color}>${t}</color>`;
      return t;
    })
    .join('');
}

function walk(node: Node, style: Style, out: Seg[]): void {
  if (node.nodeType === 3) {
    // the chat is one line: a line break becomes a space, angle brackets would be taken for tags
    const text = (node.nodeValue ?? '').replace(/[ \r\n]+/g, ' ').replace(/[<>]/g, '');
    if (text) out.push({ text, ...style });
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') return;
  const s: Style = { ...style };
  if (tag === 'b' || tag === 'strong') s.bold = true;
  if (tag === 'i' || tag === 'em') s.italic = true;
  if (tag === 'font') s.color = normHex(el.getAttribute('color')) ?? s.color;
  const css = el.style;
  if (css) {
    s.color = normHex(css.color) ?? s.color;
    if (css.fontWeight === 'bold' || Number(css.fontWeight) >= 600) s.bold = true;
    if (css.fontStyle === 'italic') s.italic = true;
  }
  for (const child of Array.from(el.childNodes)) walk(child, s, out);
}

/** the tagged text of what is in the box */
export function readFrom(box: HTMLElement): string {
  const segs: Seg[] = [];
  for (const child of Array.from(box.childNodes)) walk(child, { color: null, bold: false, italic: false }, segs);
  return segsToTags(segs).trim();
}

/** draws a tagged text into the box (replaces what is there) */
export function renderInto(box: HTMLElement, tags: string): void {
  box.textContent = '';
  for (const s of parseNews(tags)) {
    const span = box.ownerDocument.createElement('span');
    span.textContent = s.text;
    if (s.color) span.style.color = s.color;
    if (s.bold) span.style.fontWeight = '800';
    if (s.italic) span.style.fontStyle = 'italic';
    box.appendChild(span);
  }
}
