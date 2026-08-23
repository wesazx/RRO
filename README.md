# RRO — Harbor source repo

A [Harbor](https://hermes-agent.nousresearch.com/) manga & comics source repo.

| Plugin | Source | Content | Pages |
|---|---|---|---|
| **Atsu** | [atsu.moe](https://atsu.moe/) | Manga | ✅ |
| **Mangapill** | [mangapill.com](https://mangapill.com/) | Manga **+ western comics** (Batman, Star Wars, Deadpool Samurai, ...) | ✅ |

## Install

In Harbor: **Manga > Set up a source > Extensions**, paste this repo URL:

```
https://raw.githubusercontent.com/wesazx/RRO/main/repo.json
```

Then install the plugins you want.

## Features

- Popular/browse catalogue (48 per page)
- Search
- Series detail: title, synopsis, status, year, cover
- Full chapter list
- Page images — **fully cookieless**, work in Harbor

## Notes

- **Atsu** — atsu.moe's Typesense index + JSON API. Genre/tag filters supported.
  Pages are AVIF.
- **Mangapill** — MangaDex mirror with a western-comics catalog (DC's Batman,
  Star Wars, Deadpool: Samurai and more). Plain HTML scraping with a browser
  user-agent; no cookies or accounts involved, so page images load reliably in
  Harbor.
