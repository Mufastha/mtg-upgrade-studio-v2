import { loadCatalog } from './catalog/loader.js';
import { loadPrintings } from './catalog/printings.js';
import { resolveManaBoxCsv, saveCollection } from './importers/manabox.js';
import { resolveDecklist, saveDeck } from './importers/decklist.js';
import { exportPersonalData, importPersonalData } from './data/personal.js';

const statusEl = document.getElementById('status');
const searchEl = document.getElementById('pesquisa');
const tableEl = document.getElementById('resultados');
const tbodyEl = document.getElementById('resultados-corpo');

const csvInputEl = document.getElementById('manabox-csv');
const importStatusEl = document.getElementById('import-status');
const failuresTableEl = document.getElementById('import-falhas');
const failuresBodyEl = document.getElementById('import-falhas-corpo');

const decklistTextEl = document.getElementById('decklist-texto');
const decklistNameEl = document.getElementById('decklist-nome');
const decklistProcessBtn = document.getElementById('decklist-processar');
const decklistStatusEl = document.getElementById('decklist-status');
const decklistFailuresTableEl = document.getElementById('decklist-falhas');
const decklistFailuresBodyEl = document.getElementById('decklist-falhas-corpo');
const commanderPickerEl = document.getElementById('decklist-commander-picker');
const commanderSelectEl = document.getElementById('decklist-commander-select');
const decklistSaveBtn = document.getElementById('decklist-guardar');

const exportBtn = document.getElementById('dados-exportar');
const importInputEl = document.getElementById('dados-importar');
const dataStatusEl = document.getElementById('dados-status');

const MAX_RESULTS = 50;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function formatPrice(card) {
  if (card.price_eur_min == null) return '<span class="desconhecido">desconhecido</span>';
  return `~${card.price_eur_min.toFixed(2)} €`;
}

function renderResults(cards) {
  tbodyEl.innerHTML = cards
    .slice(0, MAX_RESULTS)
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.mana_cost)}</td>
        <td>${escapeHtml(c.type_line)}</td>
        <td class="preco">${formatPrice(c)}</td>
      </tr>`
    )
    .join('');
}

function renderImportFailures(failures) {
  if (failures.length === 0) {
    failuresTableEl.hidden = true;
    return;
  }
  failuresBodyEl.innerHTML = failures
    .map(
      (f) => `<tr>
        <td>${f.line}</td>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.set_code)}</td>
        <td>${escapeHtml(f.collector_number)}</td>
      </tr>`
    )
    .join('');
  failuresTableEl.hidden = false;
}

// printings.json (32MB) só é pedido aqui, ao escolher um ficheiro - nunca no
// arranque da app (invariante 11 no CLAUDE.md).
function setupManaBoxImport(cards) {
  csvInputEl.disabled = false;
  csvInputEl.addEventListener('change', async () => {
    const file = csvInputEl.files[0];
    if (!file) return;

    importStatusEl.classList.remove('erro');
    importStatusEl.textContent = 'A carregar printings.json (sob demanda)…';
    csvInputEl.disabled = true;

    try {
      const { printings } = await loadPrintings();
      importStatusEl.textContent = 'A processar o CSV…';
      const csvText = await file.text();
      const result = resolveManaBoxCsv(csvText, { cards, printings });
      await saveCollection(result.entries);

      const failRate = ((result.failures.length / result.totalRows) * 100).toFixed(2);
      importStatusEl.textContent =
        `Coleção importada: ${result.entries.length} entradas guardadas ` +
        `(${result.resolvedRows}/${result.totalRows} linhas resolvidas, ${failRate}% falhas).`;
      renderImportFailures(result.failures);
    } catch (err) {
      importStatusEl.textContent = `Falha ao importar: ${err.message}`;
      importStatusEl.classList.add('erro');
    } finally {
      csvInputEl.disabled = false;
    }
  });
}

function setupDecklistImport(cards) {
  decklistTextEl.disabled = false;
  decklistNameEl.disabled = false;
  decklistProcessBtn.disabled = false;

  let lastResult = null;

  decklistProcessBtn.addEventListener('click', () => {
    lastResult = resolveDecklist(decklistTextEl.value, { cards });
    decklistStatusEl.classList.remove('erro');
    decklistStatusEl.textContent =
      `${lastResult.cards.length} cartas resolvidas de ${lastResult.totalLines} linhas ` +
      `(${lastResult.failures.length} falhas).`;

    if (lastResult.failures.length > 0) {
      decklistFailuresBodyEl.innerHTML = lastResult.failures
        .map((f) => `<tr><td>${f.line}</td><td>${escapeHtml(f.raw)}</td></tr>`)
        .join('');
      decklistFailuresTableEl.hidden = false;
    } else {
      decklistFailuresTableEl.hidden = true;
    }

    if (lastResult.commanderOracleId) {
      commanderPickerEl.hidden = true;
    } else {
      // §4.2: sem marcação CMDR, o utilizador escolhe o commander aqui.
      commanderSelectEl.innerHTML = lastResult.cards
        .map((c) => {
          const card = cards.find((x) => x.oracle_id === c.oracle_id);
          return `<option value="${c.oracle_id}">${escapeHtml(card?.name ?? c.oracle_id)}</option>`;
        })
        .join('');
      commanderPickerEl.hidden = false;
    }
    decklistSaveBtn.hidden = lastResult.cards.length === 0;
  });

  decklistSaveBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    const commanderOracleId = lastResult.commanderOracleId ?? commanderSelectEl.value;
    const name = decklistNameEl.value.trim() || 'Deck sem nome';
    const deckId = await saveDeck({ name, commanderOracleId, cards: lastResult.cards });
    decklistStatusEl.textContent = `Deck "${name}" guardado (${deckId}).`;
    decklistSaveBtn.hidden = true;
    commanderPickerEl.hidden = true;
  });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setupPersonalData() {
  exportBtn.disabled = false;
  importInputEl.disabled = false;

  exportBtn.addEventListener('click', async () => {
    const bundle = await exportPersonalData();
    downloadJson(`mtg-upgrade-studio-${bundle.exported_at.slice(0, 10)}.json`, bundle);
    dataStatusEl.classList.remove('erro');
    dataStatusEl.textContent =
      `Exportado: ${bundle.stores.collection.length} entradas de coleção, ${bundle.stores.decks.length} decks.`;
  });

  importInputEl.addEventListener('change', async () => {
    const file = importInputEl.files[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      await importPersonalData(bundle);
      dataStatusEl.classList.remove('erro');
      dataStatusEl.textContent = 'Dados importados com sucesso. Recarrega a página para veres as alterações.';
    } catch (err) {
      dataStatusEl.textContent = `Falha ao importar: ${err.message}`;
      dataStatusEl.classList.add('erro');
    }
  });
}

async function main() {
  let cards;
  try {
    const { cards: loaded, offline } = await loadCatalog();
    cards = loaded;
    statusEl.textContent = `Catálogo carregado: ${cards.length} cartas${offline ? ' (cache, sem rede)' : ''}.`;
  } catch (err) {
    statusEl.textContent = `Não foi possível carregar o catálogo: ${err.message}`;
    statusEl.classList.add('erro');
    return;
  }

  searchEl.disabled = false;
  searchEl.addEventListener('input', () => {
    const query = searchEl.value.trim().toLowerCase();
    if (!query) {
      tableEl.hidden = true;
      return;
    }
    renderResults(cards.filter((c) => c.name.toLowerCase().includes(query)));
    tableEl.hidden = false;
  });

  setupManaBoxImport(cards);
  setupDecklistImport(cards);
  setupPersonalData();
}

main();
