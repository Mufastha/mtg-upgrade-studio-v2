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

// curiosity e wheel-symmetrical entraram pelo mesmo teste (2 de setembro
// de 2026) - curiosity-like, apesar do nome parecido, dispersa (16%) e
// ficou de fora; wheel-one-sided (60%, n=85) ficou pendente, amostra
// suficiente mas abaixo do limiar de confiança, decisão do Diogo.
//
// impulsive-draw/repeatable-impulsive-draw/long-term-impulsive-draw SAÍRAM
// daqui em 5 de setembro de 2026 - exilam do topo da biblioteca e dão
// acesso temporário a jogar essas cartas, nunca as põem na mão (Light Up
// the Stage, Chandra Torch of Defiance). Não é draw, é ACCESS_TAGS abaixo.
// Isto baixa o Draw do Limit Break de 12 para 9 - correção aceite mesmo
// piorando o número, o erro estava aqui antes de hoje.
const DRAW_TAGS = new Set([
  'draw-engine',
  'repeatable-pure-draw',
  'pure-draw',
  'burst-draw',
  'force-draw',
  'repeatable-draw',
  'repeatable-loot',
  'loot',
  'curiosity',
  'wheel-symmetrical',
]);

// Papel "Acesso Temporário" (9º papel, 5 de setembro de 2026): converte mana
// em acesso a cartas, nunca as acumula - Light Up the Stage e Chandra,
// Torch of Defiance exilam do topo e dão uma janela para jogar, sem nunca
// pôr nada na mão. Nome estreito de propósito, não "velocidade": testados
// cost-reducer, gives-haste, extra-land/play-additional-land e ritual/
// ritual-untap como candidatos ao mesmo balde e nenhum converge com estas
// três (0-8% de sobreposição de cartas) - extra-land/play-additional-land/
// ritual já estão bem servidos em Ramp (74-100%), gives-haste é uma
// armadilha de nome (é subproduto de roubo/reanimação, não "haste em
// massa" - Sauron the Lidless Eye, Puppeteer Clique), cost-reducer é um
// mecanismo genuinamente diferente (gasta menos mana, não troca uma carta
// por acesso temporário a outras). O balde fica só com as três tags de
// impulse - "acesso temporário" descreve exatamente isto, "velocidade"
// seria largo demais.
//
// Armadilha de nome à parte: a tag `impulse` (sem sufixo) NÃO é isto - é
// "olha as top N, põe 1 na mão" (Sleight of Hand, Telling Time), seleção
// de cartas para a mão, não exílio temporário. Nunca deve entrar neste
// balde.
const ACCESS_TAGS = new Set(['impulsive-draw', 'repeatable-impulsive-draw', 'long-term-impulsive-draw']);

// Remoção = respostas permanentes/duras (destroy, exile, sacrifice forçado,
// fight, sweepers). Bounce e tuck saíram daqui - ver INTERACTION_TAGS: um
// efeito temporário (a carta pode voltar) não é a mesma coisa que remover.
//
// burn-any/burn-creature/burn-planeswalker/burn-with-set-s-mechanic,
// bombard, banish e lockdown-creature entraram depois do teste de
// convergência sobre o catálogo real (2 de setembro de 2026, ver §7.1 da
// especificação) - por tag exata, nunca por prefixo: burn-player e
// burn-you, mesmo prefixo "burn-", ficaram de fora por dispersarem sob
// 40% (queimam o jogador, não uma permanente). burn-self e bombard-self
// também ficaram de fora, mas por razão diferente - queimar as próprias
// criaturas não remove nada do adversário, não é remoção por definição,
// não só por amostra.
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
  'burn-any',
  'burn-creature',
  'burn-planeswalker',
  'burn-with-set-s-mechanic',
  'bombard',
  'banish',
  'lockdown-creature',
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
// lockdown-land entrou apesar de n=10 (abaixo do limiar de amostra usado
// para as outras adições de hoje) porque a razão não é estatística: é a
// mesma família conceptual do mass-land-denial já presente aqui, e liga
// diretamente à checklist de bracket (§6) - decisão por categoria, não
// por concentração.
const DISRUPTION_EXACT_TAGS = new Set([
  'discard',
  'cost-increaser',
  'cast-tax',
  'tax-attack',
  'tax-block',
  'prevent-cast',
  'stasis',
  'mass-land-denial',
  'lockdown-land',
]);

// Responder ao adversário sem remover nem proteger: tap em massa, bounce,
// tuck. "tapper-*" é a família verificada com o Aether Shockwave.
// freeze-creature entrou pelo teste de 2 de setembro de 2026 (84%,
// n=171); as tags-irmãs freeze-artifact/freeze-nonland/freeze-permanent-any
// ficaram de fora por amostra pequena (n<25), freeze-land por dispersar.
const INTERACTION_TAG_PREFIXES = ['tapper-'];
const INTERACTION_EXACT_TAGS = new Set(['removal-bounce', 'removal-tuck', 'freeze-creature']);

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
//
// "access" (Acesso Temporário) fica de propósito fora daqui - é um papel
// medido e mostrado, sem alvo de referência. Um alvo de 2 num papel criado
// há dias não vem de nenhuma base (nenhum guia de construção EDH fala
// nisto, ao contrário de terrenos/ramp/draw/remoção); um deck "passar" com
// 3 seria um número sem significado. Alvo só quando houver com que o
// justificar - ver §7.1 da especificação.
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

// Todos os papéis classificáveis - inclui "access", que não tem alvo (ver
// ROLE_TARGETS acima) mas continua a medir-se e a aparecer na UI.
const ROLE_KEYS = [...Object.keys(ROLE_TARGETS), 'access'];

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
    access: hasAny(tags, ACCESS_TAGS),
  };
}

// Para uma tag isolada (não uma carta), diz que papel do §7.1 ela já
// cobre sozinha, se algum - usado pelo formulário do §7.2 para distinguir
// "isto já é papel" de "isto é eixo de sinergia" na semente do plano, sem
// decidir por ninguém (só mostra, nunca remove).
const ROLE_TAG_SETS = {
  ramp: RAMP_TAGS,
  draw: DRAW_TAGS,
  removal: REMOVAL_TAGS,
  protection: PROTECTION_EXTRA_TAGS,
  disruption: DISRUPTION_EXACT_TAGS,
  interaction: INTERACTION_EXACT_TAGS,
  closers: CLOSER_TAGS,
  amplifiers: AMPLIFIER_TAGS,
  access: ACCESS_TAGS,
};
const ROLE_TAG_PREFIX_SETS = {
  protection: PROTECTION_TAG_PREFIXES,
  disruption: DISRUPTION_TAG_PREFIXES,
  interaction: INTERACTION_TAG_PREFIXES,
};
export function getEstablishedRoleForTag(tag) {
  for (const [role, set] of Object.entries(ROLE_TAG_SETS)) {
    if (set.has(tag)) return role;
  }
  for (const [role, prefixes] of Object.entries(ROLE_TAG_PREFIX_SETS)) {
    if (prefixes.some((p) => tag.startsWith(p))) return role;
  }
  return null;
}

// Tags já estabelecidas acima (mesmo por prefixo) - excluídas do cálculo de
// sugestões porque testá-las contra si próprias é tautológico.
const ESTABLISHED_TAGS = new Set([
  ...RAMP_TAGS,
  ...DRAW_TAGS,
  ...REMOVAL_TAGS,
  ...PROTECTION_EXTRA_TAGS,
  ...DISRUPTION_EXACT_TAGS,
  ...INTERACTION_EXACT_TAGS,
  ...CLOSER_TAGS,
  ...AMPLIFIER_TAGS,
  ...ACCESS_TAGS,
]);
const ESTABLISHED_PREFIXES = [...PROTECTION_TAG_PREFIXES, ...DISRUPTION_TAG_PREFIXES, ...INTERACTION_TAG_PREFIXES];
function isEstablishedTag(tag) {
  return ESTABLISHED_TAGS.has(tag) || ESTABLISHED_PREFIXES.some((p) => tag.startsWith(p));
}

// Sugestão automática de papel para uma carta sem nenhuma tag estabelecida
// (§7.1: "sem papel" tem duas causas, isto cobre a lacuna, nunca a
// legítima). Limiares fixados a partir do teste de convergência corrido
// sobre o catálogo real (2 de setembro de 2026, ver especificação): todas
// as adições aprovadas hoje tinham n>=100 e concentração >=88%; todas as
// rejeitadas por amostra tinham n<25. wheel-one-sided (n=85, 60%) ficou de
// propósito fora do limiar - amostra suficiente, concentração insuficiente,
// decisão pendente do Diogo. Cartas cuja tag não bate este limiar ficam
// legitimamente sem papel, sem sugestão nenhuma - nunca um palpite fraco.
const HINT_MIN_SAMPLE = 25;
const HINT_MIN_SHARE = 0.8;

const hintCache = new WeakMap();
function buildTagRoleHints(cardsByOracleId) {
  const cached = hintCache.get(cardsByOracleId);
  if (cached) return cached;

  const tagStats = new Map();
  for (const card of cardsByOracleId.values()) {
    if (card.type_line.includes('Land')) continue;
    const roles = classifyRoles(card.oracle_tags);
    for (const tag of card.oracle_tags) {
      if (isEstablishedTag(tag)) continue;
      if (!tagStats.has(tag)) {
        tagStats.set(tag, { n: 0, roleCounts: Object.fromEntries(ROLE_KEYS.map((r) => [r, 0])) });
      }
      const stats = tagStats.get(tag);
      stats.n += 1;
      for (const role of ROLE_KEYS) if (roles[role]) stats.roleCounts[role] += 1;
    }
  }

  const hints = new Map();
  for (const [tag, stats] of tagStats) {
    if (stats.n < HINT_MIN_SAMPLE) continue;
    let topRole = null;
    let topCount = 0;
    for (const role of ROLE_KEYS) {
      if (stats.roleCounts[role] > topCount) {
        topRole = role;
        topCount = stats.roleCounts[role];
      }
    }
    const share = stats.n > 0 ? topCount / stats.n : 0;
    if (topRole && share >= HINT_MIN_SHARE) hints.set(tag, { role: topRole, share });
  }

  hintCache.set(cardsByOracleId, hints);
  return hints;
}

// Aplica anulações por deck (guardadas em deck.role_overrides, ver
// decklist.js: setRoleOverride) por cima da classificação automática.
// action "add": a carta conta para o papel mesmo sem tag estabelecida, e
// fica marcada como confirmada mesmo que já lá estivesse como incerta.
// action "confirm": só limpa a marca de incerteza, sem mudar inclusão -
// para o caso em que a sugestão automática já está certa. action
// "remove": a carta NÃO conta para o papel apesar da tag/sugestão. Nunca
// muda a regra global - só o que está guardado com este deck.
function applyOverrides(autoRoleCards, overrides, qtyByOracleId, cardsByOracleId) {
  if (!overrides || overrides.length === 0) return autoRoleCards;
  const result = {};
  for (const [role, list] of Object.entries(autoRoleCards)) result[role] = list.map((e) => ({ ...e }));
  for (const o of overrides) {
    const list = result[o.role];
    if (!list) continue;
    const idx = list.findIndex((e) => e.oracle_id === o.oracle_id);
    if (o.action === 'add') {
      if (idx === -1) {
        const card = cardsByOracleId.get(o.oracle_id);
        const qty = qtyByOracleId.get(o.oracle_id) ?? 1;
        if (card) list.push({ oracle_id: o.oracle_id, name: card.name, quantity: qty, uncertain: false });
      } else {
        list[idx].uncertain = false;
      }
    } else if (o.action === 'confirm' && idx !== -1) {
      list[idx].uncertain = false;
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
  const hints = buildTagRoleHints(cardsByOracleId);

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
    let hasEstablishedRole = false;
    for (const [role, included] of Object.entries(roles)) {
      if (included) {
        autoRoleCards[role].push({ ...entry, uncertain: false });
        hasEstablishedRole = true;
      }
    }

    // Sem nenhuma tag estabelecida: procura a sugestão mais forte entre as
    // outras tags da carta, marcada como incerta - nunca em silêncio
    // (§7.1). Sem sugestão que bata o limiar, fica legitimamente sem papel.
    if (!hasEstablishedRole) {
      let bestHint = null;
      for (const tag of tags) {
        const hint = hints.get(tag);
        if (hint && (!bestHint || hint.share > bestHint.share)) bestHint = hint;
      }
      if (bestHint) autoRoleCards[bestHint.role].push({ ...entry, uncertain: true });
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
