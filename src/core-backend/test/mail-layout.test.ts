import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layout } from '../src/alerts/mail.ts';

describe('letter layout', () => {
  it('has the brand, the text, one button with its address and a plain-text twin', () => {
    const r = layout('My <Club>', ['Hello', 'Second & line'], { label: 'Set a password', url: 'https://p.example.ru/#/reset/abc' });
    assert.match(r.html, /My &lt;Club&gt;/);
    assert.match(r.html, /Second &amp; line/);
    assert.match(r.html, /href="https:\/\/p\.example\.ru\/#\/reset\/abc"/);
    assert.match(r.html, /Set a password/);
    assert.ok(r.html.includes('background:#4f46e5'), 'the default accent');
    assert.equal(r.text, 'Hello\nSecond & line\n\nSet a password: https://p.example.ru/#/reset/abc\n\n— My <Club>');
  });
  it('without a button there is no button markup, and nothing from the text can become markup', () => {
    const r = layout('B', ['<script>alert(1)</script>']);
    assert.ok(!r.html.includes('<script>'));
    assert.ok(!r.html.includes('href='));
  });
});
