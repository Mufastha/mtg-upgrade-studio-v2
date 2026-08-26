# MTG Upgrade Studio

Ferramenta pessoal para melhorar decks de Commander existentes: cruza
recomendações de cartas com a coleção real e produz listas de compra para o
Cardmarket.

Ver [docs/ESPECIFICACAO.md](docs/ESPECIFICACAO.md) para as decisões de
arquitetura que não devem ser re-discutidas em cada sessão.

## Hosting

Servido como ficheiros estáticos pelo GitHub Pages. Num plano gratuito, o
GitHub Pages só está disponível para repositórios **públicos** — isto aplica-se
independentemente de servir a partir da raiz, de `/docs` ou via Actions, por
isso este repositório tem de se manter público enquanto usar esse plano.

## Dados pessoais

Este repositório é público. **Nenhum dado pessoal entra aqui** — coleção
exportada da ManaBox, decks importados, configurações. Esses dados vivem só no
IndexedDB do browser (ver §3.3 da especificação) ou, localmente durante o
desenvolvimento, em `local/`, que está no `.gitignore`.
