// Plano de jogo do commander (§7.2). Semeado das oracle_tags do próprio
// commander - sem filtro automático, a curadoria é do Diogo no formulário
// ("resolve ambiguidade que nenhum algoritmo adivinha"). Confirmado com os
// dois commanders possíveis do Limit Break: Cloud, Ex-SOLDIER tem
// synergy-equipment/quick-equip/power-matters-self (plano de equipamento);
// Tifa, Martial Artist tem power-matters/extra-combat-phase/extra-untap,
// sem nenhuma tag de equipamento (plano de combates extra). Mesmo deck,
// dois commanders possíveis, dois planos distintos - por isto a semente
// vem sempre do commander escolhido, nunca de um perfil fixo do deck.
export function seedGamePlan(commanderCard) {
  return {
    synergy_tags: [...(commanderCard?.oracle_tags ?? [])],
    archetype: '',
    avoid_tags: [],
  };
}
