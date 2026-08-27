// Lógica pura por trás da lista da coleção em index.html - sem DOM, para dar
// para testar diretamente. app.js só faz a pintura a partir disto.
export function buildCollectionRows(entries, cardsByOracleId, query) {
  const q = query.trim().toLowerCase();
  const rows = entries
    .map((e) => ({ ...e, card: cardsByOracleId.get(e.oracle_id) }))
    .filter((e) => !q || (e.card?.name.toLowerCase().includes(q) ?? false))
    .sort((a, b) => (a.card?.name ?? '').localeCompare(b.card?.name ?? ''));

  return {
    rows,
    totalEntries: entries.length,
    totalCopies: entries.reduce((sum, e) => sum + e.quantity, 0),
  };
}
