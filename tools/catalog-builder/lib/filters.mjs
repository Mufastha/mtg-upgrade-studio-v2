// Objetos não jogáveis que passam por vezes legalities.commander === "legal"
// mesmo não sendo cartas de facto. Defesa em profundidade sobre o filtro de
// legalidade (ver §3.1 da especificação).
const EXCLUDED_LAYOUTS = new Set([
  'token',
  'double_faced_token',
  'emblem',
  'art_series',
  'memorabilia',
  'vanguard',
  'scheme',
  'planar',
  'phenomenon',
]);

export function passesCatalogFilters(card) {
  return card.legalities?.commander === 'legal' && !EXCLUDED_LAYOUTS.has(card.layout);
}
