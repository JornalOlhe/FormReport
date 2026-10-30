'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => {
  const raw = String(value ?? '').trim();
  if (/^Imagens\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|svg)$/i.test(raw)) return raw;
  try { const u = new URL(raw); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
};
const fallback = 'Imagens/fallback.svg';
const photo = (x, cls = 'cover') => `<img class="${cls}" src="${esc(safeUrl(x.image) || fallback)}" alt="" loading="lazy" width="640" height="640">`;
const time = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const api = (url, signal) => FormReportAPI.request(url, { signal });

const form = $('#artistForm'), input = $('#artist'), list = $('#suggestions');
const albumsBox = $('#albums'), header = $('#artistHeader'), moreButton = $('#moreAlbums');
const player = $('#player'), audio = new Audio();

let suggestions = [], active = -1, typing = null, searchController = null;
let currentArtist = null, albums = [], albumOffset = 0, artistVersion = 0;
const tracksByAlbum = new Map();
let playing = null; // { albumId, index }

function status(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('error', error); }
document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && !event.target.src.endsWith('/fallback.svg')) event.target.src = fallback; }, true);
if (FormReportAPI.staticMode) document.querySelector('[data-online-note]').hidden = false;

// ---------- Sugestões ----------
function closeSuggestions() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
function highlight(index) {
  active = (index + suggestions.length) % suggestions.length;
  list.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
  input.setAttribute('aria-activedescendant', `suggestion-${active}`);
}
function renderSuggestions() {
  list.innerHTML = suggestions.length
    ? suggestions.map((a, i) => `<li role="option" id="suggestion-${i}" data-index="${i}" aria-selected="false">${photo(a, 'avatar')}<span><strong>${esc(a.name)}</strong>${a.genres?.length ? `<small>${esc(a.genres.join(' · '))}</small>` : ''}</span></li>`).join('')
    : '<li class="empty">Nenhum artista encontrado</li>';
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
async function suggest(term) {
  searchController?.abort();
  searchController = new AbortController();
  try {
    const data = await api('/api/music/search?' + new URLSearchParams({ q: term }), searchController.signal);
    if (input.value.trim() !== term) return data.artists;
    suggestions = data.artists; active = -1; renderSuggestions();
    return suggestions;
  } catch (error) {
    if (error.name !== 'AbortError') status(error.message, true);
    return [];
  }
}
input.addEventListener('input', () => {
  clearTimeout(typing);
  const term = input.value.trim();
  if (term.length < 2) return closeSuggestions();
  typing = setTimeout(() => suggest(term), 250);
});
input.addEventListener('keydown', event => {
  if (list.hidden || !suggestions.length) return;
  if (event.key === 'ArrowDown') { event.preventDefault(); highlight(active + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active - 1); }
  else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); chooseArtist(suggestions[active]); }
  else if (event.key === 'Escape') closeSuggestions();
});
list.addEventListener('mousedown', event => {
  const item = event.target.closest('li[data-index]');
  if (!item) return;
  event.preventDefault();
  chooseArtist(suggestions[item.dataset.index]);
});
document.addEventListener('click', event => { if (!form.contains(event.target)) closeSuggestions(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); // Impede o recarregamento padrão da página
  const term = input.value.trim();
  if (term.length < 2) return status('Digite pelo menos 2 caracteres.', true);
  clearTimeout(typing);
  const found = await suggest(term);
  if (found.length) chooseArtist(found[0]); else status('Nenhum artista encontrado para essa busca.', true);
});

// ---------- Artista e álbuns ----------
async function chooseArtist(artist) {
  const version = ++artistVersion;
  input.value = artist.name;
  closeSuggestions();
  currentArtist = artist; albums = []; albumOffset = 0; tracksByAlbum.clear();
  albumsBox.replaceChildren(); moreButton.hidden = true;
  header.innerHTML = `${photo(artist, 'artist-photo')}<div><p class="eyebrow">Discografia de</p><h2>${esc(artist.name)}</h2></div>`;
  header.hidden = false;
  status('Buscando álbuns…');
  await loadAlbums(version);
}
async function loadAlbums(version) {
  moreButton.disabled = true;
  try {
    const data = await api(`/api/music/artist/${encodeURIComponent(currentArtist.id)}?offset=${albumOffset}`);
    if (version !== artistVersion) return;
    const known = new Set(albums.map(a => a.name.toLowerCase()));
    const fresh = data.albums.filter(a => !known.has(a.name.toLowerCase()));
    albums.push(...fresh);
    albumOffset += 24;
    albumsBox.insertAdjacentHTML('beforeend', fresh.map(albumCard).join(''));
    moreButton.hidden = !data.hasMore;
    status(albums.length ? `${albums.length} álbuns · clique em uma capa para ver as faixas` : 'Esse artista não tem álbuns disponíveis.');
  } catch (error) {
    if (version === artistVersion) status(error.message, true);
  } finally { moreButton.disabled = false; }
}
moreButton.addEventListener('click', () => loadAlbums(artistVersion));
function albumCard(a) {
  return `<article class="card" data-id="${esc(a.id)}"><button class="card-art" type="button" aria-expanded="false" aria-label="Ver faixas de ${esc(a.name)}"><span class="disc"></span>${photo(a)}</button><div class="card-text"><h3>${esc(a.name)}</h3><p>${esc(String(a.releaseDate).slice(0, 4))}${a.totalTracks ? ` · ${a.totalTracks} faixas` : ''}</p></div><ol class="tracks" hidden></ol></article>`;
}
albumsBox.addEventListener('click', event => {
  const art = event.target.closest('.card-art');
  if (art) return toggleAlbum(art.closest('.card'));
  const row = event.target.closest('.track button');
  if (row) { const li = row.closest('.track'); play(li.dataset.album, Number(li.dataset.index)); }
});
async function toggleAlbum(card) {
  const box = card.querySelector('.tracks'), open = box.hidden;
  box.hidden = !open;
  card.classList.toggle('open', open);
  card.querySelector('.card-art').setAttribute('aria-expanded', String(open));
  if (!open) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const id = card.dataset.id;
  if (tracksByAlbum.has(id)) return;
  box.innerHTML = '<li class="loading">Buscando prévias…</li>';
  try {
    const data = await api(`/api/music/album/${encodeURIComponent(id)}`);
    tracksByAlbum.set(id, data.tracks);
    box.innerHTML = data.tracks.map((t, i) => {
      const preview = safeUrl(t.previewUrl);
      return `<li class="track${preview ? '' : ' no-preview'}" data-album="${esc(id)}" data-index="${i}"><button type="button"${preview ? '' : ' disabled'} aria-label="Tocar ${esc(t.name)}"><span class="number">${esc(t.number || i + 1)}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="name">${esc(t.name)}</span><span class="length">${preview ? time(t.duration) : 'sem prévia'}</span></button></li>`;
    }).join('') || '<li class="loading">Este álbum não tem faixas.</li>';
    markPlaying();
  } catch (error) {
    box.innerHTML = `<li class="loading error">${esc(error.message)}</li>`;
  }
}

// ---------- Player ----------
function play(albumId, index) {
  if (playing && playing.albumId === albumId && playing.index === index) { audio.paused ? audio.play() : audio.pause(); return; }
  const track = tracksByAlbum.get(albumId)[index];
  const album = albums.find(a => a.id === albumId);
  const src = safeUrl(track.previewUrl);
  if (!src) return;
  playing = { albumId, index };
  audio.src = src;
  audio.play().catch(() => status('Não foi possível tocar esta prévia. Tente outra faixa.', true));
  $('#playerCover').src = safeUrl(album?.image) || fallback;
  $('#playerTrack').textContent = track.name;
  $('#playerAlbum').textContent = `${currentArtist.name} · ${album?.name || ''}`;
  player.hidden = false;
  markPlaying();
}
function nextTrack() {
  if (!playing) return;
  const tracks = tracksByAlbum.get(playing.albumId);
  for (let i = playing.index + 1; i < tracks.length; i++) if (safeUrl(tracks[i].previewUrl)) return play(playing.albumId, i);
  audio.pause();
}
function markPlaying() {
  document.querySelectorAll('.track.playing').forEach(li => li.classList.remove('playing'));
  document.querySelectorAll('.card.spinning').forEach(c => c.classList.remove('spinning'));
  if (!playing) return;
  document.querySelector(`.track[data-album="${CSS.escape(playing.albumId)}"][data-index="${playing.index}"]`)?.classList.add('playing');
  if (!audio.paused) document.querySelector(`.card[data-id="${CSS.escape(playing.albumId)}"]`)?.classList.add('spinning');
}
audio.addEventListener('play', () => { player.classList.remove('paused'); $('#playerToggle').setAttribute('aria-label', 'Pausar'); document.body.classList.remove('paused'); markPlaying(); });
audio.addEventListener('pause', () => { player.classList.add('paused'); $('#playerToggle').setAttribute('aria-label', 'Tocar'); document.body.classList.add('paused'); markPlaying(); });
audio.addEventListener('timeupdate', () => { $('#playerProgress').style.width = `${audio.duration ? (audio.currentTime / audio.duration) * 100 : 0}%`; });
audio.addEventListener('ended', nextTrack);
audio.addEventListener('error', () => { if (audio.src) status('A prévia desta faixa não pôde ser carregada.', true); });
$('#playerToggle').addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
$('#playerNext').addEventListener('click', nextTrack);
