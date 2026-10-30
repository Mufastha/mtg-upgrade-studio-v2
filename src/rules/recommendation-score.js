// §8.3 Fase C (relevância) e §8.4 (cortes, emparelhamento, lote).
//
// Relevância: sobreposição de tags/tipo com o plano de jogo (§7.2). O
// plano pontua, nunca filtra a Fase A, e só um plano guardado pelo Diogo
// conta - sem plano curado, não há recomendações (a semente do commander
// media parecença com ele, §8.0). Dentro do plano, as tags que são papel
// do §7.1 pesam menos do que o eixo. Ainda sem sinal de força (§8.3).
//
// edhrec_rank NUNCA entra no score nem no desempate - é popularidade global,
// sem variante por identidade de cor nem por commander. Fica ao lado de
// cada carta, só como informação.
import {
  getEstablishedRoleForTag,
  computeDeckMetrics,
  cardRoles,
  ROLE_TARGETS,
  LAND_TARGET,
} from './deck-metrics.js';
import { evaluateBracketChecklist } from './bracket.js';

// Tentativos - sliders na UI, nunca constantes fixas (§8.3, §12).
export const DEFAULT_WEIGHTS = { axis: 3, role: 1, avoid: 2 };

function splitPlanTags(synergyTags) {
  const axis = [];
  const role = [];
  for (const tag of synergyTags ?? []) {
    if (getEstablishedRoleForTag(tag)) role.push(tag);
    else axis.push(tag);
  }
  return { axis, role };
}

function matchedTags(cardTags, planTagList) {
  if (planTagList.length === 0) return [];
  const set = new Set(planTagList);
  return cardTags.filter((t) => set.has(t));
}

// "synergy-X"/"typal-X" marcam cartas que se dão bem com X; o X em si (um
// Equipment, um Soldier) não carrega a tag, tem o TIPO. Procura a palavra
// depois do prefixo como palavra inteira no type_line - só acerta quando é
// tipo/subtipo literal (equipment, artifact, soldier...);
// synergy-graveyard/-historic nunca batem por esta via (§12).
const TYPE_AXIS_PREFIXES = ['synergy-', 'typal-'];

function typeLineWords(typeLine) {
  return new Set((typeLine ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean));
}

function matchedTypeAxisWords(typeLine, axisTags) {
  const synergyTypeWords = axisTags.flatMap((t) => {
    const prefix = TYPE_AXIS_PREFIXES.find((p) => t.startsWith(p));
    return prefix ? [t.slice(prefix.length)] : [];
  });
  if (synergyTypeWords.length === 0) return [];
  const words = typeLineWords(typeLine);
  return synergyTypeWords.filter((w) => words.has(w));
}

// Devolve, além do score, as tags/palavras que bateram - a justificação
// (§8.5) diz O QUÊ, nunca só o número.
export function scoreCard(card, gamePlan, weights = DEFAULT_WEIGHTS) {
  const { axis, role } = splitPlanTags(gamePlan?.synergy_tags);
  const axisTagsMatched = matchedTags(card.oracle_tags, axis);
  const axisTypeMatched = matchedTypeAxisWords(card.type_line, axis);
  const axisOverlap = axisTagsMatched.length + axisTypeMatched.length;
  const roleTagsMatched = matchedTags(card.oracle_tags, role);
  const roleOverlap = roleTagsMatched.length;
  const avoidTagsMatched = matchedTags(card.oracle_tags, gamePlan?.avoid_tags ?? []);
  const avoidOverlap = avoidTagsMatched.length;
  const score = weights.axis * axisOverlap + weights.role * roleOverlap - weights.avoid * avoidOverlap;
  return {
    score,
    axisOverlap,
    roleOverlap,
    avoidOverlap,
    axisTagOverlap: axisTagsMatched.length,
    axisTypeOverlap: axisTypeMatched.length,
    axisTagsMatched,
    axisTypeMatched,
    roleTagsMatched,
    avoidTagsMatched,
  };
}

// Terrenos têm alvo próprio (LAND_TARGET), fora dos papéis do §7.1 - aqui
// contam como um "papel" sintético para o mesmo mecanismo de folga.
const LAND_ROLE = 'terrenos';
const targetOf = (role) => (role === LAND_ROLE ? LAND_TARGET : ROLE_TARGETS[role]);
const isLand = (card) => card.type_line.includes('Land');

function rolesOfCandidate(card, cardsByOracleId) {
  return isLand(card) ? [LAND_ROLE] : cardRoles(card, cardsByOracleId);
}

// Estado do deck num ponto do lote: contagem por papel (incluindo
// terrenos), cartas por papel, e Game Changers.
function deckState(deckList, cardsByOracleId, overrides) {
  const metrics = computeDeckMetrics(deckList, cardsByOracleId, overrides);
  const counts = { ...metrics.roleCounts, [LAND_ROLE]: metrics.landCount };
  const cardsInRole = { ...metrics.roleCards, [LAND_ROLE]: metrics.landCards };
  const gameChangers = deckList.filter((dc) => cardsByOracleId.get(dc.oracle_id)?.is_gamechanger).length;
  return { metrics, counts, cardsInRole, gameChangers };
}

function occupiedRolesOf(oracleId, state) {
  return Object.keys(state.cardsInRole).filter((role) => state.cardsInRole[role].some((e) => e.oracle_id === oracleId));
}

// Elegibilidade de corte (§8.4), sempre sobre o deck no estado atual do
// lote - a folga gasta por uma troca já não está disponível à seguinte.
// - protegida: única carta num papel com alvo (ou único terreno) - nunca
//   candidata.
// - sem-papel-reconhecido: nenhum papel do §7.1 e nenhuma tag do plano. Não
//   quer dizer que a carta é fraca - quer dizer que está fora do nosso
//   vocabulário (Red XIII, §8.0).
// - por-folga: ocupa papel(is) com folga sobre o alvo - depende de alvos
//   escritos à mão, ainda não validados.
// - sem-folga: ocupa papel no alvo, abaixo dele, ou só papéis sem alvo
//   (Acesso Temporário), e não é a única - por último.
// "access" não tem alvo: nunca protege nem dá folga, mas conta como papel.
const TIER_ORDER = { 'sem-papel-reconhecido': 0, 'por-folga': 1, 'sem-folga': 2 };

export const CONFIDENCE_BY_TIER = {
  'sem-papel-reconhecido': 'sem papel reconhecido — fora do vocabulário do §7.1 e do plano, não quer dizer que seja fraca',
  'por-folga': 'por folga — depende de um alvo do §7.1 ainda por validar',
  'sem-folga': 'sem folga — ocupa papel no alvo, abaixo dele, ou sem alvo definido; fica para o fim',
};

// Uma troca tira UMA cópia (terrenos básicos vêm em pilha). "Única no
// papel" conta cópias, não entradas - um Forest ×36 não é o único terreno.
function cutInfoOf(oracleId, state) {
  const occupiedRoles = occupiedRolesOf(oracleId, state);
  const withTarget = occupiedRoles.filter((role) => targetOf(role) != null);
  const isUniqueFiller = withTarget.some((role) => state.counts[role] === 1);
  const slacks = withTarget.map((role) => state.counts[role] - targetOf(role));
  const minSlack = slacks.length > 0 ? Math.min(...slacks) : null;
  return { occupiedRoles, isUniqueFiller, minSlack };
}

function classifyTier(cutInfo, planScore) {
  if (cutInfo.occupiedRoles.length === 0 && planScore === 0) return 'sem-papel-reconhecido';
  if (cutInfo.minSlack != null && cutInfo.minSlack > 0) return 'por-folga';
  return 'sem-folga';
}

const byName = (a, b) => a.card.name.localeCompare(b.card.name);

// Papéis que um corte deixaria abaixo do alvo - a adição tem de os repor.
function rolesNeedingReplacement(cut, state) {
  return cut.occupiedRoles.filter((role) => {
    const target = targetOf(role);
    return target != null && state.counts[role] - 1 < target;
  });
}

// Uma troca é válida se não cria nenhuma falta nova contra os alvos do §7.1
// (um papel que estava no alvo não pode ficar abaixo) nem passa o limite de
// Game Changers do bracket (§6).
function swapViolation(cut, add, state, gameChangersMax) {
  const gcAfter = state.gameChangers - (cut.card.is_gamechanger ? 1 : 0) + (add.card.is_gamechanger ? 1 : 0);
  if (add.card.is_gamechanger && gameChangersMax != null && gcAfter > gameChangersMax) {
    return `passa o limite de Game Changers (${gcAfter}/${gameChangersMax})`;
  }
  const affected = new Set([...cut.occupiedRoles, ...add.roles]);
  for (const role of affected) {
    const target = targetOf(role);
    if (target == null) continue;
    const after = state.counts[role] - (cut.occupiedRoles.includes(role) ? 1 : 0) + (add.roles.includes(role) ? 1 : 0);
    if (state.counts[role] >= target && after < target) return `deixa ${role} abaixo do alvo (${after}/${target})`;
  }
  return null;
}

function averageCmc(deckList, cardsByOracleId) {
  let total = 0;
  let n = 0;
  for (const dc of deckList) {
    const card = cardsByOracleId.get(dc.oracle_id);
    if (!card || isLand(card)) continue;
    total += card.cmc * dc.quantity;
    n += dc.quantity;
  }
  return n > 0 ? total / n : 0;
}

// Trocas escolhidas uma a uma sobre o deck que vai mudando (§8.4):
// 1. o melhor corte elegível no estado atual (tier, depois score de plano,
//    depois nome como último recurso determinístico);
// 2. a melhor adição PARA ESSE CORTE - se o corte deixaria um papel abaixo
//    do alvo, só servem adições desse papel; nenhuma troca cria faltas
//    novas nem passa o limite de Game Changers;
// 3. a troca aplica-se ao deck antes de escolher a seguinte.
// Um corte sem adição válida não aparece (corte sem substituto é
// recomendação incompleta) - fica em `skipped`, com a razão.
// Com o deck acima do limite de Game Changers, os cortes forçados vêm
// primeiro: só Game Changers são candidatos a corte até o deck caber.
// No fim, o lote é avaliado como deck: papéis, terrenos, curva e a
// checklist de bracket antes e depois (§6.2).
export function generateRecommendations(deckCards, candidates, gamePlan, cardsByOracleId, options) {
  const {
    config,
    bracketRules,
    commanderOracleId = null,
    overrides = [],
    weights = DEFAULT_WEIGHTS,
    reviewByOracleId = new Map(),
  } = options;
  if (!config) throw new Error('Recomendações exigem uma configuração de deck (§5).');
  if (!bracketRules) throw new Error('Recomendações exigem as regras de bracket (§6).');
  if (!gamePlan?.synergy_tags?.length) {
    throw new Error('Plano de jogo por confirmar: guarda os eixos do deck (§7.2) antes de pedir recomendações.');
  }

  const gameChangersMax = bracketRules.brackets[String(config.target_bracket)].game_changers_max;
  const untouchable = new Set(config.untouchable);

  const scoredCandidates = candidates
    .map((card) => ({
      card,
      ...scoreCard(card, gamePlan, weights),
      roles: rolesOfCandidate(card, cardsByOracleId),
      review: reviewByOracleId.get(card.oracle_id) ?? null,
    }))
    .sort((a, b) => b.score - a.score || byName(a, b));

  const current = new Map(deckCards.map((dc) => [dc.oracle_id, dc.quantity]));
  const toList = () => [...current].map(([oracle_id, quantity]) => ({ oracle_id, quantity }));
  const addedIds = new Set();
  const skippedIds = new Set();
  const pairs = [];
  const skipped = [];

  while (pairs.length < config.max_changes) {
    const state = deckState(toList(), cardsByOracleId, overrides);
    const forcedGameChangerCuts = gameChangersMax != null && state.gameChangers > gameChangersMax;

    const cuts = toList()
      .filter((dc) => dc.oracle_id !== commanderOracleId)
      .filter((dc) => !untouchable.has(dc.oracle_id) && !addedIds.has(dc.oracle_id) && !skippedIds.has(dc.oracle_id))
      .map((dc) => {
        const card = cardsByOracleId.get(dc.oracle_id);
        const scored = scoreCard(card, gamePlan, weights);
        const info = cutInfoOf(dc.oracle_id, state);
        const tier = classifyTier(info, scored.score);
        return { card, quantity: dc.quantity, ...scored, ...info, tier, confidence: CONFIDENCE_BY_TIER[tier] };
      })
      .filter((c) => !c.isUniqueFiller)
      .filter((c) => !forcedGameChangerCuts || c.card.is_gamechanger)
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.score - b.score || byName(a, b));

    const cut = cuts[0];
    if (!cut) break;

    const needRoles = rolesNeedingReplacement(cut, state);
    let add = null;
    let lastViolation = null;
    for (const candidate of scoredCandidates) {
      if (addedIds.has(candidate.card.oracle_id)) continue;
      if (!needRoles.every((role) => candidate.roles.includes(role))) continue;
      const violation = swapViolation(cut, candidate, state, gameChangersMax);
      if (violation) {
        lastViolation = violation;
        continue;
      }
      add = candidate;
      break;
    }

    if (!add) {
      skippedIds.add(cut.card.oracle_id);
      skipped.push({
        cut,
        reason: needRoles.length > 0
          ? `nenhuma candidata repõe ${needRoles.join(', ')}`
          : `nenhuma candidata válida${lastViolation ? ` (${lastViolation})` : ''}`,
      });
      continue;
    }

    const cutRolesWithTarget = cut.occupiedRoles.filter((role) => targetOf(role) != null);
    pairs.push({
      cut,
      add,
      needRoles,
      replacedRoles: cutRolesWithTarget.filter((role) => add.roles.includes(role)),
      unreplacedRoles: cutRolesWithTarget
        .filter((role) => !add.roles.includes(role))
        .map((role) => ({ role, after: state.counts[role] - 1, target: targetOf(role) })),
    });

    if (cut.quantity > 1) current.set(cut.card.oracle_id, cut.quantity - 1);
    else current.delete(cut.card.oracle_id);
    current.set(add.card.oracle_id, (current.get(add.card.oracle_id) ?? 0) + 1);
    addedIds.add(add.card.oracle_id);
  }

  const beforeList = deckCards.map((dc) => ({ oracle_id: dc.oracle_id, quantity: dc.quantity }));
  const afterList = toList();
  const summarize = (list) => {
    const state = deckState(list, cardsByOracleId, overrides);
    const cards = list.flatMap((dc) => Array(dc.quantity).fill(cardsByOracleId.get(dc.oracle_id)));
    return {
      counts: state.counts,
      gameChangers: state.gameChangers,
      averageCmc: averageCmc(list, cardsByOracleId),
      manaCurve: state.metrics.manaCurve,
      missingRoles: state.metrics.missingRoles,
      checklist: evaluateBracketChecklist(cards, bracketRules, config.target_bracket),
    };
  };

  return {
    pairs,
    skipped,
    scoredCandidates,
    batch: { before: summarize(beforeList), after: summarize(afterList) },
  };
}
