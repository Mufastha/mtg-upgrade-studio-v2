// §8.1 Fase A (geração de candidatos) + §8.2 Fase B (filtros duros). Produz
// só um pool determinístico - nunca pontua. Cada passo é registado em
// sequência porque "quantos sobram depois de cada filtro" é o próprio
// contrato desta função, não um efeito secundário de debug.
//
// A configuração é obrigatória: as recomendações pertencem ao par (deck,
// configuração), nunca ao deck (invariante 8) - o bracket alvo, os tags a
// excluir e o resto vêm dela.
//
// Por implementar, nunca aplicado aqui em silêncio: enriquecimento por
// dados de commander do EDHREC (§8.1, por investigar).
import { bracketCandidateCheck } from './bracket.js';

function isColorIdentitySubset(cardColorIdentity, commanderColorIdentity) {
  const allowed = new Set(commanderColorIdentity);
  return cardColorIdentity.every((c) => allowed.has(c));
}

export function generateCandidates(cards, options) {
  const { commanderOracleId, deckOracleIds = new Set(), sourcePreconBaseCards = [], config, bracketRules } = options;
  if (!config) throw new Error('Gerar candidatas exige uma configuração de deck (§5).');
  if (!bracketRules) throw new Error('Gerar candidatas exige as regras de bracket (data/bracket-rules.json).');

  const commander = cards.find((c) => c.oracle_id === commanderOracleId);
  if (!commander) throw new Error('Commander não encontrado no catálogo.');

  const steps = [];
  const apply = (label, list, extra = {}) => {
    steps.push({ label, count: list.length, ...extra });
    return list;
  };

  let pool = apply('Catálogo completo (já restrito a legal em Commander na build, §3.1)', cards);

  pool = apply(
    `Identidade de cor ⊆ ${commander.color_identity.join('') || 'incolor'} (${commander.name})`,
    pool.filter((c) => isColorIdentitySubset(c.color_identity, commander.color_identity))
  );

  pool = apply('Exclui o próprio commander', pool.filter((c) => c.oracle_id !== commanderOracleId));

  const excludeIds = new Set([...deckOracleIds, ...sourcePreconBaseCards]);
  pool = apply('Exclui cartas já no deck e base_cards do precon (§4.3)', pool.filter((c) => !excludeIds.has(c.oracle_id)));

  // Barreiras do bracket alvo (§6). Uma carta permitida mas que precisa de
  // verificação à mão (turno extra em B2/B3) continua, com a razão anotada.
  const currentGameChangers = cards.filter((c) => deckOracleIds.has(c.oracle_id) && c.is_gamechanger).length;
  const excludedByReason = {};
  const reviewByOracleId = new Map();
  pool = pool.filter((card) => {
    const check = bracketCandidateCheck(card, bracketRules, config.target_bracket, currentGameChangers);
    if (check.excluded) {
      excludedByReason[check.excluded] = (excludedByReason[check.excluded] ?? 0) + 1;
      return false;
    }
    if (check.review) reviewByOracleId.set(card.oracle_id, check.review);
    return true;
  });
  const bracketName = bracketRules.brackets[String(config.target_bracket)].name;
  apply(`Barreiras do bracket ${config.target_bracket} (${bracketName}, §6)`, pool, { excludedByReason });

  if (config.exclude_tags.length > 0) {
    pool = apply(
      `exclude_tags (§5): ${config.exclude_tags.join(', ')}`,
      pool.filter((c) => !c.oracle_tags.some((t) => config.exclude_tags.includes(t)))
    );
  }

  if (config.max_cmc != null) {
    pool = apply(`max_cmc ≤ ${config.max_cmc} (§5)`, pool.filter((c) => c.cmc <= config.max_cmc));
  }

  if (config.exclude_reserved_list) {
    if (cards.some((c) => !('reserved' in c))) {
      // Catálogo de um build anterior a 27 set 2026, sem o campo - o filtro
      // não se aplica e o passo di-lo, nunca finge que filtrou.
      apply('Reserved List: campo ausente no catálogo - NÃO aplicado', pool);
    } else {
      pool = apply('Exclui a Reserved List (§5)', pool.filter((c) => !c.reserved));
    }
  }

  return { commander, steps, candidates: pool, reviewByOracleId, currentGameChangers };
}
