/**
 * GlobalComix source plugin for Harbor
 *
 * Backed by GlobalComix's web API (api.globalcomix.com), the same API the
 * globalcomix.com website calls from its own frontend:
 *  - /v1/search/query           -> popular & search (48/page, `p` page param)
 *  - /v1/comics/{slug}          -> series detail
 *  - /v1/comics/{slug}/releases -> full chapter/release list
 *  - /v1/readV3/{releaseKey}    -> page list + reader CDN URL template
 *
 * Auth model: anonymous guest. The API identifies the client via the public
 * web key (X-Gc-Client header) that ships in globalcomix.com's own JS bundle;
 * no account is used.
 *
 * Known limitation: the reader CDN authorizes page images with a short-lived
 * gc_reader_auth cookie that the API sets on the readV3 call. Harbor's bridge
 * does not forward cookies to image loaders, so if Harbor's image fetcher
 * doesn't carry the site session, pages may fail to load. Everything else
 * (browse, search, detail, chapters) works fully cookieless via the API key.
 */

const SITE = 'https://globalcomix.com';
const API = 'https://api.globalcomix.com';
// Public web-client key shipped in globalcomix.com's frontend bundle.
const CLIENT_KEY = 'gck_b4d492261ec541eda44ce41de79da424';

const PAGE_SIZE = 48;

function baseHeaders() {
  return {
    'user-agent': 'Harbor/1.0 (globalcomix plugin)',
    'x-gc-client': CLIENT_KEY,
    'x-gc-identmode': 'cookie',
    referer: SITE + '/',
  };
}

let guestReady = null;
async function ensureGuest() {
  // Warm the guest session once so the API treats us as an established client.
  if (!guestReady) {
    guestReady = harbor.http(SITE + '/json/confirm-guest/', {
      method: 'POST',
      headers: { ...baseHeaders(), 'content-type': 'application/json' },
      body: '{}',
      responseType: 'text',
    }).catch(() => null);
  }
  await guestReady;
}

async function apiGet(path) {
  await ensureGuest();
  const res = await harbor.http(API + path, {
    responseType: 'json',
    headers: baseHeaders(),
  });
  if (!res || typeof res !== 'object') return null;
  const code = res.meta && res.meta.code;
  if (code && code >= 400) return null;
  return res.payload ? res.payload.results : null;
}

function seriesToSummary(it) {
  return {
    id: String(it.id),
    title: it.name,
    cover: it.cover_image_url || undefined,
  };
}

const provider = {
  id: 'globalcomix',
  name: 'GlobalComix',

  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const r = await apiGet(`/v1/search/query?q=&p=${page}&perpage=${PAGE_SIZE}`);
    const items = (r && r.series && r.series.items) || [];
    return items.map(seriesToSummary);
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const q = encodeURIComponent(query.trim());
    const r = await apiGet(`/v1/search/query?q=${q}&p=${page}&perpage=${PAGE_SIZE}`);
    const items = (r && r.series && r.series.items) || [];
    return items.map(seriesToSummary);
  },

  async detail(id) {
    let c = await apiGet(`/v1/comics/${encodeURIComponent(id)}`);
    if (!c || c.entity_type !== 'Comic') {
      // Numeric ids sometimes only resolve through the slug; recover it from
      // the releases listing.
      const rel = await apiGet(`/v1/comics/${encodeURIComponent(id)}/releases?lang_id=en`);
      const slug = Array.isArray(rel) && rel[0] && rel[0].comic_slug;
      if (slug) {
        c = await apiGet(`/v1/comics/${encodeURIComponent(slug)}`);
      }
    }
    if (!c || c.entity_type !== 'Comic') return null;
    return {
      id: String(c.id),
      title: c.name,
      altTitle:
        c.localized_comic_name && c.localized_comic_name !== c.name
          ? c.localized_comic_name
          : undefined,
      cover: c.image_medium_url || c.image_url || c.image_small_url || undefined,
      year: c.year || undefined,
      status: (c.status_name || '').toLowerCase() || undefined,
      description: (c.description || '').trim() || undefined,
      author: c.artist && c.artist.roman_name ? c.artist.roman_name : undefined,
    };
  },

  async chapters(id) {
    const rel = await apiGet(`/v1/comics/${encodeURIComponent(id)}/releases?lang_id=en&all=true`);
    const items = Array.isArray(rel) ? rel : [];
    const out = [];
    for (const it of items) {
      if (!it || !it.key) continue;
      out.push({
        id: `${id}:${it.key}`,
        chapter: it.chapter != null ? String(it.chapter) : null,
        title: it.title || undefined,
        volume: null,
        pages: Number(it.page_count) || 0,
        language: it.lang_id || 'en',
        group: it.release_type_name || undefined,
        publishAt: it.published_time || undefined,
      });
      if (out.length >= 5000) break;
    }
    return out;
  },

  async pageUrls(chapterId) {
    // chapterId = "<seriesId>:<releaseKey>"
    const sep = chapterId.indexOf(':');
    const releaseKey = sep > 0 ? chapterId.slice(sep + 1) : chapterId;
    const r = await apiGet(`/v1/readV3/${encodeURIComponent(releaseKey)}?readerV=2`);
    if (!r) return [];

    const pages = (r.page_objects || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const cdn = r.reader_cdn_access;
    if (!cdn || !cdn.base_url) return [];

    const ranges = cdn.ranges;
    const allowed = (order) =>
      !ranges || ranges.some(([a, b]) => order >= a && order <= b);

    const template = (cdn.url_template || '{base_url}/r/{release_key}/p/{order}/{quality}.webp')
      .split('{base_url}').join(cdn.base_url.replace(/\/$/, ''))
      .split('{release_key}').join(encodeURIComponent(cdn.release_key || releaseKey));

    return pages
      .filter((p) => p.is_page_paid === false && allowed(p.order))
      .map((p) => template.split('{order}').join(String(p.order)).split('{quality}').join('desktop'))
      .filter((u) => /^https:\/\//.test(u));
  },
};

harbor.register(provider);
