import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from '../src/hints.js';

test('hints by the text of a notice', () => {
  assert.match(nextStep('Нужен привязанный ник. сделайте это'), /\/link/);
  assert.match(nextStep('Нужен аккаунт. Зарегистрируйтесь'), /\/register/);
  assert.match(nextStep('Розыгрыш не найден'), /Проверьте/);
  assert.match(nextStep('Не получилось. Панель сейчас не отвечает'), /минуту/);
  assert.match(nextStep('Только для администраторов'), /администратор/);
  assert.equal(nextStep('Всё хорошо'), '');
});
