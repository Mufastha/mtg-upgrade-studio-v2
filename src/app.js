import { loadCatalog } from './catalog/loader.js';
import { loadPrintings } from './catalog/printings.js';
import { loadExcluded } from './catalog/excluded.js';
import { getAll, clearStore } from './db/idb.js';
import { buildCollectionRows } from './ui/collection-view.js';
import { buildDeckSummaries, buildDeckCardRows, buildDeckMetrics } from './ui/deck-view.js';
import { resolveManaBoxCsv, saveCollection, enrichFailureReasons } from './importers/manabox.js';
import { resolveDecklist, saveDeck, renameDeck, deleteDeck } from './importers/decklist.js';
import { exportPersonalData, importPersonalData, FORMAT as PERSONAL_DATA_FORMAT } from './data/personal.js';

const statusEl = document.getElementById('status');
const searchEl = document.getElementById('pesquisa');
const tableEl = document.getElementById('resultados');
const tbodyEl = document.getElementById('resultados-corpo');

const collectionSearchEl = document.getElementById('colecao-pesquisa');
const collectionStatusEl = document.getElementById('colecao-status');
const collectionPositionEl = document.getElementById('colecao-posicao');
const collectionTableEl = document.getElementById('colecao-tabela');
const collectionBodyEl = document.getElementById('colecao-corpo');
const collectionShowMoreBtn = document.getElementById('colecao-mostrar-mais');
const collectionDeleteBtn = document.getElementById('colecao-apagar');

const decksStatusEl = document.getElementById('decks-status');
const decksTableEl = document.getElementById('decks-tabela');
const decksBodyEl = document.getElementById('decks-corpo');

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
const isPreconEl = document.getElementById('decklist-e-precon');
const preconFieldsEl = document.getElementById('decklist-precon-campos');
const preconNameEl = document.getElementById('decklist-precon-nome');

const exportBtn = document.getElementById('dados-exportar');
const importInputEl = document.getElementById('dados-importar');
const dataStatusEl = document.getElementById('dados-status');

const MAX_RESULTS = 50;
const COLLECTION_PAGE_SIZE = 50;
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
        <td>${f.reason ? escapeHtml(f.reason) : '<span class="desconhecido">a verificar…</span>'}</td>
      </tr>`
    )
    .join('');
  failuresTableEl.hidden = false;
}

// Lista simples da coleção guardada - só assim se confirma visualmente que
// um import (ManaBox ou JSON) gravou mesmo os dados. Sem imagens, com
// pesquisa própria (independente da do catálogo) e paginada - a coleção
// real do Diogo tem ~3900 entradas, mostrar tudo de uma vez não é "mínimo".
function setupCollectionView(cards) {
  const cardsByOracleId = new Map(cards.map((c) => [c.oracle_id, c]));
  let entries = [];
  let visibleLimit = COLLECTION_PAGE_SIZE;

  function render() {
    const { rows, matchedCount, totalEntries, totalCopies } = buildCollectionRows(
      entries,
      cardsByOracleId,
      collectionSearchEl.value,
      visibleLimit
    );

    if (totalEntries === 0) {
      collectionStatusEl.textContent = 'Coleção vazia — importa um CSV da ManaBox ou um JSON exportado antes.';
      collectionPositionEl.textContent = '';
    } else {
      const q = collectionSearchEl.value.trim();
      collectionStatusEl.textContent =
        `${totalEntries} entradas, ${totalCopies} cópias no total` +
        (q ? ` — ${matchedCount} a corresponder a "${q}".` : '.');
      // matchedCount é o total depois do filtro, não o da coleção toda -
      // com pesquisa ativa o "de N" tem de refletir isso.
      collectionPositionEl.textContent = `A mostrar ${rows.length} de ${matchedCount}.`;
    }

    collectionBodyEl.innerHTML = rows
      .map(
        (e) => `<tr>
          <td>${escapeHtml(e.card?.name ?? e.oracle_id)}</td>
          <td>${escapeHtml(e.set)}</td>
          <td>${e.quantity}</td>
          <td>${escapeHtml(e.foil)}</td>
        </tr>`
      )
      .join('');
    collectionTableEl.hidden = rows.length === 0;
    collectionShowMoreBtn.hidden = rows.length >= matchedCount;
  }

  collectionSearchEl.addEventListener('input', () => {
    visibleLimit = COLLECTION_PAGE_SIZE;
    render();
  });
  collectionShowMoreBtn.addEventListener('click', () => {
    visibleLimit += COLLECTION_PAGE_SIZE;
    render();
  });

  collectionDeleteBtn.addEventListener('click', async () => {
    if (entries.length === 0) return;
    const totalCopies = entries.reduce((sum, e) => sum + e.quantity, 0);
    const confirmado = window.confirm(
      `Apagar toda a coleção guardada (${entries.length} entradas, ${totalCopies} cópias)? ` +
        'Esta ação não pode ser desfeita — a verdade da coleção vive na ManaBox, reimporta o CSV para a recuperar.'
    );
    if (!confirmado) return;
    await clearStore('collection');
    await refresh();
  });

  async function refresh() {
    entries = await getAll('collection');
    visibleLimit = COLLECTION_PAGE_SIZE;
    render();
  }

  refresh();
  return { refresh };
}

// Lista mínima dos decks guardados - nome, commander, contagem de cartas,
// marca de precon, legalidade (§7.0). "Ver cartas" expande a lista de
// cartas; "Ver métricas" expande as métricas determinísticas (§7.1). Sem
// imagens nem gráficos.
function setupDeckView(cards) {
  const cardsByOracleId = new Map(cards.map((c) => [c.oracle_id, c]));
  let decks = [];
  let deckCards = [];
  let expandedDeckId = null;
  let metricsDeckId = null;
  let expandedBucket = null; // "<deckId>:<bucketKey>" — só uma de cada vez

  function render() {
    const summaries = buildDeckSummaries(decks, deckCards, cardsByOracleId);

    if (summaries.length === 0) {
      decksStatusEl.textContent = 'Nenhum deck guardado — importa uma decklist em texto abaixo.';
      decksTableEl.hidden = true;
      return;
    }
    decksStatusEl.textContent = `${summaries.length} deck(s) guardado(s).`;

    decksBodyEl.innerHTML = summaries
      .map((s) => {
        const legalityText = s.legality.legal ? '✓ Legal' : `⚠ ${s.legality.problems.length} problema(s)`;
        const summaryRow = `<tr>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.commanderName)}</td>
          <td>${s.cardCount}</td>
          <td>${s.isPrecon ? escapeHtml(s.preconName) : '—'}</td>
          <td class="${s.legality.legal ? 'legal' : 'ilegal'}">${legalityText}</td>
          <td>
            <button type="button" data-action="ver" data-deck-id="${s.deck_id}">${expandedDeckId === s.deck_id ? 'Fechar' : 'Ver cartas'}</button>
            <button type="button" data-action="metricas" data-deck-id="${s.deck_id}">${metricsDeckId === s.deck_id ? 'Fechar métricas' : 'Ver métricas'}</button>
            <button type="button" data-action="renomear" data-deck-id="${s.deck_id}">Renomear</button>
            <button type="button" data-action="apagar" data-deck-id="${s.deck_id}">Apagar</button>
          </td>
        </tr>`;

        // §7.0: painel de validação por deck, sempre visível quando há
        // problemas - nunca bloqueia a importação, só avisa.
        const problemsRow = s.legality.legal
          ? ''
          : `<tr class="deck-problemas"><td colspan="6">${s.legality.problems
              .map((p) => `⚠ ${p.card ? `<strong>${escapeHtml(p.card)}</strong>: ` : ''}${escapeHtml(p.message)}`)
              .join('<br>')}</td></tr>`;

        const metricsRow = metricsDeckId === s.deck_id ? renderMetricsRow(s.deck_id) : '';

        const cardsRow =
          expandedDeckId === s.deck_id
            ? `<tr><td colspan="6">${buildDeckCardRows(s.deck_id, deckCards, cardsByOracleId)
                .map((c) => `${c.quantity}x ${escapeHtml(c.name)}`)
                .join('<br>')}</td></tr>`
            : '';

        return summaryRow + problemsRow + metricsRow + cardsRow;
      })
      .join('');
    decksTableEl.hidden = false;
  }

  function formatCardList(list) {
    if (list.length === 0) return '(nenhuma)';
    return [...list]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.quantity > 1 ? `${e.quantity}x ` : ''}${escapeHtml(e.name)}`)
      .join(', ');
  }

  // §7.1 - curva de mana, terrenos/fontes de mana, contagens por papel,
  // densidade de interação e papéis em falta. Cada contagem é um botão que
  // expande a lista de cartas que a compõem - sem isso não dá para validar
  // se a classificação está certa, só olhando para um número.
  function renderMetricsRow(deckId) {
    const m = buildDeckMetrics(deckId, deckCards, cardsByOracleId);

    const buckets = [
      { key: 'terrenos', label: 'Terrenos', count: m.landCount, list: m.landCards },
      { key: 'fontes-mana', label: 'Fontes de mana', count: m.manaSourceCount, list: m.manaSourceCards },
      { key: 'ramp', label: 'Ramp', count: m.roleCounts.ramp, list: m.roleCards.ramp },
      { key: 'draw', label: 'Draw', count: m.roleCounts.draw, list: m.roleCards.draw },
      { key: 'removal', label: 'Remoção', count: m.roleCounts.removal, list: m.roleCards.removal },
      { key: 'interaction', label: 'Interação', count: m.roleCounts.interaction, list: m.roleCards.interaction },
      { key: 'wincons', label: 'Wincons', count: m.roleCounts.wincons, list: m.roleCards.wincons },
    ];

    const bucketsHtml = buckets
      .map((b) => {
        const bucketId = `${deckId}:${b.key}`;
        const isOpen = expandedBucket === bucketId;
        const btn = `<button type="button" data-action="bucket" data-deck-id="${deckId}" data-bucket="${b.key}">${escapeHtml(b.label)}: ${b.count}${isOpen ? ' ▲' : ' ▼'}</button>`;
        const detail = isOpen ? `<div class="bucket-cartas">${formatCardList(b.list)}</div>` : '';
        return btn + detail;
      })
      .join(' ');

    const curve = ['0', '1', '2', '3', '4', '5', '6', '7+']
      .map((k) => `${k}:${m.manaCurve[k]}`)
      .join('  ');
    const missing =
      m.missingRoles.length === 0
        ? 'Nenhum — todos os papéis atingem o alvo de referência.'
        : m.missingRoles.map((r) => `${r.role}: tem ${r.have}, alvo ${r.target} (faltam ${r.short})`).join('<br>');

    return `<tr class="deck-metricas"><td colspan="6">` +
      `${bucketsHtml}<br>` +
      `Densidade de interação: ${(m.interactionDensity * 100).toFixed(0)}%<br>` +
      `Curva de mana (${m.totalNonLandCards} cartas não-terreno): ${escapeHtml(curve)}<br>` +
      `<strong>Papéis em falta (alvos de referência, não regra oficial):</strong><br>${missing}` +
      `</td></tr>`;
  }

  decksBodyEl.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-deck-id]');
    if (!btn) return;
    const { deckId, action } = btn.dataset;

    if (action === 'ver') {
      expandedDeckId = expandedDeckId === deckId ? null : deckId;
      render();
      return;
    }

    if (action === 'metricas') {
      metricsDeckId = metricsDeckId === deckId ? null : deckId;
      expandedBucket = null;
      render();
      return;
    }

    if (action === 'bucket') {
      const bucketId = `${deckId}:${btn.dataset.bucket}`;
      expandedBucket = expandedBucket === bucketId ? null : bucketId;
      render();
      return;
    }

    if (action === 'renomear') {
      const atual = decks.find((d) => d.deck_id === deckId)?.name ?? '';
      const novoNome = window.prompt('Novo nome do deck:', atual);
      if (novoNome == null) return; // cancelado
      const trimmed = novoNome.trim();
      if (!trimmed || trimmed === atual) return;
      await renameDeck(deckId, trimmed);
      await refresh();
      return;
    }

    if (action === 'apagar') {
      const alvo = decks.find((d) => d.deck_id === deckId);
      const confirmado = window.confirm(`Apagar o deck "${alvo?.name}"? Esta ação não pode ser desfeita.`);
      if (!confirmado) return;
      await deleteDeck(deckId);
      if (expandedDeckId === deckId) expandedDeckId = null;
      if (metricsDeckId === deckId) {
        metricsDeckId = null;
        expandedBucket = null;
      }
      await refresh();
    }
  });

  async function refresh() {
    [decks, deckCards] = await Promise.all([getAll('decks'), getAll('deck_cards')]);
    render();
  }

  refresh();
  return { refresh };
}

// printings.json (32MB) só é pedido aqui, ao escolher um ficheiro - nunca no
// arranque da app (invariante 11 no CLAUDE.md).
function setupManaBoxImport(cards, collectionView) {
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
      await collectionView.refresh();

      const failRate = ((result.failures.length / result.totalRows) * 100).toFixed(2);
      importStatusEl.textContent =
        `Coleção importada: ${result.entries.length} entradas guardadas ` +
        `(${result.resolvedRows}/${result.totalRows} linhas resolvidas, ${failRate}% falhas).`;
      renderImportFailures(result.failures);

      // excluded.json (~2MB) só é pedido aqui, sob demanda, tal como
      // printings.json (invariante 11) - a razão de cada falha é local,
      // vinda da própria build do catálogo, nunca de um pedido à Scryfall
      // em tempo real.
      if (result.failures.length > 0) {
        const { excluded } = await loadExcluded();
        renderImportFailures(enrichFailureReasons(result.failures, excluded));
      }
    } catch (err) {
      importStatusEl.textContent = `Falha ao importar: ${err.message}`;
      importStatusEl.classList.add('erro');
    } finally {
      csvInputEl.disabled = false;
    }
  });
}

function setupDecklistImport(cards, deckView) {
  decklistTextEl.disabled = false;
  decklistNameEl.disabled = false;
  decklistProcessBtn.disabled = false;
  isPreconEl.disabled = false;

  isPreconEl.addEventListener('change', () => {
    preconFieldsEl.hidden = !isPreconEl.checked;
  });

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
    const commanderName = cards.find((c) => c.oracle_id === commanderOracleId)?.name ?? null;
    const typedName = decklistNameEl.value.trim();

    // §4.3: as próprias cartas resolvidas desta decklist são a base do
    // precon - nunca aparecerão como recomendação de compra para este deck.
    // Nome vazio: usa o do precon (se for precon) ou o do commander -
    // "Deck sem nome" só como último recurso, se nem isso houver.
    let name;
    let sourcePrecon = null;
    if (isPreconEl.checked) {
      const preconName = preconNameEl.value.trim() || commanderName || 'Precon';
      name = typedName || preconName;
      sourcePrecon = {
        name: preconName,
        base_cards: lastResult.cards.map((c) => c.oracle_id),
      };
    } else {
      name = typedName || commanderName || 'Deck sem nome';
    }

    const deckId = await saveDeck({ name, commanderOracleId, cards: lastResult.cards, sourcePrecon });
    await deckView.refresh();
    decklistStatusEl.textContent = `Deck "${name}" guardado (${deckId})${sourcePrecon ? ` — precon "${sourcePrecon.name}" com ${sourcePrecon.base_cards.length} cartas base` : ''} — ver decks guardados acima.`;
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

function setupPersonalData(collectionView, deckView) {
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
      if (bundle?.format !== PERSONAL_DATA_FORMAT) {
        throw new Error('Ficheiro não reconhecido: não é um export do MTG Upgrade Studio.');
      }

      const [collectionAtual, decksAtual] = await Promise.all([getAll('collection'), getAll('decks')]);
      const confirmado = window.confirm(
        'Importar este ficheiro substitui os dados guardados. Não pode ser desfeito.\n\n' +
          `Coleção: ${collectionAtual.length} entradas atuais → ${bundle.stores?.collection?.length ?? 0} no ficheiro\n` +
          `Decks: ${decksAtual.length} atuais → ${bundle.stores?.decks?.length ?? 0} no ficheiro\n\n` +
          'Continuar?'
      );
      if (!confirmado) {
        importInputEl.value = '';
        return;
      }

      await importPersonalData(bundle);
      await Promise.all([collectionView.refresh(), deckView.refresh()]);
      dataStatusEl.classList.remove('erro');
      dataStatusEl.textContent = 'Dados importados com sucesso — ver a coleção e os decks guardados acima.';
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

  const collectionView = setupCollectionView(cards);
  const deckView = setupDeckView(cards);

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

  setupManaBoxImport(cards, collectionView);
  setupDecklistImport(cards, deckView);
  setupPersonalData(collectionView, deckView);
}

main();
