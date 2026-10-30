const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.TEST_PORT || 3118);
const mockPort = port + 1;

// Spotify simulado: nenhum teste depende de rede ou de credenciais reais.
function mockSpotify() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const send = (data, type = 'application/json') => { res.setHeader('content-type', type); res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
      if (u.pathname === '/api/token') return send({ access_token: 't', expires_in: 3600 });
      if (u.pathname.startsWith('/embed/track/')) {
        const id = u.pathname.split('/').pop();
        return send(id.endsWith('3') ? '<html>sem prévia</html>' : `{"audioPreview":{"url":"http://127.0.0.1:${mockPort}/audio/${id}.mp3"}}`, 'text/html');
      }
      if (req.headers.authorization !== 'Bearer t') { res.statusCode = 401; return send({}); }
      if (/^\/v1\/artists\/[A-Za-z0-9]{22}$/.test(u.pathname)) return send({ id: u.pathname.split('/').pop(), name: 'Artista', images: [], genres: [] });
      if (u.pathname === '/v1/search') return send({ artists: { items: [{ id: 'A'.repeat(22), name: `${u.searchParams.get('q')} <b>x</b>`, images: [], genres: ['mpb'] }] } });
      if (u.pathname.endsWith('/albums') && u.pathname.includes('/artists/')) {
        const off = Number(u.searchParams.get('offset') || 0);
        return send({ total: 3, next: off ? null : 'x', items: [{ id: 'B'.repeat(22), name: 'Álbum', images: [], artists: [{ name: 'X' }], release_date: '1999-01-01', total_tracks: 4 }, { id: 'C'.repeat(22), name: 'ÁLBUM', images: [], artists: [{ name: 'X' }] }] });
      }
      if (u.pathname.startsWith('/v1/albums/')) {
        const items = [1, 2, 3, 4].map(n => ({ id: `faixa${n}`.padEnd(22, '0').replace(/0+$/, '') + String(n), track_number: n, name: `Faixa ${n}`, duration_ms: 200000, preview_url: n === 1 ? 'https://p.scdn.co/mp3-preview/direto' : null }));
        return send({ id: 'B'.repeat(22), name: 'Álbum', images: [], artists: [{ name: 'X' }], release_date: '1999', total_tracks: 4, tracks: { items } });
      }
      res.statusCode = 404; send({});
    }).listen(mockPort, '127.0.0.1', () => resolve(server));
  });
}

async function run(extra, callback) {
  const child = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), ...extra }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { const r = await fetch(base); if (r.ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
    assert.ok(ready, 'Servidor iniciou');
    await callback((url, opts) => fetch(base + url, opts));
  } finally { const stopped = new Promise(r => child.once('exit', r)); child.kill(); await stopped; }
}

(async () => {
  const mock = await mockSpotify();
  const spotifyEnv = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'segredo', SPOTIFY_API_URL: `http://127.0.0.1:${mockPort}/v1`, SPOTIFY_ACCOUNTS_URL: `http://127.0.0.1:${mockPort}`, SPOTIFY_EMBED_URL: `http://127.0.0.1:${mockPort}/embed/track` };
  try {
    await run({ SPOTIFY_CLIENT_ID: '', SPOTIFY_CLIENT_SECRET: '' }, async request => {
      const state = await (await request('/api/status')).json();
      assert.equal(state.spotify.configured, false);
      for (const file of ['/.env', '/server.js', '/music.js', '/package.json', '/test/integration.cjs', '/node_modules/x', '/%2eenv', '/script/../server.js']) assert.equal((await request(file)).status, 404, file);
      for (const file of ['/', '/app.css', '/script/app.js', '/Imagens/fallback.svg']) assert.equal((await request(file)).status, 200, file);
      for (const query of ['q=x', 'q=', 'q=' + 'x'.repeat(101)]) assert.equal((await request('/api/music/search?' + query)).status, 400, query);
      for (const url of ['/api/music/artist/12369444?offset=-1', '/api/music/artist/12369444?offset=1.5', '/api/music/artist/12369444?offset=1001']) assert.equal((await request(url)).status, 400, url);
      assert.equal((await request('/api/music/artist/' + 'A'.repeat(22))).status, 503);
      assert.equal((await request('/api/inexistente')).status, 404);
      console.log('PASS: arquivos privados bloqueados e parâmetros validados sem Spotify');
    });

    await run(spotifyEnv, async request => {
      assert.equal((await (await request('/api/status')).json()).spotify.configured, true);
      const search = await (await request('/api/music/search?q=gil')).json();
      assert.equal(search.source, 'Spotify');
      assert.equal(search.artists[0].kind, 'artist');
      assert.equal(search.artists[0].genres[0], 'mpb');
      const id = search.artists[0].id;
      const artist = await (await request('/api/music/artist/' + id)).json();
      assert.equal(artist.albums.length, 1, 'versões com o mesmo nome são unidas');
      assert.equal(artist.hasMore, true);
      assert.equal((await (await request('/api/music/artist/' + id + '?offset=24')).json()).hasMore, false);
      const album = await (await request('/api/music/album/' + 'B'.repeat(22))).json();
      assert.equal(album.tracks.length, 4);
      assert.equal(album.tracks[0].previewUrl, 'https://p.scdn.co/mp3-preview/direto', 'usa preview_url quando existe');
      assert.ok(album.tracks[1].previewUrl.endsWith('.mp3'), 'busca no player embed quando preview_url é nulo');
      assert.equal(album.tracks[2].previewUrl, '', 'faixa sem prévia continua listada');
      console.log('PASS: busca, álbuns, paginação e prévias pelo Spotify (com plano B pelo embed)');
    });

    await run({ ...spotifyEnv, SPOTIFY_CLIENT_SECRET: 'errado', SPOTIFY_ACCOUNTS_URL: 'http://127.0.0.1:1' }, async request => {
      assert.equal((await request('/api/music/search?q=gil')).status, 502);
      console.log('PASS: falha do Spotify vira mensagem amigável (502)');
    });
  } finally { mock.close(); }
  console.log('Todos os testes de integração passaram.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
