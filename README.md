# RRO — Harbor source repo

A [Harbor](https://hermes-agent.nousresearch.com/) manga/comics source repo hosting two plugins:

| Plugin | Source | Content |
|---|---|---|
| **Atsu** | [atsu.moe](https://atsu.moe/) | Manga (Typesense index + site API) |
| **GlobalComix** | [globalcomix.com](https://globalcomix.com/) | Western comics & manga (DC, Marvel, Image, ...) |

## Install

In Harbor: **Manga > Set up a source > Extensions**, paste this repo URL:

```
https://raw.githubusercontent.com/wesazx/RRO/main/repo.json
```

Then install **Atsu** and/or **GlobalComix**.

## Features

Both plugins provide:
- Popular listing & search (48 items per page)
- Series detail: title, author, synopsis, status, year, cover
- Full chapter/release list with page counts and dates
- Page images for the reader

## Notes

- **Atsu**: full access. Genre/tag filters supported. Pages are AVIF.
- **GlobalComix**: anonymous guest access via the site's public web API key.
  Browse/search/detail/chapters work fully. Page images use the reader CDN,
  which authorizes via a short-lived cookie — if pages fail to load in Harbor,
  that's the CDN's session check; everything else works regardless.
