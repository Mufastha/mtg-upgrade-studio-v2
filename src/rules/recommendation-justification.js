// §8.5 Fase D (parte determinística) - justificação por par corte/adição.
// Invariante 4: determinístico antes do LLM - todos os factos vêm de
// computação real (papéis e folga do §7.1, tags/tipo do plano), nunca
// inventados. Um LLM, quando existir, só dá prosa a isto.
//
// Diz que papel sai, se a adição o repõe, e o que a adição traz - um score
// de 15 contra 0 não diz nada sem perceber a troca.
import { ROLE_LABELS, getEstablishedRoleForTag } from './deck-metrics.js';

function roleLabel(role) {
  return role === 'terrenos' ? 'Terrenos' : (ROLE_LABELS[role] ?? role);
}

function describeCut({ cut, replacedRoles, unreplacedRoles }) {
  if (cut.tier === 'sem-papel-reconhecido') {
    return 'sem papel do §7.1 nem tag do plano — fora do nosso vocabulário, o que não prova que seja fraca';
  }
  const parts = [`ocupa ${cut.occupiedRoles.map(roleLabel).join(', ')}`];
  if (replacedRoles.length > 0) parts.push(`reposto pela adição: ${replacedRoles.map(roleLabel).join(', ')}`);
  if (unreplacedRoles.length > 0) {
    const detail = unreplacedRoles.map((r) => `${roleLabel(r.role)} fica ${r.after}/${r.target}`).join(', ');
    parts.push(`não reposto, ${detail} — depende de o alvo do §7.1 estar certo`);
  }
  return parts.join('; ');
}

function describeAdd(add) {
  const gains = [];
  if (add.axisTagsMatched.length > 0) gains.push(`eixo do plano (${add.axisTagsMatched.join(', ')})`);
  if (add.axisTypeMatched.length > 0) gains.push(`eixo por tipo de carta (${add.axisTypeMatched.join(', ')})`);
  if (add.roleTagsMatched.length > 0) {
    const roles = [...new Set(add.roleTagsMatched.map((t) => roleLabel(getEstablishedRoleForTag(t))))];
    gains.push(`papel do §7.1 já coberto: ${roles.join(', ')} (via ${add.roleTagsMatched.join(', ')})`);
  }
  if (add.roles.length > 0) gains.push(`papéis: ${add.roles.map(roleLabel).join(', ')}`);
  if (add.review) gains.push(`a verificar à mão: ${add.review}`);
  return gains.length > 0 ? gains.join('; ') : 'nenhuma tag do plano nem papel do §7.1';
}

export function justifyPair(pair) {
  const cutText = describeCut(pair);
  const addText = describeAdd(pair.add);
  return {
    confidence: pair.cut.confidence,
    tier: pair.cut.tier,
    cut: { name: pair.cut.card.name, reason: cutText },
    add: { name: pair.add.card.name, gain: addText },
    summary: `Sai ${pair.cut.card.name} (${cutText}). Entra ${pair.add.card.name} (${addText}).`,
  };
}

export function justifyRecommendations(pairs) {
  return pairs.map(justifyPair);
}
