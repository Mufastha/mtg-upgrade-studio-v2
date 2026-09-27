// §8 Fase C - Scoring por mérito face ao plano de jogo (§7.2). O plano
// PONTUA, nunca filtra a Fase A: filtrar ao eixo de sinergia excluiria
// remoção/proteção/terrenos que o deck precisa sem ligação nenhuma ao
// tema (decisão do Diogo, 27 de setembro de 2026).
//
// synergy_tags do plano dividem-se em duas contagens, pesadas
// separadamente - nunca somadas com o mesmo peso:
// - eixo genuíno: tags que NÃO são papel do §7.1 (getEstablishedRoleForTag
//   devolve null) - o tema real do plano (synergy-equipment, quick-equip).
// - papel já coberto: tags que já são papel do §7.1 (draw-engine,
//   burst-draw...) - sem isto, dominam por serem categorias muito
//   maiores e afogam o eixo (testado: attacking-matters-self em 922
//   candidatas do pool Naya do Cloud, contra 135 de synergy-equipment).
//
// edhrec_rank NUNCA entra no score - é popularidade global, sem variante
// por identidade de cor nem por commander (confirmado na documentação da
// Scryfall), trazer isso para o score reproduziria o enviesamento que a
// app existe para evitar. Fica visível ao lado de cada carta, só como
// informação (decisão do Diogo, 27 de setembro de 2026).
import { getEstablishedRoleForTag, computeDeckMetrics, ROLE_TARGETS, LAND_TARGET } from './deck-metrics.js';

// Tentativos - sliders na UI, nunca constantes fixas (§8, §12). Eixo
// genuíno pesa mais do que papel já coberto por omissão; a relação entre
// os dois é o que se afina.
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

function countOverlap(cardTags, planTagList) {
  if (planTagList.length === 0) return 0;
  const set = new Set(planTagList);
  return cardTags.reduce((n, t) => n + (set.has(t) ? 1 : 0), 0);
}

export function scoreCard(card, gamePlan, weights = DEFAULT_WEIGHTS) {
  const { axis, role } = splitPlanTags(gamePlan?.synergy_tags);
  const axisOverlap = countOverlap(card.oracle_tags, axis);
  const roleOverlap = countOverlap(card.oracle_tags, role);
  const avoidOverlap = countOverlap(card.oracle_tags, gamePlan?.avoid_tags ?? []);
  const score = weights.axis * axisOverlap + weights.role * roleOverlap - weights.avoid * avoidOverlap;
  return { score, axisOverlap, roleOverlap, avoidOverlap };
}

// Elegibilidade de corte a partir das métricas do §7.1 - desempata por
// critério de jogo dentro do score de plano, nunca por posição/ordem de
// inserção (era o que estava a acontecer antes: 72% do Limit Break
// empatava a 0 e "pior primeiro" virava alfabético). Três categorias
// (Diogo, 27 de setembro de 2026), decididas sobre papel + folga, nunca
// sobre edhrec_rank:
//
// - "protegida": é a ÚNICA carta do deck a preencher algum papel com
//   alvo (§7.1) - nunca é candidata a corte, excluída por completo (como
//   `untouchable`, §5), independentemente do score de plano.
// - "primeira-a-sair": não ocupa papel nenhum E não tem sinergia com o
//   plano (score de plano 0) - o topo da fila de corte.
// - "legítima": ocupa pelo menos um papel com alvo e esse papel tem folga
//   (contagem do deck > alvo) - corte razoável, o papel continua servido
//   mesmo depois.
// - "sem-folga": ocupa papel(is) sem folga (contagem no alvo ou abaixo) e
//   não é a única - não protegida, mas cortá-la empurra o deck para
//   `missingRoles`; fica a seguir às legítimas, à frente de nada.
//
// "access" (Acesso Temporário) não tem alvo (§7.1) - nunca conta para
// proteção nem para folga, mas ainda conta como "ocupa papel" para não
// cair em "primeira-a-sair" à toa.
//
// Terrenos têm o próprio alvo (LAND_TARGET, §7.1) fora dos 9 papéis -
// tratados aqui como um "papel" sintético (`terrenos`) para caírem no
// mesmo mecanismo de folga/proteção, nunca em "primeira-a-sair": sem
// isto, todo terreno sem outro papel caía direto no topo do corte só por
// a métrica de terrenos viver fora de `roleCards` (encontrado a testar
// contra o Limit Break real - a lista de corte ficou cheia de terrenos).
function computeCutTiers(deckCards, cardsByOracleId, overrides = []) {
  const metrics = computeDeckMetrics(deckCards, cardsByOracleId, overrides);
  const tierByOracleId = new Map();
  const landSlack = metrics.landCount - LAND_TARGET;
  const isLandUnique = metrics.landCards.length === 1;

  for (const dc of deckCards) {
    const card = cardsByOracleId.get(dc.oracle_id);
    if (!card) continue;

    if (card.type_line.includes('Land')) {
      tierByOracleId.set(dc.oracle_id, {
        occupiedRoles: ['terrenos'],
        isUniqueFiller: isLandUnique,
        minSlack: landSlack,
      });
      continue;
    }

    const occupiedRoles = Object.keys(metrics.roleCards).filter((role) =>
      metrics.roleCards[role].some((e) => e.oracle_id === dc.oracle_id)
    );

    const isUniqueFiller = occupiedRoles.some((role) => {
      if (ROLE_TARGETS[role] == null) return false;
      return metrics.roleCards[role].length === 1;
    });

    const slacks = occupiedRoles
      .filter((role) => ROLE_TARGETS[role] != null)
      .map((role) => metrics.roleCounts[role] - ROLE_TARGETS[role]);
    const minSlack = slacks.length > 0 ? Math.min(...slacks) : null;

    tierByOracleId.set(dc.oracle_id, { occupiedRoles, isUniqueFiller, minSlack });
  }

  return tierByOracleId;
}

const TIER_ORDER = { 'primeira-a-sair': 0, legitima: 1, 'sem-folga': 2 };

function classifyTier(cutInfo, planScore) {
  if (cutInfo.occupiedRoles.length === 0 && planScore === 0) return 'primeira-a-sair';
  if (cutInfo.minSlack != null && cutInfo.minSlack > 0) return 'legitima';
  return 'sem-folga';
}

// Compara cartas do deck com candidatas pela MESMA fórmula de mérito
// (§8) - as candidatas ordenam-se só por score de plano (melhor
// primeiro); o corte ordena-se primeiro pela elegibilidade do §7.1
// (acima), depois por score de plano (pior primeiro) - nunca por posição.
// Critério de paragem: maxChanges (§5, ainda sem UI - default explícito
// aqui, a substituir quando existir), nunca um score alvo. Corte sem
// substituto nunca acontece - o array de pares é a única saída.
export function generateRecommendations(
  deckCards,
  candidates,
  gamePlan,
  cardsByOracleId,
  { weights = DEFAULT_WEIGHTS, maxChanges = 10, commanderOracleId = null, untouchableIds = new Set(), overrides = [] } = {}
) {
  const cutTiers = computeCutTiers(deckCards, cardsByOracleId, overrides);

  const scoredDeck = deckCards
    .filter((dc) => dc.oracle_id !== commanderOracleId && !untouchableIds.has(dc.oracle_id))
    .map((dc) => {
      const card = cardsByOracleId.get(dc.oracle_id);
      const scored = scoreCard(card, gamePlan, weights);
      const cutInfo = cutTiers.get(dc.oracle_id);
      const tier = classifyTier(cutInfo, scored.score);
      return { card, quantity: dc.quantity, ...scored, ...cutInfo, tier };
    })
    .filter((e) => !e.isUniqueFiller) // "protegida" - nunca candidata a corte
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.score - b.score || a.card.name.localeCompare(b.card.name));

  const scoredCandidates = candidates
    .map((card) => ({ card, ...scoreCard(card, gamePlan, weights) }))
    .sort((a, b) => b.score - a.score);

  const pairCount = Math.min(maxChanges, scoredDeck.length, scoredCandidates.length);
  const pairs = [];
  for (let i = 0; i < pairCount; i++) {
    pairs.push({ cut: scoredDeck[i], add: scoredCandidates[i] });
  }

  return { pairs, scoredDeck, scoredCandidates };
}
