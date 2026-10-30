import { getAll, putAll, deleteRecord } from '../db/idb.js';

// Apagar um deck leva as configurações dele (decklist.js: deleteDeck).

export async function saveDeckConfig(config) {
  await putAll('deck_configs', [config]);
}

export async function getDeckConfigs(deckId) {
  return (await getAll('deck_configs')).filter((c) => c.deck_id === deckId);
}

export async function deleteDeckConfig(configId) {
  await deleteRecord('deck_configs', configId);
}
