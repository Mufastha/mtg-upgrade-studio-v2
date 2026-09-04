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
aponta para nenhum dos 8 papéis, é uma carta genérica (corpo vanilla,
efeito fora do âmbito destes papéis). Medido sobre `synergy-*`: das 3 328
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
| Draw | `draw-engine`, `repeatable-pure-draw`, `pure-draw`, `burst-draw`, `force-draw`, `repeatable-impulsive-draw`, `long-term-impulsive-draw`, `impulsive-draw`, `repeatable-draw`, `repeatable-loot`, `loot`, `curiosity`, `wheel-symmetrical` | 8 |
| Remoção | `spot-removal`, `removal-creature/destroy/exile/toughness/nonland/sacrifice/artifact/land/enchantment/permanent/planeswalker/fight/aura/equipment/noncreature/vehicle/battle/nonenchantment/spacecraft`, `swap-removal`, `repeatable-removal`, `sweeper*`, `burn-any`, `burn-creature`, `burn-planeswalker`, `burn-with-set-s-mechanic`, `bombard`, `banish`, `lockdown-creature` — respostas **permanentes/duras** | 8 |
| Proteção | prefixo `protects-`, `gives-protection`, `gains-protection` — proteger o que já tens em jogo | 3 |
| Disrupção | prefixo `counterspell`, `discard`, `cost-increaser`, `cast-tax`, `tax-attack`, `tax-block`, `prevent-cast`, `stasis`, `mass-land-denial`, `lockdown-land` — negar recursos/ações ao adversário | 2 |
| Interação/Resposta | `removal-bounce`, `removal-tuck`, `freeze-creature`, prefixo `tapper-` — responder sem remover nem proteger (tap em massa, bounce, tuck) | 2 |
| Fecho de jogo | só `alternate-win-condition` — único sinal explícito da Scryfall para "ganha o jogo fora do combate normal"; não existe tag genérica "finisher"/"wincon". Fase 5: + combos do Commander Spellbook cujo resultado seja dano/vida em massa ou "win the game" (§12) | 1 |
| Amplificadores | `extra-combat-phase` (fase de combate — não confundir com turno extra, critério diferente da checklist de bracket, §6), `anthem` (+X/+X real; `keyword-anthem`, que só concede keywords, fica de fora), `storm-like`, `storm-count-matters` — acelera um plano já existente, não fecha nada por si | 2 |

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

**Revisão futura** — tags-irmãs do mesmo prefixo que dispersaram só por
amostra pequena (n<25), a reavaliar quando o catálogo crescer, nunca
promovidas sem voltar a medir: `lockdown-artifact` (n=15), `lockdown-permanent`
(n=3), `banish-graveyard` (n=6), `banish-hand` (n=12, pode ser Disrupção —
"exilar temporariamente da mão" —, amostra pequena demais para decidir),
`freeze-artifact` (n=9), `freeze-nonland` (n=6), `freeze-permanent-any`
(n=6), `freeze-land` (n=10), `wheel-symmetrical-optional` (n=10),
`burn-bright-with-set-mechanic` (n=21). `wheel-one-sided` (60%, n=85) tem
amostra suficiente mas ficou pendente — ver abaixo, decisão ainda por
tomar com a lista de cartas em mãos. `burn-player`, `burn-you` e
`curiosity-like` têm amostra grande (784, 104, 74) e dispersão real, não de
amostra — confirmados como não-classificadores, não entram nesta lista de
revisão.

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

**Onde aparece:** botão "Ver métricas" por deck na lista de "Decks
guardados", ao lado de "Ver cartas" — computado sob demanda (mais trabalho
por deck que a legalidade do §7.0, que corre sempre). Cada contagem é um
botão que expande a lista de cartas que a compõe. Texto simples, sem
gráficos. Uma carta classificada com incerteza (acima) aparece marcada nessa
lista — não some dentro da contagem como se fosse uma classificação normal.

Testado contra o Limit Break real: 37 terrenos, 41 fontes de mana, ramp 11,
draw 12, remoção 9, proteção 8, disrupção 0, interação/resposta 3, fecho de
jogo 1 (Hellkite Tyrant), amplificadores 1 (Tifa, Martial Artist, por
combate extra). **Papéis em falta: disrupção (0 de 2) e amplificadores (1 de
2)** — um resultado real e não-trivial, nem tudo passa nem tudo falha.

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

**Fase C — Scoring.** Compara cartas do deck com candidatas filtradas pela
mesma fórmula — não gera candidatas para preencher papéis em falta, mede
mérito face ao **plano de jogo** do commander (§7.2):

```
score(carta, plano) = w1 * sobreposição_de_tags_com_plano.synergy_tags
                     + w2 * eficiência (proxy: edhrec_rank)
                     - w3 * sobreposição_com_plano.avoid_tags
```

Pesos `w1..w3` são **visíveis e ajustáveis na interface** (sliders), nunca
constantes no código. Ainda não se sabe quanto vale cada termo — só se
descobre comparando recomendações com o julgamento do Diogo; enterrados no
código, cada afinação exigiria uma sessão de desenvolvimento em vez de um
slider (aberto no §12).

Posse (`Tenho`/`Comprar`/`Proxy`, §9) e preço são **classificação ao lado de
cada carta, nunca fator do score.** Já ter a carta é custo, não mérito;
misturá-los empurraria para baixo uma carta claramente melhor só por não
estar na coleção. Quem quiser ver só o que já tem liga um filtro — a
ordenação não muda com isso.

As cartas do deck (exceto commander e `untouchable`, §5) e as candidatas
filtradas na Fase B são pontuadas pela mesma fórmula. Ordena-se o deck a
subir (pior primeiro) e as candidatas a descer (melhor primeiro); empareha-se
pior com melhor. `missingRoles` do §7.1 fica como aviso estrutural ao lado da
lista ("30 terrenos é pouco"), nunca como termo do score — um deck já
equilibrado não pode deixar o motor mudo.

**Critério de paragem: `max_changes` (§5), não um score alvo.** O Diogo
decide quantas trocas quer ver; a engine não para porque uma carta "já
passou" um limiar.

**Fase D — Reordenação e justificação (LLM).** Apenas sobre o top ~40. Devolve
ordenação, justificação por carta e pares adição/corte propostos. Todo o output
é validado contra o catálogo (P5).

**Cortes.** Um deck de 100 cartas não aceita adições sem remoções. A engine
propõe pares; o corte é sempre decisão do utilizador; cartas em `untouchable`
nunca aparecem como corte.

Quando o corte é forçado por uma barreira do bracket alvo — por exemplo, o
deck excede o limite de Game Changers do §6 — o critério de escolha é o
mesmo score: corta-se primeiro o Game Changer pior pontuado face ao plano.
Se esse Game Changer for a única carta do deck a preencher um papel do §7.1,
o par de substituição é obrigatório, tirado da mesma Fase C e filtrado a
preencher esse papel. **Corte sem substituto é recomendação incompleta** —
nunca se mostra um corte sozinho.

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
  inspeção.
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

**Aberto:** valores iniciais dos pesos `w1..w3` do score (§8 Fase C — já
sliders na UI, não constantes no código) — a calibrar empiricamente
comparando recomendações com o julgamento do Diogo, Fase 4 contra o Shelob,
que ele já conhece a fundo.

**Trabalho futuro:** catálogo de precons no builder, a partir do
`taw/magic-preconstructed-decks-data` ou do MTGJSON. Hoje o campo "É um deck
de precon" (§4.3) é texto livre e a `base_cards` vem de colar a decklist à
mão — com um catálogo de precons na build, o nome passaria a um dropdown e a
`base_cards` importava-se sozinha, sem colar nada. Por avaliar: tamanho do
ficheiro resultante e frequência de atualização (precons saem a cada
lançamento, ao contrário do catálogo principal que só muda por carta).
