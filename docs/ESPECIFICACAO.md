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
produz `catalog.json.gz`, `printings.json`, `excluded.json` e `manifest.json`
e publica-os como artefacto de deployment do GitHub Pages — não ficam no
histórico do repositório (ver §3.2). O builder escreve para `catalog/` na
raiz do repositório (gitignored); o workflow copia essa pasta tal e qual
para dentro de `dist/`, que é o que `actions/upload-pages-artifact` publica.
Os quatro ficheiros ficam então em `/catalog/` a partir da raiz do site
publicado:

```
https://<utilizador>.github.io/<repo>/catalog/catalog.json.gz
https://<utilizador>.github.io/<repo>/catalog/printings.json
https://<utilizador>.github.io/<repo>/catalog/excluded.json
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
edhrec_rank, reserved, oracle_tags[], price_eur_min, price_source_date,
price_source_scryfall_id
```

`reserved` (booleano, `oracle_cards`, 27 de setembro de 2026) — alimenta
`exclude_reserved_list` (§5/§8 Fase B), gap fechado no mesmo dia em que foi
descoberto (§12).

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

Medido em produção (28 de agosto de 2026, 106 982 impressões): **32 MB em
disco, não comprimido** (ao contrário de `catalog.json.gz`). O GitHub Pages
comprime-o em trânsito de forma transparente (~6,4 MB pela rede), mas o
ficheiro em si não leva gzip — é só usado sob pedido, nunca no arranque da app
(ver a invariante 11 no CLAUDE.md e §3.2).

#### excluded.json

Uma impressão de `default_cards` que não passa os filtros do catálogo (§3.1)
não fica em lado nenhum — nem em `catalog.json.gz`, nem em `printings.json`.
Sem este ficheiro, a app não tem forma de explicar *porquê* uma linha do
importador da ManaBox (§4.1) falhou, sem perguntar à Scryfall em tempo real —
o que feriria a invariante 10 (local-first) só para produzir uma mensagem de
erro. `excluded.json` guarda a razão no momento da build, uma vez, para todas
as impressões filtradas.

Campos por entrada, chave `scryfall_id`:

```
scryfall_id, oracle_id, reason, detail, type_line
```

`reason` é `"excluded_layout"` ou `"not_legal_commander"`; `detail` é o
`layout` (para o primeiro caso) ou o valor de `legalities.commander` (para o
segundo, ex. `"not_legal"`, `"banned"`). Construído na mesma passagem por
`default_cards` que gera `printings.json` — a impressão que não entra num
Map entra no outro, nunca as duas.

Medido em produção (28 de agosto de 2026): **10 621 impressões excluídas,
~2 MB em disco.** Tal como `printings.json`, sob demanda, nunca no arranque.

### 3.2 Versionamento e atualização

`catalog.json.gz`, `printings.json`, `excluded.json` e `manifest.json`
**não são commitados.** Cada build semanal deixaria um blob de vários MB no
histórico do repositório, permanentemente, sem nenhum benefício — só o
código e os dados de referência escritos à mão (como `bracket-rules.json`)
vivem no git. A Action gera os quatro ficheiros no runner e publica-os como
artefacto de deployment do GitHub Pages (`actions/upload-pages-artifact` +
`actions/deploy-pages`), lado a lado com os ficheiros estáticos da app.

`manifest.json` tem `{version, built_at, card_count, sha}`. A app compara com
o que tem em cache (IndexedDB) e descarrega `catalog.json.gz` de novo se for
diferente. O utilizador não faz nada.

**`printings.json` e `excluded.json` carregam-se à parte, sob demanda —
nunca no arranque.** Só são necessários no importador da ManaBox (§4.1); 32
MB (+ 2 MB) não têm lugar no carregamento inicial da app. Ver a invariante 11
no CLAUDE.md.

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
| `excluded` | `scryfall_id` | Descartável, re-descarregável — de `excluded.json` (§3.1), sob demanda como `printings` |
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

Uma linha falha porque a carta não está em `printings.json`/`catalog.json.gz`
— e não está lá precisamente por ter sido filtrada na construção do catálogo
(§3.1). A razão dessa exclusão vive em `excluded.json` (§3.1), gerado na
mesma build, por isso o relatório resolve-a localmente, por `scryfall_id`,
sem depender da rede em tempo real — pedir isto à Scryfall por carta
feriria a invariante 10 (local-first) só para explicar um erro.

### 4.2 Decks

Formato de entrada: texto simples, uma carta por linha, `1 Sol Ring`. Linhas
começadas por `//` ignoradas. O commander é identificado por marcação explícita
ou escolhido pelo utilizador na importação.

Duas formas de marcação explícita, porque exports reais (Archidekt, Moxfield)
não anotam cada linha:

1. Cabeçalho de secção `// COMMANDER` numa linha isolada — a próxima linha de
   carta é o commander.
2. `CMDR` no lugar da quantidade, ex. `CMDR Cloud, Ex-SOLDIER` — para quem
   escreve a lista à mão sem cabeçalhos de secção.

Sem nenhuma das duas em toda a lista, o import mostra as cartas resolvidas e o
utilizador escolhe o commander antes de guardar — nunca um palpite automático
(ex. a primeira lenda da lista).

Exports reais também trazem `(SET) número *F*` a seguir ao nome (edição,
número de colecionador, acabamento) — descartado antes da resolução, que é
só por nome. Testado contra a decklist real do Limit Break (100 linhas,
formato Archidekt): **100/100 cartas resolvidas, 0 falhas**, commander detetado
via `// COMMANDER`.

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
    name,                    // nome legível do precon, mostrado na lista de decks
    base_cards: [oracle_id]  // as 100 cartas originais da lista do produto
  } | null,
  role_overrides: [{oracle_id, role, action: "add"|"remove"|"confirm"}]  // §7.1, opcional
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

**Implementado em versão mínima** (`src/rules/deck-config.js`,
`src/data/deck-configs.js`, store `deck_configs`): criação com validação
(`target_bracket` obrigatório, nunca assumido), armazenamento, inclusão no
export/import de dados pessoais, e apagar um deck leva as configurações dele.
`generateCandidates` exige uma configuração. `max_tutors` e
`edhpowerlevel_result` ainda não existem no registo; não há UI para criar
configurações.

---

## 6. Regras de bracket

Ficheiro `data/bracket-rules.json`, versionado, com a data da atualização da
WotC a que corresponde. **Estado atual: atualização de 9 de fevereiro de 2026,
confirmada a 30 de outubro de 2026** — os anúncios de março e maio e o B&R de
12 de outubro não alteraram brackets nem Game Changers; a tabela abaixo bate
com o anúncio de 21 de outubro de 2025 (B3: até três Game Changers, sem mass
land denial, turnos extra em pouca quantidade e sem encadear, sem combos
infinitos de duas cartas cedo). Deteção: tag `mass-land-denial` (conservadora
— apanha também casos limite como Liliana of the Veil, o lado seguro para
excluir de recomendações) e tag `extra-turn` (cobre as 51 cartas com "extra
turn" no texto; `prevent-extra-turns` não conta).

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
| "Só late game" | custo total das peças vs `early_combo_threshold_mana` (§6.4) | review até Commander Spellbook (Fase 5); depois pass / fail |
| Commander em combo de 2 (grupo) | Commander Spellbook + `no_combo_with_commander` (§6.4) | review até Commander Spellbook (Fase 5); depois pass / fail |
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

### 6.4 Interpretação do grupo (house rules)

O grupo de torneio de Bracket 3 do Diogo opera regras mais específicas do que
o texto da WotC, que não dá números para "turno esperado" nem define "early
combo". Guardadas em `bracket-rules.json`, num bloco claramente marcado como
leitura do grupo, nunca como regra oficial:

```
group_interpretation: {
  source: "grupo de torneio B3 do Diogo",
  expected_turn_count: { min: 6, max: 7 },
  no_combo_with_commander: bool,   // restrição adicional à regra oficial de combos de 2 cartas
  early_combo_threshold_mana: 8    // custo total das peças, incluindo ativações
}
```

- `expected_turn_count` fica em `review` (§6.1) — não é determinável a
  partir da lista, só documenta a expectativa do grupo.
- `no_combo_with_commander` é mais estrito do que a regra oficial de combos
  de 2 cartas: mesmo um combo que a WotC deixaria passar por ser late game
  falha se o commander for uma das duas peças. Calculável quando o Commander
  Spellbook entrar (Fase 5): basta verificar se `commander_oracle_id`
  aparece na lista de cartas de algum combo de 2 peças.
- `early_combo_threshold_mana` torna **"só late game" computável** (§6.1):
  um combo é precoce se o custo total das peças — casting + ativações — for
  inferior a este valor. Antes do Commander Spellbook (Fase 5) fica
  `review`, como já estava; depois passa a `pass`/`fail`.

---

## 7. Perfil de deck

### 7.0 Validação de legalidade (Commander)

Antes de qualquer métrica, o deck é validado contra as regras do próprio
formato Commander — não as barreiras de bracket (§6, outra coisa: aquilo é
poder relativo dentro de um deck já legal; isto é se o deck é sequer um deck
de Commander válido). **Nunca bloqueia a importação — só avisa.** Um deck de
96 cartas continua a importar-se e a ficar guardado; só aparece assinalado.

Regras verificadas, por deck:

1. **Exatamente 100 cartas, incluindo o commander.**
2. **Singleton** — no máximo uma cópia de cada carta, exceto terrenos
   básicos e cartas cujo `oracle_text` tenha a cláusula "A deck can have any
   number of cards named ‹X›" (Relentless Rats, Dragon's Approach, etc.).
3. **Identidade de cor** de cada carta contida na do commander. Usa
   `color_identity` do catálogo (§3.1) diretamente — já é o resultado de
   contar os símbolos de mana no custo e no texto de regras, calculado pela
   Scryfall; não há razão para reimplementar essa leitura aqui.
4. **Commander lendário** — criatura lendária, ou qualquer carta cujo
   `oracle_text` diga "can be your commander" (cobre planeswalkers-commander
   e afins).

Cada problema aponta a carta concreta (quando aplicável — contagem total de
cartas e commander em falta são problemas do deck, não de uma carta). A
validação corre a partir do estado atual do deck (`decks` + `deck_cards`),
nunca é guardada — não pode desatualizar-se.

**Onde aparece:** um painel por deck na lista de "Decks guardados", sempre
visível quando há problemas, com os avisos listados um a um.

Três camadas de perfil, por ordem de confiança:

**7.1 Determinística (automática).** Curva de mana, contagem de terrenos e
fontes de mana, contagens por papel (ramp, draw, remoção, proteção,
disrupção, interação/resposta, fecho de jogo, amplificadores), histograma de
oracle tags. Produz a lista de **papéis em falta** — aviso estrutural, nunca
termo do score do §8 (ver "Alvos de referência" abaixo e §8 Fase C).
`src/rules/deck-metrics.js`.

Papel de cada carta = conjuntos exatos de `oracle_tags`, verificados contra o
catálogo real antes de escrever (substring como `"ramp"` apanha
`"trample"`/`"rampage"` — nada a ver; os conjuntos abaixo são exatos).

**Tags de fog (`fog`, `fog-selective`, `pseudo-fog`) não classificam nada
sozinhas.** Três cartas com essa tag dão três papéis diferentes: `Cloud's
Limit Break` tem `multi-removal` — é Remoção, destrói os atacantes;
`Arachnogenesis` tem `protects-planeswalker` — é Proteção, cria
bloqueadores; `Aether Shockwave` só tem `tapper-creature` — não é nenhum dos
dois, é Interação/Resposta. Confirmado até na própria carta *Fog*: já tem
`protects-planeswalker` da Scryfall. O papel decide-se pelas outras tags da
carta, nunca pela tag de fog isolada.

**A fiabilidade de uma tag não é uma lista fixa — é um teste mecânico sobre
o catálogo.** Para cada `oracle_tag`, olha-se como as cartas do catálogo que
a têm se distribuem pelos papéis desta tabela: se convergem num papel, a
tag classifica sozinha; se se espalham por vários, não classifica com
confiança e a carta fica marcada como incerta (abaixo).

**A unidade de análise é a tag exata, nunca o prefixo partilhado.** Corrido
o teste sobre o catálogo todo (31 830 cartas, 30 636 não-terreno, 2 de
setembro de 2026): tags com o mesmo prefixo divergem tanto quanto tags sem
nada em comum. `fog` sozinha converge (97% Proteção, n=35); `pseudo-fog`,
mesmo "família" no sentido de nome, dispersa (35% no papel mais comum,
n=74). `burn-creature` e `burn-any` convergem quase 100% em Remoção;
`burn-player` e `burn-you`, mesmo prefixo `burn-`, ficam abaixo de 40% —
queimam o jogador, não uma permanente, e "remoção" aqui não se aplica.
Agrupar por prefixo serve só para organizar a leitura de muitas tags de
uma vez; nunca é a decisão. O Tagger tem centenas (milhares, contando
variações por edição/set) de tags; o teste já correu sobre todo o
catálogo uma vez — nenhuma tag fica por avaliar por preguiça, mas os
resultados ainda não fixaram um limiar de "quão concentrada chega".

A distinção **função vs forma** usada para explicar isto é conceptual, um
atalho para o Diogo perceber o critério — não é algoritmo, e o código nunca
tenta aplicá-la carta a carta ("esta tag descreve forma"). A decisão vem
sempre da distribuição medida no catálogo, por tag, nunca de uma lista de
nomes escritos à mão.

**"Sem papel" tem duas causas distintas, e só uma é um problema.** Quando
uma carta com uma tag dispersa não cai em nenhum papel, ou é (a) **lacuna
nossa** — a carta tem outra tag com sinal forte que a tabela ainda não
incorporou — ou (b) **legitimamente sem papel** — nenhuma das suas tags
aponta para nenhum dos papéis desta tabela, é uma carta genérica (corpo
vanilla, efeito fora do âmbito destes papéis). Medido sobre `synergy-*`
(2 de setembro de 2026, sobre os 8 papéis de então — antes do Acesso
Temporário abaixo): das 3 328
cartas sem papel, só 423 são lacuna (têm outra tag com sinal ≥50% não
incorporado, ex. `hate-flying`, `flicker-creature`); as outras 2 905 são
legitimamente sem papel. Uma família não perde pontos de fiabilidade por
conter a segunda categoria — só a primeira aponta para uma tabela
incompleta.

**Reprovar no teste de dispersão significa "não classifica papel sozinha",
nunca "é inútil".** `synergy-*` dispersa como classificador de papel (14%
no topo, maioria sem papel) mas é exatamente a família que semeia o plano
de jogo do commander (§7.2) — outra função, sobreposição de tags com o
plano, não classificação de papel. As duas coisas usam o mesmo tipo de
dado (`oracle_tags`) para perguntas diferentes; falhar uma não diz nada
sobre a outra.

Quando uma carta só tem tags dispersas (ou nenhuma tag aplicável), o
classificador coloca-a no papel mais provável **marcada como incerta**,
visível como tal — nunca classificada em silêncio. O Diogo corrige as
poucas que interessam via anulação por deck (abaixo), que também limpa a
marca de incerteza para essa carta. É o mesmo princípio do estado `review`
na checklist de bracket (§6.1): onde a app não sabe, diz que não sabe.

**Limiares da sugestão incerta, fixados a partir do teste de 2 de setembro
de 2026:** uma tag só gera sugestão (papel mais provável, marcado incerto)
com **n ≥ 25 cartas de amostra e ≥ 80% de concentração num só papel**.
Abaixo disso, a carta fica legitimamente sem papel, sem sugestão — um
palpite fraco (amostras de 6 a 21, como se viu com `banish-graveyard` ou
`freeze-artifact`) é pior do que nenhum. Todas as adições aprovadas hoje
tinham n≥100 e concentração ≥88%, bem acima do limiar; as rejeitadas por
amostra tinham todas n<25. `src/rules/deck-metrics.js` calcula isto uma vez
por catálogo carregado (não por deck), a partir das cartas não-terreno,
excluindo tags já estabelecidas (testá-las contra si próprias é
tautológico).

| Papel | Tags | Alvo de referência |
|---|---|---|
| Fontes de mana | `mana-rock`, `utility-mana-rock`, `mana-rock-with-set-s-mechanic`, `mana-dork`, `mana-dork-egg`, `ritual`, `ritual-untap` | — (informativo, soma-se a terrenos) |
| Ramp | fontes de mana + `ramp`, `ramp-with-set-s-mechanic`, `land-ramp`, `multi-land-ramp`, `combat-ramp`, `tutor-land-to-battlefield` | 8 |
| Draw | `draw-engine`, `repeatable-pure-draw`, `pure-draw`, `burst-draw`, `force-draw`, `repeatable-draw`, `repeatable-loot`, `loot`, `curiosity`, `wheel-symmetrical` — cartas que chegam à **mão** | 8 |
| Remoção | `spot-removal`, `removal-creature/destroy/exile/toughness/nonland/sacrifice/artifact/land/enchantment/permanent/planeswalker/fight/aura/equipment/noncreature/vehicle/battle/nonenchantment/spacecraft`, `swap-removal`, `repeatable-removal`, `sweeper*`, `burn-any`, `burn-creature`, `burn-planeswalker`, `burn-with-set-s-mechanic`, `bombard`, `banish`, `lockdown-creature` — respostas **permanentes/duras** | 8 |
| Proteção | prefixo `protects-`, `gives-protection`, `gains-protection` — proteger o que já tens em jogo | 3 |
| Disrupção | prefixo `counterspell`, `discard`, `cost-increaser`, `cast-tax`, `tax-attack`, `tax-block`, `prevent-cast`, `stasis`, `mass-land-denial`, `lockdown-land`, `silence` — negar recursos/ações ao adversário | 2 |
| Interação/Resposta | `removal-bounce`, `removal-tuck`, `freeze-creature`, prefixo `tapper-` — responder sem remover nem proteger (tap em massa, bounce, tuck) | 2 |
| Fecho de jogo | só `alternate-win-condition` — único sinal explícito da Scryfall para "ganha o jogo fora do combate normal"; não existe tag genérica "finisher"/"wincon". Fase 5: + combos do Commander Spellbook cujo resultado seja dano/vida em massa ou "win the game" (§12) | 1 |
| Amplificadores | `extra-combat-phase` (fase de combate — não confundir com turno extra, critério diferente da checklist de bracket, §6), `anthem` (+X/+X real; `keyword-anthem`, que só concede keywords, fica de fora), `storm-like`, `storm-count-matters` — acelera um plano já existente, não fecha nada por si | 2 |
| Acesso Temporário | `impulsive-draw`, `repeatable-impulsive-draw`, `long-term-impulsive-draw` — exila do topo da biblioteca e dá uma janela para jogar essas cartas, **nunca as põe na mão** (Light Up the Stage, Chandra, Torch of Defiance); converte mana em acesso, não acumula recursos | — (sem alvo, ver nota abaixo) |

Terrenos: 36.

**Adições de 2 de setembro de 2026**, por tag exata (nunca por prefixo — ver
acima), a partir do teste de convergência sobre o catálogo real:
`burn-any` (100%, n=797), `burn-creature` (100%, n=961), `burn-planeswalker`
(93%, n=339), `burn-with-set-s-mechanic` (93%, n=262), `bombard` (91%,
n=102), `banish` (100%, n=100) e `lockdown-creature` (97%, n=104) em
Remoção; `freeze-creature` (84%, n=171) em Interação/Resposta; `curiosity`
(94%, n=241) e `wheel-symmetrical` (100%, n=35) em Draw; `lockdown-land`
(70%, n=10, exceção — decisão por categoria: é da família do
`mass-land-denial` já presente aqui e liga à checklist de bracket, §6, não
por concentração). `burn-self` e `bombard-self` ficaram de fora por razão
conceptual, não de amostra: queimar as próprias criaturas não remove nada
do adversário.

**`silence` adicionado a Disrupção em 27 de setembro de 2026** —
verificado por leitura direta de texto real (36 cartas: Xantid Swarm,
Marisi, Wardscale Dragon, Orim's Chant, Render Silent, a própria carta
*Silence*...), não pelo teste de convergência por co-ocorrência: essa
técnica serve para saber se uma tag é AMBÍGUA sozinha (fog/pseudo-fog);
`silence` não é — é uma tag de função, o nome já é o efeito ("opponents
can't cast spells"), como `discard`/`stasis`/`mass-land-denial` já na
tabela, nenhuma dessas passou pelo teste de convergência também.
Descoberto ao investigar `Conqueror's Flail` no Limit Break, cujo "your
opponents can't cast spells during your turn" não batia em nenhum papel
— a única fonte de disrupção do deck ficava sem proteção de anulação por
não estar classificada, não por falha no mecanismo de proteção em si.

**Revisão futura** — tags-irmãs do mesmo prefixo que dispersaram só por
amostra pequena (n<25), a reavaliar quando o catálogo crescer, nunca
promovidas sem voltar a medir: `lockdown-artifact` (n=15), `lockdown-permanent`
(n=3), `banish-graveyard` (n=6), `banish-hand` (n=12, pode ser Disrupção —
"exilar temporariamente da mão" —, amostra pequena demais para decidir),
`freeze-artifact` (n=9), `freeze-nonland` (n=6), `freeze-permanent-any`
(n=6), `freeze-land` (n=10), `wheel-symmetrical-optional` (n=10),
`burn-bright-with-set-mechanic` (n=21). `burn-player`, `burn-you` e
`curiosity-like` têm amostra grande (784, 104, 74) e dispersão real, não de
amostra — confirmados como não-classificadores, não entram nesta lista de
revisão.

`wheel-one-sided` (60%, n=85, amostra suficiente) **excluído em 5 de
setembro de 2026**, por razão diferente das acima: das 85 cartas, 51 já
classificam Draw por outra tag; as 26 que ficariam a dever tudo a esta tag
seguem sobretudo o padrão "descarta a mão, depois compra N" (Bedlam
Reveler, Phyrexian Dragon Engine, Rix Maadi Reveler), mas confirmar
oracle_text carta a carta para 26 casos não compensa. Registado aqui para
reavaliar se o conjunto crescer o suficiente para decidir por amostragem
em vez de inspeção manual.

**Correção de 5 de setembro de 2026 — Draw estava a contar Acesso
Temporário.** `impulsive-draw`, `repeatable-impulsive-draw` e
`long-term-impulsive-draw` **saíram de Draw**: exilam do topo da
biblioteca e dão uma janela para jogar essas cartas (Light Up the Stage:
"Exile the top two cards of your library... you may play those cards";
Chandra, Torch of Defiance: "Exile the top card... You may cast that
card"), nunca as põem na mão. Era um erro na tabela original, não uma
lacuna nova — 237 cartas do catálogo têm alguma destas tags, 235 não têm
nenhuma outra tag de draw real e contavam para Draw só por isto. **Draw do
Limit Break passa de 12 para 9** (saem `Cait Sith, Fortune Teller`,
`Furious Rise`, `Professional Face-Breaker`) — correção aceite mesmo
piorando o número, porque o resultado anterior estava errado, não porque
o alvo mudou.

Ficam a formar sozinhas o novo papel **Acesso Temporário** (9º papel,
acima), não uma extensão de Draw: convertem mana em acesso a cartas, nunca
acumulam recursos — um deck com muito disto tem uma estratégia
identificável (spend-now, tempo), informação que o plano de jogo do §7.2
vai precisar. Testados como candidatos ao mesmo papel e **rejeitados por
não convergirem** com as três tags de acesso temporário (0–8% de
sobreposição de cartas no catálogo real): `cost-reducer` (mecanismo
diferente — gasta menos mana, não troca uma carta por acesso temporário a
outras; n=83, 0% em Ramp hoje, candidato a papel próprio no futuro, não
decidido), `gives-haste` (**armadilha de nome** — é subproduto de roubo ou
reanimação, não "haste em massa": Sauron, the Lidless Eye e Puppeteer
Clique dão haste a uma criatura roubada/reanimada, o efeito principal é
outro; n=513), `extra-land`/`play-additional-land` (já bem servidos em
Ramp, 74–100%; n=30/39), `ritual`/`ritual-untap` (já 100% em Ramp,
zero sobreposição com acesso temporário; n=59/20). Por isto o nome ficou
**estreito de propósito** — "Acesso Temporário", não "Velocidade": o
papel só tem as três tags de exílio-e-jogar, nenhum candidato mais largo
resistiu ao teste.

**Acesso Temporário não tem alvo de referência, e é deliberado — corrigido
em 5 de setembro de 2026 depois de um primeiro rascunho com alvo 2
tentativo.** Um alvo num papel criado há dias não vem de nenhuma base:
nenhum guia de construção EDH fala em "acesso temporário" como categoria
(ao contrário de terrenos/ramp/draw/remoção, citados pela generalidade
deles), e inventar um número sem essa base tornaria "passar" ou "falhar"
neste papel um resultado sem significado. **O papel mede-se e mostra-se
sempre** — a contagem aparece na UI como qualquer outro — mas só entra na
lista de "papéis em falta" quando houver um alvo real para o justificar.
Nunca aparece em `missingRoles` até essa base existir.

**Armadilha de nome, registada para não se repetir:** a tag `impulse`
(sem sufixo) **não é isto** — é "olha as top N cartas, põe uma na mão"
(Sleight of Hand, Telling Time), seleção de cartas para a mão, não
exílio temporário. Nunca deve entrar no papel Acesso Temporário.
`impulsive-mill`/`impulsive-recursion`/`impulsive-curiosity` são a mesma
mecânica de exílio-e-jogar disparada por mill/cemitério/dano de combate —
nunca entraram em nenhum papel, corretamente, mas ficam registadas como a
mesma família por futura referência.

**Um papel nunca é uma regra sobre a cor do deck.** `Mana Tithe`, `Rebuff
the Wicked`, `Dawn Charm` e `Lapse of Certainty` são brancas e têm
`counterspell*`; a métrica lê o que está no deck, nunca presume a partir da
identidade de cor. Disrupção é rara fora de azul, mas isso é um facto sobre
o deck, não uma regra da métrica — nunca é zero por definição.

**Os papéis podem sobrepor-se quando os efeitos são distintos** (`Boros
Charm` dá indestructible OU queima por 4 — conta nos dois). O critério é
sempre o **efeito** da carta, nunca o alvo escolhido: uma remoção apontada à
própria criatura para a salvar de um sacrifício continua a ser remoção.
**Não existe métrica agregada a somar baldes** — havia `interactionDensity`
antes (remoção + interação, a dividir pelo total), dava 36,5% no Limit
Break; o problema era a agregação em si, não os baldes.

### Anulação por deck

Os alvos e as tags acima são a regra **global**. Quando o Diogo discordar de
uma carta específica num deck específico, pode mover ou duplicar essa carta
para outros baldes — só naquele deck, sem tocar na regra global. Guardado em
`deck.role_overrides: [{oracle_id, role, action: "add"|"remove"|"confirm"}]`.
`"confirm"` é o terceiro estado: limpa a marca de incerteza de uma sugestão
automática já correta, sem mudar a inclusão — para quando o palpite estava
certo e só falta o Diogo validá-lo.

Se a mesma anulação se repetir em vários decks, é sinal de que a regra
global está errada e deve ser corrigida em `deck-metrics.js`, não empilhada
como anulação em cada deck.

**Onde aparece:** dentro de cada balde expandido, cada carta é clicável e
abre uma edição dos papéis dessa carta, só para aquele deck.

### Alvos de referência

Pisos de senso comum de construção de Commander — **avisos estruturais**,
não regra oficial nem motor de recomendação (isso é o §8, calibrado a partir
do plano do commander, não de alvos fixos — ver §12). **Não ajustados para
nenhum deck passar ou falhar:** se um deck bem construído cumpre um alvo,
esse é o resultado correto, não motivo para subir o número.

- **Terrenos 36, ramp/draw/remoção 8** — piso citado pela generalidade dos
  guias de construção EDH para um deck de 100 cartas funcionar sem
  engasgar.
- **Proteção 3, disrupção 2, interação/resposta 2** — categorias
  opcionais/situacionais; um piso baixo reconhece que nem todo o deck
  precisa de muito disto, mas zero é um sinal a assinalar.
- **Fecho de jogo 1** — a maioria dos decks ganha por combate; um fecho
  dedicado é bónus, não requisito, mas zero é informação útil ("este deck
  só ganha se conseguir atacar").
- **Amplificadores 2** — idem, situacional.

**Acesso Temporário não tem alvo** — ver nota acima, na descrição do
papel: mede-se e mostra-se, nunca entra nesta lista sem uma base real para
justificar um número.

**Onde aparece:** botão "Ver métricas" por deck na lista de "Decks
guardados", ao lado de "Ver cartas" — computado sob demanda (mais trabalho
por deck que a legalidade do §7.0, que corre sempre). Cada contagem é um
botão que expande a lista de cartas que a compõe. Texto simples, sem
gráficos. Uma carta classificada com incerteza (acima) aparece marcada nessa
lista — não some dentro da contagem como se fosse uma classificação normal.

Testado contra o Limit Break real (27 de setembro de 2026, depois da
adição de `silence` a Disrupção): 37 terrenos, 41 fontes de mana, ramp
11, draw 9, remoção 9, proteção 8, **disrupção 1** (`Conqueror's Flail`),
interação/resposta 3, fecho de jogo 1 (Hellkite Tyrant), amplificadores 1
(Tifa, Martial Artist), acesso temporário 3 (`Cait Sith, Fortune Teller`,
`Furious Rise`, `Professional Face-Breaker` — sem alvo, medido e
mostrado, sem entrar em "papéis em falta"). **Papéis em falta: disrupção
(1 de 2) e amplificadores (1 de 2)** — draw desceu de 12 para 9 com a
correção de 5 de setembro, mas continua acima do alvo de 8, não entra na
lista de papéis em falta.

**7.2 Declarada (formulário).** Define o **plano de jogo** do deck — o que a
Fase C do §8 usa para pontuar cada carta. Semeado automaticamente a partir das
`oracle_tags` do commander e confirmado/ajustado pelo Diogo; trinta segundos
por deck, nunca formulário em branco.

Confirmado com os dois commanders possíveis do Limit Break: `Cloud,
Ex-SOLDIER` tem `synergy-equipment`, `quick-equip`, `power-matters-self` —
plano de equipamento; `Tifa, Martial Artist` tem `power-matters`,
`extra-combat-phase`, `extra-untap`, **sem nenhuma tag de equipamento** —
plano de combates extra. Mesmo deck, dois commanders possíveis, dois planos
distintos com as mesmas contagens de papel do §7.1 — é exatamente por isto
que os alvos do §7.1 nunca podem ser o motor de recomendação (§8), só aviso
estrutural.

```
game_plan {
  deck_id,
  synergy_tags: [oracle_tag],  // semeado do commander, editável
  archetype,                   // texto livre curto, ex. "equipment voltron"
  avoid_tags: [oracle_tag]     // linhas indesejadas
}
```

`untouchable` continua em `deck_config` (§5) — protege uma carta de aparecer
como corte numa configuração específica; não é sobre o plano em si, por isso
não muda de sítio.

**Implementado em 5 de setembro de 2026.** `seedGamePlan`
(`src/rules/game-plan.js`) copia as `oracle_tags` do commander, com um
único filtro: **prefixo `cycle-*` sai da semente.** Não é curadoria do
Diogo — é bookkeeping da Scryfall para agrupar ciclos e reimpressões
dentro de um set (`cycle-fic-face-commander`, presente em Cloud e em
Tifa), sem relação nenhuma com jogabilidade, e já tinha reprovado no
teste de dispersão do §7.1 (1 386 tags, 55% sem papel). Remover isto é
tirar ruído medido, não decidir o que é plano — nenhum outro filtro
existe: inventar mais seria decidir por ele o que é ou não eixo de
sinergia, o oposto do que esta camada faz.

**Revisto no mesmo dia — distinguir papel de eixo de sinergia na
semente.** Tags como `burst-draw`, `draw-engine` e `repeatable-pure-draw`
descrevem **função** (já papel do §7.1, Draw), não **eixo de sinergia**
(o tema que dá identidade ao plano). Deixadas no plano sem distinção,
o scoring do §8 premiaria qualquer carta que compre cartas e o eixo de
equipamento do Cloud diluir-se-ia. A app **não decide isto por ninguém**:
o formulário anota, ao lado do campo de eixos de sinergia, quais das
tags semeadas já são papel — `getEstablishedRoleForTag` em
`deck-metrics.js`, a mesma tabela do §7.1, consultada tag a tag — e para
que papel, sem as remover sozinha. Confirmado com o Cloud: `burst-draw`,
`draw-engine` e `repeatable-pure-draw` aparecem anotadas → Draw;
`synergy-equipment`, `quick-equip`, `power-matters-self` ficam sem
anotação — são o eixo de sinergia genuíno. O Diogo decide, ao curar, se
tira as anotadas.

**7.3 Sintetizada (LLM).** O modelo lê a lista mais as métricas e propõe um
perfil em JSON estruturado. **Sempre revisto e editado pelo utilizador antes de
ser guardado.** Nunca aceite automático. Guardado com versão.

---

## 8. Motor de recomendação

Quatro fases, nesta ordem. A ordem é o desenho, não uma sugestão. O histórico
das versões anteriores deste capítulo está no git; aqui fica o desenho em
vigor.

### 8.0 Diagnóstico de 30 de outubro de 2026

A primeira versão completa (Fases A–C e a parte determinística da D, 27 de
setembro) produziu para o Limit Break recomendações que o Diogo rejeitou na
maioria (ver 8.6). Uma leitura crítica do código, confirmada por uma revisão
independente do Diogo, encontrou a causa no modelo, não num caso isolado:

1. **O score media semelhança com o commander, não sinergia nem força.** O
   plano era semeado das tags *do próprio Cloud* — o que ele **é**, não o que
   ele **quer**. `attacking-matters-self` no Cloud quer dizer "o Cloud tem um
   gatilho de ataque"; numa candidata quer dizer "esta carta tem o seu próprio
   gatilho de ataque". Premiar isso é premiar parecença.
2. **"Não é papel do §7.1 ⇒ eixo genuíno, peso máximo" era classificação por
   ausência.** Das 8 tags que o plano semeado tratava como eixo, só 2 eram de
   equipment; `firebend-like`, `refund`, `repeatable-treasures`,
   `attacking-matters` pesavam o triplo sem ninguém as ter escolhido. É o erro
   que o §7.1 já corrigira ("tag fora da tabela não é tag fiável"), repetido
   ao contrário.
3. **Não havia sinal de força.** Tirar `edhrec_rank` estava certo
   (popularidade global, §8.3); assumir que "mérito face ao plano" bastava
   estava errado. O plano mede **relevância**, nunca **qualidade**.

Prova, com dados reais: Goldspan Dragon pontuava 12 (`attacking-matters-self`,
`firebend-like`, `refund`, `repeatable-treasures` — zero equipment) e
Stoneforge Mystic pontuava 3 (`synergy-equipment`). Num deck de equipment.

4. **Os pares corte/adição eram fictícios.** Duas listas ordenadas em separado
   e juntas por índice — Aerith ↔ Tanuki Transplanter só por serem ambas "#1".
   Nenhuma consciência de papel nas adições, o lote nunca avaliado como deck,
   e as adições empatadas ordenadas pela posição no catálogo.
5. **"Primeira-a-sair, confiança alta" afirmava uma coisa sobre a carta
   quando só sabia uma coisa sobre a tabela.** As cartas cortadas tinham 6–9
   tags cada (média do catálogo: 6,6) — não estavam sub-etiquetadas, estavam
   fora do vocabulário do plano e do §7.1. Red XIII, Proud Warrior
   (`synergy-modified`, `regrowth-equipment` — payoff de equipment) foi
   cortado assim.

Um dos exemplos da leitura crítica estava errado: `typal-soldier` (Heidegger,
SOLDIER Military Program) parecia um sub-tema do deck que o plano não via. O
Diogo corta as duas — é o tema de tokens do precon, não o plano do Cloud. É a
razão pela qual as sugestões tiradas das 99 (§7.2) são sempre propostas a
confirmar, nunca eixo automático: as 99 de um precon trazem temas que o dono
do deck não quer.

### 8.1 Fase A — Geração de candidatos

Pool inicial: catálogo ∩ identidade de cor do commander, menos o próprio
commander, as cartas já no deck e `source_precon.base_cards` (§4.3).
**Implementado** (`src/rules/candidate-generation.js`, `generateCandidates`),
devolvendo a contagem sobrante a cada passo — "quantos ficam depois de cada
filtro" é o contrato da função. Limit Break (catálogo de 21 set 2026):
31 830 → 18 382 (Naya) → 18 381 → 18 288.

Enriquecimento por dados de commander do EDHREC: **por investigar** (o que
existe, condições de uso, como guardar em cache sem quebrar a invariante 10)
— é a fonte candidata para o sinal de força (8.3).

### 8.2 Fase B — Filtros duros

Legalidade, identidade de cor, **barreiras do bracket alvo** (§6, a partir de
`bracket-rules.json` e do `target_bracket` da configuração, §5),
`exclude_tags`, `max_cmc`, Reserved List se excluída. Uma carta que falhe
qualquer filtro não continua.

**Implementado** (30 out 2026, `src/rules/bracket.js` +
`generateCandidates`): todos os filtros acima, lidos da configuração (§5) e de
`data/bracket-rules.json` (§6). Por carta: mass land denial e turnos extra
excluídos onde o bracket os proíbe; turnos extra onde só não podem encadear
continuam, anotados para verificação à mão; Game Changers excluídos se o deck
já está no limite. O limite de Game Changers **ao longo de um lote** de várias
trocas é verificado na avaliação do lote (§8.4). Reserved List: o catálogo tem
o campo `reserved` nos builds posteriores a 27 set 2026 (544 cartas no de 26
out); se faltar, o passo diz que não foi aplicado.

Limit Break, bracket 3 (catálogo de 26 out 2026): 32 116 → 18 537 (Naya) →
18 536 → 18 443 → 18 371 (72 cartas de mass land denial excluídas). Checklist
do deck atual: Game Changers 0/3 pass, mass land denial pass, turnos extra
pass, combos de 2 cartas e turno de fim em review. O conjunto de validação
não mexe (nenhuma das 20 cartas toca numa barreira) — as barreiras protegem
contra recomendações ilegais para o torneio, não melhoram a escolha.

### 8.3 Fase C — Relevância e força, em separado

Uma carta boa para o deck tem de ser **relevante para o plano** e **forte**.
São duas medidas distintas e nunca se derivam uma da outra.

**Relevância** — só a partir de eixos **curados** pelo Diogo (§7.2). Uma tag
não confirmada como eixo pesa zero. A semente do commander e as sugestões
tiradas das 99 propõem eixos; nunca pesam sozinhas. Cartas do tipo X contam
para um eixo `synergy-X` (Equipment para `synergy-equipment`) — `synergy-X`
marca quem gosta de X, nunca X em si; só cobre X que seja tipo/subtipo literal
do `type_line` (§12). Tags que já são papel do §7.1 contam com peso menor do
que o eixo, para não afogar o tema em categorias genéricas.

**Força** — sinal contextual, por commander. `edhrec_rank` global **não
serve**: é popularidade em todos os decks, sem variante por identidade de cor
nem por commander (documentação da Scryfall) — Polluted Delta aparecia num
pool Naya por ser popular em decks azuis e pretos. Fonte candidata: dados por
commander do EDHREC (8.1), por investigar. Até haver fonte, o motor **não tem
sinal de força** e as recomendações têm de o dizer.

**Posse e preço** (Tenho/Comprar/Proxy, §9) ficam ao lado de cada carta,
nunca no score — já ter uma carta é custo, não mérito.

Pesos (`w_eixo`, `w_papel`, `w_evitar`, e o de força quando existir): sliders
visíveis, nunca constantes no código. Os valores por omissão só se fixam
medindo contra o conjunto de validação (8.6).

**Estado do código** (`src/rules/recommendation-score.js`, `scoreCard`): ainda
o modelo de 27 de setembro — trata toda a tag do plano que não seja papel como
eixo, e não tem sinal de força. Por rever quando os eixos curados (§7.2) e
a fonte de força existirem.

### 8.4 Cortes, emparelhamento e avaliação do lote

**Elegibilidade de corte** a partir do §7.1 (`computeCutTiers`) — mantém-se:

- **Protegida** — única carta do deck a preencher um papel com alvo, ou o
  único terreno: nunca candidata. Hellkite Tyrant, Tifa e Conqueror's Flail no
  Limit Break.
- **Sem papel reconhecido** (antes "primeira-a-sair") — nenhum papel do §7.1
  e nenhuma tag dos eixos curados. **Não é confiança alta:** quer dizer que a
  carta está fora do nosso vocabulário, não que é fraca (Red XIII).
- **Por folga** — ocupa papel(is) com folga sobre o alvo do §7.1. Depende de
  alvos escritos à mão e ainda não validados — a decisão mais arriscada da
  lista (cortar ramp ou remoção), e marcada como tal.
- **Sem folga** — ocupa papel no alvo ou abaixo, não é a única: por último.

`untouchable` (§5) nunca aparece como corte.

**Emparelhamento por papel, não por índice.** Cada adição é escolhida para o
corte que substitui: um corte por folga é substituído por uma carta do mesmo
papel ou o par diz explicitamente que o papel não é reposto e que o deck
continua no alvo depois disso. Corte sem substituto é recomendação incompleta
— nunca se mostra um corte sozinho.

**O lote é avaliado como deck.** Antes de mostrar as trocas, o motor aplica-as
em sequência ao deck e verifica o resultado: terrenos e papéis contra os alvos
do §7.1 (a folga gasta por uma troca já não está disponível para a seguinte),
Game Changers contra o limite do bracket (§6), e a curva antes/depois. Uma
troca que quebre uma barreira ou ponha um papel abaixo do alvo não entra. A
curva é reportada, não bloqueia — não há alvo de curva validado.

Quando o corte é forçado por uma barreira do bracket (o deck excede o limite
de Game Changers), corta-se primeiro o Game Changer menos relevante para o
plano; se for o único a preencher um papel, o substituto tem de o preencher.

**Critério de paragem:** `max_changes` (§5), nunca um score alvo.

**Implementado a 30 out 2026** (`generateRecommendations`,
`src/rules/recommendation-score.js`): as trocas escolhem-se uma a uma sobre o
deck que vai mudando — o melhor corte elegível no estado atual, depois a
melhor adição *para esse corte* (só adições do papel que o corte deixaria
abaixo do alvo; nenhuma troca cria faltas novas nem passa o limite de Game
Changers), depois a troca aplica-se antes da seguinte. Uma troca tira uma
cópia (terrenos básicos em pilha) e "única no papel" conta cópias. Cortes sem
adição válida ficam em `skipped` com a razão, nunca na lista. No fim, papéis,
terrenos, Game Changers, CMC médio e checklist de bracket antes e depois.
Testes com catálogo sintético em `tests/recommendation.test.mjs` para os casos
que o Limit Break não exerce (reposição obrigatória, folga gasta ao longo do
lote, limite de Game Changers no lote, cortes forçados).

Limit Break: o conjunto de validação **não mexe** (4/4 escolhas e 6/6
rejeitadas, nas duas listas) — nenhum dos dez cortes precisava de reposição,
por isso saem as mesmas 20 cartas; o que as escolhe mal é a relevância (§8.3),
não o emparelhamento. O ganho é a avaliação do lote, que antes não existia:
Draw 9 → 13, Remoção 9 → 8 (no alvo), terrenos 37 → 36 (no alvo), Ramp 11 →
12, CMC médio 3,08 → 3,02.

### 8.5 Fase D — Reordenação e justificação (LLM)

Apenas sobre o top ~40. Todo o nome de carta que o LLM produza é resolvido
contra o catálogo (P5); se não resolver, é descartado.

**Parte determinística implementada** (`src/rules/recommendation-justification.js`):
por par, que papel sai, se a adição o repõe ou com que contagem o deck fica
quando não repõe, que eixo/papel entra (`scoreCard` devolve as tags e palavras
de tipo que bateram), e o tier do corte com o que ele realmente significa
("sem papel reconhecido" já não diz "confiança alta"). A justificação vem de
factos computados, nunca do LLM.

**Por implementar:** a reordenação por LLM. O projeto nunca chamou a Anthropic
API; falta decidir como a app autentica (chave do Diogo no browser? outro
mecanismo?).

### 8.6 Conjunto de validação — Limit Break

Veredicto do Diogo (30 de outubro de 2026) sobre as 10 adições e os 10 cortes
que o motor de 27 de setembro propôs. **Toda a alteração ao scoring ou ao
emparelhamento é medida contra este conjunto e reportada como "X das tuas
escolhas no top 10, Y das rejeitadas"**, separadamente para adições e cortes,
com as cartas novas no top 10 marcadas "por julgar" (e julgadas pelo Diogo
para o conjunto crescer). Máquina: `tools/validation/limit-break.json` +
`node tools/validation/measure.mjs "<decklist>"` — o ficheiro é espelho desta
tabela.

Ordem decidida pelo Diogo: corrigir contra o Limit Break, depois confirmar no
Shelob (§11) que as correções generalizam. O risco de sobreajuste a um único
deck resolve-se nessa segunda passagem, não antes.

**Adições**

| Carta | Veredicto | Razão (do Diogo) |
|---|---|---|
| Raubahn, Bull of Ala Mhigo | escolha | — |
| Diamond Pick-Axe | escolha | barata, equipa na curva, difícil de remover, pumpa e gera mana |
| Dáin Ironfoot | escolha | põe um equipamento já equipado, facilmente finisher |
| Jor Kadeen, First Goldwarden | escolha | — |
| Tanuki Transplanter | rejeitada | rampa, mas há ramp verde melhor; cara a jogar e a re-equipar; o plano é várias criaturas equipadas e o Cloud a power 7 |
| Goldspan Dragon | rejeitada | boa carta, não faz nada pelo plano |
| Amy Rose | rejeitada | cara para o que faz, depende do que já está em campo |
| Tributary Instructor | rejeitada | é para decks de contadores +1/+1 |
| Paladin Elizabeth Taggerdy | rejeitada | go-wide / cheat de criaturas, não representa o Cloud |
| Merry, Esquire of Rohan | rejeitada | é para decks de lendas |

**Cortes**

| Carta | Veredicto | Razão (do Diogo) |
|---|---|---|
| Aerith, Last Ancient | escolha | reanimar dá demasiado trabalho |
| Avalanche of Sector 7 | escolha | não ajuda o tema |
| Heidegger, Shinra Executive | escolha | para decks de tokens Soldier |
| SOLDIER Military Program | escolha | idem |
| Elena, Turk Recruit | rejeitada | recupera históricos — todos os equipamentos são artefactos; procuraria outra carta primeiro |
| Red XIII, Proud Warrior | rejeitada | barata, dá keywords a criaturas modificadas (as equipadas são), e recupera equipamento |
| Arcane Signet | rejeitada | staple, sobretudo em três cores — "nunca na vida" |
| Ash Barrens | rejeitada | mana fixing; só sairia por outro terreno |
| Austere Command | rejeitada | não corta board wipes sem manter um número saudável; talvez por um melhor |
| Bastion Protector | rejeitada | proteção e pump do commander — essencial |

**Linha de base** (motor de 27 set, catálogo de 21 set, plano = semente não
curada): adições — 4 das 4 escolhas, 6 das 6 rejeitadas no top 10; cortes — 4
das 4 escolhas, 6 das 6 rejeitadas.

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
  `excluded.json` + `manifest.json` como artefacto do Pages (nunca
  commitados, §3.2)
- App carrega e cacheia o catálogo; funciona offline depois disso
- Importador ManaBox com relatório de falhas
- Importador de decklist em texto
- Exportar/importar JSON de dados pessoais

**Aceite quando:** o catálogo comprimido está abaixo de 10 MB, o export da
coleção resolve com menos de 1% de falhas não explicadas, e o deck Limit Break importa
com 100 cartas identificadas.

Coleção real testada (26 de agosto de 2026, 4371 linhas): **0,64% de
falhas** — as 28 linhas não resolvidas são todas do set `TTMC`, cartas
físicas reais do modo de jogo "Team-Up" das Teenage Mutant Ninja Turtles
(bosses e eventos do baralho de inimigos), não cartas de baralho normais.
A Scryfall classifica-as como `layout: token` (a categoria mais próxima que
o esquema deles tem para isto) e `set_name: "...Eternal Tokens"`, o que é
enganador — não são brindes, são peças físicas reais que o Diogo possui.
`legalities.commander: not_legal` de qualquer forma. Falha explicada, não um
problema do importador; a razão real (por carta) vem de `excluded.json`,
gerado na build (§3.1/§4.1), e é mostrada na tabela de falhas, em vez de um
texto genérico — sem depender da rede no momento do import.

Deck Limit Break real testado (27 de agosto de 2026, decklist Archidekt de
100 cartas): **100/100 resolvidas, 0 falhas**, commander detetado via `//
COMMANDER` (§4.2). **Fase 1 aceite pelos três critérios.**

### Fase 2 — Análise de deck
- ~~Validação de legalidade do deck (§7.0)~~ — **já feito**, 28 de agosto de
  2026, antes do resto da fase começar (motivado por um deck de 96 cartas
  aceite sem aviso). `src/rules/commander-legality.js` + painel por deck na
  lista de "Decks guardados".
- ~~Métricas determinísticas (§7.1)~~ — **já feito**, 29 de agosto de 2026,
  revisto no mesmo dia depois de uma primeira ronda (a interação estava a
  somar remoção+proteção, os alvos deixavam o Limit Break passar em tudo).
  `src/rules/deck-metrics.js` + botão "Ver métricas" na lista de decks, com
  anulação por deck. Oito papéis: ramp, draw, remoção, proteção, disrupção,
  interação/resposta, fecho de jogo, amplificadores. Testado contra o Limit
  Break real: 37 terrenos, 41 fontes de mana, ramp 11, draw 12, remoção 9,
  proteção 8, disrupção 0, interação/resposta 3, fecho de jogo 1,
  amplificadores 1 — falta disrupção e amplificadores, um resultado real.
  **Revisto de novo em 2 de setembro de 2026:** teste de convergência
  corrido sobre o catálogo real, 11 tags novas incorporadas por tag exata
  (não prefixo) com amostra de cartas validada, mecanismo de sugestão
  incerta implementado (n≥25, ≥80% concentração) com terceiro estado de
  anulação `"confirm"`. Resultados do Limit Break inalterados (nenhuma tag
  nova calhou nas cartas deste deck) — validado por regressão, não só por
  inspeção. **Revisto uma terceira vez em 5 de setembro de 2026:** Draw
  estava a contar `impulsive-draw`/`repeatable-impulsive-draw`/
  `long-term-impulsive-draw` (exílio-e-jogar, nunca chega à mão) — erro da
  tabela original, corrigido. Novo 9º papel, **Acesso Temporário**, criado
  só para essas três tags depois de testar (e rejeitar) `cost-reducer`,
  `gives-haste`, `extra-land`/`play-additional-land` e `ritual`/
  `ritual-untap` como candidatos ao mesmo papel — nenhum convergiu (0–8%
  de sobreposição). Draw do Limit Break passa de 12 para 9 (número pior,
  correção aceite) e o deck ganha acesso temporário 3 — medido e mostrado,
  **sem alvo de referência** (decidido depois de um primeiro rascunho com
  alvo 2 tentativo: um número sem base para um papel de dias não significa
  nada, corrigido no mesmo dia).
- ~~Formulário de perfil declarado (§7.2)~~ — **já feito**, 5 de setembro
  de 2026. `src/rules/game-plan.js` (`seedGamePlan`) + `saveGamePlan` em
  `decklist.js` + painel "Ver plano de jogo" na lista de decks. Confirmado
  com Cloud, Ex-SOLDIER vs Tifa, Martial Artist — dois planos distintos a
  partir do mesmo deck, como previsto (`synergy-equipment`/`quick-equip`
  só no Cloud). Guardado por deck (`deck.game_plan`), nunca por
  configuração. **Revisto no mesmo dia**, depois do Diogo validar a
  proposta do Cloud: `cycle-*` filtrado da semente (bookkeeping da
  Scryfall, já reprovado no teste de dispersão do §7.1 — não é curadoria,
  é remover ruído medido); tags semeadas que já são papel do §7.1
  (`burst-draw`/`draw-engine`/`repeatable-pure-draw` → Draw, no Cloud)
  ficam anotadas no formulário via `getEstablishedRoleForTag`, sem serem
  removidas automaticamente — o Diogo decide se dilui o eixo de sinergia
  ao curar. **Pronto para o §8** usar como base do scoring.
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
- Fase A (§8.1) — implementada, sem enriquecimento por EDHREC
- Fase B (§8.2) — implementada sem as barreiras de bracket (primeiro na ordem
  de trabalho, §12)
- Fase C (§8.3, §8.4) — implementada a 27 set 2026 e **em revisão** desde o
  diagnóstico de 30 out (§8.0): eixos curados, sinal de força, emparelhamento
  por papel, lote avaliado como deck. Medida contra o conjunto de validação
  (§8.6).
- Simulação de checklist projetada (§6.2)
- Sincronização Supabase dos dados pessoais

**Aceite quando:** duas execuções com os mesmos parâmetros dão o mesmo resultado,
nenhuma carta recomendada quebra uma barreira do bracket alvo, e as recomendações
para o Shelob fazem sentido para o Diogo, que conhece o deck a fundo.

### Fase 5 — Reordenação e integrações
- Fase D (§8.5): justificação determinística implementada; reordenação por
  LLM por implementar, depende de decidir como a app chama a Anthropic API
- Pares adição/corte — gerados desde a Fase C, emparelhamento em revisão (§8.4)
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
| Afinar o motor a um único deck | Conjunto de validação do Limit Break (§8.6), depois confirmação no Shelob |

**Aberto, por ordem de trabalho (decidida a 30 de outubro de 2026):**

1. ~~**Barreiras de bracket na Fase B**~~ — feito a 30 out 2026 (§8.2),
   com o limite de Game Changers ao longo de um lote a cargo do ponto 2.
2. ~~**Emparelhamento por papel e lote avaliado como deck**~~ — feito a 30 out
   2026 (§8.4). Não mexeu no conjunto de validação: a causa das más escolhas
   é a relevância (ponto 3).
3. **Eixos curados e sugestão a partir das 99** (§7.2, §8.3). Hoje o score
   trata como eixo, com o peso máximo, toda a tag do plano que não seja papel
   do §7.1.
4. **Sinal de força** (§8.3). O motor não tem nenhum desde que
   `edhrec_rank` saiu do score. Investigar os dados por commander do EDHREC:
   o que existe, condições de uso, e como guardar em cache sem quebrar a
   invariante 10 — mostrar ao Diogo antes de implementar.

**Aberto, sem ordem:**

- **Alvos do §7.1 escritos à mão.** Os cortes "por folga" dependem deles e
  nenhum foi validado contra decks reais — reserva do Diogo (30 out): trocar
  ramp ou remoção por uma criatura é a decisão mais arriscada da lista. Estes
  cortes vão marcados como tal até os alvos terem base.
- **Pesos do score** (`w_eixo`, `w_papel`, `w_evitar`, força) — sliders na
  UI; os valores por omissão só se fixam medindo contra o §8.6.
- **`synergy-X` → `type_line`** só cobre X que seja tipo/subtipo literal
  (equipment, artifact, vehicle…); `synergy-graveyard`, `synergy-historic`
  ficam sem cobertura até o Diogo os curar à mão como eixo.
- **Validação só no Limit Break** — confirmar no Shelob que as correções
  generalizam, depois de ele ser importado.
- **LLM da Fase D** — falta decidir como a app autentica a Anthropic API.

**Trabalho futuro:** catálogo de precons no builder, a partir do
`taw/magic-preconstructed-decks-data` ou do MTGJSON. Hoje o campo "É um deck
de precon" (§4.3) é texto livre e a `base_cards` vem de colar a decklist à
mão — com um catálogo de precons na build, o nome passaria a um dropdown e a
`base_cards` importava-se sozinha, sem colar nada. Por avaliar: tamanho do
ficheiro resultante e frequência de atualização (precons saem a cada
lançamento, ao contrário do catálogo principal que só muda por carta).
