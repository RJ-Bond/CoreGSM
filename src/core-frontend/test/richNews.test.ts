// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mergeSegs, normHex, readFrom, renderInto, segsToTags } from '../src/richNews';

const box = (html = '') => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
};

describe('visual editor of a game message', () => {
  it('reads colours however the browser writes them', () => {
    expect(readFrom(box('a <span style="color: rgb(255, 85, 85);">красный</span> b'))).toBe('a <color=#FF5555>красный</color> b');
    expect(readFrom(box('<font color="#ff0">жёлтый</font>'))).toBe('<color=#FFFF00>жёлтый</color>');
    expect(readFrom(box('<b>жирный</b> и <i>курсив</i>'))).toBe('<b>жирный</b> и <i>курсив</i>');
    expect(readFrom(box('<span style="font-weight: 700; color: #5fd068">всё</span>'))).toBe('<color=#5FD068><b>всё</b></color>');
  });

  it('merges neighbours of one style into one tag', () => {
    expect(readFrom(box('<span style="color:#ff5555">а</span><span style="color:rgb(255,85,85)">б</span>'))).toBe('<color=#FF5555>аб</color>');
    expect(mergeSegs([{ text: 'a', color: null, bold: false, italic: false }, { text: 'b', color: null, bold: false, italic: false }])).toHaveLength(1);
  });

  it('keeps the chat on one line and drops angle brackets', () => {
    expect(readFrom(box('раз<br>два'))).toBe('раздва');
    expect(readFrom(box('a\nb c'))).toBe('a b c');
    expect(readFrom(box('1 &lt; 2 &gt; 0'))).toBe('1  2  0');
  });

  it('draws tagged text with real colours and reads it back unchanged', () => {
    const el = box();
    const tags = '<color=#FF5555><b>Внимание!</b></color> Рестарт <i>скоро</i>';
    renderInto(el, tags);
    const red = el.querySelector('span') as HTMLElement;
    expect(red.style.color).toBeTruthy();
    expect(el.textContent).toBe('Внимание! Рестарт скоро');
    expect(readFrom(el)).toBe(tags);
  });

  it('shows no tags as text', () => {
    const el = box();
    renderInto(el, '<color=#FF5555>x</color>');
    expect(el.textContent).toBe('x');
  });

  it('understands hex and rgb', () => {
    expect(normHex('#f50')).toBe('#FF5500');
    expect(normHex('rgb(0, 128, 255)')).toBe('#0080FF');
    expect(normHex('red')).toBeNull();
    expect(segsToTags([])).toBe('');
  });
});
