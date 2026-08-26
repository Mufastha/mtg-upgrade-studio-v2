import { getMeta, setMeta, putAll, clearStore, getAll } from '../db/idb.js';

async function fetchManifest(catalogBase) {
  const res = await fetch(new URL('manifest.json', catalogBase));
  if (!res.ok) throw new Error(`Não foi possível obter manifest.json (HTTP ${res.status})`);
  return res.json();
}

// Sincroniza uma store com o manifest publicado: só volta a descarregar
// quando manifest.version muda (§3.2). Se a rede falhar mas já houver cache,
// usa a cache em vez de rebentar - é o que torna a app local-first depois do
// primeiro carregamento (invariante 10 no CLAUDE.md).
export async function syncStore({ storeName, catalogBase, fetchRecords }) {
  let manifest;
  try {
    manifest = await fetchManifest(catalogBase);
  } catch (err) {
    const cached = await getAll(storeName);
    if (cached.length > 0) {
      return { records: cached, manifest: await getMeta(`${storeName}_manifest`), offline: true };
    }
    throw err;
  }

  const versionKey = `${storeName}_version`;
  if ((await getMeta(versionKey)) === manifest.version) {
    return { records: await getAll(storeName), manifest, offline: false };
  }

  const records = await fetchRecords(catalogBase);
  await clearStore(storeName);
  await putAll(storeName, records);
  await setMeta(versionKey, manifest.version);
  await setMeta(`${storeName}_manifest`, manifest);

  return { records, manifest, offline: false };
}
