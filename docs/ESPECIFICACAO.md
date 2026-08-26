# MTG Upgrade Studio — Especificação (v1)

**Data:** 17 de agosto de 2026
**Estado:** decisões fechadas, pronto para implementação da Fase 1

---

## 1. Objetivo

Ferramenta pessoal para melhorar decks de Commander que já existem, cruzando
recomendações de cartas com a coleção real e produzindo uma lista de compras
para o Cardmarket.

### Dentro do âmbito (v1)

1. Ler e guardar a coleção (export da ManaBox)
2. Ler e guardar decks, e caracterizar o seu intuito
3. Recomendar cartas com base nesse intuito
4. Separar as recomendações em: já tenho / comprar / proxy
5. Exportar lista de compras em formato Cardmarket

### Fora do âmbito (v1)

- Construir decks de zero
- Registo de partidas ou estatísticas de jogo
- Multi-utilizador ou partilha pública
- Integração transacional com o Cardmarket (ver §9)

---

## 2. Princípios de arquitetura

Estas decisões estão fechadas. Se alguma for revertida, é uma alteração
estrutural e a especificação tem de ser atualizada primeiro.

**P1. `oracle_id` é a chave da lógica de jogo.** O `scryfall_id` (impressão
específica) só é usado para saber que cópia física existe na coleção e para
calcular preços. Tudo o que seja análise de deck ou recomendação opera sobre
`oracle_id`.

**P2. Três classes de dados, três destinos.**

| Classe | Exemplos | Onde vive |
|---|---|---|
| Referência | catálogo de cartas, tags, Game Changers, regras de bracket | Ficheiro estático no GitHub Pages, cacheado no browser |
| Pessoal | coleção, decks, configurações | Local (IndexedDB); Supabase a partir da Fase 4 |
| Derivada | execuções de recomendação, snapshots de preço | Local, purgável |

Dados de referência **nunca** vão para o Supabase. São públicos, idênticos para
todos e o Scryfall serve-os de graça.

**P3. Local-first.** O motor de recomendação corre inteiramente no browser sobre
o catálogo cacheado. Nenhum filtro depende da rede. A app tem de funcionar
offline depois do primeiro carregamento.

**P4. O preço é sempre uma estimativa.** Nunca é apresentado como preço. O
Scryfall avisa explicitamente que os preços dos ficheiros bulk servem para
estimativa geral e tendências, não para operações comerciais. A conta a sério
faz-se no Cardmarket.

**P5. Determinístico primeiro, LLM depois.** Nenhuma carta chega ao ecrã sem ter
passado pelos filtros determinísticos. O LLM só reordena e justifica um conjunto
já validado. Qualquer nome de carta produzido pelo LLM é resolvido contra o
catálogo antes de ser mostrado; se não resolver, é descartado em silêncio.

**P6. Regras em dados, não em código.** As regras de bracket vivem num ficheiro
JSON versionado. A WotC atualiza o sistema a cada 3–4 meses; a resposta a isso é
editar um ficheiro, não alterar lógica.

**P7. Reprodutibilidade.** Cada execução de recomendação guarda os parâmetros e
os preços que usou. Uma lista de compras de há duas semanas continua a fazer
sentido.

---

## 3. Camada de dados

### 3.1 Construção do catálogo

Uma GitHub Action semanal (mais execução manual após lançamento de edições)
produz `catalog.json.gz` e publica-o com a app.

Fontes:

- Scryfall bulk `oracle_cards` — uma entrada por `oracle_id`
- Scryfall bulk `oracle_tags` — tags funcionais do projeto Tagger, join por `oracle_id`
- Scryfall query `is:gamechanger` — lista oficial de Game Changers
- Scryfall bulk `default_cards` — apenas para calcular o preço mínimo por impressão

Filtros aplicados na construção:

- `legalities.commander == "legal"`
- Excluir tokens, emblemas, cartas de brincadeira e objetos não jogáveis

Campos retidos por carta (o resto é descartado — é isto que torna o ficheiro pequeno):

```
oracle_id, name, mana_cost, cmc, type_line, oracle_text,
color_identity, keywords, layout, is_gamechanger,
edhrec_rank, oracle_tags[], price_eur_min, price_source_date,
cardmarket_uri
```

`price_eur_min` = menor `prices.eur` entre todas as impressões não-foil da
carta. Se não existir preço em EUR, o campo fica nulo e a carta é tratada como
"preço desconhecido", nunca como grátis.

**Critério de aceitação:** o ficheiro comprimido tem de ficar abaixo de 10 MB. Se
não ficar, cortar `oracle_text` para as cartas fora do pool de recomendação.

### 3.2 Versionamento e atualização

O catálogo publica um `manifest.json` com `{version, built_at, card_count, sha}`.
A app compara com o que tem em cache e descarrega se for diferente. O
utilizador não faz nada.

### 3.3 Armazenamento local

IndexedDB, com as seguintes stores:

| Store | Chave | Notas |
|---|---|---|
| `catalog` | `oracle_id` | Descartável, re-descarregável |
| `collection` | `scryfall_id` | Vem da ManaBox |
| `decks` | `deck_id` | |
| `deck_cards` | `(deck_id, oracle_id)` | |
| `deck_configs` | `config_id` | Ver §5 |
| `runs` | `run_id` | Execuções + snapshots de preço |

**Exportar/importar JSON de tudo o que é pessoal é obrigatório na Fase 1.** Até
existir sincronização, é a única proteção contra limpar os dados do browser.

---

## 4. Importadores

### 4.1 Coleção (ManaBox CSV)

Resolução por `scryfall_id` quando presente; fallback para
`(nome, código de edição, número de colecionador)`; último recurso, nome exato.
Agregar quantidades por `oracle_id` para uso na análise.

Guardar: `scryfall_id`, `oracle_id`, quantidade, foil, edição.
**Não** usar estado da carta para nada (ver P4).

Toda a linha que não resolva vai para um relatório de importação visível. Falhas
silenciosas são inaceitáveis — uma carta que não resolve é uma carta que a app
acha que não tens.

### 4.2 Decks

Formato de entrada: texto simples, uma carta por linha, `1 Sol Ring`. Linhas
começadas por `//` ignoradas. O commander é identificado por marcação explícita
ou escolhido pelo utilizador na importação.

Fase 2 pode acrescentar import por URL (Moxfield, Archidekt).

---

## 5. Configurações de deck

Um deck tem **N configurações**, não uma. É o que permite ter o mesmo deck
avaliado para torneio de Bracket 3 e para uma mesa casual.

```
deck_config {
  config_id, deck_id, name,
  target_bracket: 1..5,
  max_price_per_card_eur,
  total_budget_eur,
  max_changes,
  max_cmc,
  exclude_tags: [],          // mass land denial, extra turns, stax, ...
  max_tutors,
  exclude_reserved_list: bool,
  untouchable: [oracle_id],  // nunca sugerir como corte
  edhpowerlevel_result: { recommended_bracket, checked_at }  // manual
}
```

As recomendações pertencem ao par *(deck, config)*, nunca ao deck.

---

## 6. Regras de bracket

Ficheiro `bracket-rules.json`, versionado, com a data da atualização da WotC a
que corresponde. **Estado atual: atualização de 9 de fevereiro de 2026.**

| Critério | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Game Changers | 0 | 0 | ≤ 3 | livre | livre |
| Mass land denial | não | não | não | livre | livre |
| Extra turns | nenhum | sem chaining | sem chaining | livre | livre |
| Combos de 2 cartas | não | não | só late game | livre | livre |
| Turno esperado de fim | 9+ | 8+ | 6+ | 4+ | qualquer |
| Tutores | sem restrição | sem restrição | sem restrição | livre | livre |

Notas a manter no ficheiro:

- As restrições a tutores foram **removidas** dos brackets 1–3 na atualização de
  outubro de 2025. Regras mais antigas que circulam por aí estão desatualizadas.
- O Bracket 1 admite Game Changers em casos muito temáticos combinados antes do
  jogo. É uma exceção social; a app não a avalia.
- A lista de Game Changers vem sempre de `is:gamechanger`, nunca hardcoded.

### 6.1 Três estados, não dois

Cada linha da checklist devolve `pass`, `fail` ou `review`:

| Critério | Verificação | Estado possível |
|---|---|---|
| Game Changers | contagem via flag do catálogo | pass / fail |
| Extra turns | oracle tags + lista curada | pass / fail |
| Mass land denial | oracle tags + lista curada | pass / fail |
| Combos de 2 cartas | Commander Spellbook | pass / review |
| "Só late game" | heurística sobre custo total das peças | review |
| Turno de fim | não determinável a partir da lista | review |

Uma checklist que dá verde sem ter verificado é pior do que não existir.

### 6.2 Onde a checklist aparece

O mesmo componente em três sítios:

1. **Estado atual do deck** — bracket mínimo permitido pelas barreiras
2. **Por carta recomendada** — que linha da checklist esta carta mexe
3. **Simulação** — checklist projetada com as adições e cortes selecionados,
   ao lado da atual

O ponto 3 é a feature central da app antes de um torneio.

### 6.3 Relação com o EDHPowerLevel

O EDHPowerLevel avalia as mesmas barreiras oficiais **e** produz um bracket
recomendado a partir de um cálculo próprio baseado em dados de procura de
mercado. O grupo de torneio exige "recomendado 3".

Divisão de responsabilidades:

- **A app replica as barreiras.** São regras oficiais, determinísticas.
- **A app não replica o bracket recomendado.** Fica como campo manual, com data.
- Integração desejável (Fase 5): gerar link pré-preenchido via HXDEC, o formato
  compacto do EDHPowerLevel, que tem biblioteca open-source. **A confirmar na
  implementação** — não foi possível verificar a biblioteca a partir da
  documentação pública.

---

## 7. Perfil de deck

Três camadas, por ordem de confiança:

**7.1 Determinística (automática).** Curva de mana, contagem de terrenos e fontes
de mana, contagens por papel (ramp, draw, remoção, interação, wincons),
histograma de oracle tags, densidade de interação. Produz a lista de **papéis em
falta**, que alimenta o scoring.

**7.2 Declarada (formulário).** Arquétipo, eixos de sinergia principais, linhas
indesejadas, cartas intocáveis. Trinta segundos por deck; resolve ambiguidade que
nenhum algoritmo adivinha.

**7.3 Sintetizada (LLM).** O modelo lê a lista mais as métricas e propõe um
perfil em JSON estruturado. **Sempre revisto e editado pelo utilizador antes de
ser guardado.** Nunca aceite automático. Guardado com versão.

---

## 8. Motor de recomendação

Quatro fases, nesta ordem. A ordem é o desenho, não uma sugestão.

**Fase A — Geração de candidatos.** Pool inicial: catálogo ∩ identidade de cor do
commander. Enriquecido por sobreposição de oracle tags com o perfil do deck e
por dados de commander (EDHREC).

**Fase B — Filtros duros.** Legalidade, identidade de cor, barreiras do bracket
alvo, `exclude_tags`, `max_cmc`, Reserved List se excluída, cartas já no deck.
Uma carta que falhe qualquer filtro não continua.

**Fase C — Scoring.** Soma ponderada, com os pesos configuráveis e visíveis:

```
score = w1 * sobreposição_de_tags_com_perfil
      + w2 * preenchimento_de_papel_em_falta
      + w3 * eficiência (proxy: edhrec_rank)
      + w4 * bónus_já_na_coleção
      - w5 * penalização_de_preço
```

**Fase D — Reordenação e justificação (LLM).** Apenas sobre o top ~40. Devolve
ordenação, justificação por carta e pares adição/corte propostos. Todo o output
é validado contra o catálogo (P5).

**Cortes.** Um deck de 100 cartas não aceita adições sem remoções. A engine
propõe pares; o corte é sempre decisão do utilizador; cartas em `untouchable`
nunca aparecem como corte.

---

## 9. Orçamento e proxy

Dois parâmetros: `max_price_per_card_eur` (fronteira do proxy) e
`total_budget_eur` (quanto se compra).

Três baldes por execução:

- **Tenho** — presente na coleção, custo zero
- **Comprar** — abaixo do máximo por carta e cabe no orçamento, por ordem de score
- **Proxy** — acima do máximo por carta

Cartas de preço desconhecido vão para "revisão", não para "comprar".

---

## 10. Exportação para Cardmarket

Formato aceite pela wants list: **uma carta por linha**, quantidade opcional à
frente, edição opcional entre parênteses. Nomes em inglês.

```
1 Sol Ring
2 Dark Confidant (Modern Masters)
```

Restrições da plataforma a respeitar: até 150 entradas por wants list. Listas
maiores são divididas automaticamente pela app.

A exportação inclui também uma versão com link direto do Cardmarket por carta
(`cardmarket_uri` do catálogo) e a lista de proxies em separado.

**A app decide *o quê* comprar. O Cardmarket decide *onde* e *a que preço*.** A
otimização de estado, vendedor e portes é feita pelo shopping wizard deles, que
faz isso melhor do que qualquer coisa construída aqui.

---

## 11. Fases e critérios de aceitação

Cada fase termina com um commit e com algo utilizável. Deck de validação: **Shelob**.

### Fase 1 — Fundação de dados
- GitHub Action constrói e publica `catalog.json.gz` + `manifest.json`
- App carrega e cacheia o catálogo; funciona offline depois disso
- Importador ManaBox com relatório de falhas
- Importador de decklist em texto
- Exportar/importar JSON de dados pessoais

**Aceite quando:** o catálogo comprimido está abaixo de 10 MB, o export da
coleção resolve com menos de 1% de falhas não explicadas, e o deck Shelob importa
com 100 cartas identificadas.

### Fase 2 — Análise de deck
- Métricas determinísticas (§7.1)
- Formulário de perfil declarado (§7.2)
- Configurações de deck com bracket alvo (§5)
- Checklist de bracket com três estados (§6)

**Aceite quando:** a checklist do Shelob corresponde ao que o EDHPowerLevel mostra
para as barreiras verificáveis automaticamente.

### Fase 3 — Cruzamento e exportação
- Deck × coleção: o que tenho, o que falta
- Baldes de orçamento e proxy (§9)
- Exportação Cardmarket (§10)

**Aceite quando:** uma lista exportada é aceite pela wants list do Cardmarket sem
linhas rejeitadas.

### Fase 4 — Motor de recomendação
- Fases A a C (§8), sem LLM
- Simulação de checklist projetada (§6.2)
- Sincronização Supabase dos dados pessoais

**Aceite quando:** duas execuções com os mesmos parâmetros dão o mesmo resultado,
e nenhuma carta recomendada quebra uma barreira do bracket alvo.

### Fase 5 — Reordenação e integrações
- Fase D (§8): reordenação e justificações
- Pares adição/corte
- Combos via Commander Spellbook
- Link HXDEC para o EDHPowerLevel (a confirmar)

**Aceite quando:** nenhuma carta inexistente chega ao ecrã em 50 execuções.

---

## 12. Riscos e decisões abertas

| Risco | Mitigação |
|---|---|
| Limpar dados do browser antes da Fase 4 | Export JSON obrigatório desde a Fase 1 |
| Regras de bracket mudam | Ficheiro de dados versionado (P6) |
| Preço estimado diverge do real | Enquadrado como estimativa em toda a UI (P4) |
| LLM inventa cartas | Validação contra catálogo (P5) |
| Biblioteca HXDEC não serve | Fallback: copiar e colar, como já é feito hoje |

**Aberto:** pesos iniciais do scoring (§8 Fase C) — a calibrar empiricamente na
Fase 4 contra decks já conhecidos.
