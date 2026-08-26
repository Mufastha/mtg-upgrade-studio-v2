import { syncStore } from './sync.js';

const CATALOG_BASE = new URL('../../catalog/', import.meta.url);

async function fetchPrintingsRecords(base) {
  const res = await fetch(new URL('printings.json', base));
  if (!res.ok) throw new Error(`Não foi possível obter printings.json (HTTP ${res.status})`);
  // Sem descompressão manual aqui: o ficheiro não é pré-comprimido, mas o
  // GitHub Pages aplica Content-Encoding: gzip em trânsito e o fetch() já
  // devolve JSON descomprimido.
  return res.json();
}

// Só deve ser chamado pelo importador da ManaBox (§4.1), nunca no arranque
// da app - printings.json tem 32MB em disco (invariante 11 no CLAUDE.md).
// Nada em loader.js referencia este módulo.
export async function loadPrintings() {
  const { records, manifest, offline } = await syncStore({
    storeName: 'printings',
    catalogBase: CATALOG_BASE,
    fetchRecords: fetchPrintingsRecords,
  });
  return { printings: records, manifest, offline };
}
