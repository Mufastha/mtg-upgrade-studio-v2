// Métricas determinísticas do deck (§7.1). Nomes de tags verificados contra
// o catálogo real (31830 cartas) antes de escrever isto - "ramp" como
// substring, por exemplo, apanha "trample"/"rampage", que nada têm a ver.
// Os conjuntos abaixo são exatos, não heurísticas de substring.
//
// Os papéis podem sobrepor-se quando a carta tem efeitos distintos (Boros
// Charm dá indestructible OU queima por 4 - conta em dois papéis). O
// critério é sempre o EFEITO da carta, nunca o alvo escolhido: uma remoção
// apontada à própria criatura para a salvar de um sacrifício continua a ser
// remoção. Não existe métrica agregada a somar baldes (havia
// interactionDensity antes - dava 36,5% no Limit Break por estar a somar
// remoção com proteção; o problema era a agregação, não os baldes).
//
// Tags de fog ("fog", "fog-selective", "pseudo-fog") NÃO classificam nada
// sozinhas - verificado contra a carta "Fog" em si, que já tem
// protects-planeswalker da própria Scryfall. O papel real de uma carta com
// fog decide-se pelas outras tags: Cloud's Limit Break tem multi-removal
// (é remoção, destrói os atacantes), Arachnogenesis tem
// protects-planeswalker (é proteção, cria bloqueadores), Aether Shockwave
// só tem tapper-creature (não é nenhum dos dois - é Interação/Resposta).

const MANA_SOURCE_TAGS = new Set([
  'mana-rock',
  'utility-mana-rock',
  'mana-rock-with-set-s-mechanic',
  'mana-dork',
  'mana-dork-egg',
  'ritual',
  'ritual-untap',
]);

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

// Remoção = respostas permanentes/duras (destroy, exile, sacrifice forçado,
// fight, sweepers). Bounce e tuck saíram daqui - ver INTERACTION_TAGS: um
// efeito temporário (a carta pode voltar) não é a mesma coisa que remover.
const REMOVAL_TAGS = new Set([
  'spot-removal',
  'removal-creature',
  'removal-destroy',
  'multi-removal',
  'removal-toughness',
  'removal-exile',
  'removal-nonland',
  'removal-sacrifice',
  'removal-artifact',
  'removal-land',
  'removal-enchantment',
  'removal-permanent',
  'removal-planeswalker',
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

// Proteger o que já tens em jogo (teu, não o do adversário).
const PROTECTION_TAG_PREFIXES = ['protects-'];
const PROTECTION_EXTRA_TAGS = new Set(['gives-protection', 'gains-protection']);

// Negar recursos/ações ao adversário - counterspells, hand attack, taxas
// ("stax"). Nunca é zero por definição de cor: Mana Tithe, Rebuff the
// Wicked, Dawn Charm e Lapse of Certainty são brancas e têm counterspell*;
// a métrica lê o que está no deck, não presume a partir da identidade de
// cor. A raridade fora de azul é um facto sobre o deck, não sobre a regra.
const DISRUPTION_TAG_PREFIXES = ['counterspell'];
const DISRUPTION_EXACT_TAGS = new Set([
  'discard',
  'cost-increaser',
  'cast-tax',
  'tax-attack',
  'tax-block',
  'prevent-cast',
  'stasis',
  'mass-land-denial',
]);

// Responder ao adversário sem remover nem proteger: tap em massa, bounce,
// tuck. "tapper-*" é a família verificada com o Aether Shockwave.
const INTERACTION_TAG_PREFIXES = ['tapper-'];
const INTERACTION_EXACT_TAGS = new Set(['removal-bounce', 'removal-tuck']);

// Fecho de jogo: ganha o jogo por si só, fora do dano de combate normal. Só
// "alternate-win-condition" por agora (Fase 5: + combos do Commander
// Spellbook cujo resultado seja dano/vida em massa ou "win the game" - ver
// §12 da especificação).
const CLOSER_TAGS = new Set(['alternate-win-condition']);

// Amplificadores: acelera um plano já existente, não fecha nada por si -
// um combate extra exige board e criaturas vivas. "anthem" é mesmo +X/+X
// (verificado); "keyword-anthem" é conceder keywords (trample, double
// strike) e fica de fora, é outra coisa. Equipment que só melhora a
// criatura equipada também não é anthem.
const AMPLIFIER_TAGS = new Set(['extra-combat-phase', 'anthem', 'storm-like', 'storm-count-matters']);

// Alvos de referência para "papéis em falta" - aviso estrutural, não motor
// de recomendação (isso é o §8, calibrado a partir do plano do commander,
// não de alvos fixos - ver §12). Pisos de senso comum de construção EDH,
// não ajustados para nenhum deck passar ou falhar. Documentados com
// justificação no §7.1 da especificação.
const ROLE_TARGETS = {
  ramp: 8,
  draw: 8,
  removal: 8,
  protection: 3,
  disruption: 2,
  interaction: 2,
  closers: 1,
  amplifiers: 2,
};
const LAND_TARGET = 36;

const ROLE_KEYS = Object.keys(ROLE_TARGETS);

function hasAny(tags, set) {
  return tags.some((t) => set.has(t));
}
function hasPrefix(tags, prefixes) {
  return tags.some((t) => prefixes.some((p) => t.startsWith(p)));
}
function sumQty(list) {
  return list.reduce((sum, e) => sum + e.quantity, 0);
}
function classifyRoles(tags) {
  return {
    ramp: hasAny(tags, RAMP_TAGS),
    draw: hasAny(tags, DRAW_TAGS),
    removal: hasAny(tags, REMOVAL_TAGS),
    protection: hasPrefix(tags, PROTECTION_TAG_PREFIXES) || hasAny(tags, PROTECTION_EXTRA_TAGS),
    disruption: hasPrefix(tags, DISRUPTION_TAG_PREFIXES) || hasAny(tags, DISRUPTION_EXACT_TAGS),
    interaction: hasPrefix(tags, INTERACTION_TAG_PREFIXES) || hasAny(tags, INTERACTION_EXACT_TAGS),
    closers: hasAny(tags, CLOSER_TAGS),
    amplifiers: hasAny(tags, AMPLIFIER_TAGS),
  };
}

// Aplica anulações por deck (guardadas em deck.role_overrides, ver
// decklist.js: setRoleOverride) por cima da classificação automática.
// action "add": a carta conta para o papel mesmo sem a tag. action
// "remove": a carta NÃO conta para o papel apesar da tag. Nunca muda a
// regra global - só o que está guardado com este deck.
function applyOverrides(autoRoleCards, overrides, qtyByOracleId, cardsByOracleId) {
  if (!overrides || overrides.length === 0) return autoRoleCards;
  const result = {};
  for (const [role, list] of Object.entries(autoRoleCards)) result[role] = [...list];
  for (const o of overrides) {
    const list = result[o.role];
    if (!list) continue;
    const idx = list.findIndex((e) => e.oracle_id === o.oracle_id);
    if (o.action === 'add' && idx === -1) {
      const card = cardsByOracleId.get(o.oracle_id);
      const qty = qtyByOracleId.get(o.oracle_id) ?? 1;
      if (card) list.push({ oracle_id: o.oracle_id, name: card.name, quantity: qty });
    } else if (o.action === 'remove' && idx !== -1) {
      list.splice(idx, 1);
    }
  }
  return result;
}

export function computeDeckMetrics(deckCards, cardsByOracleId, overrides = []) {
  const landCards = [];
  const nonLandManaSourceCards = [];
  const nonLandCards = [];
  const autoRoleCards = Object.fromEntries(ROLE_KEYS.map((k) => [k, []]));
  const curveCards = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], '7+': [] };
  const tagHistogram = new Map();
  const qtyByOracleId = new Map(deckCards.map((dc) => [dc.oracle_id, dc.quantity]));

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

    if (hasAny(tags, MANA_SOURCE_TAGS)) nonLandManaSourceCards.push(entry);

    const roles = classifyRoles(tags);
    for (const [role, included] of Object.entries(roles)) {
      if (included) autoRoleCards[role].push(entry);
    }
  }

  const roleCards = applyOverrides(autoRoleCards, overrides, qtyByOracleId, cardsByOracleId);

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
    autoRoleCards,
    tagHistogram,
    missingRoles,
  };
}

export { ROLE_KEYS };
