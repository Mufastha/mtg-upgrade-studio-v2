// node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateBracketChecklist, bracketCandidateCheck } from '../src/rules/bracket.js';
import { createDeckConfig } from '../src/rules/deck-config.js';

const rules = JSON.parse(await readFile(new URL('../data/bracket-rules.json', import.meta.url), 'utf8'));

const card = (name, { gc = false, tags = [] } = {}) => ({ name, is_gamechanger: gc, oracle_tags: tags });
const gc = (n) => card(`GC ${n}`, { gc: true });
const state = (checklist, criterion) => checklist.rows.find((r) => r.criterion === criterion).state;

test('B3: até 3 Game Changers passa, 4 falha', () => {
  assert.equal(state(evaluateBracketChecklist([gc(1), gc(2), gc(3)], rules, 3), 'Game Changers'), 'pass');
  assert.equal(state(evaluateBracketChecklist([gc(1), gc(2), gc(3), gc(4)], rules, 3), 'Game Changers'), 'fail');
});

test('B2: um único Game Changer falha', () => {
  assert.equal(state(evaluateBracketChecklist([gc(1)], rules, 2), 'Game Changers'), 'fail');
});

test('mass land denial falha em B3, passa em B4', () => {
  const deck = [card('Armageddon', { tags: ['mass-land-denial'] })];
  assert.equal(state(evaluateBracketChecklist(deck, rules, 3), 'Mass land denial'), 'fail');
  assert.equal(state(evaluateBracketChecklist(deck, rules, 4), 'Mass land denial'), 'pass');
});

test('turnos extra: B1 falha, B3 fica em review (encadeamento não verificável), nunca pass', () => {
  const deck = [card('Time Warp', { tags: ['extra-turn'] })];
  assert.equal(state(evaluateBracketChecklist(deck, rules, 1), 'Turnos extra'), 'fail');
  assert.equal(state(evaluateBracketChecklist(deck, rules, 3), 'Turnos extra'), 'review');
});

test('prevent-extra-turns não conta como turno extra', () => {
  const deck = [card('Stranglehold', { tags: ['prevent-extra-turns'] })];
  assert.equal(state(evaluateBracketChecklist(deck, rules, 1), 'Turnos extra'), 'pass');
});

test('combos e turno de fim nunca dão pass abaixo de B4 (invariante 7)', () => {
  const checklist = evaluateBracketChecklist([], rules, 3);
  assert.equal(state(checklist, 'Combos de 2 cartas'), 'review');
  assert.equal(state(checklist, 'Turno de fim'), 'review');
});

test('Fase B: Game Changer só é excluído com o deck já no limite', () => {
  const candidate = gc('nova');
  assert.equal(bracketCandidateCheck(candidate, rules, 3, 2).excluded, null);
  assert.match(bracketCandidateCheck(candidate, rules, 3, 3).excluded, /limite/);
  assert.match(bracketCandidateCheck(candidate, rules, 2, 0).excluded, /limite/);
  assert.equal(bracketCandidateCheck(candidate, rules, 4, 10).excluded, null);
});

test('Fase B: turno extra em B3 continua, anotado para verificação', () => {
  const check = bracketCandidateCheck(card('Time Warp', { tags: ['extra-turn'] }), rules, 3, 0);
  assert.equal(check.excluded, null);
  assert.ok(check.review);
});

test('configuração exige bracket alvo explícito de 1 a 5', () => {
  assert.throws(() => createDeckConfig({ deckId: 'd' }));
  assert.throws(() => createDeckConfig({ deckId: 'd', targetBracket: 6 }));
  const config = createDeckConfig({ deckId: 'd', targetBracket: 3 });
  assert.equal(config.target_bracket, 3);
  assert.equal(config.max_changes, 10);
});
