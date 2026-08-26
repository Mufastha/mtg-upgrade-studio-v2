import { syncStore } from './sync.js';

// Resolve para <site>/catalog/ independentemente de sub-caminho (Pages de
// projeto serve em /<repo>/) ou de onde a app corre localmente.
const CATALOG_BASE = new URL('../../catalog/', import.meta.url);

async function fetchCatalogRecords(base) {
  const res = await fetch(new URL('catalog.json.gz', base));
  if (!res.ok) throw new Error(`Não foi possível obter catalog.json.gz (HTTP ${res.status})`);
  // catalog.json.gz é gzip como formato de ficheiro (Content-Type:
  // application/gzip, sem Content-Encoding) - chega ao browser ainda
  // comprimido. DecompressionStream é nativo, sem dependência nova.
  const decompressed = res.body.pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(decompressed).text();
  return JSON.parse(text);
}

export async function loadCatalog() {
  const { records, manifest, offline } = await syncStore({
    storeName: 'catalog',
    catalogBase: CATALOG_BASE,
    fetchRecords: fetchCatalogRecords,
  });
  return { cards: records, manifest, offline };
}
