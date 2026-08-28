import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getBulkDataUri, getGamechangerOracleIds } from './lib/scryfall.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { mergeOracleTags } from './lib/tags.mjs';
import { buildPrintings } from './lib/printings.mjs';
import { writeOutput } from './lib/write-output.mjs';

const CATALOG_SIZE_LIMIT_BYTES = 10 * 1_000_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'catalog');

async function main() {
  console.log('A obter lista de Game Changers (is:gamechanger)...');
  const gamechangerIds = await getGamechangerOracleIds();
  console.log(`  ${gamechangerIds.size} Game Changers`);

  console.log('A localizar bulk data...');
  const [oracleCards, oracleTags, defaultCards] = await Promise.all([
    getBulkDataUri('oracle_cards'),
    getBulkDataUri('oracle_tags'),
    getBulkDataUri('default_cards'),
  ]);

  console.log('A construir o catálogo a partir de oracle_cards...');
  const catalog = await buildCatalog(oracleCards.uri, gamechangerIds);
  console.log(`  ${catalog.size} cartas retidas`);

  console.log('A juntar oracle_tags...');
  await mergeOracleTags(oracleTags.uri, catalog);

  console.log('A construir printings.json, excluded.json e price_eur_min a partir de default_cards...');
  const { printings, excluded } = await buildPrintings(defaultCards.uri, catalog, defaultCards.updatedAt);
  console.log(`  ${printings.size} impressões, ${excluded.size} excluídas (com razão registada)`);

  console.log('A escrever ficheiros de saída...');
  const { manifest, catalogBytes } = await writeOutput(OUT_DIR, { catalog, printings, excluded });

  const mb = (catalogBytes / 1_000_000).toFixed(2);
  console.log(`catalog.json.gz: ${mb} MB (${manifest.card_count} cartas)`);
  console.log('manifest.json:', manifest);

  if (catalogBytes > CATALOG_SIZE_LIMIT_BYTES) {
    console.error(
      `AVISO: catalog.json.gz excede o limite de 10 MB do §3.1 da especificação (${mb} MB).`
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
