import { streamJsonl } from './scryfall.mjs';

// oracle_tags.jsonl vem organizado por tag, não por carta: cada registo é uma
// tag com uma lista `taggings` de oracle_id. É preciso inverter para chegar a
// oracle_tags[] por carta.
export async function mergeOracleTags(tagsUrl, catalog) {
  const tagSets = new Map();
  await streamJsonl(tagsUrl, (tag) => {
    if (tag.object !== 'tag' || tag.type !== 'oracle') return;
    for (const tagging of tag.taggings ?? []) {
      if (!catalog.has(tagging.oracle_id)) continue;
      let set = tagSets.get(tagging.oracle_id);
      if (!set) {
        set = new Set();
        tagSets.set(tagging.oracle_id, set);
      }
      set.add(tag.slug);
    }
  });
  for (const [oracleId, set] of tagSets) {
    catalog.get(oracleId).oracle_tags = [...set].sort();
  }
}
