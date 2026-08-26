import { streamJsonl } from './scryfall.mjs';
import { passesCatalogFilters } from './filters.mjs';

// Cartas com duas faces (transform, modal_dfc) têm mana_cost/oracle_text
// vazios no nível de topo - os valores reais estão em card_faces[].
function resolveTextFields(card) {
  if (card.oracle_text || !card.card_faces) {
    return { mana_cost: card.mana_cost ?? '', oracle_text: card.oracle_text ?? '' };
  }
  return {
    mana_cost: card.card_faces.map((f) => f.mana_cost).filter(Boolean).join(' // '),
    oracle_text: card.card_faces.map((f) => `${f.name}: ${f.oracle_text ?? ''}`).join('\n//\n'),
  };
}

export async function buildCatalog(oracleCardsUrl, gamechangerIds) {
  const catalog = new Map();
  await streamJsonl(oracleCardsUrl, (card) => {
    if (!passesCatalogFilters(card)) return;
    const { mana_cost, oracle_text } = resolveTextFields(card);
    catalog.set(card.oracle_id, {
      oracle_id: card.oracle_id,
      name: card.name,
      mana_cost,
      cmc: card.cmc,
      type_line: card.type_line ?? '',
      oracle_text,
      color_identity: card.color_identity ?? [],
      keywords: card.keywords ?? [],
      layout: card.layout,
      is_gamechanger: gamechangerIds.has(card.oracle_id),
      edhrec_rank: card.edhrec_rank ?? null,
      oracle_tags: [],
      price_eur_min: null,
      price_source_date: null,
      price_source_scryfall_id: null,
    });
  });
  return catalog;
}
