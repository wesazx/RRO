/**
 * MangaDex source plugin for Harbor
 *
 * Uses MangaDex's official public API (api.mangadex.org) and the at-home
 * image server. No authentication required; page images load cookieless.
 *
 * Endpoints:
 *  - GET /manga?title=&limit=&offset[]        -> search / popular listing
 *  - GET /manga/{id}                          -> detail
 *  - GET /manga/{id}/feed?translatedLanguage[]=en&limit=500&offset[]
 *                                             -> chapter list
 *  - GET /at-home/server/{chapterId}          -> page URLs (signed, time-limited)
 */

const API = 'https://api.mangadex.org';
const LANG = 'en';
const PAGE_SIZE = 48;

const UA = 'Harbor/1.0 (mangadex plugin)';

async function apiGet(path) {
  const res = await harbor.http(API + path, {
    responseType: 'json',
    headers: { 'user-agent': UA },
  });
  if (!res || typeof res !== 'object') return null;
  if (res.result !== 'ok') return null;
  return res;
}

function titleOf(m) {
  const t = m.attributes && m.attributes.title;
  if (!t) return '';
  return t.en || Object.values(t)[0] || '';
}

function altTitleOf(m) {
  const alts = (m.attributes && m.attributes.altTitles) || [];
  for (const a of alts) if (a.en) return a.en;
  return undefined;
}

function coverUrl(m) {
  const rels = m.relationships || [];
  for (const r of rels) {
    if (r.type === 'cover_art' && r.attributes && r.attributes.fileName) {
      return `https://uploads.mangadex.org/covers/${m.id}/${r.attributes.fileName}.512.jpg`;
    }
  }
  return undefined;
}

function descOf(m) {
  const d = m.attributes && m.attributes.description;
  return (d && (d.en || Object.values(d)[0])) || undefined;
}

function statusOf(m) {
  const s = m.attributes && m.attributes.status;
  if (!s) return undefined;
  if (s === 'completed') return 'completed';
  if (s === 'ongoing' || s === 'hiatus' || s === 'cancelled') return s;
  return undefined;
}

function yearOf(m) {
  return (m.attributes && m.attributes.year) || undefined;
}

function tagsOf(m) {
  // not used by Harbor summaries, but keep author extraction simple below
  return [];
}

function authorOf(m) {
  const rels = m.relationships || [];
  const names = rels
    .filter((r) => r.type === 'author' && r.attributes && r.attributes.name)
    .map((r) => r.attributes.name);
  return names.length ? [...new Set(names)].join(', ') : undefined;
}

function toSummary(m) {
  return {
    id: m.id,
    title: titleOf(m),
    altTitle: altTitleOf(m),
    cover: coverUrl(m),
    year: yearOf(m),
    status: statusOf(m),
    description: undefined,
  };
}

const provider = {
  id: 'mangadex',
  name: 'MangaDex',

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE);
    const path =
      `/manga?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
      `&hasAvailableChapters=true&availableTranslatedLanguage%5B%5D=${LANG}` +
      `&order%5BfollowedCount%5D=desc` +
      `&includes%5B%5D=cover_art&includes%5B%5D=author&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive`;
    const res = await apiGet(path);
    return ((res && res.data) || []).map(toSummary);
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE);
    const path =
      `/manga?title=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
      `&availableTranslatedLanguage%5B%5D=${LANG}` +
      `&includes%5B%5D=cover_art&includes%5B%5D=author`;
    const res = await apiGet(path);
    return ((res && res.data) || []).map(toSummary);
  },

  async detail(id) {
    const res = await apiGet(
      `/manga/${encodeURIComponent(id)}?includes%5B%5D=cover_art&includes%5B%5D=author`
    );
    if (!res || !res.data) return null;
    const m = res.data;
    return {
      id: m.id,
      title: titleOf(m),
      altTitle: altTitleOf(m),
      cover: coverUrl(m),
      year: yearOf(m),
      status: statusOf(m),
      description: descOf(m),
      author: authorOf(m),
      contentRating:
        m.attributes &&
        Array.isArray(m.attributes.contentRating) &&
        m.attributes.contentRating.indexOf('erotica') !== -1
          ? 'mature'
          : undefined,
    };
  },

  async chapters(id) {
    const out = [];
    const limit = 300; // MD max per call
    for (let off = 0; off < 6000; off += limit) {
      const res = await apiGet(
        `/manga/${encodeURIComponent(id)}/feed` +
          `?translatedLanguage%5B%5D=${LANG}&limit=${limit}&offset=${off}` +
          `&order%5Bchapter%5D=desc`
      );
      const data = (res && res.data) || [];
      if (!data.length) break;
      for (const c of data) {
        const a = c.attributes || {};
        if (!c.id) continue;
        out.push({
          id: c.id,
          chapter: a.chapter != null ? String(a.chapter) : null,
          title: a.title || undefined,
          volume: a.volume != null ? String(a.volume) : null,
          pages: Number(a.pages) || 0,
          language: a.translatedLanguage || LANG,
          group: (c.relationships || [])
            .filter((r) => r.type === 'scanlation_group' && r.attributes && r.attributes.name)
            .map((r) => r.attributes.name)
            .join(', ') || undefined,
          publishAt: a.publishAt || a.createdAt || undefined,
        });
        if (out.length >= 5000) return out;
      }
      if (data.length < limit) break;
    }
    return out;
  },

  async pageUrls(chapterId) {
    const res = await harbor.http(`${API}/at-home/server/${encodeURIComponent(chapterId)}`, {
      responseType: 'json',
      headers: { 'user-agent': UA },
    });
    if (!res || typeof res !== 'object' || res.result !== 'ok') return [];
    const ch = res.chapter || {};
    const base = res.baseUrl;
    if (!base) return [];

    const quality =
      Array.isArray(ch.dataSaver) && ch.dataSaver.length && false ? 'data-saver' : 'data';
    const hash = ch.hash;
    const files = ch.data || [];
    const urls = files.map((f) => `${base}/${quality}/${hash}/${f}`);
    return urls.filter((u) => /^https:\/\//.test(u));
  },
};

harbor.register(provider);
