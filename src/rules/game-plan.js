// Plano de jogo do commander (§7.2). Semeado das oracle_tags do próprio
// commander - sem filtro automático, a curadoria é do Diogo no formulário
// ("resolve ambiguidade que nenhum algoritmo adivinha"). Confirmado com os
// dois commanders possíveis do Limit Break: Cloud, Ex-SOLDIER tem
// synergy-equipment/quick-equip/power-matters-self (plano de equipamento);
// Tifa, Martial Artist tem power-matters/extra-combat-phase/extra-untap,
// sem nenhuma tag de equipamento (plano de combates extra). Mesmo deck,
// dois commanders possíveis, dois planos distintos - por isto a semente
// vem sempre do commander escolhido, nunca de um perfil fixo do deck.
// `cycle-*` sai da semente - não é curadoria do Diogo, é bookkeeping da
// Scryfall para agrupar ciclos e reimpressões dentro de um set (ex.
// `cycle-fic-face-commander`), sem relação nenhuma com jogabilidade. Já
// tinha reprovado no teste de dispersão do §7.1 (1386 tags, 55% sem
// papel) - remover isto é tirar ruído medido, não decidir o que é plano.
// Todas as outras tags do commander continuam sem filtro - essa curadoria
// é sempre do Diogo no formulário.
export function seedGamePlan(commanderCard) {
  const tags = (commanderCard?.oracle_tags ?? []).filter((t) => !t.startsWith('cycle-'));
  return {
    synergy_tags: tags,
    archetype: '',
    avoid_tags: [],
  };
}
