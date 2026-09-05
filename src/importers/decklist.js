import { putAll, getRecord, deleteRecord, deleteWhere } from '../db/idb.js';

// Formato do §4.2: texto simples, uma carta por linha, "1 Sol Ring". Linhas
// vazias e começadas por // são ignoradas.
//
// Duas formas de marcar o commander, porque decklists reais (exports do
// Archidekt/Moxfield) trazem um cabeçalho de secção em vez de anotar cada
// linha:
// 1. "// COMMANDER" (ou "// Commander") numa linha isolada - a próxima
//    linha de carta é o commander.
// 2. "CMDR" no lugar da quantidade (ex. "CMDR Cloud, Ex-SOLDIER") - para
//    quem escreve a lista à mão sem cabeçalhos de secção.
// Sem nenhuma das duas, cabe ao utilizador escolher no import (§4.2).
const COMMANDER_HEADER_RE = /^\/\/\s*commander\b/i;

// Exports reais também têm "(SET) número *F*" a seguir ao nome (edição,
// número de colecionador, acabamento) - descartado aqui, porque esta
// resolução é só por nome (ver comentário em resolveDecklist).
const PRINTING_SUFFIX_RE = /^(.+?)\s+\([A-Za-z0-9]+\)\s+\S+(?:\s+\*[A-Za-z]+\*)?$/;

function stripPrintingSuffix(name) {
  const match = name.match(PRINTING_SUFFIX_RE);
  return match ? match[1].trim() : name;
}

function parseLine(line) {
  const match = line.match(/^(CMDR|\d+)\s+(.+)$/i);
  if (!match) return { quantity: 1, name: stripPrintingSuffix(line), markedCommander: false };
  const [, qtyToken, rest] = match;
  const markedCommander = qtyToken.toUpperCase() === 'CMDR';
  return {
    quantity: markedCommander ? 1 : Number(qtyToken),
    name: stripPrintingSuffix(rest),
    markedCommander,
  };
}

// Não depende de rede nem do DOM - fácil de testar isoladamente. Usada
// também para base_cards de um precon (§4.3), que resolve "da mesma forma
// que a decklist em §4.2". Resolução só por nome (case-insensitive, ao
// contrário do importador da ManaBox): uma decklist em texto não tem
// scryfall_id nem número de colecionador fiável para cruzar com
// printings.json, só o nome.
export function resolveDecklist(text, { cards }) {
  const catalogByName = new Map(cards.map((c) => [c.name.toLowerCase(), c]));
  const rawLines = text.split('\n').map((l) => l.replace(/\r$/, ''));

  const entries = [];
  const failures = [];
  let commanderOracleId = null;
  let nextLineIsCommander = false;

  rawLines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (line.length === 0) return;
    if (line.startsWith('//')) {
      if (COMMANDER_HEADER_RE.test(line)) nextLineIsCommander = true;
      return;
    }

    const { quantity, name, markedCommander } = parseLine(line);
    const isCommander = markedCommander || nextLineIsCommander;
    nextLineIsCommander = false;

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
    totalLines: entries.length + failures.length,
  };
}

// Cada import cria um deck novo - não atualiza a lista de cartas de um deck
// existente (isso é edição de deck, fora do âmbito desta peça). Renomear e
// apagar são as duas exceções mínimas, abaixo.
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

export async function renameDeck(deckId, name) {
  const deck = await getRecord('decks', deckId);
  if (!deck) throw new Error('Deck não encontrado.');
  await putAll('decks', [{ ...deck, name }]);
}

export async function deleteDeck(deckId) {
  await deleteRecord('decks', deckId);
  await deleteWhere('deck_cards', (dc) => dc.deck_id === deckId);
}

// Anulação por deck da classificação por papel (§7.1) - quando a regra
// global erra para este deck específico, sem mudar a regra global. Guardada
// em deck.role_overrides: [{oracle_id, role, action: "add"|"remove"|"confirm"}].
// "add": a carta conta para o papel (nova ou a confirmar uma sugestão
// incerta já lá presente). "remove": não conta, apesar da tag/sugestão.
// "confirm": só limpa a marca de incerteza de uma sugestão automática já
// correta, sem mudar a inclusão. action=null limpa qualquer anulação
// existente (volta ao automático).
export async function setRoleOverride(deckId, oracleId, role, action) {
  const deck = await getRecord('decks', deckId);
  if (!deck) throw new Error('Deck não encontrado.');
  const overrides = (deck.role_overrides ?? []).filter((o) => !(o.oracle_id === oracleId && o.role === role));
  if (action) overrides.push({ oracle_id: oracleId, role, action });
  await putAll('decks', [{ ...deck, role_overrides: overrides }]);
}

// Plano de jogo (§7.2) - guardado por deck, nunca por configuração (o
// commander já amarra o deck a um plano). Semeado do commander
// (game-plan.js: seedGamePlan) e sempre revisto/editado pelo Diogo antes
// de ser guardado - nunca aceite automático.
export async function saveGamePlan(deckId, gamePlan) {
  const deck = await getRecord('decks', deckId);
  if (!deck) throw new Error('Deck não encontrado.');
  await putAll('decks', [{ ...deck, game_plan: gamePlan }]);
}
