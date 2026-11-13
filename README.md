# Zoneshift

A browser extension that finds dates and times on web pages and shows them in
your own time zone.

`Friday, November 13, 2026, at 1:30 AM UTC` becomes
`Thursday, November 12, 2026, at 5:30 PM PST` for a reader in Los Angeles.

**Status: early development.** The conversion engine works and is tested. The
extension marks each recognised time with a clock icon, converts prose times,
and offers conversion for log and ISO 8601 timestamps; settings and the
feedback flow are not built yet. See [docs/design.md](docs/design.md) for the full design
and roadmap.

## Principles

- A time is converted only when its source zone is known: stated in the text,
  or set by you as the default for that site.
- The converted text keeps the original's format.
- Every conversion is marked, reversible, and shows how it was read.
- Uncertain readings (ambiguous or out-of-season zone labels) are flagged and
  offer the alternatives.
- The extension makes no network requests.

## Layout

| Path | What |
|---|---|
| `packages/core` | Conversion engine: pure TypeScript, no DOM, no dependencies |
| `apps/extension` | WebExtension shell, built with [WXT](https://wxt.dev) |
| `docs/design.md` | Design and roadmap |

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm build
```

`pnpm build` writes unpacked extensions to `apps/extension/.output/chrome-mv3`
and `apps/extension/.output/firefox-mv2`. `pnpm dev` starts a browser with the
extension loaded and live reload.

## License

MIT
