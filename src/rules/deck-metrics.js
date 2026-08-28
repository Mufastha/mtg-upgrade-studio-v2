// Métricas determinísticas do deck (§7.1). Nomes de tags verificados contra
// o catálogo real (31830 cartas) antes de escrever isto - "ramp" como
// substring, por exemplo, apanha "trample"/"rampage", que nada têm a ver.
// Os conjuntos abaixo são exatos, não heurísticas de substring.

const MANA_SOURCE_TAGS = new Set([
  'mana-rock',
  'utility-mana-rock',
  'mana-rock-with-set-s-mechanic',
  'mana-dork',
  'mana-dork-egg',
  'ritual',
  'ritual-untap',
]);

// Ramp é mais lato que "fontes de mana": inclui também tutores de terreno
// para o campo de batalha e ramp de combate, que não produzem mana por si
// só mas aumentam a mana disponível a prazo.
const RAMP_TAGS = new Set([
  ...MANA_SOURCE_TAGS,
  'ramp',
  'ramp-with-set-s-mechanic',
  'land-ramp',
  'multi-land-ramp',
  'combat-ramp',
  'tutor-land-to-battlefield',
]);

const DRAW_TAGS = new Set([
  'draw-engine',
  'repeatable-pure-draw',
  'pure-draw',
  'burst-draw',
  'force-draw',
  'repeatable-impulsive-draw',
  'long-term-impulsive-draw',
  'impulsive-draw',
  'repeatable-draw',
  'repeatable-loot',
  'loot',
]);

const REMOVAL_TAGS = new Set([
  'spot-removal',
  'removal-creature',
  'removal-destroy',
  'multi-removal',
  'removal-toughness',
  'removal-exile',
  'removal-nonland',
  'removal-bounce',
  'removal-sacrifice',
  'removal-artifact',
  'removal-land',
  'removal-enchantment',
  'removal-permanent',
  'removal-planeswalker',
  'removal-tuck',
  'removal-fight',
  'swap-removal',
  'removal-aura',
  'removal-equipment',
  'removal-noncreature',
  'removal-vehicle',
  'removal-battle',
  'removal-nonenchantment',
  'removal-spacecraft',
  'repeatable-removal',
  'sweeper',
  'sweeper-one-sided',
  'sweeper-graveyard',
]);

// Interação lata: proteção, counterspells, taxas/hosers ("hate-*"), fog. Uma
// carta de remoção também conta tipicamente como interação (não são baldes
// exclusivos - ver interactionOrRemovalCards para a densidade).
//
// EM DISCUSSÃO (27/08): "hate-*" e "protects-*" apanham coisa demais - ver
// nota na especificação §7.1. Mantido por agora para não mudar código antes
// de decidir; a UI expansível existe precisamente para se poder ver isto.
const INTERACTION_EXTRA_TAGS = new Set(['gives-protection', 'gains-protection', 'fog', 'fog-selective', 'pseudo-fog']);
const INTERACTION_PREFIXES = ['protects-', 'hate-', 'counterspell'];

// Só "alternate-win-condition" - é o único sinal explícito que a Scryfall dá
// para "esta carta pode ganhar o jogo fora do dano de combate normal". Não
// existe tag para "finisher"/"wincon" genérico no vocabulário real. EM
// DISCUSSÃO: não cobre dano/perda de vida em massa nem peças de combo
// (Walking Ballista) - ver nota na especificação §7.1.
const WINCON_TAGS = new Set(['alternate-win-condition']);

// Alvos de referência para "papéis em falta" - senso comum de construção de
// Commander, não uma regra oficial. EM DISCUSSÃO: um precon (Limit Break)
// não falha nenhum destes alvos, o que sugere que estão demasiado baixos
// para o propósito da app. Ajustável; calibra-se a sério na Fase 4 contra
// decks conhecidos (ver §12 da especificação, pesos do scoring).
const ROLE_TARGETS = { ramp: 8, draw: 8, removal: 8, interaction: 5, wincons: 1 };
const LAND_TARGET = 36;

function hasAny(tags, set) {
  return tags.some((t) => set.has(t));
}
function hasPrefix(tags, prefixes) {
  return tags.some((t) => prefixes.some((p) => t.startsWith(p)));
}
function sumQty(list) {
  return list.reduce((sum, e) => sum + e.quantity, 0);
}

export function computeDeckMetrics(deckCards, cardsByOracleId) {
  const landCards = [];
  const nonLandManaSourceCards = [];
  const nonLandCards = [];
  const roleCards = { ramp: [], draw: [], removal: [], interaction: [], wincons: [] };
  const interactionOrRemovalCards = [];
  const curveCards = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], '7+': [] };
  const tagHistogram = new Map();

  for (const dc of deckCards) {
    const card = cardsByOracleId.get(dc.oracle_id);
    if (!card) continue;
    const entry = { oracle_id: card.oracle_id, name: card.name, quantity: dc.quantity };
    const tags = card.oracle_tags;

    for (const t of tags) tagHistogram.set(t, (tagHistogram.get(t) ?? 0) + dc.quantity);

    if (card.type_line.includes('Land')) {
      landCards.push(entry);
      continue;
    }

    nonLandCards.push(entry);
    const bucket = card.cmc >= 7 ? '7+' : String(Math.floor(card.cmc));
    curveCards[bucket].push(entry);

    const isRemoval = hasAny(tags, REMOVAL_TAGS);
    const isInteraction = isRemoval || hasAny(tags, INTERACTION_EXTRA_TAGS) || hasPrefix(tags, INTERACTION_PREFIXES);

    if (hasAny(tags, MANA_SOURCE_TAGS)) nonLandManaSourceCards.push(entry);
    if (hasAny(tags, RAMP_TAGS)) roleCards.ramp.push(entry);
    if (hasAny(tags, DRAW_TAGS)) roleCards.draw.push(entry);
    if (isRemoval) roleCards.removal.push(entry);
    if (isInteraction) {
      roleCards.interaction.push(entry);
      interactionOrRemovalCards.push(entry);
    }
    if (hasAny(tags, WINCON_TAGS)) roleCards.wincons.push(entry);
  }

  const landCount = sumQty(landCards);
  const manaSourceCards = [...landCards, ...nonLandManaSourceCards];
  const manaSourceCount = sumQty(manaSourceCards);
  const totalNonLandCards = sumQty(nonLandCards);

  const roleCounts = Object.fromEntries(Object.entries(roleCards).map(([role, list]) => [role, sumQty(list)]));

  const manaCurve = Object.fromEntries(Object.entries(curveCards).map(([bucket, list]) => [bucket, sumQty(list)]));

  const missingRoles = [];
  if (landCount < LAND_TARGET) {
    missingRoles.push({ role: 'terrenos', have: landCount, target: LAND_TARGET, short: LAND_TARGET - landCount });
  }
  for (const [role, target] of Object.entries(ROLE_TARGETS)) {
    const have = roleCounts[role];
    if (have < target) missingRoles.push({ role, have, target, short: target - have });
  }

  return {
    totalNonLandCards,
    landCount,
    landCards,
    manaSourceCount,
    manaSourceCards,
    manaCurve,
    curveCards,
    roleCounts,
    roleCards,
    tagHistogram,
    interactionDensity: totalNonLandCards === 0 ? 0 : sumQty(interactionOrRemovalCards) / totalNonLandCards,
    missingRoles,
  };
}
