// §8 Fase A (geração de candidatos) + Fase B (filtros duros). Produz só um
// pool determinístico - nunca pontua (Fase C, por implementar). Cada passo
// é registado em sequência porque "quantos sobram depois de cada filtro" é
// o próprio contrato desta função, não um efeito secundário de debug.
//
// Gaps conhecidos, por implementar mais tarde, nunca aplicados aqui em
// silêncio:
// - Reserved List: o catálogo (§3.1) não guarda o campo `reserved` da
//   Scryfall - falta acrescentar ao catalog-builder antes deste filtro
//   poder existir.
// - Barreiras do bracket alvo (§6) e EDHREC (Fase A): dependem de
//   deck_config (§5), ainda sem UI nem armazenamento - não aplicadas.

function isColorIdentitySubset(cardColorIdentity, commanderColorIdentity) {
  const allowed = new Set(commanderColorIdentity);
  return cardColorIdentity.every((c) => allowed.has(c));
}

export function generateCandidates(cards, options) {
  const {
    commanderOracleId,
    deckOracleIds = new Set(),
    sourcePreconBaseCards = [],
    excludeTags = [],
    maxCmc = null,
  } = options;

  const commander = cards.find((c) => c.oracle_id === commanderOracleId);
  if (!commander) throw new Error('Commander não encontrado no catálogo.');

  const steps = [];
  const apply = (label, list) => {
    steps.push({ label, count: list.length });
    return list;
  };

  let pool = apply(
    'Catálogo completo (já restrito a legal em Commander na build, §3.1)',
    cards
  );

  pool = apply(
    `Identidade de cor ⊆ ${commander.color_identity.join('') || 'incolor'} (Fase A, ${commander.name})`,
    pool.filter((c) => isColorIdentitySubset(c.color_identity, commander.color_identity))
  );

  pool = apply('Exclui o próprio commander', pool.filter((c) => c.oracle_id !== commanderOracleId));

  const excludeIds = new Set([...deckOracleIds, ...sourcePreconBaseCards]);
  pool = apply(
    'Exclui cartas já no deck e base_cards do precon (§4.3)',
    pool.filter((c) => !excludeIds.has(c.oracle_id))
  );

  if (excludeTags.length > 0) {
    pool = apply(
      `exclude_tags (§5): ${excludeTags.join(', ')}`,
      pool.filter((c) => !c.oracle_tags.some((t) => excludeTags.includes(t)))
    );
  }

  if (maxCmc != null) {
    pool = apply(`max_cmc ≤ ${maxCmc} (§5)`, pool.filter((c) => c.cmc <= maxCmc));
  }

  return { commander, steps, candidates: pool };
}
