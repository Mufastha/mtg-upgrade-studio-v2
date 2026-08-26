import { streamJsonl } from './scryfall.mjs';

// default_cards.jsonl tem uma entrada por impressão. Alimenta printings.json
// (§3.1) e, em paralelo, price_eur_min por oracle_id: prices.eur é o preço
// não-foil da Scryfall, por isso impressões só-foil (sem prices.eur) ficam
// de fora do cálculo naturalmente.
export async function buildPrintings(defaultCardsUrl, catalog, priceSourceDate) {
  const printings = new Map();
  await streamJsonl(defaultCardsUrl, (card) => {
    const entry = catalog.get(card.oracle_id);
    if (!entry) return;

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
  return printings;
}
