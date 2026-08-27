const DB_NAME = 'mtg-upgrade-studio';
const DB_VERSION = 3;

// Só as stores usadas até agora. deck_configs e runs (§3.3) entram com o
// motor de recomendação.
//
// collection usa chave composta (scryfall_id, foil): o export da ManaBox tem
// foil e não-foil da mesma impressão sob o MESMO scryfall_id (é a Scryfall a
// tratá-los como o mesmo objeto, com finishes[] a listar os acabamentos) -
// chavear só por scryfall_id perderia uma das duas quantidades ao gravar.
const STORES = {
  catalog: 'oracle_id',
  printings: 'scryfall_id',
  collection: ['scryfall_id', 'foil'],
  decks: 'deck_id',
  deck_cards: ['deck_id', 'oracle_id'],
  meta: 'key',
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key) {
  const db = await openDb();
  const record = await request(db.transaction('meta', 'readonly').objectStore('meta').get(key));
  return record?.value ?? null;
}

export async function setMeta(key, value) {
  const db = await openDb();
  await request(db.transaction('meta', 'readwrite').objectStore('meta').put({ key, value }));
}

export async function putAll(storeName, records) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const record of records) store.put(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStore(storeName) {
  const db = await openDb();
  await request(db.transaction(storeName, 'readwrite').objectStore(storeName).clear());
}

export async function getAll(storeName) {
  const db = await openDb();
  return request(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function getRecord(storeName, key) {
  const db = await openDb();
  return request(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function deleteRecord(storeName, key) {
  const db = await openDb();
  await request(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key));
}

// Sem índice por deck_id em deck_cards - percorre a store com um cursor e
// apaga o que corresponder ao predicado. Só usado para apagar as cartas de
// um deck apagado; a store é pequena o suficiente para isto ser suficiente.
export async function deleteWhere(storeName, predicate) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  return new Promise((resolve, reject) => {
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      if (predicate(cursor.value)) cursor.delete();
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
