# Glaze Music

A desktop music player for Windows that plays **your local files and YouTube
streams in the same queue**, wrapped in a "Liquid Glass" UI whose lighting is
driven by the current album art.

Built with Electron 36, React 18, Vite 6 and Tailwind CSS v4.

> **Status: pre-release.** This is a working app with a small number of testers.
> It is not yet code-signed and does not auto-update. See
> [Known gaps](#known-gaps) before shipping it to anyone.

---

## What it actually does

**Playback**
- One queue that mixes local file paths and remote stream URLs
- Recursive library scanner for `.mp3 .flac .wav .ogg .aac .m4a .opus`
- ID3/Vorbis metadata via `music-metadata` (title, artist, album, duration, embedded art)
- 10-band equaliser, 8D spatial panning, reverb presets, adjustable playback speed
- Shuffle, repeat-all, repeat-one, gapless-ish prefetch of the next track
- Resumes playback position per track, and restores the queue + view on relaunch

**Streaming**
- YouTube search, home feed, playlists (with continuation paging), artist pages,
  "up next" batches, and search suggestions
- Stream resolution through `youtubei.js` (Innertube), with `yt-dlp` as the
  download path and fallback resolver
- Optional account linking for **YouTube** and **Spotify** so your cloud library
  shows up alongside local files
- Downloads land in a folder you choose and are folded back into the library

**Interface**
- Home dashboard, streaming browser, albums, artists + artist profiles,
  playlists, liked songs, cloud library, listening insights, settings, profile
- Floating capsule player bar, full-screen player, and a resizable mini-player
  that can be pinned always-on-top
- Synced LRC lyrics with optional machine translation and dual-language view
- Discord Rich Presence, Windows taskbar thumbnail transport controls,
  OS media keys, and a system tray menu
- Setup wizard on first run, custom themes, accent colour extracted from album art
- Backup / restore of everything to a single `.glaze` file

---

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 36 (main + preload + renderer) |
| Renderer | React 18, Vite 6, Tailwind CSS v4 |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Local metadata | `music-metadata` v10 |
| Streaming | `youtubei.js` (Innertube) + bundled `yt-dlp.exe` |
| Rich presence | `discord-rpc` |

---

## Project structure

```
├── electron/
│   ├── main.cjs        # Main process: windows, tray, media keys, all IPC handlers,
│   │                   #   Innertube/yt-dlp streaming, downloads, custom protocols
│   ├── preload.cjs     # contextBridge surface — window.electronAPI
│   └── db.cjs          # SQLite schema + all queries (stats, history, metadata
│                       #   cache, playlists, favourites, artists, library index)
├── src/
│   ├── App.jsx         # Root shell: routing, sidebar, global keyboard shortcuts
│   ├── ErrorBoundary.jsx
│   ├── main.jsx        # React entry point
│   ├── index.css       # Tailwind import + Liquid Glass base styles
│   ├── themes.js       # Built-in + custom theme definitions
│   ├── lyricsUtils.js  # LRC parsing, RTL detection, translation helpers
│   ├── utils.js        # formatTime, getArtURL, misc helpers
│   ├── constants/
│   ├── context/
│   │   ├── context.js          # Raw context objects (PlayerContext, PlaybackTimeContext)
│   │   ├── PlayerContext.jsx   # The audio engine + transport
│   │   ├── LibraryContext.jsx  # Library, playlists, favourites, artists
│   │   └── usePlayer.js        # usePlayer() / usePlaybackTime() hooks
│   └── components/             # 25 view + control components (see below)
├── scripts/            # One-off asset generation (icons, installer bitmaps, logos)
├── build/              # NSIS installer assets
├── index.html
├── vite.config.js
├── tailwind.config.js
├── eslint.config.js
└── package.json
```

### Components

`AddToPlaylistModal` `AlbumsView` `ArtistProfileView` `ArtistsView`
`AudioPlayer` `ClickableArtists` `CloudLibraryView` `ContextMenu`
`FancyUsername` `FavouritesView` `FullScreenPlayer` `HomeDashboard`
`ListeningInsightsDashboard` `LyricsView` `MiniPlayerView` `PlaylistsView`
`ProfileView` `Queue` `QuickAudioControls` `SettingsView` `SetupWizard`
`Sidebar` `StreamingView` `TitleBar` `TrackList`

---

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together and waits for the dev server.

> **Windows note:** if Electron's binary fails to download, extract it manually
> from the cache:
> ```powershell
> Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Filter "*.zip"
> Expand-Archive -Path "<path-to-zip>" -DestinationPath "node_modules\electron\dist" -Force
> Set-Content -Path "node_modules\electron\path.txt" -Value "electron.exe" -NoNewline
> ```

`better-sqlite3` is a native module. After changing your Node or Electron
version, rebuild it:

```bash
npx electron-rebuild -f -w better-sqlite3
```

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server + Electron, together |
| `npm run dev:vite` | Vite only |
| `npm run dev:electron` | Electron only (waits for port 5173) |
| `npm run build` | Build the renderer to `dist/` |
| `npm run build:electron` | Build + package an NSIS installer via electron-builder |
| `npm run preview` | Preview the built renderer |
| `npm run lint` | ESLint over `src/`, `electron/`, `scripts/` |
| `npm run lint:fix` | ESLint with `--fix` |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (CI-friendly) |

---

## Data & storage

Everything lives under Electron's `userData` folder, except the human-readable
backup:

| Location | Contents |
|---|---|
| `userData/glaze_data.db` | SQLite: play history, play counts (track/artist/album/hour/day), metadata cache, playlists, favourites, followed artists, artist art cache, **local library index** |
| `Documents/Glaze Music/preferences.json` | Folders, playlists, favourites, followed artists, download folder |
| `userData/*.cookies` | Encrypted account cookies (`safeStorage` / DPAPI) |
| `userData/playback_state.json` | Queue, current index, volume, EQ, theme |
| `userData/glaze_proxy.log` | Verbose stream logs — only written when `DEBUG_GLAZE` is set |

The library index is **not** kept in `localStorage`; it lives in SQLite because a
few thousand tracks exceeded the browser storage quota. `localStorage` holds only
a small bounded mirror for a flash-free first paint.

### Backup format

Exports are JSON with a `schemaVersion` field. Bump `BACKUP_SCHEMA_VERSION` in
`src/components/SettingsView.jsx` when the payload shape changes, and raise
`MAX_SUPPORTED_SCHEMA_VERSION` once the new writer ships. Files without a
`schemaVersion` are treated as the legacy pre-versioning format.

---

## Architecture notes

A few things that are non-obvious if you're reading the code:

**Two contexts, not one.** `PlayerContext` holds transport and metadata.
`PlaybackTimeContext` holds only `currentTime` / `progress`, which tick ~4× per
second. They are separate so that the seek bar and synced lyrics can re-render
without dragging the other 18 `usePlayer()` consumers along. If you need a
ticking clock, use `usePlaybackTime()` — never add `currentTime` back to
`PlayerContext`.

**Custom protocols, path-allow-listed.** Local audio is served over `media://`
(with HTTP 206 range support) and embedded art over `art://`. Both resolve only
paths under a root the user explicitly picked; anything else gets a 403.

**Play counts are threshold-based.** A play is logged once a track passes 30
seconds or 50% of its duration, whichever comes first, deduplicated per load.
Logging on load inflated the Insights dashboard.

**Global keyboard shortcuts have one owner** — the effect in `App.jsx`. If you
add a `window` keydown listener for a transport key anywhere else, two handlers
will fire and cancel each other out.

---

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- `webSecurity` is **on**; no `webviewTag`
- Header rewriting (`onBeforeSendHeaders` / `onHeadersReceived`) is scoped to an
  explicit allow-list of streaming hosts, not `*://*/*`
- Account cookies are encrypted at rest with Electron's `safeStorage`
- No plaintext third-party geo-lookup; country comes from `app.getLocaleCountryCode()`

**Known architectural risk:** `youtubei.js` executes remote player JavaScript via
`Platform.shim.eval`. Today that runs in the **main process** with full Node
privileges, which is why `unsafe-eval` is in the CSP. Moving Innertube into a
`utilityProcess` is the planned containment fix.

---

## Known gaps

Tracked in [`AUDIT-REPORT.md`](./AUDIT-REPORT.md), which contains the full audit
this README was rewritten from.

- **No code signing and no auto-update.** Windows SmartScreen will warn users.
  This must be resolved before a public release.
- **No crash reporting.** Failures are invisible once the app leaves your machine.
- **Innertube runs in the main process** (see above).
- **No test suite.** ESLint + Prettier are in place; automated tests are not.
- **The repo carries large unused artefacts** (build caches, old installer
  output) that should be pruned and gitignored.

## Legal

The YouTube and Spotify integrations use undocumented endpoints. Distributing an
app that streams from these services may conflict with their terms of service.
This has not been resolved and gates any public release.

---

## License

Not yet chosen. Treat as all rights reserved until a licence is added.
