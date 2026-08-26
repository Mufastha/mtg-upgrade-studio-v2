import { loadCatalog } from './catalog/loader.js';
import { loadPrintings } from './catalog/printings.js';
import { resolveManaBoxCsv, saveCollection } from './importers/manabox.js';

const statusEl = document.getElementById('status');
const searchEl = document.getElementById('pesquisa');
const tableEl = document.getElementById('resultados');
const tbodyEl = document.getElementById('resultados-corpo');

const csvInputEl = document.getElementById('manabox-csv');
const importStatusEl = document.getElementById('import-status');
const failuresTableEl = document.getElementById('import-falhas');
const failuresBodyEl = document.getElementById('import-falhas-corpo');

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
}

main();
