# MTG Upgrade Studio

Ferramenta pessoal para melhorar decks de Commander existentes: cruza
recomendações de cartas com a coleção real e produz listas de compra para o
Cardmarket.

**Lê `docs/ESPECIFICACAO.md` antes de escrever código.** Este ficheiro é só o
resumo das decisões que não devem ser re-discutidas em cada sessão.

## Contexto

Projeto pessoal do Diogo, jogador de Commander. Responder em português europeu.
Participa em torneios de Bracket 3 e precisa que a app respeite as barreiras
oficiais da WotC de forma fiável.

Esta é uma reconstrução. A versão anterior cresceu por acumulação de widgets sem
fundação de dados, e o objetivo desta é não repetir isso.

## Stack

HTML/JS puro, sem framework. GitHub Pages. IndexedDB para persistência local.
Supabase apenas a partir da Fase 4 e apenas para dados pessoais. Anthropic API
para as partes de linguagem.

## Invariantes

Estas regras não se negociam sessão a sessão. Se alguma parecer errada, discutir
e atualizar a especificação primeiro — não contorná-la em código.

1. **`oracle_id` é a chave da lógica de jogo.** `scryfall_id` só para coleção
   física e preços.
2. **Dados de referência nunca vão para o Supabase.** Catálogo, tags e Game
   Changers são ficheiro estático no GitHub Pages, cacheado no browser.
3. **O preço é sempre estimativa.** Nunca apresentado como preço. Preço
   desconhecido nunca é tratado como zero.
4. **Determinístico antes do LLM.** O LLM só reordena e justifica candidatos já
   filtrados. Todo o nome de carta que ele produz é resolvido contra o catálogo
   antes de aparecer; se não resolver, é descartado.
5. **Regras de bracket vivem em `bracket-rules.json`**, não em código. A WotC
   atualiza a cada 3–4 meses.
6. **A lista de Game Changers vem de `is:gamechanger`** no Scryfall. Nunca
   hardcoded.
7. **A checklist de bracket tem três estados:** `pass`, `fail`, `review`. Nunca
   dar verde a um critério que não foi verificado.
8. **Recomendações pertencem ao par (deck, configuração)**, nunca ao deck.
9. **Falhas de importação são sempre visíveis.** Uma carta que não resolve é uma
   carta que a app acha que o utilizador não tem.
10. **Local-first.** Nenhum filtro do motor depende da rede. A app funciona
    offline depois do primeiro carregamento.
11. **`printings.json` carrega-se sob demanda, nunca no arranque.** Tem 32 MB
    (§3.1 da especificação) e só serve para o importador da ManaBox resolver
    `scryfall_id → oracle_id` (§4.1). O arranque da app só descarrega
    `catalog.json.gz` + `manifest.json`.
12. **A coleção é uma cópia de leitura da ManaBox, nunca editável na app.** Um
    import substitui-a inteira (§4.1); não há edição nem remendo linha a
    linha, para não criar uma segunda fonte de verdade a divergir da real.
    Corrigir a coleção é corrigir o export e reimportar.

## Convenções

- Um commit por fase concluída, com mensagem descritiva
- Nomes de cartas em inglês internamente; UI em português
- Nada de dependências novas sem justificação — a app tem de continuar a servir
  como ficheiros estáticos

## Estado atual

Fase 1 (fundação de dados) aceite — os três critérios do §11 da
especificação estão cumpridos e testados contra dados reais do Diogo.
Fase 2 (análise de deck) por começar, exceto três partes já feitas — ver
§11 da especificação:
- **§7.0** (validação de legalidade do deck).
- **§7.2** (formulário de plano de jogo), 5 de setembro de 2026:
  `seedGamePlan` (`src/rules/game-plan.js`) copia as `oracle_tags` do
  commander — a curadoria do resto é do Diogo no formulário, não do
  código. Painel "Ver plano de jogo" na lista de decks, guardado em
  `deck.game_plan`. Confirmado com Cloud (`synergy-equipment`/
  `quick-equip`) vs Tifa (`power-matters`, nenhuma de equipamento) — dois
  planos distintos do mesmo deck. **Validado pelo Diogo e revisto no
  mesmo dia:** `cycle-*` filtrado da semente (bookkeeping da Scryfall, já
  reprovado no teste de dispersão do §7.1 — remover ruído medido, não
  curadoria); tags semeadas que já são papel do §7.1
  (`burst-draw`/`draw-engine`/`repeatable-pure-draw` → Draw, no Cloud)
  ficam anotadas no formulário (`getEstablishedRoleForTag` em
  `deck-metrics.js`) sem serem removidas sozinhas — o Diogo decide se
  dilui o eixo de sinergia ao curar. **Pronto para o §8.**
- **§7.1** (métricas determinísticas por papel), revista no mesmo dia:
  fiabilidade de uma família de tags apura-se por teste mecânico (como as
  cartas do catálogo com essa tag se distribuem pelos papéis — converge
  numa, classifica; espalha-se, não classifica), não por lista fixa; sem
  métrica agregada a somar baldes; anulação por deck quando o Diogo
  discorda da classificação global. **Revista de novo em 2 de setembro de
  2026:** teste de convergência corrido sobre o catálogo todo, 11 tags
  novas incorporadas por tag exata (nunca prefixo), mecanismo de sugestão
  incerta implementado (`buildTagRoleHints` em `deck-metrics.js`, n≥25 e
  ≥80% de concentração) com terceiro estado de anulação `"confirm"` (limpa
  a incerteza sem mudar a inclusão). Testado contra o catálogo real e o
  Limit Break — ver §11 da especificação. **Revista uma terceira vez em 5
  de setembro de 2026:** Draw estava a contar `impulsive-draw` e as duas
  tags-irmãs (exílio-e-jogar, nunca chega à mão) — erro da tabela
  original, corrigido; Draw do Limit Break passa de 12 para 9. Essas três
  tags formam sozinhas o novo 9º papel, **Acesso Temporário** — medido e
  mostrado, **sem alvo de referência** (um número para um papel de dias
  não tem base nenhuma, corrigido no mesmo dia depois de um primeiro
  rascunho tentativo) — testados e rejeitados como candidatos ao mesmo
  papel:
  `cost-reducer`, `gives-haste` (armadilha de nome — subproduto de roubo/
  reanimação, não "haste em massa"), `extra-land`/`play-additional-land`,
  `ritual`/`ritual-untap` (0–8% de sobreposição com as três, todos já bem
  servidos noutros papéis). `wheel-one-sided` excluído (26 de 85 cartas
  dependiam só dela, não compensa confirmar oracle_text carta a carta) e
  registado na lista de revisão futura do §7.1.

Depois de aceite, a Fase 1 recebeu uma ronda de correções vindas de uso
real: visualizador de coleção e de decks guardados (pesquisa, paginação,
renomear, apagar), confirmação antes de operações destrutivas (apagar
coleção, importar JSON), e a correção mais importante — o relatório de
falhas do importador da ManaBox deixou de depender da rede em tempo real
para explicar um erro (violava a invariante 10); a razão vem agora de
`excluded.json`, gerado na build.

**§8 Fases A/B implementadas em 27 de setembro de 2026**
(`src/rules/candidate-generation.js`, `generateCandidates`) — geração de
candidatos + filtros duros, sem scoring. Testado contra o Limit Break real
(catálogo de 21 de setembro): 31 830 → 18 382 (identidade de cor Naya) →
18 381 (exclui commander) → 18 288 (exclui as 100 cartas do deck). Antes
de implementar: confirmado que o workflow do catálogo (`build-catalog.yml`)
correu toda semana sem interrupção durante o interregno (GitHub não o
desativou por inatividade) — catálogo local desatualizado (28 de agosto)
foi substituído pelo deploy mais recente do Pages (21 de setembro, 53 Game
Changers) antes de gerar candidatos. **Gap do `reserved` fechado no mesmo
dia:** campo acrescentado ao catalog-builder (`tools/catalog-builder/lib/
catalog.mjs`), efetivo no próximo build — o filtro em si continua por
implementar (depende de `deck_config`, §5).

**§8 Fase C implementada em 27 de setembro de 2026**
(`src/rules/recommendation-score.js`, `scoreCard` + `generateRecommendations`),
resolvendo as duas descobertas do mesmo dia (detalhe no §8 da
especificação): (a) o plano **pontua, nunca filtra** a Fase A, e as
`synergy_tags` dividem-se em **eixo genuíno** vs **papel já coberto do
§7.1** (`getEstablishedRoleForTag`), pesadas por sliders separados
(`w_eixo=3`, `w_papel=1`, `w_evitar=2`, tentativos); (b) `edhrec_rank`
saiu do score — fica só como informação ao lado de cada carta. Testado
contra o Limit Break real: 10 pares corte/adição gerados, ordenados
corretamente (nenhuma candidata pontua pior do que a carta cortada).

**Empate de 72% em score 0 resolvido no mesmo dia** com elegibilidade de
corte a partir do §7.1 (`computeCutTiers` em `recommendation-score.js`,
detalhe no §8 da especificação): protegida (única a preencher um papel
ou o único terreno — nunca candidata, `Hellkite Tyrant`/`Tifa` no Limit
Break) / primeira-a-sair (sem papel nenhum, sem sinergia) / legítima
(papel com folga — `Arcane Signet` cai aqui) / sem-folga. `edhrec_rank`
continua fora de qualquer critério, mesmo como desempate. **Gap
encontrado e corrigido no processo:** terrenos vivem fora de `roleCards`
(têm `LAND_TARGET` próprio) — sem tratamento especial caíam todos em
"primeira-a-sair" e a primeira lista de corte ficou cheia de terrenos;
tratados como mais um "papel" sintético antes de fechar. Testado contra
o Limit Break real: 10 pares corte/adição, nenhum terreno nem ramp
fundamental na lista.

**Limite conhecido, aberto no §12:** a elegibilidade avalia cada carta
isoladamente contra o estado atual do deck, não simula cortar várias do
mesmo papel/terrenos em conjunto no mesmo lote — não é um problema no
Limit Break (só havia 1 terreno de folga), mas é uma lacuna real para
decks com folgas maiores.

**Pendente:** validação do Diogo sobre a nova lista de corte/adição do
Cloud (com a elegibilidade do §7.1) antes de avançar para a Fase D. Só
depois disto: Fase D (LLM, reordenação e justificação sobre o top ~40) e
a simulação de checklist de bracket (§6.2) — Fases A/B/C já prontas.

**Decidido mas ainda por implementar** (documentado em §8/§6.4 da
especificação, para retomar em código sem re-discutir):
- Cortes por excesso de Game Changers do bracket exigem par de substituição
  (§8); regras próprias do grupo de torneio (turno esperado, combo com o
  commander, limiar de mana de combo precoce) ficam em
  `group_interpretation` dentro de `bracket-rules.json` (§6.4), marcadas
  como leitura do grupo, não regra oficial.

Dois decks de validação, com papéis diferentes (ver §11 da especificação):
- **Limit Break** (Cloud, Ex-SOLDIER) — Fases 1 a 3.
- **Shelob** (aranhas / deathtouch / Food) — Fases 4 e 5.
