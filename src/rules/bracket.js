// Barreiras de bracket (§6). As regras vêm de data/bracket-rules.json
// (invariante 5) - este módulo só as aplica. Três estados por linha:
// pass, fail, review (invariante 7) - nunca pass sem ter verificado.

function bracketOf(rules, targetBracket) {
  const bracket = rules.brackets[String(targetBracket)];
  if (!bracket) throw new Error(`Bracket desconhecido: ${targetBracket}`);
  return bracket;
}

function hasTag(card, tag) {
  return card.oracle_tags.includes(tag);
}

// Checklist do §6.1 sobre um conjunto de cartas (o deck atual ou o deck
// projetado depois de um lote de trocas - §6.2).
export function evaluateBracketChecklist(cards, rules, targetBracket) {
  const bracket = bracketOf(rules, targetBracket);
  const { mass_land_denial_tag: mldTag, extra_turn_tag: extraTurnTag } = rules.detection;
  const rows = [];

  const gameChangers = cards.filter((c) => c.is_gamechanger).map((c) => c.name);
  const gcMax = bracket.game_changers_max;
  rows.push({
    criterion: 'Game Changers',
    state: gcMax == null || gameChangers.length <= gcMax ? 'pass' : 'fail',
    detail: gcMax == null ? `${gameChangers.length}, sem limite` : `${gameChangers.length} de ${gcMax} permitidos`,
    cards: gameChangers,
  });

  const mld = cards.filter((c) => hasTag(c, mldTag)).map((c) => c.name);
  rows.push({
    criterion: 'Mass land denial',
    state: bracket.mass_land_denial === 'forbidden' && mld.length > 0 ? 'fail' : 'pass',
    detail: bracket.mass_land_denial === 'forbidden' ? `proibido, ${mld.length} no deck` : 'permitido',
    cards: mld,
  });

  const extraTurns = cards.filter((c) => hasTag(c, extraTurnTag)).map((c) => c.name);
  let extraTurnState = 'pass';
  let extraTurnDetail = 'permitido';
  if (bracket.extra_turns === 'forbidden') {
    extraTurnState = extraTurns.length > 0 ? 'fail' : 'pass';
    extraTurnDetail = `proibido, ${extraTurns.length} no deck`;
  } else if (bracket.extra_turns === 'no_chaining') {
    // Poucos e sem encadear: a contagem não diz se encadeiam - não é pass.
    extraTurnState = extraTurns.length > 0 ? 'review' : 'pass';
    extraTurnDetail = extraTurns.length > 0
      ? `${extraTurns.length} no deck - encadeamento não verificável a partir da lista`
      : 'nenhum no deck';
  }
  rows.push({ criterion: 'Turnos extra', state: extraTurnState, detail: extraTurnDetail, cards: extraTurns });

  rows.push({
    criterion: 'Combos de 2 cartas',
    state: bracket.two_card_combos === 'allowed' ? 'pass' : 'review',
    detail: bracket.two_card_combos === 'allowed'
      ? 'permitido'
      : 'sem dados de combos (Commander Spellbook, Fase 5) - por verificar à mão',
    cards: [],
  });

  rows.push({
    criterion: 'Turno de fim',
    state: bracket.expected_turns_min == null ? 'pass' : 'review',
    detail: bracket.expected_turns_min == null
      ? 'sem expectativa'
      : `esperado ${bracket.expected_turns_min}+ - não determinável a partir da lista`,
    cards: [],
  });

  return { bracket: targetBracket, name: bracket.name, rows };
}

// Filtro por carta da Fase B (§8.2). currentGameChangers é a contagem do
// deck atual: com o deck no limite, nenhum Game Changer entra como
// candidata. O limite ao longo de um lote de várias trocas é verificado na
// avaliação do lote (§8.4), não aqui.
export function bracketCandidateCheck(card, rules, targetBracket, currentGameChangers) {
  const bracket = bracketOf(rules, targetBracket);
  const { mass_land_denial_tag: mldTag, extra_turn_tag: extraTurnTag } = rules.detection;

  if (card.is_gamechanger && bracket.game_changers_max != null && currentGameChangers >= bracket.game_changers_max) {
    return { excluded: `Game Changer com o deck já no limite (${currentGameChangers}/${bracket.game_changers_max})` };
  }
  if (bracket.mass_land_denial === 'forbidden' && hasTag(card, mldTag)) {
    return { excluded: 'mass land denial proibido no bracket' };
  }
  if (bracket.extra_turns === 'forbidden' && hasTag(card, extraTurnTag)) {
    return { excluded: 'turnos extra proibidos no bracket' };
  }
  if (bracket.extra_turns === 'no_chaining' && hasTag(card, extraTurnTag)) {
    return { excluded: null, review: 'turno extra - verificar que não encadeia' };
  }
  return { excluded: null };
}
