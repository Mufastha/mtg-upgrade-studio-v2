// Validação de legalidade do formato Commander (§7.0 da especificação).
// Nunca bloqueia nada - só produz avisos. Não confundir com as barreiras de
// bracket (§6, bracket-rules.json): isto é a legalidade do formato em si
// (100 cartas, singleton, identidade de cor, commander lendário).

const ANY_NUMBER_COPIES_RE = /a deck can have any number of cards named/i;
const CAN_BE_COMMANDER_RE = /can be your commander/i;
const REQUIRED_CARD_COUNT = 100;

function isBasicLand(card) {
  return card.type_line.includes('Basic Land');
}

function allowsMultipleCopies(card) {
  return ANY_NUMBER_COPIES_RE.test(card.oracle_text ?? '');
}

function isLegalCommander(card) {
  const isLegendaryCreature = card.type_line.includes('Legendary') && card.type_line.includes('Creature');
  return isLegendaryCreature || CAN_BE_COMMANDER_RE.test(card.oracle_text ?? '');
}

// color_identity vem do catálogo (§3.1), já calculado pela Scryfall a partir
// dos símbolos de mana no custo e no texto de regras - é exatamente a regra
// que o formato usa, sem reimplementar a leitura do oracle_text aqui.
export function validateCommanderDeck(deck, deckCards, cardsByOracleId) {
  const problems = [];
  const commander = deck.commander_oracle_id ? cardsByOracleId.get(deck.commander_oracle_id) : null;

  if (!commander) {
    problems.push({ card: null, message: 'Sem commander definido.' });
  } else if (!isLegalCommander(commander)) {
    problems.push({
      card: commander.name,
      message: 'Não é uma criatura lendária nem tem "can be your commander".',
    });
  }

  const totalCards = deckCards.reduce((sum, dc) => sum + dc.quantity, 0);
  if (totalCards !== REQUIRED_CARD_COUNT) {
    problems.push({
      card: null,
      message: `Deck tem ${totalCards} cartas, o formato exige exatamente ${REQUIRED_CARD_COUNT} (incluindo o commander).`,
    });
  }

  const commanderColors = new Set(commander?.color_identity ?? []);

  for (const dc of deckCards) {
    const card = cardsByOracleId.get(dc.oracle_id);
    if (!card) continue;

    if (commander && card.color_identity.some((c) => !commanderColors.has(c))) {
      const cardColors = card.color_identity.join('') || 'incolor';
      const cmdColors = [...commanderColors].join('') || 'incolor';
      problems.push({
        card: card.name,
        message: `Identidade de cor (${cardColors}) fora da do commander (${cmdColors}).`,
      });
    }

    if (dc.quantity > 1 && !isBasicLand(card) && !allowsMultipleCopies(card)) {
      problems.push({
        card: card.name,
        message: `${dc.quantity} cópias — só é permitida 1 (não é terreno básico nem permite múltiplas cópias).`,
      });
    }
  }

  return { legal: problems.length === 0, problems, totalCards };
}
