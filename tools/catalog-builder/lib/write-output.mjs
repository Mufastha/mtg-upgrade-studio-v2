import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export async function writeOutput(outDir, { catalog, printings, excluded }) {
  await mkdir(outDir, { recursive: true });

  const catalogArray = [...catalog.values()];
  const catalogGz = gzipSync(Buffer.from(JSON.stringify(catalogArray)));
  await writeFile(`${outDir}/catalog.json.gz`, catalogGz);

  const printingsArray = [...printings.values()];
  await writeFile(`${outDir}/printings.json`, JSON.stringify(printingsArray));

  const excludedArray = [...excluded.values()];
  await writeFile(`${outDir}/excluded.json`, JSON.stringify(excludedArray));

  const builtAt = new Date().toISOString();
  const manifest = {
    version: builtAt,
    built_at: builtAt,
    card_count: catalogArray.length,
    sha: createHash('sha256').update(catalogGz).digest('hex'),
  };
  await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

  return { manifest, catalogBytes: catalogGz.length };
}
