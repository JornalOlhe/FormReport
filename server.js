const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const music = require('./music');

function loadDotEnv() {
  for (const fileName of ['.env.local', '.env']) {
    const envPath = path.join(ROOT, fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const SPOTIFY_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.SPOTIFY_REQUEST_TIMEOUT_MS || 8000)));
// Endereços substituíveis apenas para os testes de integração (servidor Spotify simulado).
const SPOTIFY_API = process.env.SPOTIFY_API_URL || 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com';
const EMBED_DEFAULT = 'https://open.spotify.com/embed/track';
const SPOTIFY_EMBED = process.env.SPOTIFY_EMBED_URL || EMBED_DEFAULT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

// -------------------------
// Spotify Web API
// -------------------------
const spotify = { token: null, expiresAt: 0 };

function spotifyConfigured() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

async function getSpotifyToken() {
  if (!spotifyConfigured()) {
    const err = new Error('SPOTIFY_NOT_CONFIGURED');
    err.code = 'SPOTIFY_NOT_CONFIGURED';
    throw err;
  }
  if (spotify.token && Date.now() < spotify.expiresAt - 60_000) return spotify.token;

  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify auth failed (${response.status}): ${text.slice(0, 180)}`);
  }

  const data = await response.json();
  spotify.token = data.access_token;
  spotify.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return spotify.token;
}

async function spotifyFetch(endpoint, retryAuth = true) {
  const token = await getSpotifyToken();
  const response = await fetch(`${SPOTIFY_API}${endpoint}`, {
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 401 && retryAuth) {
    spotify.token = null;
    spotify.expiresAt = 0;
    return spotifyFetch(endpoint, false);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify request failed (${response.status}): ${text.slice(0, 220)}`);
  }
  return response.json();
}

function mapArtist(artist) {
  return {
    id: artist.id,
    kind: 'artist',
    name: artist.name,
    image: artist.images?.[0]?.url || '',
    genres: (artist.genres || []).slice(0, 3),
    url: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`
  };
}

function mapAlbum(album) {
  return {
    id: album.id,
    kind: 'album',
    name: album.name,
    image: album.images?.[0]?.url || '',
    artist: album.artists?.[0]?.name || '',
    releaseDate: album.release_date || '',
    totalTracks: album.total_tracks || 0,
    url: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`
  };
}

function mapTrack(track) {
  return {
    id: track.id,
    kind: 'track',
    name: track.name,
    number: track.track_number || 0,
    duration: Math.round(Number(track.duration_ms || 0) / 1000),
    previewUrl: track.preview_url || '',
    url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`
  };
}

// Apps novos do Spotify recebem preview_url nulo. Nesse caso o link do mp3 é lido
// no player embed oficial da faixa; se a página mudar, a faixa fica sem prévia.
const previewCache = new Map();

async function embedPreview(id) {
  if (previewCache.has(id)) return previewCache.get(id);
  let preview = '';
  try {
    const response = await fetch(`${SPOTIFY_EMBED}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS) });
    const found = (await response.text()).match(/"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/);
    if (found) preview = JSON.parse(`"${found[1]}"`);
    // Só aceita https (no teste com servidor simulado, aceita o endereço local).
    if (!/^https:\/\//.test(preview) && SPOTIFY_EMBED === EMBED_DEFAULT) preview = '';
  } catch (error) {
    console.warn('[Spotify embed]', error.message);
  }
  if (previewCache.size >= 1000) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(id, preview);
  return preview;
}

async function spotifySearch(q) {
  const params = new URLSearchParams({ q, type: 'artist', limit: '8' });
  const data = await spotifyFetch(`/search?${params}`);
  return { artists: (data.artists?.items || []).filter(Boolean).map(mapArtist), source: 'Spotify' };
}

async function spotifyDetail(kind, id, offset = 0) {
  const market = process.env.SPOTIFY_MARKET || 'BR';
  const safeId = encodeURIComponent(id);

  if (kind === 'artist') {
    const artist = await spotifyFetch(`/artists/${safeId}`);
    const albumData = await spotifyFetch(`/artists/${safeId}/albums?include_groups=album,single&market=${encodeURIComponent(market)}&limit=24&offset=${offset}`);
    const seen = new Set();
    const albums = (albumData.items || []).filter(item => item && !seen.has(item.name.toLowerCase()) && seen.add(item.name.toLowerCase())).map(mapAlbum);
    return { ...mapArtist(artist), albumCount: Number(albumData.total || albums.length), albums, hasMore: Boolean(albumData.next), source: 'Spotify' };
  }

  const album = await spotifyFetch(`/albums/${safeId}?market=${encodeURIComponent(market)}`);
  const tracks = (album.tracks?.items || []).filter(Boolean).map(mapTrack);
  await Promise.all(tracks.filter(t => !t.previewUrl).map(async t => { t.previewUrl = await embedPreview(t.id); }));
  return { ...mapAlbum(album), tracks, source: 'Spotify' };
}

// -------------------------
// API
// -------------------------
async function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/music/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 100) return sendJson(res, 400, { error: 'Use uma busca de 2 a 100 caracteres.' });
    try {
      return sendJson(res, 200, spotifyConfigured() ? await spotifySearch(q) : await music.search(q));
    } catch (error) {
      console.error('[Music search]', error.message);
      return sendJson(res, 502, { error: spotifyConfigured() ? 'Não foi possível consultar o Spotify agora.' : 'Busca indisponível no momento. Verifique sua conexão e tente novamente.' });
    }
  }

  const detailMatch = url.pathname.match(/^\/api\/music\/(artist|album)\/([A-Za-z0-9]{22}|\d{1,16})$/);
  if (req.method === 'GET' && detailMatch) {
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) return sendJson(res, 400, { error: 'Página inválida.' });
    try {
      const id = detailMatch[2];
      const isSpotifyId = /^[A-Za-z0-9]{22}$/.test(id);
      if (isSpotifyId && !spotifyConfigured()) return sendJson(res, 503, { error: 'Configure o Spotify no arquivo .env para abrir este perfil.' });
      const data = isSpotifyId ? await spotifyDetail(detailMatch[1], id, offset) : await music.detail(detailMatch[1], id, offset);
      return sendJson(res, 200, data);
    } catch (error) {
      console.error('[Music detail]', error.message);
      return sendJson(res, 502, { error: 'Não foi possível carregar este conteúdo. Tente novamente.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, { spotify: { configured: spotifyConfigured(), market: process.env.SPOTIFY_MARKET || 'BR' } });
  }

  return false;
}

function serveStatic(req, res, url) {
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); }
  catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad Request');
  }

  const relative = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  // Lista pública explícita: nunca expor .env, código do servidor ou dependências.
  const publicFile = /^(index\.html|app\.css|script\/(app|api|music-data|runtime-config)\.js|Imagens\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|svg))$/.test(relative);
  if (!publicFile || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); return res.end('Arquivo não encontrado');
  }
  const filePath = path.resolve(ROOT, relative);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (!filePath.startsWith(rootPrefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Arquivo não encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; media-src 'self' blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host || '').replace(/:\d+$/, ''))) { res.writeHead(403); return res.end('Host inválido'); }
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); }
  catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      const handled = await routeApi(req, res, url);
      if (handled !== false) return;
      return sendJson(res, 404, { error: 'Rota não encontrada.' });
    } catch (error) {
      console.error('[API fatal]', error);
      return sendJson(res, 500, { error: 'Não foi possível concluir esta ação. Tente novamente.' });
    }
  }

  serveStatic(req, res, url);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nFormReport: http://127.0.0.1:${PORT}`);
  console.log(`Spotify API: ${spotifyConfigured() ? 'configurada' : 'não configurada (usando Deezer)'}`);
  console.log('');
});
