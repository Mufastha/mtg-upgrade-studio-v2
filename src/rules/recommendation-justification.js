// §8 Fase D (parte determinística) - justificação por par corte/adição.
// Invariante 4/P5: determinístico antes do LLM - todos os factos aqui vêm
// de computação real (papéis e folga do §7.1 via computeCutTiers, tags/
// tipo do plano via scoreCard), nunca inventados. Se um dia um LLM entrar
// nisto (por implementar - falta decidir como a app autentica a
// Anthropic API, nunca feito neste projeto), o trabalho dele é dar prosa
// a estes factos, nunca produzir factos novos.
//
// Pedido do Diogo (27 de setembro de 2026): "uma carta com score 15
// contra 0 não me diz nada se eu não perceber a troca" - a justificação
// tem de dizer que papel sai, que papel entra, e o que o deck ganha, não
// só o número do score.
import { ROLE_LABELS, getEstablishedRoleForTag } from './deck-metrics.js';

function roleLabel(role) {
  return role === 'terrenos' ? 'Terrenos' : (ROLE_LABELS[role] ?? role);
}

function describeCut(cut) {
  if (cut.tier === 'primeira-a-sair') {
    return 'sem papel do §7.1 e sem nenhuma tag do plano - sai sem custo estrutural conhecido';
  }
  const roles = cut.occupiedRoles.map(roleLabel).join(', ');
  const folga = cut.minSlack != null ? cut.minSlack : '?';
  return (
    `ocupa ${roles} (folga de ${folga} sobre o alvo do §7.1) - o deck continua a cumprir o alvo ` +
    'depois do corte, mas esta decisão depende desse alvo estar certo (§12, ainda por validar)'
  );
}

function describeAdd(add) {
  const gains = [];
  if (add.axisTagsMatched.length > 0) {
    gains.push(`eixo do plano (${add.axisTagsMatched.join(', ')})`);
  }
  if (add.axisTypeMatched.length > 0) {
    gains.push(`eixo por tipo de carta (${add.axisTypeMatched.join(', ')})`);
  }
  if (add.roleTagsMatched.length > 0) {
    const roles = [...new Set(add.roleTagsMatched.map((t) => roleLabel(getEstablishedRoleForTag(t))))];
    gains.push(`papel do §7.1 já coberto: ${roles.join(', ')} (via ${add.roleTagsMatched.join(', ')})`);
  }
  if (gains.length === 0) {
    return 'nenhuma tag do plano nem papel do §7.1 identificado - candidata mais fraca do lote';
  }
  return gains.join('; ');
}

// Um par por vez - devolve os factos estruturados (para a UI decidir como
// mostrar) e um resumo em português já pronto a apresentar.
export function justifyPair({ cut, add }) {
  const cutText = describeCut(cut);
  const addText = describeAdd(add);
  return {
    confidence: cut.confidence,
    tier: cut.tier,
    cut: { name: cut.card.name, reason: cutText },
    add: { name: add.card.name, gain: addText },
    summary: `Sai ${cut.card.name} (${cutText}). Entra ${add.card.name} (ganha: ${addText}).`,
  };
}

export function justifyRecommendations(pairs) {
  return pairs.map((pair) => justifyPair(pair));
}
