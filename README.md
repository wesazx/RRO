# RRO — Harbor source repo

A [Harbor](https://hermes-agent.nousresearch.com/) manga/comics source repo hosting three plugins:

| Plugin | Source | Content | Pages |
|---|---|---|---|
| **Atsu** | [atsu.moe](https://atsu.moe/) | Manga | ✅ work |
| **MangaDex** | [mangadex.org](https://mangadex.org/) | Manga & manhwa (huge, official public API) | ✅ work |
| **GlobalComix** | [globalcomix.com](https://globalcomix.com/) | Western comics (DC, Marvel, Image, ...) | ⚠️ see note |

## Install

In Harbor: **Manga > Set up a source > Extensions**, paste this repo URL:

```
https://raw.githubusercontent.com/wesazx/RRO/main/repo.json
```

Then install the plugins you want.

## Features (all plugins)

- Popular listing & search (48 items per page)
- Series detail: title, author, synopsis, status, year, cover
- Full chapter list with page counts, groups and dates
- Page images for the reader

## Notes

- **Atsu** — full access via the site's Typesense index + JSON API. Genre/tag
  filters supported. Pages are AVIF.
- **MangaDex** — uses the official public API; no account needed. Page images
  load from the at-home server with no cookies, so they work reliably.
- **GlobalComix** — anonymous guest access via the site's public web API key.
  Browse/search/detail/chapters all work. Page images use a reader CDN that
  authorizes with a short-lived session cookie which Harbor's bridge does not
  forward to image loaders — so pages may fail to load. If you need western
  comics pages in-reader, this is a GlobalComix-side restriction, not a bug in
  the plugin.
