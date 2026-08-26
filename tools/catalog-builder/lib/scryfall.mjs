import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const USER_AGENT = 'MTGUpgradeStudio/0.1 (personal project; contact: c.ramospatricio@gmail.com)';
const API_BASE = 'https://api.scryfall.com';
const RATE_LIMIT_DELAY_MS = 100;

async function scryfallFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Scryfall ${url} -> HTTP ${res.status}`);
  }
  return res;
}

export async function getBulkDataUri(type) {
  const res = await scryfallFetch(`${API_BASE}/bulk-data`);
  const { data } = await res.json();
  const entry = data.find((d) => d.type === type);
  if (!entry) throw new Error(`Bulk data type não encontrado: ${type}`);
  return { uri: entry.jsonl_download_uri, updatedAt: entry.updated_at };
}

// Cada bulk file é NDJSON gzipped: um objeto JSON por linha. Stream em vez de
// carregar tudo em memória - default_cards descomprimido passa dos 300MB.
export async function streamJsonl(url, onRecord) {
  const res = await scryfallFetch(url);
  const gunzip = createGunzip();
  Readable.fromWeb(res.body).pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    onRecord(JSON.parse(line));
  }
}

export async function getGamechangerOracleIds() {
  const ids = new Set();
  let url = `${API_BASE}/cards/search?q=is%3Agamechanger&order=name`;
  while (url) {
    const res = await scryfallFetch(url);
    const page = await res.json();
    for (const card of page.data) ids.add(card.oracle_id);
    url = page.has_more ? page.next_page : null;
    if (url) await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }
  return ids;
}
