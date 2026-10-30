// Plano de jogo (§7.2). Só os eixos que o Diogo guardou no formulário
// contam para a relevância (§8.3). A semente do commander e as sugestões
// tiradas das 99 propõem; nunca pesam sozinhas.
//
// Porquê: a semente descreve o que o commander É, não o que ele QUER - as
// tags do próprio Cloud (attacking-matters-self, firebend-like, refund)
// premiavam cartas parecidas com ele, não cartas que o alimentam (§8.0). E
// as 99 de um precon trazem temas que o dono do deck não quer
// (typal-soldier, synergy-legendary no Limit Break).
import { getEstablishedRoleForTag } from './deck-metrics.js';

// cycle-* é bookkeeping da Scryfall (ciclos e reimpressões), sem relação com
// jogabilidade - já reprovado no teste de dispersão do §7.1.
const isNoise = (tag) => tag.startsWith('cycle-');

// Proposta tirada das tags do commander - o que ele faz, não o que quer.
// Usada como uma das fontes de sugestão e como linha de base da medição.
export function seedGamePlan(commanderCard) {
  return {
    synergy_tags: (commanderCard?.oracle_tags ?? []).filter((t) => !isNoise(t)),
    archetype: '',
    avoid_tags: [],
  };
}

const isLand = (card) => card.type_line.includes('Land');

// Palavras de tipo/subtipo de uma carta (Equipment, Soldier, Artifact...),
// sem supertipos.
const SUPERTYPES = new Set(['Legendary', 'Basic', 'Snow', 'World', 'Ongoing']);
function typeWordsOf(card) {
  return card.type_line
    .split('//')
    .flatMap((face) => face.replace('—', ' ').split(/\s+/))
    .filter((w) => /^[A-Z]/.test(w) && !SUPERTYPES.has(w));
}

// Frequência de cada tag e de cada palavra de tipo nas cartas não-terreno
// do catálogo - calculada uma vez por catálogo carregado.
const catalogFrequencyCache = new WeakMap();
function catalogFrequency(cardsByOracleId) {
  const cached = catalogFrequencyCache.get(cardsByOracleId);
  if (cached) return cached;
  const tags = new Map();
  const types = new Map();
  let total = 0;
  for (const card of cardsByOracleId.values()) {
    if (isLand(card)) continue;
    total += 1;
    for (const t of new Set(card.oracle_tags)) tags.set(t, (tags.get(t) ?? 0) + 1);
    for (const w of new Set(typeWordsOf(card))) types.set(w, (types.get(w) ?? 0) + 1);
  }
  const result = { tags, types, total };
  catalogFrequencyCache.set(cardsByOracleId, result);
  return result;
}

// Limiares de apresentação, não de decisão: uma sugestão aparece se está em
// pelo menos 3 cartas do deck e é pelo menos 3× mais frequente no deck do
// que no catálogo. O Diogo confirma ou ignora cada uma.
const MIN_CARDS = 3;
const MIN_ENRICHMENT = 3;

// Sugere eixos a partir das 99, com a evidência de cada um. Uma palavra de
// tipo concentrada no deck (Equipment) vira a tag de sinergia que a
// representa (synergy-equipment) quando essa tag existe no catálogo - é
// assim que o score casa tipo com eixo (recommendation-score.js). Tags que
// já são papel do §7.1 vêm à parte: medem função, não tema.
export function suggestPlanAxes(deckCards, cardsByOracleId, commanderOracleId) {
  const freq = catalogFrequency(cardsByOracleId);
  const deckNonLand = deckCards
    .map((dc) => cardsByOracleId.get(dc.oracle_id))
    .filter((card) => card && !isLand(card));
  const commander = cardsByOracleId.get(commanderOracleId);
  const commanderTags = new Set(commander?.oracle_tags ?? []);

  const examples = (pred) => deckNonLand.filter(pred).map((c) => c.name);
  const enrichment = (inDeck, inCatalog) =>
    inCatalog > 0 ? inDeck / deckNonLand.length / (inCatalog / freq.total) : 0;

  const axes = [];
  const roles = [];

  const tagCounts = new Map();
  for (const card of deckNonLand) for (const t of new Set(card.oracle_tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  for (const [tag, count] of tagCounts) {
    if (isNoise(tag) || count < MIN_CARDS) continue;
    const factor = enrichment(count, freq.tags.get(tag) ?? 0);
    if (factor < MIN_ENRICHMENT) continue;
    const entry = {
      tag,
      source: 'tag',
      cardsInDeck: count,
      enrichment: factor,
      inCommander: commanderTags.has(tag),
      examples: examples((c) => c.oracle_tags.includes(tag)).slice(0, 5),
    };
    const role = getEstablishedRoleForTag(tag);
    if (role) roles.push({ ...entry, role });
    else axes.push(entry);
  }

  const typeCounts = new Map();
  for (const card of deckNonLand) for (const w of new Set(typeWordsOf(card))) typeCounts.set(w, (typeCounts.get(w) ?? 0) + 1);
  for (const [word, count] of typeCounts) {
    if (count < MIN_CARDS) continue;
    const factor = enrichment(count, freq.types.get(word) ?? 0);
    if (factor < MIN_ENRICHMENT) continue;
    const tag = [`synergy-${word.toLowerCase()}`, `typal-${word.toLowerCase()}`].find((t) => freq.tags.has(t));
    if (!tag) continue;
    const existing = axes.find((a) => a.tag === tag);
    if (existing) {
      // O mesmo eixo pela tag e pelo tipo: junta a evidência do tipo.
      existing.source = `${existing.source} + tipo ${word} (${count} cartas)`;
      continue;
    }
    axes.push({
      tag,
      source: `tipo ${word}`,
      cardsInDeck: count,
      enrichment: factor,
      inCommander: commanderTags.has(tag),
      examples: examples((c) => typeWordsOf(c).includes(word)).slice(0, 5),
    });
  }

  const byStrength = (a, b) => b.enrichment - a.enrichment || b.cardsInDeck - a.cardsInDeck;
  return {
    axes: axes.sort(byStrength),
    roles: roles.sort(byStrength),
    // Tags do commander que as 99 não confirmam (menos de MIN_CARDS cartas):
    // mostradas para o Diogo decidir, sem força de sugestão.
    commanderOnly: [...commanderTags].filter(
      (t) => !isNoise(t) && !getEstablishedRoleForTag(t) && !axes.some((a) => a.tag === t)
    ),
  };
}
