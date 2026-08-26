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

## Convenções

- Um commit por fase concluída, com mensagem descritiva
- Nomes de cartas em inglês internamente; UI em português
- Nada de dependências novas sem justificação — a app tem de continuar a servir
  como ficheiros estáticos

## Estado atual

Fase 1 (fundação de dados) por começar. Ver §11 da especificação para os
critérios de aceitação.

Dois decks de validação, com papéis diferentes (ver §11 da especificação):
- **Limit Break** (Cloud, Ex-SOLDIER) — Fases 1 a 3.
- **Shelob** (aranhas / deathtouch / Food) — Fases 4 e 5.
