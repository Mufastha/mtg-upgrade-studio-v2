// Mede o motor de recomendação (§8) contra o conjunto de validação do
// Diogo. Toda a alteração ao scoring/emparelhamento reporta-se assim:
// "X das tuas escolhas no top 10, Y das rejeitadas".
//
// Uso (a decklist é dado pessoal, fica fora do repositório):
//   node tools/validation/measure.mjs "<caminho da decklist>" [validation.json] [opções]
//
// Plano de jogo (relevância só a partir de um plano curado, §8.3), por
// esta ordem: --plano=<ficheiro.json> | game_plan do conjunto de validação
// | --semente (tags do commander, só para reproduzir a linha de base).
// --detalhe mostra pares, cortes saltados e o lote antes/depois;
// --sugestoes mostra os eixos sugeridos a partir das 99 (§7.2).
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveDecklist } from '../../src/importers/decklist.js';
import { generateCandidates } from '../../src/rules/candidate-generation.js';
import { seedGamePlan } from '../../src/rules/game-plan.js';
import { generateRecommendations } from '../../src/rules/recommendation-score.js';
import { evaluateBracketChecklist } from '../../src/rules/bracket.js';
import { createDeckConfig } from '../../src/rules/deck-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

const args = process.argv.slice(2);
const verbose = args.includes('--detalhe');
const [deckPath, validationArg] = args.filter((a) => !a.startsWith('--'));
if (!deckPath) {
  console.error('Uso: node tools/validation/measure.mjs "<decklist>" [validation.json]');
  process.exit(1);
}
const validationPath = validationArg ?? path.join(here, 'limit-break.json');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const cards = JSON.parse(gunzipSync(await readFile(path.join(repo, 'catalog/catalog.json.gz'))));
const manifest = await readJson(path.join(repo, 'catalog/manifest.json'));
const bracketRules = await readJson(path.join(repo, 'data/bracket-rules.json'));
const validation = await readJson(validationPath);
const cardsByOracleId = new Map(cards.map((c) => [c.oracle_id, c]));

const { cards: deckCards, commanderOracleId } = resolveDecklist(await readFile(deckPath, 'utf8'), { cards });
const deckOracleIds = new Set(deckCards.map((c) => c.oracle_id));

const config = createDeckConfig({ deckId: 'validacao', name: 'Torneio B3', targetBracket: validation.target_bracket ?? 3 });

const { commander, candidates, steps, reviewByOracleId } = generateCandidates(cards, {
  commanderOracleId,
  deckOracleIds,
  sourcePreconBaseCards: [...deckOracleIds],
  config,
  bracketRules,
});
const planArg = args.find((a) => a.startsWith('--plano='));
let gamePlan;
let planLabel;
if (planArg) {
  const planPath = planArg.slice('--plano='.length);
  gamePlan = await readJson(planPath);
  planLabel = `ficheiro ${path.basename(planPath)}${gamePlan.note ? ` (${gamePlan.note})` : ''}`;
} else if (validation.game_plan) {
  gamePlan = validation.game_plan;
  planLabel = 'curado (conjunto de validação)';
} else if (args.includes('--semente')) {
  gamePlan = seedGamePlan(commander);
  planLabel = 'semente do commander (não curado - linha de base)';
} else {
  console.error('Sem plano curado no conjunto de validação: usa --plano=<ficheiro> ou --semente (linha de base).');
  process.exit(1);
}

if (args.includes('--sugestoes')) {
  const { suggestPlanAxes } = await import('../../src/rules/game-plan.js');
  const s = suggestPlanAxes(deckCards, cardsByOracleId, commanderOracleId);
  console.log('Eixos sugeridos a partir das 99:');
  for (const a of s.axes) {
    console.log(`  ${a.tag.padEnd(28)} ${String(a.cardsInDeck).padStart(2)} cartas, ${a.enrichment.toFixed(1)}×  (${a.source}${a.inCommander ? ', também no commander' : ''})  ${a.examples.join(', ')}`);
  }
  console.log(`Já são papel do §7.1: ${s.roles.map((r) => `${r.tag} (${r.role})`).join(', ')}`);
  console.log(`Só no commander, sem confirmação nas 99: ${s.commanderOnly.join(', ')}\n`);
}

const { pairs, skipped, batch } = generateRecommendations(deckCards, candidates, gamePlan, cardsByOracleId, {
  config,
  bracketRules,
  commanderOracleId,
  reviewByOracleId,
});

console.log(
  `${validation.deck} — catálogo de ${manifest.built_at.slice(0, 10)}, bracket ${config.target_bracket}, ` +
    `plano: ${planLabel} — eixos ${gamePlan.synergy_tags.join(', ')}\n`
);

console.log('Fase A/B:');
for (const s of steps) {
  const reasons = s.excludedByReason ? Object.entries(s.excludedByReason).map(([r, n]) => `${n} × ${r}`).join('; ') : '';
  console.log(`  ${String(s.count).padStart(6)}  ${s.label}${reasons ? `  [${reasons}]` : ''}`);
}

const deckCardObjects = deckCards.map((dc) => cardsByOracleId.get(dc.oracle_id));
const checklist = evaluateBracketChecklist(deckCardObjects, bracketRules, config.target_bracket);
console.log(`\nChecklist do deck atual (bracket ${checklist.bracket}, ${checklist.name}):`);
for (const row of checklist.rows) console.log(`  [${row.state.padEnd(6)}] ${row.criterion}: ${row.detail}`);
console.log('');

function report(label, names, verdict) {
  const accepted = names.filter((n) => verdict.accepted.includes(n));
  const rejected = names.filter((n) => verdict.rejected.includes(n));
  const unjudged = names.filter((n) => !verdict.accepted.includes(n) && !verdict.rejected.includes(n));
  console.log(
    `${label}: ${accepted.length} das tuas ${verdict.accepted.length} escolhas no top 10, ` +
      `${rejected.length} das ${verdict.rejected.length} rejeitadas, ${unjudged.length} por julgar`
  );
  for (const n of names) {
    const tag = verdict.accepted.includes(n) ? 'escolha  ' : verdict.rejected.includes(n) ? 'REJEITADA' : 'por julgar';
    console.log(`  [${tag}] ${n}`);
  }
}

report('Adições', pairs.map((p) => p.add.card.name), validation.adds);
console.log('');
report('Cortes', pairs.map((p) => p.cut.card.name), validation.cuts);

if (verbose) {
  const { justifyRecommendations } = await import('../../src/rules/recommendation-justification.js');
  console.log('\nPares:');
  for (const j of justifyRecommendations(pairs)) console.log(`  [${j.tier}] ${j.summary}`);
  if (skipped.length > 0) {
    console.log('\nCortes sem substituto válido (não mostrados como recomendação):');
    for (const s of skipped) console.log(`  ${s.cut.card.name} — ${s.reason}`);
  }
  const { before, after } = batch;
  console.log('\nLote avaliado como deck (antes → depois):');
  for (const role of Object.keys(before.counts)) {
    if (before.counts[role] !== after.counts[role]) console.log(`  ${role}: ${before.counts[role]} → ${after.counts[role]}`);
  }
  console.log(`  Game Changers: ${before.gameChangers} → ${after.gameChangers}`);
  console.log(`  CMC médio (não-terreno): ${before.averageCmc.toFixed(2)} → ${after.averageCmc.toFixed(2)}`);
  console.log(`  Papéis em falta depois: ${after.missingRoles.map((m) => `${m.role} ${m.have}/${m.target}`).join(', ') || 'nenhum'}`);
  console.log(`  Checklist depois: ${after.checklist.rows.map((r) => `${r.criterion} ${r.state}`).join('; ')}`);
}
