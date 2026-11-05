import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { COMMANDS } from '../src/commands.js';
import { MENU_SET, MENU_WELCOME, ROLE_COMMANDS, isPickable, roleMenu } from '../src/roles.js';

const role = (o: { id?: string; managed?: boolean; editable?: boolean; perms?: bigint } = {}) => ({
  id: o.id ?? '200000000000000001',
  managed: o.managed ?? false,
  editable: o.editable ?? true,
  permissions: new PermissionsBitField(o.perms ?? 0n),
});

test('/roles is registered once and works only on a server', () => {
  assert.equal(COMMANDS.filter((c) => c.name === 'roles').length, 1);
  assert.equal((ROLE_COMMANDS[0] as { dm_permission?: boolean }).dm_permission, false);
});

test('a plain role may be handed out', () => {
  assert.equal(isPickable(role({ perms: PermissionFlagsBits.SendMessages | PermissionFlagsBits.Connect }), '100'), true);
});

test('never hand out @everyone, an integration role, a role above the bot or a role with administrative rights', () => {
  assert.equal(isPickable(role({ id: '100' }), '100'), false);
  assert.equal(isPickable(role({ managed: true }), '100'), false);
  assert.equal(isPickable(role({ editable: false }), '100'), false);
  for (const p of [PermissionFlagsBits.Administrator, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.MentionEveryone]) {
    assert.equal(isPickable(role({ perms: p | PermissionFlagsBits.SendMessages }), '100'), false, String(p));
  }
});

test('the menu: one option per role, the current roles are ticked, the greeting menu needs at least one choice', () => {
  const roles = [
    { id: '1', name: 'PvP', unicodeEmoji: '⚔️' },
    { id: '2', name: 'Строитель', unicodeEmoji: null },
  ];
  const set = roleMenu(MENU_SET, roles, new Set(['2']), 0).components[0]!.toJSON();
  assert.equal(set.custom_id, MENU_SET);
  assert.equal(set.min_values, 0);
  assert.equal(set.max_values, 2);
  assert.deepEqual(set.options.map((o) => [o.value, o.default === true]), [['1', false], ['2', true]]);
  assert.equal(set.options[0]!.emoji?.name, '⚔️');
  const welcome = roleMenu(MENU_WELCOME, roles, new Set(), 1).components[0]!.toJSON();
  assert.equal(welcome.min_values, 1);
});
