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

- Um commit por passo concluído, com mensagem descritiva
- Nomes de cartas em inglês internamente; UI em português
- Nada de dependências novas sem justificação — a app tem de continuar a servir
  como ficheiros estáticos
- Testes: `node --test "tests/*.test.mjs"`
- Dados pessoais (decklists, CSV da ManaBox) ficam fora do repositório
- Qualquer alteração ao scoring é medida contra o conjunto de validação
  (§8.6, `node tools/validation/measure.mjs`) e reportada como "X das
  escolhas do Diogo no top 10, Y das rejeitadas"

## Estado atual (30 out 2026)

O histórico está no git e na especificação; aqui só o ponto em que estamos.

- **Fase 1** aceite. **Fase 2:** §7.0, §7.1 e §7.2 feitos (o plano de jogo
  é curado pelo Diogo a partir de propostas tiradas das 99; sem plano
  guardado o motor não recomenda).
- **Motor (§8):** Fases A/B com barreiras de bracket (`data/bracket-rules.json`,
  `deck_config` mínimo), relevância só a partir de eixos curados, cortes
  emparelhados por papel e lote avaliado como deck, justificação
  determinística. Ainda não aparece na UI — corre pelo
  `tools/validation/measure.mjs`.

## Próxima sessão — pendentes por ordem (detalhe no §12 da especificação)

1. **O Diogo guarda o plano curado do Limit Break na app.** Depois:
   acrescentá-lo ao `game_plan` de `tools/validation/limit-break.json`,
   correr a medição e reportar "X das escolhas do Diogo no top 10, Y das
   rejeitadas" (registar no §8.6). **Nada mais se afina antes deste número
   existir.**
2. **EDHREC: não se implementa nada.** Os termos de uso proíbem acesso
   automatizado e redistribuição; o Diogo decide se pede autorização. Até
   lá o motor não tem sinal de força e as recomendações têm de o dizer
   (requisito ainda por cumprir: nem o `measure.mjs` nem a UI o dizem).
3. **Depois do ponto 1:** substituir os alvos do §7.1 pelo template da
   Command Zone (Rachel Weeks, fev. 2025: 38 terrenos, 10 ramp, 12 card
   advantage, 12 targeted disruption, 6 mass disruption, 30 plan cards;
   108 com sobreposição) num ficheiro de dados com fonte e data; dividir as
   plan cards em recursos, motores e payoffs, classificados ao nível das
   tags do plano, sem proporção alvo — só medida e mostrada. Decisões de
   correspondência com os papéis em §12, ponto 6.
4. **Depois:** importar o Shelob como segundo conjunto de validação, para
   confirmar que as correções não estão sobreajustadas ao Limit Break.

Em aberto sem ordem: pesos do score, `synergy-X` só por tipo literal,
autenticação da Anthropic API para a Fase D.
