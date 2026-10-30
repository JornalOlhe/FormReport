// Provedor público de metadados compartilhado entre Node.js e GitHub Pages (Deezer).
(function (root) {
'use strict';
const browserMode = typeof window !== 'undefined';
const cache = new Map();
let sequence = 0;
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `formreport_${Date.now()}_${++sequence}`;
    const script = document.createElement('script');
    const target = new URL(url);
    target.searchParams.set('output', 'jsonp');
    target.searchParams.set('callback', callback);
    function clean() { clearTimeout(timer); script.remove(); delete root[callback]; }
    const timer = setTimeout(() => { clean(); reject(new Error('A busca demorou para responder. Tente novamente.')); }, 10000);
    root[callback] = data => { clean(); resolve(data); };
    script.onerror = () => { clean(); reject(new Error('Não foi possível consultar a música. Tente novamente.')); };
    script.src = target.href;
    document.head.append(script);
  });
}
async function json(url) {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.data;
  let data;
  if (browserMode) data = await jsonp(url);
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'FormReport/1.0 (music preview discovery)' } });
    if (!response.ok) throw new Error('Fonte musical temporariamente indisponível. Tente novamente.');
    data = await response.json();
  }
  if (data.error) throw new Error('A fonte musical não retornou este conteúdo.');
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(url, { data, until: Date.now() + 300000 });
  return data;
}
const dz = endpoint => json('https://api.deezer.com' + endpoint);
const image = x => x.picture_xl || x.cover_xl || x.picture_big || x.cover_big || x.picture_medium || x.cover_medium || '';
const artist = x => ({ id: String(x.id), kind: 'artist', name: x.name, image: image(x), genres: [], url: x.link });
const album = x => ({ id: String(x.id), kind: 'album', name: x.title, image: image(x), artist: x.artist?.name || '', releaseDate: x.release_date || '', totalTracks: x.nb_tracks || 0, url: x.link });
const track = x => ({ id: String(x.id), kind: 'track', name: x.title, number: x.track_position || 0, duration: x.duration || 0, previewUrl: x.preview || '', url: x.link });
async function search(q) {
  const data = await dz(`/search/artist?q=${encodeURIComponent(q)}&limit=8`);
  return { artists: (data.data || []).map(artist), source: 'Deezer' };
}
async function detail(kind, id, offset = 0) {
  if (kind === 'artist') {
    const data = await dz(`/artist/${id}`);
    const page = await dz(`/artist/${id}/albums?limit=24&index=${offset}`);
    const seen = new Set();
    const albums = (page.data || []).filter(x => !seen.has(x.title.toLowerCase()) && seen.add(x.title.toLowerCase())).map(album);
    return { ...artist(data), albumCount: data.nb_album, albums, hasMore: Boolean(page.next), source: 'Deezer' };
  }
  const data = await dz(`/album/${id}`);
  return { ...album(data), tracks: (data.tracks?.data || []).map((t, i) => track({ ...t, track_position: t.track_position || i + 1 })), source: 'Deezer' };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { search, detail };
else root.FormReportMusic = { search, detail };
})(globalThis);
