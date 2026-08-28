import { streamJsonl } from './scryfall.mjs';
import { EXCLUDED_LAYOUTS } from './filters.mjs';

// default_cards.jsonl tem uma entrada por impressão. Alimenta printings.json
// (§3.1) e, em paralelo, price_eur_min por oracle_id: prices.eur é o preço
// não-foil da Scryfall, por isso impressões só-foil (sem prices.eur) ficam
// de fora do cálculo naturalmente.
//
// Uma impressão cujo oracle_id não está no catálogo é uma impressão
// excluída na construção (legalidade ou layout, ver filters.mjs) - a razão
// fica registada em excluded.json para o importador da ManaBox explicar uma
// falha sem depender da rede (§4.1, invariante 10 - local-first).
export async function buildPrintings(defaultCardsUrl, catalog, priceSourceDate) {
  const printings = new Map();
  const excluded = new Map();

  await streamJsonl(defaultCardsUrl, (card) => {
    const entry = catalog.get(card.oracle_id);
    if (!entry) {
      const layoutExcluded = EXCLUDED_LAYOUTS.has(card.layout);
      excluded.set(card.id, {
        scryfall_id: card.id,
        oracle_id: card.oracle_id,
        reason: layoutExcluded ? 'excluded_layout' : 'not_legal_commander',
        detail: layoutExcluded ? card.layout : card.legalities?.commander ?? 'unknown',
        type_line: card.type_line,
      });
      return;
    }

    printings.set(card.id, {
      scryfall_id: card.id,
      oracle_id: card.oracle_id,
      set: card.set,
      collector_number: card.collector_number,
      cardmarket_uri: card.purchase_uris?.cardmarket ?? null,
    });

    if (card.prices?.eur == null) return;
    const price = Number(card.prices.eur);
    if (entry.price_eur_min == null || price < entry.price_eur_min) {
      entry.price_eur_min = price;
      entry.price_source_scryfall_id = card.id;
      entry.price_source_date = priceSourceDate;
    }
  });
  return { printings, excluded };
}
