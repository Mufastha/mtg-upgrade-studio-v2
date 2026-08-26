import { putAll } from '../db/idb.js';

// Formato do §4.2: texto simples, uma carta por linha, "1 Sol Ring". Linhas
// vazias e começadas por // são ignoradas. O commander marca-se com "CMDR"
// em vez da quantidade (ex. "CMDR Cloud, Ex-SOLDIER") - se nenhuma linha
// tiver essa marca, cabe ao utilizador escolher no import (§4.2).
function parseLines(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}

function parseLine(line) {
  const match = line.match(/^(CMDR|\d+)\s+(.+)$/i);
  if (!match) return { quantity: 1, name: line, isCommander: false };
  const [, qtyToken, name] = match;
  const isCommander = qtyToken.toUpperCase() === 'CMDR';
  return { quantity: isCommander ? 1 : Number(qtyToken), name, isCommander };
}

// Não depende de rede nem do DOM - fácil de testar isoladamente. Usada
// também para base_cards de um precon (§4.3), que resolve "da mesma forma
// que a decklist em §4.2".
export function resolveDecklist(text, { cards }) {
  const catalogByName = new Map(cards.map((c) => [c.name.toLowerCase(), c]));
  const lines = parseLines(text);

  const entries = [];
  const failures = [];
  let commanderOracleId = null;

  lines.forEach((line, i) => {
    const { quantity, name, isCommander } = parseLine(line);
    const card = catalogByName.get(name.toLowerCase());
    if (!card) {
      failures.push({ line: i + 1, raw: line, name });
      return;
    }
    entries.push({ oracle_id: card.oracle_id, quantity });
    if (isCommander) commanderOracleId = card.oracle_id;
  });

  // Uma carta pode aparecer em mais que uma linha (ex. terrenos básicos
  // listados em blocos separados) - agregar por oracle_id.
  const aggregated = new Map();
  for (const e of entries) {
    const existing = aggregated.get(e.oracle_id);
    if (existing) existing.quantity += e.quantity;
    else aggregated.set(e.oracle_id, { ...e });
  }

  return {
    cards: [...aggregated.values()],
    commanderOracleId,
    failures,
    totalLines: lines.length,
  };
}

// Cada import cria um deck novo - não atualiza um deck existente (essa é
// uma funcionalidade de edição de deck, fora do âmbito desta peça).
export async function saveDeck({ name, commanderOracleId, cards, sourcePrecon = null }) {
  const deckId = crypto.randomUUID();
  await putAll('decks', [
    {
      deck_id: deckId,
      name,
      commander_oracle_id: commanderOracleId,
      source_precon: sourcePrecon,
    },
  ]);
  await putAll(
    'deck_cards',
    cards.map((c) => ({ deck_id: deckId, oracle_id: c.oracle_id, quantity: c.quantity }))
  );
  return deckId;
}
