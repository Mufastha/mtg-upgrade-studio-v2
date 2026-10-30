// node --test "tests/*.test.mjs"
// Emparelhamento por papel e lote avaliado como deck (§8.4), sobre um
// catálogo sintético - os casos que o Limit Break não exerce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateRecommendations } from '../src/rules/recommendation-score.js';
import { createDeckConfig } from '../src/rules/deck-config.js';

const rules = JSON.parse(await readFile(new URL('../data/bracket-rules.json', import.meta.url), 'utf8'));
const plan = { synergy_tags: ['synergy-equipment'], avoid_tags: [] };

const mk = (id, { type = 'Creature', tags = [], gc = false, cmc = 2 } = {}) => ({
  oracle_id: id,
  name: id,
  type_line: type,
  oracle_tags: tags,
  cmc,
  is_gamechanger: gc,
  color_identity: [],
});
const commander = mk('Commander', { type: 'Legendary Creature' });
const rock = (n) => mk(`Rock ${n}`, { type: 'Artifact', tags: ['mana-rock'] });
const equipment = (n, opts = {}) => mk(`Equipment ${n}`, { type: 'Artifact — Equipment', ...opts });
const forest = mk('Forest', { type: 'Basic Land — Forest' });

function run(deck, candidates, { bracket = 3, maxChanges } = {}) {
  const catalog = [commander, forest, ...deck.map((d) => d.card), ...candidates];
  const cardsByOracleId = new Map(catalog.map((c) => [c.oracle_id, c]));
  const deckCards = [
    { oracle_id: commander.oracle_id, quantity: 1 },
    ...deck.map((d) => ({ oracle_id: d.card.oracle_id, quantity: d.quantity ?? 1 })),
  ];
  const config = createDeckConfig({ deckId: 't', targetBracket: bracket, maxChanges });
  return generateRecommendations(deckCards, candidates, plan, cardsByOracleId, {
    config,
    bracketRules: rules,
    commanderOracleId: commander.oracle_id,
  });
}

const rocks = (n) => Array.from({ length: n }, (_, i) => ({ card: rock(i + 1) }));
const lands = (n) => [{ card: forest, quantity: n }];

test('um corte que deixaria um papel abaixo do alvo só é emparelhado com uma adição desse papel', () => {
  // Ramp exatamente no alvo (8), terrenos no alvo (36): todo o corte tira um papel do alvo.
  const candidates = [equipment(1), rock('nova')];
  const { pairs, skipped } = run([...rocks(8), ...lands(36)], candidates, { maxChanges: 1 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].add.card.name, 'Rock nova', 'a adição repõe Ramp, mesmo pontuando menos que o Equipment');
  assert.deepEqual(pairs[0].needRoles, ['ramp']);
  // O terreno foi tentado primeiro (nome) e saltado: nenhuma candidata é terreno.
  assert.ok(skipped.some((s) => s.cut.card.name === 'Forest' && /terrenos/.test(s.reason)));
});

test('a folga gasta por uma troca já não está disponível para a seguinte', () => {
  // Ramp 9/8 e terrenos 37/36: uma unidade de folga em cada.
  const candidates = [equipment(1), equipment(2), equipment(3), equipment(4)];
  const { pairs, batch } = run([...rocks(9), ...lands(37)], candidates, { maxChanges: 4 });
  const cutRamp = pairs.filter((p) => p.cut.occupiedRoles.includes('ramp')).length;
  const cutLand = pairs.filter((p) => p.cut.occupiedRoles.includes('terrenos')).length;
  assert.equal(cutRamp, 1, 'só um rock sai - o segundo deixaria Ramp abaixo de 8');
  assert.equal(cutLand, 1, 'só um terreno sai - o segundo deixaria terrenos abaixo de 36');
  assert.ok(batch.after.counts.ramp >= 8);
  assert.ok(batch.after.counts.terrenos >= 36);
});

test('o lote nunca passa o limite de Game Changers do bracket', () => {
  // Deck com 2 Game Changers em B3 (limite 3); as duas melhores candidatas são Game Changers.
  const deck = [
    { card: mk('GC velho 1', { gc: true }) },
    { card: mk('GC velho 2', { gc: true }) },
    { card: mk('Filler 1') },
    { card: mk('Filler 2') },
    ...lands(40),
  ];
  const candidates = [equipment('GC A', { gc: true }), equipment('GC B', { gc: true }), equipment('normal')];
  const { pairs, batch } = run(deck, candidates, { maxChanges: 2 });
  assert.equal(pairs.filter((p) => p.add.card.is_gamechanger).length, 1);
  assert.equal(batch.after.gameChangers, 3);
});

test('com o deck acima do limite, os primeiros cortes são Game Changers', () => {
  const deck = [
    ...Array.from({ length: 4 }, (_, i) => ({ card: mk(`GC ${i + 1}`, { gc: true }) })),
    { card: mk('Filler sem papel') },
    ...lands(40),
  ];
  const { pairs, batch } = run(deck, [equipment(1), equipment(2)], { maxChanges: 1 });
  assert.equal(pairs[0].cut.card.is_gamechanger, true, 'o filler não sai antes de o deck caber no bracket');
  assert.equal(batch.after.gameChangers, 3);
});

test('a única carta de um papel nunca é cortada, e o commander também não', () => {
  const deck = [{ card: mk('Único closer', { tags: ['alternate-win-condition'] }) }, ...lands(40)];
  const { pairs } = run(deck, [equipment(1)], { maxChanges: 5 });
  assert.ok(pairs.every((p) => p.cut.card.name !== 'Único closer' && p.cut.card.name !== 'Commander'));
});
