(function (root) {
  'use strict';
  const staticMode = root.FORMREPORT_MODE === 'static';
  async function staticRequest(raw) {
    const url = new URL(raw, location.origin);
    const match = url.pathname.match(/^\/api\/music\/(artist|album)\/(\d{1,16})$/);
    if (url.pathname === '/api/music/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2 || q.length > 100) throw new Error('Digite de 2 a 100 caracteres para buscar.');
      return root.FormReportMusic.search(q);
    }
    if (match) {
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new Error('Página inválida.');
      return root.FormReportMusic.detail(match[1], match[2], offset);
    }
    throw new Error('Este conteúdo não está disponível.');
  }
  async function request(url, options = {}) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (staticMode) return staticRequest(url);
    const response = await fetch(url, options);
    let data;
    try { data = await response.json(); } catch { throw new Error('Não foi possível carregar este conteúdo. Tente novamente.'); }
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir esta ação. Tente novamente.');
    return data;
  }
  root.FormReportAPI = { request, staticMode };
})(globalThis);
