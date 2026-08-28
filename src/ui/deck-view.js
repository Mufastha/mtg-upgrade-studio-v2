import { validateCommanderDeck } from '../rules/commander-legality.js';
import { computeDeckMetrics } from '../rules/deck-metrics.js';

// Lógica pura por trás da lista de decks em index.html - sem DOM, para dar
// para testar diretamente. app.js só faz a pintura a partir disto.
export function buildDeckSummaries(decks, deckCards, cardsByOracleId) {
  const cardCountByDeck = new Map();
  for (const dc of deckCards) {
    cardCountByDeck.set(dc.deck_id, (cardCountByDeck.get(dc.deck_id) ?? 0) + dc.quantity);
  }

  return decks.map((d) => {
    const ownCards = deckCards.filter((dc) => dc.deck_id === d.deck_id);
    return {
      deck_id: d.deck_id,
      name: d.name,
      commanderName: cardsByOracleId.get(d.commander_oracle_id)?.name ?? '(sem commander)',
      cardCount: cardCountByDeck.get(d.deck_id) ?? 0,
      isPrecon: d.source_precon != null,
      preconName: d.source_precon?.name ?? null,
      // §7.0: nunca bloqueia, só informa - recalculado a cada render a
      // partir do estado atual do deck, nunca guardado.
      legality: validateCommanderDeck(d, ownCards, cardsByOracleId),
    };
  });
}

// §7.1 - computado sob demanda (só quando "Ver métricas" é aberto), não a
// cada render da lista como a legalidade (§7.0): é mais trabalho por deck e
// não precisa de estar sempre visível.
export function buildDeckMetrics(deckId, deckCards, cardsByOracleId) {
  const ownCards = deckCards.filter((dc) => dc.deck_id === deckId);
  return computeDeckMetrics(ownCards, cardsByOracleId);
}

export function buildDeckCardRows(deckId, deckCards, cardsByOracleId) {
  return deckCards
    .filter((dc) => dc.deck_id === deckId)
    .map((dc) => ({
      oracle_id: dc.oracle_id,
      name: cardsByOracleId.get(dc.oracle_id)?.name ?? dc.oracle_id,
      quantity: dc.quantity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
