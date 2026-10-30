# formreport

Digite o nome de um artista, escolha na lista de sugestões e ouça a prévia de 30 segundos das faixas de cada álbum. Projeto irmão do [PopReport](https://github.com/JornalOlhe/PopREPORT), com a mesma identidade visual e a mesma arquitetura.

## Site online

**https://jornalolhe.github.io/formreport/**

A publicação usa GitHub Pages, sem servidor e sem credenciais. No Pages a busca usa a fonte pública Deezer, que já fornece o link da prévia de cada faixa. Nenhum áudio é baixado ou hospedado pelo projeto.

Para ativar: Settings > Pages > Deploy from a branch > **main /docs**.

## Como usar

1. Digite pelo menos 2 letras do nome do artista. Aparecem sugestões com foto (setas + Enter funcionam).
2. Escolha o artista (ou envie o formulário para usar a primeira sugestão): os álbuns aparecem em grade, com "Carregar mais álbuns" quando houver mais.
3. Clique na capa de um álbum para ver as faixas e clique em uma faixa para tocar a prévia no player fixo. Ao terminar, toca a próxima faixa que tiver prévia. Faixas sem prévia aparecem desabilitadas.

## Versão local

Requisito: Node.js 18+. Não há dependências para instalar.

```sh
npm start
```

Abra http://127.0.0.1:3000. Sem configuração, o servidor usa o Deezer. Para usar a Spotify Web API, crie um app em https://developer.spotify.com/dashboard, copie `.env.example` para `.env.local` e preencha `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`. O segredo nunca deve ser enviado ao GitHub.

### Sobre as prévias do Spotify

Apps novos do Spotify recebem `preview_url` vazio. Nesse caso o servidor procura o link do mp3 na página do player embed da faixa (`open.spotify.com/embed/track/:id`). Essa página é interna do Spotify, não tem garantia oficial e pode mudar; se mudar, as faixas aparecem como "sem prévia". O Deezer não tem essa limitação.

## Como publicar e atualizar

Altere os arquivos da raiz e gere a publicação:

```sh
npm run check
npm test
npm run build:pages
npm run preview:pages
```

Abra http://127.0.0.1:3014/FormReport/ para conferir. Depois envie as fontes e a pasta `docs/` juntas. Os arquivos de `docs/` são gerados a partir da raiz: não os edite diretamente. O workflow `Verify FormReport` falha se `docs/` estiver desatualizado.

## Estrutura

- `index.html`, `app.css`: interface.
- `script/app.js`: sugestões, álbuns, faixas e player.
- `script/api.js`: acesso ao servidor local ou direto à fonte pública na publicação.
- `script/music-data.js`: provedor Deezer compartilhado entre Node e Pages.
- `script/runtime-config.js`: modo local; o build gera o modo estático em `docs/`.
- `server.js` e `music.js`: aplicação local (Node puro, só serve arquivos públicos de uma lista explícita).
- `scripts/`: build e prévia do Pages. `test/integration.cjs`: testes com Spotify simulado.
- `docs/`: arquivos publicados pelo Pages.

## Rotas locais

| Rota | O que faz |
|---|---|
| `GET /api/music/search?q=` | sugestões de artistas |
| `GET /api/music/artist/:id?offset=` | álbuns do artista (24 por página) |
| `GET /api/music/album/:id` | faixas do álbum com `previewUrl` |
| `GET /api/status` | informa se o Spotify está configurado |

Serviços externos podem mudar ou ficar indisponíveis; disponibilidade permanente não é prometida.
