// Configuração de deck (§5) - as recomendações pertencem ao par (deck,
// configuração), nunca ao deck (invariante 8). Versão mínima: o que a
// Fase B e o emparelhamento precisam. Preço e orçamento ficam no registo
// para a Fase 3 (§9), sem uso ainda.

export function createDeckConfig({
  deckId,
  name,
  targetBracket,
  maxChanges = 10,
  maxCmc = null,
  excludeTags = [],
  excludeReservedList = false,
  untouchable = [],
  maxPricePerCardEur = null,
  totalBudgetEur = null,
}) {
  if (!deckId) throw new Error('Configuração sem deck.');
  // O bracket alvo nunca é assumido - um deck de torneio B3 e uma mesa
  // casual são configurações diferentes do mesmo deck.
  if (!Number.isInteger(targetBracket) || targetBracket < 1 || targetBracket > 5) {
    throw new Error('Bracket alvo tem de ser um inteiro de 1 a 5.');
  }
  if (!Number.isInteger(maxChanges) || maxChanges < 1) {
    throw new Error('max_changes tem de ser um inteiro positivo.');
  }
  return {
    config_id: crypto.randomUUID(),
    deck_id: deckId,
    name: name?.trim() || `Bracket ${targetBracket}`,
    target_bracket: targetBracket,
    max_changes: maxChanges,
    max_cmc: maxCmc,
    exclude_tags: [...excludeTags],
    exclude_reserved_list: Boolean(excludeReservedList),
    untouchable: [...untouchable],
    max_price_per_card_eur: maxPricePerCardEur,
    total_budget_eur: totalBudgetEur,
  };
}
