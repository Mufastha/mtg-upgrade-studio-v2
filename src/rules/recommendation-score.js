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
import { getEstablishedRoleForTag } from './deck-metrics.js';

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

// Compara cartas do deck com candidatas pela MESMA fórmula (§8) - ordena o
// deck a subir (pior primeiro) e as candidatas a descer (melhor primeiro),
// empareia pior com melhor. Critério de paragem: maxChanges (§5, ainda
// sem UI - default explícito aqui, a substituir quando existir), nunca um
// score alvo. Corte sem substituto nunca acontece - o array de pares é a
// única saída.
export function generateRecommendations(
  deckCards,
  candidates,
  gamePlan,
  cardsByOracleId,
  { weights = DEFAULT_WEIGHTS, maxChanges = 10, commanderOracleId = null, untouchableIds = new Set() } = {}
) {
  const scoredDeck = deckCards
    .filter((dc) => dc.oracle_id !== commanderOracleId && !untouchableIds.has(dc.oracle_id))
    .map((dc) => {
      const card = cardsByOracleId.get(dc.oracle_id);
      return { card, quantity: dc.quantity, ...scoreCard(card, gamePlan, weights) };
    })
    .sort((a, b) => a.score - b.score);

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
