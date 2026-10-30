// node --test "tests/*.test.mjs"
// Plano de jogo (§7.2) e relevância só a partir de eixos curados (§8.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { suggestPlanAxes } from '../src/rules/game-plan.js';
import { scoreCard, generateRecommendations } from '../src/rules/recommendation-score.js';
import { createDeckConfig } from '../src/rules/deck-config.js';

const rules = JSON.parse(await readFile(new URL('../data/bracket-rules.json', import.meta.url), 'utf8'));

const mk = (id, type, tags = []) => ({ oracle_id: id, name: id, type_line: type, oracle_tags: tags, cmc: 2, is_gamechanger: false, color_identity: [] });

// Catálogo: muitas criaturas genéricas, poucas cartas de equipment. O deck
// concentra equipment - a sugestão tem de o apanhar; a tag do commander
// que não se repete nas 99 fica só como "do commander".
const commander = mk('Commander', 'Legendary Creature — Human Soldier', ['synergy-equipment', 'firebend-like', 'cycle-xyz']);
const generic = Array.from({ length: 200 }, (_, i) => mk(`Genérica ${i}`, 'Creature — Elf', ['triggered-ability']));
const payoffs = Array.from({ length: 4 }, (_, i) => mk(`Payoff ${i}`, 'Creature — Human Soldier', ['synergy-equipment']));
const gear = Array.from({ length: 5 }, (_, i) => mk(`Gear ${i}`, 'Artifact — Equipment'));
const catalog = [commander, ...generic, ...payoffs, ...gear];
const cardsByOracleId = new Map(catalog.map((c) => [c.oracle_id, c]));
const deckCards = [commander, ...payoffs, ...gear, ...generic.slice(0, 3)].map((c) => ({ oracle_id: c.oracle_id, quantity: 1 }));

test('sugere o eixo concentrado nas 99, com a evidência do tipo junta', () => {
  const { axes } = suggestPlanAxes(deckCards, cardsByOracleId, commander.oracle_id);
  const equipment = axes.find((a) => a.tag === 'synergy-equipment');
  assert.ok(equipment, 'synergy-equipment sugerido');
  assert.equal(equipment.inCommander, true);
  assert.match(equipment.source, /tipo Equipment/);
});

test('tags só do commander e ruído cycle-* não são sugestões fortes', () => {
  const { axes, commanderOnly } = suggestPlanAxes(deckCards, cardsByOracleId, commander.oracle_id);
  assert.ok(!axes.some((a) => a.tag === 'firebend-like'));
  assert.ok(commanderOnly.includes('firebend-like'));
  assert.ok(!commanderOnly.includes('cycle-xyz') && !axes.some((a) => a.tag.startsWith('cycle-')));
});

test('typal-X casa com o tipo X, como synergy-X', () => {
  const soldier = mk('Soldado', 'Creature — Human Soldier');
  assert.deepEqual(scoreCard(soldier, { synergy_tags: ['typal-soldier'] }).axisTypeMatched, ['soldier']);
  assert.equal(scoreCard(mk('Elfo', 'Creature — Elf'), { synergy_tags: ['typal-soldier'] }).score, 0);
});

test('sem plano curado não há recomendações', () => {
  const config = createDeckConfig({ deckId: 'd', targetBracket: 3 });
  assert.throws(
    () => generateRecommendations(deckCards, gear, { synergy_tags: [] }, cardsByOracleId, { config, bracketRules: rules }),
    /Plano de jogo por confirmar/
  );
});
