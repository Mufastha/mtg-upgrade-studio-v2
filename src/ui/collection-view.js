// Lógica pura por trás da lista da coleção em index.html - sem DOM, para dar
// para testar diretamente. app.js só faz a pintura a partir disto.
//
// `limit` corta as linhas a mostrar (a coleção real do Diogo tem ~3900
// entradas - mostrar tudo de uma vez não é "mínimo"), mas matchedCount e
// totalEntries continuam a refletir o total real, para o "mostrar mais"
// saber quanto falta.
export function buildCollectionRows(entries, cardsByOracleId, query, limit = Infinity) {
  const q = query.trim().toLowerCase();
  const matched = entries
    .map((e) => ({ ...e, card: cardsByOracleId.get(e.oracle_id) }))
    .filter((e) => !q || (e.card?.name.toLowerCase().includes(q) ?? false))
    .sort((a, b) => (a.card?.name ?? '').localeCompare(b.card?.name ?? ''));

  return {
    rows: matched.slice(0, limit),
    matchedCount: matched.length,
    totalEntries: entries.length,
    totalCopies: entries.reduce((sum, e) => sum + e.quantity, 0),
  };
}
