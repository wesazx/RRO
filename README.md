# RRO — Harbor source repo

A [Harbor](https://hermes-agent.nousresearch.com/) manga & comics source repo.

## Plugins

| Plugin | Source | Content |
|---|---|---|
| **Atsu** | [atsu.moe](https://atsu.moe/) | Manga (JS plugin, genre/tag filters) |

## Custom source config

**Mangapill** — manga + western comics (Batman, Star Wars, Deadpool: Samurai, ...)

`mangapill.json` is a declarative scrape config. In Harbor:
**Manga > Set up a source > Add custom source**, then either paste the JSON or
point Harbor at this raw file:

```
https://raw.githubusercontent.com/wesazx/RRO/main/mangapill.json
```

Pages load cookieless with a browser User-Agent — verified working in Harbor.
