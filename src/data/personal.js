import { getAll, clearStore, putAll } from '../db/idb.js';

export const FORMAT = 'mtg-upgrade-studio-export';

// P2: dados pessoais são coleção, decks e configurações - nunca o catálogo
// (referência, re-descarregável).
const PERSONAL_STORES = ['collection', 'decks', 'deck_cards', 'deck_configs'];

export async function exportPersonalData() {
  const stores = {};
  for (const name of PERSONAL_STORES) {
    stores[name] = await getAll(name);
  }
  return {
    format: FORMAT,
    version: 1,
    exported_at: new Date().toISOString(),
    stores,
  };
}

export async function importPersonalData(bundle) {
  if (bundle?.format !== FORMAT) {
    throw new Error('Ficheiro não reconhecido: não é um export do MTG Upgrade Studio.');
  }
  // Importar substitui tudo: uma store ausente no ficheiro (export anterior
  // a deck_configs existir) fica vazia, em vez de manter configurações de
  // decks que já não existem.
  for (const name of PERSONAL_STORES) {
    await clearStore(name);
    await putAll(name, bundle.stores?.[name] ?? []);
  }
}
