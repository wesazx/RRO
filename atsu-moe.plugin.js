/**
 * Atsu.moe source plugin for Harbor
 *
 * Backed by:
 *  - Typesense index:  /collections/manga/documents/search
 *  - Site JSON API:    /api/manga/page, /api/manga/chapters, /api/read/chapter,
 *                      /api/explore/availableFilters
 */

const BASE = 'https://atsu.moe';
const PAGE = 48; // Harbor's MANGA_PAGE

// Fields returned by the Typesense documents endpoint
const INCLUDE_FIELDS =
  'id,title,englishTitle,poster,posterSmall,posterMedium,type,medium,isAdult,status,year,mbRating,popularity,dateAdded';
const QUERY_BY = 'title,englishTitle,otherNames,authors,acronyms';
const QUERY_BY_WEIGHTS = '4,3,2,1,1';

function abs(path) {
  if (!path || typeof path !== 'string') return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  // Posters/banners/pages live under /static/, sometimes given with or without the prefix
  const p = path.startsWith('/') ? path : '/static/' + path;
  return BASE + p;
}

function numToMs(v) {
  // createdAt comes either as epoch millis (number) or ISO string
  if (typeof v === 'number') return new Date(v).toISOString();
  return v;
}

async function tsSearch(params) {
  const qs = new URLSearchParams({
    q: params.q,
    query_by: QUERY_BY,
    query_by_weights: QUERY_BY_WEIGHTS,
    prefix: 'true,true,true,true,false',
    include_fields: INCLUDE_FIELDS,
    filter_by: params.filter,
    per_page: String(PAGE),
    page: String(Math.floor(params.offset / PAGE) + 1),
  });
  if (params.sort) qs.set('sort_by', params.sort);

  const res = await harbor.http(BASE + '/collections/manga/documents/search?' + qs.toString(), {
    responseType: 'json',
    headers: { 'user-agent': 'Harbor/1.0 (atsu.moe plugin)' },
  });
  if (!res || res === null) return [];
  const json = typeof res === 'object' ? res : null;
  const hits = (json && json.hits) || [];
  return hits.map((h) => h.document || {}).filter((d) => d.id);
}

function docToSummary(d) {
  const cover = abs(d.poster) || abs(d.posterMedium) || abs(d.posterSmall);
  return {
    id: d.id,
    title: d.title,
    altTitle: d.englishTitle || undefined,
    cover,
    year: d.year || undefined,
    status: d.status ? String(d.status).toLowerCase() : undefined,
    contentRating: d.isAdult ? 'mature' : undefined,
  };
}

const provider = {
  id: 'atsu-moe',
  name: 'Atsu',

  async popular(offset, tagId) {
    let filter = 'hidden:!=true';
    if (tagId) {
      // tagId encodes kind and id: "g:<id>" genre, "t:<id>" tag
      if (tagId.startsWith('g:')) filter += ` && genreIds:=\`${tagId.slice(2)}\``;
      else if (tagId.startsWith('t:')) filter += ` && tagIds:=\`${tagId.slice(2)}\``;
    }
    const docs = await tsSearch({ q: '*', filter, sort: 'views:desc', offset });
    return docs.map(docToSummary);
  },

  async search(query, offset, tagId) {
    let filter = 'hidden:!=true';
    if (tagId) {
      if (tagId.startsWith('g:')) filter += ` && genreIds:=\`${tagId.slice(2)}\``;
      else if (tagId.startsWith('t:')) filter += ` && tagIds:=\`${tagId.slice(2)}\``;
    }
    const docs = await tsSearch({ q: query.trim() || '*', filter, sort: null, offset });
    return docs.map(docToSummary);
  },

  async detail(id) {
    const res = await harbor.http(`${BASE}/api/manga/page?id=${encodeURIComponent(id)}`, {
      responseType: 'json',
      headers: { 'user-agent': 'Harbor/1.0 (atsu.moe plugin)' },
    });
    if (!res || !res.mangaPage) return null;
    const m = res.mangaPage;
    const authors = Array.isArray(m.authors)
      ? [...new Set(m.authors.map((a) => a.name))].join(', ')
      : undefined;
    const lastCh =
      Array.isArray(m.chapters) && m.chapters.length
        ? String(m.chapters[0].number ?? m.chapters[0].title ?? '')
        : m.totalChapterCount != null && !m.hasMoreChapters
          ? String(m.totalChapterCount)
          : undefined;

    const summary = {
      id: m.id,
      title: m.title,
      altTitle: m.englishTitle || undefined,
      cover: m.poster ? abs(m.poster.image || m.poster.mediumImage || m.poster.smallImage) : undefined,
      year: m.released ? new Date(m.released).getUTCFullYear() : undefined,
      status: m.status ? String(m.status).toLowerCase() : undefined,
      description: m.synopsis || undefined,
      author: authors,
      lastChapter: lastCh,
      contentRating: m.isAdult ? 'mature' : undefined,
    };
    return summary;
  },

  async chapters(id) {
    // id is the manga id
    const out = [];
    let page = 0;
    let totalPages = 1;
    do {
      const res = await harbor.http(
        `${BASE}/api/manga/chapters?id=${encodeURIComponent(id)}&filter=all&sort=desc&page=${page}`,
        { responseType: 'json', headers: { 'user-agent': 'Harbor/1.0 (atsu.moe plugin)' } }
      );
      if (!res || !Array.isArray(res.chapters)) break;
      totalPages = Number(res.pages) || 1;
      for (const c of res.chapters) {
        if (!c || !c.id) continue;
        const number = c.number != null ? String(c.number) : null;
        // encode mangaId into chapter id so pageUrls can call /api/read/chapter
        out.push({
          id: `${id}:${c.id}`,
          chapter: number,
          title: c.title || undefined,
          volume: null,
          pages: Number(c.pageCount) || 0,
          language: 'en',
          group: undefined,
          publishAt: numToMs(c.createdAt),
        });
        if (out.length >= 5000) break;
      }
      page += 1;
    } while (page < totalPages && out.length < 5000);
    return out;
  },

  async pageUrls(chapterId) {
    // chapterId = "<mangaId>:<chapterId>"
    const sep = chapterId.indexOf(':');
    const mangaId = sep > 0 ? chapterId.slice(0, sep) : '';
    const chId = sep > 0 ? chapterId.slice(sep + 1) : chapterId;
    const res = await harbor.http(
      `${BASE}/api/read/chapter?mangaId=${encodeURIComponent(mangaId)}&chapterId=${encodeURIComponent(chId)}`,
      { responseType: 'json', headers: { 'user-agent': 'Harbor/1.0 (atsu.moe plugin)' } }
    );
    const rc = res && res.readChapter;
    if (!rc || !Array.isArray(rc.pages)) return [];
    return rc.pages
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .map((p) => abs(p.image))
      .filter(Boolean);
  },

  async tags() {
    const res = await harbor.http(`${BASE}/api/explore/availableFilters`, {
      responseType: 'json',
      headers: { 'user-agent': 'Harbor/1.0 (atsu.moe plugin)' },
    });
    if (!res) return [];
    const out = [];
    for (const g of res.genres || []) {
      if (!g || !g.id) continue;
      out.push({ id: `g:${g.id}`, name: g.name, group: 'Genre' });
    }
    for (const t of res.tags || []) {
      if (!t || !t.id) continue;
      if (out.length >= 1000) break;
      out.push({ id: `t:${t.id}`, name: t.name, group: t.group || 'Tag' });
    }
    return out;
  },
};

harbor.register(provider);
