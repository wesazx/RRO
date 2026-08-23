/**
 * Mangapill source plugin for Harbor
 *
 * Mangapill (mangapill.com) is a fast MangaDex mirror that also carries
 * western comics — Batman, Star Wars, Deadpool Samurai, Detective Comics
 * crossovers and more.
 *
 * All endpoints are plain HTML, fetched with a browser user-agent (their CDN
 * rejects requests without one; no cookies needed).
 *
 *  - GET /search?q=&page=N          -> search results
 *  - GET /                          -> popular on home page
 *  - GET /manga/{id}/{slug}         -> detail + full chapter list
 *  - GET /chapters/{id}-{n}/{slug}  -> page list (lazy-load URLs in HTML)
 */

const SITE = 'https://mangapill.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const PAGE_SIZE = 48; // Harbor offset step

function headers() {
  return { 'user-agent': UA, referer: SITE + '/' };
}

function absolute(u) {
  if (!u) return undefined;
  if (/^https:\/\//.test(u)) return u;
  return SITE + (u.startsWith('/') ? '' : '/') + u;
}

async function getHtml(path) {
  const res = await harbor.http(SITE + path, {
    responseType: 'text',
    headers: headers(),
  });
  if (!res || typeof res !== 'object') return null;
  if (res.status && res.status >= 400) return null;
  return res.body || '';
}

// --- tiny regex-based extraction helpers (HTML is regular on this site) ---

function extractAll(html, re) {
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m);
    if (out.length > 2000) break;
  }
  return out;
}

function unescapeBasic(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Parse the manga cards from a listing/search page. */
function parseCards(html) {
  // <a href="/manga/6955/batman" class="relative block"> ... <img data-src="COVER"
  //  .../> ... <div class="... line-clamp-2">TITLE</div>
  const seen = new Set();
  const results = [];
  const re = /href="\/manga\/(\d+)\/([a-z0-9-]+)"\s+class="relative block">[\s\S]{0,400}?data-src="([^"]+)"[\s\S]{0,700}?line-clamp-2[^>]*>([^<]+)<\/div>/g;
  for (const m of extractAll(html, re)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = unescapeBasic(m[4]) || unescapeBasic(m[2].replace(/-/g, ' '));
    if (!title) continue;
    results.push({ id, title, cover: absolute(m[3]), slug: m[2] });
  }
  return results;
}

/** Parse chapter links from a manga detail page. */
function parseChapters(html, mangaId) {
  // href="/chapters/6955-10001000/batman-chapter-1"
  const re = new RegExp(
    'href="/chapters/(' + mangaId + '-\\d+)/([a-z0-9-]+)"[\\s\\S]{0,500}?(?:</a>)',
    'g'
  );
  const chapters = [];
  for (const m of extractAll(html, re)) {
    chapters.push({ key: m[1], slug: m[2] });
  }
  return chapters;
}

function titleFromSlug(slug) {
  // "batman-chapter-12" -> "Chapter 12"
  const m = /chapter-(\d+(?:\.\d+)?)$/.exec(slug);
  if (m) return 'Chapter ' + m[1];
  return undefined;
}

function numberFromSlug(slug) {
  const m = /chapter-(\d+(?:\.\d+)?)$/.exec(slug);
  return m ? m[1] : null;
}

function volumeFromTitle(html, key) {
  // The site shows volume headers like "Volume 3"; approximate by looking at
  // section headings before each chapter link. Simple heuristic: none.
  return null;
}

const provider = {
  id: 'mangapill',
  name: 'Mangapill',

  async popular(offset) {
    // Single-letter search returns the full catalogue, 50 per page with
    // ?page=N — use it as the popular/browse listing.
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const html = await getHtml(`/search?q=a&page=${page}`);
    if (!html) return [];
    return parseCards(html).slice(0, PAGE_SIZE);
  },

  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const q = encodeURIComponent(query.trim());
    const html = await getHtml(`/search?q=${q}&page=${page}`);
    if (!html) return [];
    return parseCards(html);
  },

  async detail(idOrSlug) {
    // Accept either numeric id or "id/slug". Resolve to the canonical page.
    let path;
    if (/^\d+$/.test(idOrSlug)) {
      // Need the slug for a pretty URL; the bare /manga/{id} redirects but our
      // bridge follows redirects only sometimes. Try search-free approach:
      // fetch /manga/{id} directly first.
      path = `/manga/${idOrSlug}`;
    } else {
      path = `/manga/${idOrSlug}`;
    }
    let html = await getHtml(path);
    if (!html) {
      // Try to recover the slug from a search by id prefix is unreliable;
      // give up gracefully.
      return null;
    }

    const title =
      unescapeBasic((/<h1[^>]*>([^<]+)<\/h1>/.exec(html) || [])[1] || '') ||
      unescapeBasic((/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '').replace(/ - Manga(pill)?$/i, '');

    const descMatch =
      /<meta\s+name="description"\s+content="([^"]+)"/.exec(html) ||
      /<p[^>]*class="[^"]*break-words[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html) ||
      /itemprop="description"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    const description = descMatch ? unescapeBasic(descMatch[1].replace(/<[^>]+>/g, ' ')) : undefined;

    const cover = absolute(
      (/data-src="(https:\/\/cdn[^"]*\/i\/[^"]+)"/.exec(html) || [])[1] ||
        (/src="(https:\/\/cdn[^"]*\/i\/[^"]+)"/.exec(html) || [])[1]
    );

    // Status/year/type from definition list
    const statusMatch = /(Ongoing|Finished|Discontinued|Hiatus|Publishing)/i.exec(html);
    const yearMatch = /\b(19|20)\d{2}\b/.exec(
      (/<span[^>]*>\s*(19|20)\d{2}\s*<\/span>/.exec(html) || [''])[0]
    );

    return {
      id: idOrSlug,
      title,
      cover,
      year: yearMatch ? Number(yearMatch[0]) : undefined,
      status: statusMatch ? statusMatch[1].toLowerCase() : undefined,
      description,
    };
  },

  async chapters(idOrSlug) {
    const html = await getHtml(`/manga/${idOrSlug}`);
    if (!html) return [];

    const mangaId = (/\/manga\/(\d+)\//.exec(html) || [])[1] || String(idOrSlug).split('/')[0];
    const raw = parseChapters(html, mangaId);

    // Chapter entries appear newest-first on the site; reverse for oldest-first
    const out = [];
    for (let i = raw.length - 1; i >= 0; i--) {
      const c = raw[i];
      out.push({
        id: `${idOrSlug}|${c.key}/${c.slug}`,
        chapter: numberFromSlug(c.slug),
        title: titleFromSlug(c.slug),
        volume: null,
        pages: 0,
        language: 'en',
        group: 'Mangapill',
        publishAt: undefined,
      });
      if (out.length >= 5000) break;
    }
    return out;
  },

  async pageUrls(chapterId) {
    // chapterId = "<mangaRef>|<chapterKey>/<chapterSlug>"
    const pipe = chapterId.indexOf('|');
    const chPath = pipe >= 0 ? chapterId.slice(pipe + 1) : chapterId;

    const html = await getHtml(`/chapters/${chPath}`);
    if (!html) return [];

    // Pages are lazy-loaded: <img data-src="https://cdn.../N.jpeg">
    const urls = [];
    const re = /data-src="(https:\/\/cdn\.readdetectiveconan\.com\/file\/mangap\/[^"]+)"/g;
    for (const m of extractAll(html, re)) {
      urls.push(m[1]);
      if (urls.length >= 2000) break;
    }
    return urls;
  },
};

harbor.register(provider);
