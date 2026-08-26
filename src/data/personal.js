import { getAll, clearStore, putAll } from '../db/idb.js';

const FORMAT = 'mtg-upgrade-studio-export';

// P2: dados pessoais são coleção, decks e configurações - nunca o catálogo
// (referência, re-descarregável). deck_configs entra aqui quando existir
// (§5); por agora só há collection/decks/deck_cards.
const PERSONAL_STORES = ['collection', 'decks', 'deck_cards'];

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
  for (const name of PERSONAL_STORES) {
    const records = bundle.stores?.[name];
    if (!records) continue;
    await clearStore(name);
    await putAll(name, records);
  }
}
