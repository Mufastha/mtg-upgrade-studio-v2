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
// exclusivos - ver interactionOrRemovalCount para a densidade).
const INTERACTION_EXTRA_TAGS = new Set(['gives-protection', 'gains-protection', 'fog', 'fog-selective', 'pseudo-fog']);
const INTERACTION_PREFIXES = ['protects-', 'hate-', 'counterspell'];

// Só "alternate-win-condition" - é o único sinal explícito que a Scryfall dá
// para "esta carta pode ganhar o jogo fora do dano de combate normal". Não
// existe tag para "finisher"/"wincon" genérico no vocabulário real.
const WINCON_TAGS = new Set(['alternate-win-condition']);

// Alvos de referência para "papéis em falta" - senso comum de construção de
// Commander, não uma regra oficial. Ajustável; calibra-se a sério na Fase 4
// contra decks conhecidos (ver §12 da especificação, pesos do scoring).
const ROLE_TARGETS = { ramp: 8, draw: 8, removal: 8, interaction: 5, wincons: 1 };
const LAND_TARGET = 36;

function hasAny(tags, set) {
  return tags.some((t) => set.has(t));
}
function hasPrefix(tags, prefixes) {
  return tags.some((t) => prefixes.some((p) => t.startsWith(p)));
}

export function computeDeckMetrics(deckCards, cardsByOracleId) {
  let landCount = 0;
  let manaSourceCount = 0;
  let nonLandCount = 0;
  let interactionOrRemovalCount = 0;
  const roleCounts = { ramp: 0, draw: 0, removal: 0, interaction: 0, wincons: 0 };
  const manaCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };
  const tagHistogram = new Map();

  for (const dc of deckCards) {
    const card = cardsByOracleId.get(dc.oracle_id);
    if (!card) continue;
    const qty = dc.quantity;
    const tags = card.oracle_tags;
    const isLand = card.type_line.includes('Land');

    for (const t of tags) tagHistogram.set(t, (tagHistogram.get(t) ?? 0) + qty);

    if (isLand) {
      landCount += qty;
      continue;
    }

    nonLandCount += qty;
    const bucket = card.cmc >= 7 ? '7+' : String(Math.floor(card.cmc));
    manaCurve[bucket] += qty;

    const isRamp = hasAny(tags, RAMP_TAGS);
    const isDraw = hasAny(tags, DRAW_TAGS);
    const isRemoval = hasAny(tags, REMOVAL_TAGS);
    const isInteraction = isRemoval || hasAny(tags, INTERACTION_EXTRA_TAGS) || hasPrefix(tags, INTERACTION_PREFIXES);
    const isWincon = hasAny(tags, WINCON_TAGS);

    if (hasAny(tags, MANA_SOURCE_TAGS)) manaSourceCount += qty;
    if (isRamp) roleCounts.ramp += qty;
    if (isDraw) roleCounts.draw += qty;
    if (isRemoval) roleCounts.removal += qty;
    if (isInteraction) roleCounts.interaction += qty;
    if (isWincon) roleCounts.wincons += qty;
    if (isInteraction) interactionOrRemovalCount += qty;
  }
  manaSourceCount += landCount;

  const missingRoles = [];
  if (landCount < LAND_TARGET) {
    missingRoles.push({ role: 'terrenos', have: landCount, target: LAND_TARGET, short: LAND_TARGET - landCount });
  }
  for (const [role, target] of Object.entries(ROLE_TARGETS)) {
    const have = roleCounts[role];
    if (have < target) missingRoles.push({ role, have, target, short: target - have });
  }

  return {
    totalNonLandCards: nonLandCount,
    landCount,
    manaSourceCount,
    manaCurve,
    roleCounts,
    tagHistogram,
    interactionDensity: nonLandCount === 0 ? 0 : interactionOrRemovalCount / nonLandCount,
    missingRoles,
  };
}
