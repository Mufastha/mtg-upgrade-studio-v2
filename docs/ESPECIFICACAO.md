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
produz `catalog.json.gz`, `printings.json` e `manifest.json` e publica-os como
artefacto de deployment do GitHub Pages — não ficam no histórico do
repositório (ver §3.2). O builder escreve para `catalog/` na raiz do
repositório (gitignored); o workflow copia essa pasta tal e qual para dentro
de `dist/`, que é o que `actions/upload-pages-artifact` publica. Os três
ficheiros ficam então em `/catalog/` a partir da raiz do site publicado:

```
https://<utilizador>.github.io/<repo>/catalog/catalog.json.gz
https://<utilizador>.github.io/<repo>/catalog/printings.json
https://<utilizador>.github.io/<repo>/catalog/manifest.json
```

Fontes (bulk files descarregados como `.jsonl.gz` — NDJSON gzipped, um objeto
por linha, via `jsonl_download_uri` listado em `GET /bulk-data`; não é um único
array JSON):

- Scryfall bulk `oracle_cards` — uma entrada por `oracle_id`
- Scryfall bulk `oracle_tags` — tags funcionais do projeto Tagger. Cada
  registo é uma *tag* com uma lista `taggings` de `oracle_id`, não o
  contrário — a construção inverte isto para obter `oracle_tags[]` por carta
- Scryfall query `is:gamechanger` — lista oficial de Game Changers
- Scryfall bulk `default_cards` — uma entrada por impressão; alimenta
  `printings.json` e o cálculo de `price_eur_min`

Filtros aplicados na construção:

- `legalities.commander == "legal"`
- Excluir tokens, emblemas, cartas de brincadeira e objetos não jogáveis

#### catalog.json.gz

Campos retidos por carta (o resto é descartado — é isto que torna o ficheiro pequeno):

```
oracle_id, name, mana_cost, cmc, type_line, oracle_text,
color_identity, keywords, layout, is_gamechanger,
edhrec_rank, oracle_tags[], price_eur_min, price_source_date,
price_source_scryfall_id
```

`price_eur_min` = menor `prices.eur` entre todas as impressões não-foil da
carta. Se não existir preço em EUR, o campo fica nulo e a carta é tratada como
"preço desconhecido", nunca como grátis.

`price_source_scryfall_id` = `scryfall_id` da impressão que gerou
`price_eur_min`. É a chave para a exportação Cardmarket (§10) ir buscar o
`cardmarket_uri` certo a `printings.json` — sem isto não há como saber qual
das N impressões de uma carta foi a mais barata.

**Critério de aceitação:** o ficheiro comprimido tem de ficar abaixo de 10 MB. Se
não ficar, cortar `oracle_text` para as cartas fora do pool de recomendação.

Medido em produção (26 de agosto de 2026, 31 830 cartas): **5,17 MB**.

#### printings.json

Mapa de impressão: é o que permite ao importador da ManaBox (§4.1) resolver
`scryfall_id → oracle_id` offline, sem depender da rede (P3). `cardmarket_uri`
é uma propriedade da impressão, não da carta oracle — por isso vive aqui, não
em `catalog.json.gz`.

Campos por entrada, chave `scryfall_id`:

```
scryfall_id, oracle_id, set, collector_number, cardmarket_uri
```

Construído a partir do mesmo bulk `default_cards` que alimenta `price_eur_min`,
sujeito aos mesmos filtros de legalidade e tipo de objeto do catálogo.

Medido em produção (26 de agosto de 2026, 106 687 impressões): **32 MB em
disco, não comprimido** (ao contrário de `catalog.json.gz`). O GitHub Pages
comprime-o em trânsito de forma transparente (~6,4 MB pela rede), mas o
ficheiro em si não leva gzip — é só usado sob pedido, nunca no arranque da app
(ver a invariante 11 no CLAUDE.md e §3.2).

### 3.2 Versionamento e atualização

`catalog.json.gz`, `printings.json` e `manifest.json` **não são commitados.**
Cada build semanal deixaria um blob de vários MB no histórico do
repositório, permanentemente, sem nenhum benefício — só o código e os dados
de referência escritos à mão (como `bracket-rules.json`) vivem no git. A
Action gera os três ficheiros no runner e publica-os como artefacto de
deployment do GitHub Pages (`actions/upload-pages-artifact` +
`actions/deploy-pages`), lado a lado com os ficheiros estáticos da app.

`manifest.json` tem `{version, built_at, card_count, sha}`. A app compara com
o que tem em cache (IndexedDB) e descarrega `catalog.json.gz` de novo se for
diferente. O utilizador não faz nada.

**`printings.json` carrega-se à parte, sob demanda — nunca no arranque.** É
só necessário no importador da ManaBox (§4.1); 32 MB não têm lugar no
carregamento inicial da app. Ver a invariante 11 no CLAUDE.md.

Nuance de transporte a ter em conta no loader: `catalog.json.gz` é gzip como
*formato de ficheiro* (`Content-Type: application/gzip`, sem
`Content-Encoding`) — chega ao browser ainda comprimido e tem de ser
descomprimido explicitamente (`DecompressionStream('gzip')`, nativo, sem
dependência nova). `printings.json` é servido sem compressão de ficheiro, mas
o GitHub Pages aplica `Content-Encoding: gzip` em trânsito de forma
transparente — o `fetch()` já devolve JSON descomprimido, sem passo manual.

### 3.3 Armazenamento local

IndexedDB, com as seguintes stores:

| Store | Chave | Notas |
|---|---|---|
| `catalog` | `oracle_id` | Descartável, re-descarregável |
| `printings` | `scryfall_id` | Descartável, re-descarregável — de `printings.json` (§3.1) |
| `collection` | `(scryfall_id, foil)` | Vem da ManaBox — chave composta: a Scryfall trata foil e não-foil da mesma impressão como o mesmo `scryfall_id` (`finishes[]` é que distingue), e um export real tem as duas quantidades lado a lado |
| `decks` | `deck_id` | Inclui `source_precon` opcional (§4.3) |
| `deck_cards` | `(deck_id, oracle_id)` | |
| `deck_configs` | `config_id` | Ver §5 |
| `runs` | `run_id` | Execuções + snapshots de preço |

**Exportar/importar JSON de tudo o que é pessoal é obrigatório na Fase 1.** Até
existir sincronização, é a única proteção contra limpar os dados do browser.

---

## 4. Importadores

### 4.1 Coleção (ManaBox CSV)

Resolução contra `printings.json` (§3.1): `scryfall_id` quando presente resolve
direto para `oracle_id`; fallback para `(nome, código de edição, número de
colecionador)`, também contra `printings.json`; último recurso, nome exato
contra `catalog.json.gz`. Agregar quantidades por `oracle_id` para uso na
análise.

Guardar por `(scryfall_id, foil)` (§3.3): `scryfall_id`, `oracle_id`,
quantidade, foil, edição. Linhas que resolvam para a mesma chave (a ManaBox
por vezes repete uma impressão entre scans) somam a quantidade em vez de se
substituírem. A importação substitui a coleção guardada — é sempre o estado
atual completo, não um incremento.
**Não** usar estado da carta para nada (ver P4).

Toda a linha que não resolva vai para um relatório de importação visível. Falhas
silenciosas são inaceitáveis — uma carta que não resolve é uma carta que a app
acha que não tens.

### 4.2 Decks

Formato de entrada: texto simples, uma carta por linha, `1 Sol Ring`. Linhas
começadas por `//` ignoradas. O commander é identificado por marcação explícita
ou escolhido pelo utilizador na importação.

Marcação explícita: `CMDR` no lugar da quantidade, ex. `CMDR Cloud,
Ex-SOLDIER`. Sem essa marca em nenhuma linha, o import mostra as cartas
resolvidas e o utilizador escolhe o commander antes de guardar — nunca um
palpite automático (ex. a primeira lenda da lista).

Resolução por nome exato contra `catalog.json.gz`, sem distinguir
maiúsculas/minúsculas (ao contrário do importador da ManaBox, que já recebe
nomes de uma fonte fiável). Cartas repetidas em linhas separadas (ex.
terrenos básicos em blocos por edição) agregam por `oracle_id`.

Fase 2 pode acrescentar import por URL (Moxfield, Archidekt).

### 4.3 Deck derivado de precon (opcional)

Um deck pode declarar de que precon partiu:

```
deck {
  deck_id, name, commander_oracle_id,
  source_precon: {
    precon_id,               // identificador do produto, ex. "para-food-and-fellowship"
    name,                    // nome legível do precon
    base_cards: [oracle_id]  // as 100 cartas originais da lista do produto
  } | null
}
```

`base_cards` resolve-se contra o catálogo da mesma forma que a decklist em
§4.2 (texto simples, `1 Sol Ring` por linha), tipicamente colando a decklist
oficial do precon publicada pela WotC.

**Regra:** uma carta presente em `base_cards` nunca aparece como recomendação
de compra (balde "comprar" ou "proxy" em §9), independentemente do score que
receba na Fase C. O motor de recomendação existe para sugerir *upgrades* sobre
a base do precon, não para recomprar a própria base. Isto é um filtro duro
(§8 Fase B), não um ajuste de score — ver a entrada correspondente nessa
secção.

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
alvo, `exclude_tags`, `max_cmc`, Reserved List se excluída, cartas já no deck,
cartas em `source_precon.base_cards` (§4.3) quando o deck tiver precon de
origem declarado. Uma carta que falhe qualquer filtro não continua.

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
(`cardmarket_uri` de `printings.json`, §3.1 — da mesma impressão usada para
`price_eur_min`) e a lista de proxies em separado.

**A app decide *o quê* comprar. O Cardmarket decide *onde* e *a que preço*.** A
otimização de estado, vendedor e portes é feita pelo shopping wizard deles, que
faz isso melhor do que qualquer coisa construída aqui.

---

## 11. Fases e critérios de aceitação

Cada fase termina com um commit e com algo utilizável. Dois decks de validação,
com papéis diferentes:

- **Limit Break** (Cloud, Ex-SOLDIER) — Fases 1 a 3. É o caso de uso real
  (upgrade de precon) e o que exercita o campo `source_precon` (§4.3).
- **Shelob** (aranhas / deathtouch / Food) — Fases 4 e 5. Julgar se uma
  recomendação é boa exige um deck que o utilizador já conhece a fundo; o
  Limit Break ainda não tem esse histórico.

### Fase 1 — Fundação de dados
- GitHub Action constrói e publica `catalog.json.gz` + `printings.json` +
  `manifest.json` como artefacto do Pages (nunca commitados, §3.2)
- App carrega e cacheia o catálogo; funciona offline depois disso
- Importador ManaBox com relatório de falhas
- Importador de decklist em texto
- Exportar/importar JSON de dados pessoais

**Aceite quando:** o catálogo comprimido está abaixo de 10 MB, o export da
coleção resolve com menos de 1% de falhas não explicadas, e o deck Limit Break importa
com 100 cartas identificadas.

Coleção real testada (26 de agosto de 2026, 4371 linhas): **0,64% de
falhas** — as 28 linhas não resolvidas são todas do set `TTMC` (Teenage
Mutant Ninja Turtles Eternal Tokens), tokens com `legalities.commander:
not_legal`. Falha explicada, não um problema do importador.

### Fase 2 — Análise de deck
- Métricas determinísticas (§7.1)
- Formulário de perfil declarado (§7.2)
- Configurações de deck com bracket alvo (§5)
- Checklist de bracket com três estados (§6)

**Aceite quando:** a checklist do Limit Break corresponde ao que o EDHPowerLevel mostra
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
nenhuma carta recomendada quebra uma barreira do bracket alvo, e as recomendações
para o Shelob fazem sentido para o Diogo, que conhece o deck a fundo.

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
