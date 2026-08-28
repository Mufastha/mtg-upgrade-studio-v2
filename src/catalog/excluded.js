import { syncStore } from './sync.js';

const CATALOG_BASE = new URL('../../catalog/', import.meta.url);

async function fetchExcludedRecords(base) {
  const res = await fetch(new URL('excluded.json', base));
  if (!res.ok) throw new Error(`Não foi possível obter excluded.json (HTTP ${res.status})`);
  return res.json();
}

// Só deve ser chamado pelo relatório de falhas do importador da ManaBox
// (§4.1), nunca no arranque da app. Guarda a razão pela qual cada impressão
// ficou fora do catálogo (legalidade ou layout, decidido na build) - é o
// que permite explicar uma falha sem pedir nada à Scryfall em tempo real
// (invariante 10, local-first).
export async function loadExcluded() {
  const { records, manifest, offline } = await syncStore({
    storeName: 'excluded',
    catalogBase: CATALOG_BASE,
    fetchRecords: fetchExcludedRecords,
  });
  return { excluded: records, manifest, offline };
}
