/**
 * preload.js — The secure bridge between the Electron main process and the React renderer.
 *
 * RULE: Only expose what the renderer actually needs. Never expose the full `ipcRenderer`
 * object — that would allow arbitrary IPC messages and break security.
 *
 * Each entry in `contextBridge.exposeInMainWorld` becomes available as `window.electronAPI.*`
 * inside the React app.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Window Controls ─────────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  openExternal:   (url) => ipcRenderer.invoke('app:openExternal', url),

  // Mini-Player & PiP Controls
  toggleMiniPlayer: (enable) => ipcRenderer.invoke('window:toggleMiniPlayer', enable),
  setMiniPlayerHeight: (height) => ipcRenderer.invoke('window:setMiniPlayerHeight', height),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
  getAlwaysOnTop: () => ipcRenderer.invoke('window:getAlwaysOnTop'),
  isMiniPlayer: () => ipcRenderer.invoke('window:isMiniPlayer'),
  onMiniPlayerChange: (callback) => {
    const handler = (_event, isMini) => callback(isMini)
    ipcRenderer.on('mini-player-change', handler)
    return () => ipcRenderer.removeListener('mini-player-change', handler)
  },

  onFullScreenChange: (callback) => {
    const handler = (_event, isFS) => callback(isFS)
    ipcRenderer.on('fullscreen-change', handler)
    return () => ipcRenderer.removeListener('fullscreen-change', handler)
  },

  // ── File / Folder Dialogs ───────────────────────────────────────────────────
  // Returns the selected folder path string, or null if cancelled
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),

  // Returns an array of selected file path strings
  openFilesDialog: () => ipcRenderer.invoke('dialog:openFiles'),

  // ── Image Picker (for profile picture) ──────────────────────────────────────
  // Returns { url: 'avatar://<file>', size, isAnimated } on success,
  // { canceled: true } if dismissed, or { error } if the file was rejected.
  openImageDialog: () => ipcRenderer.invoke('dialog:openImage'),
  // Deletes uploaded avatar files that are no longer referenced.
  pruneAvatars: (keepUrl) => ipcRenderer.invoke('avatar:prune', keepUrl),

  // ── Data Backup & Restore ───────────────────────────────────────────────────
  exportBackup: (backupData) => ipcRenderer.invoke('app:exportBackup', backupData),
  importBackup: () => ipcRenderer.invoke('app:importBackup'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  isOnline: () => ipcRenderer.invoke('app:isOnline'),

  // ── Online updates ──────────────────────────────────────────────────────────
  // The app never downloads an update on its own: `getUpdateState` reports what is
  // known, `checkForUpdates` asks the feed, and the user's click triggers
  // `downloadUpdate`. `installUpdate` quits and runs the NSIS installer.
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  // Why the last stream lookup failed — shown to the user so a broken machine can
  // report the reason without finding a log file.
  getStreamFailure: () => ipcRenderer.invoke('stream:lastFailure'),
  // Windows media flyout (SMTC). The native bridge lives in main; the renderer just
  // reports what is playing and listens for the flyout's transport buttons.
  smtcUpdate: (payload) => ipcRenderer.invoke('smtc:update', payload),
  onSmtcButton: (callback) => {
    const handler = (_event, button) => callback(button)
    ipcRenderer.on('smtc:button', handler)
    return () => ipcRenderer.removeListener('smtc:button', handler)
  },
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },

  // ── Crash / diagnostic log ──────────────────────────────────────────────────
  // A packaged build has no console, so main-process errors and crashes are
  // written to <userData>/logs/main.log and minidumps to <userData>/crashDumps.
  // These expose them so a bug report has something to attach.
  getCrashInfo: () => ipcRenderer.invoke('crash:getInfo'),
  openCrashLogFolder: () => ipcRenderer.invoke('crash:openLogFolder'),
  openCrashDumpFolder: () => ipcRenderer.invoke('crash:openDumpFolder'),

  // ── Library Scanner ─────────────────────────────────────────────────────────
  // Recursively scans a folder and returns an array of audio file paths
  scanLibrary: (folderPath) => ipcRenderer.invoke('library:scan', folderPath),

  // ── Local Library Index (SQLite) ────────────────────────────────────────────
  // Authoritative store for the scanned file list — replaces the localStorage
  // key that silently overflowed its quota on large libraries.
  loadLibraryIndex: () => ipcRenderer.invoke('library:loadIndex'),
  syncLibraryIndex: (paths) => ipcRenderer.invoke('library:syncIndex', paths),

  // ── File Utilities ──────────────────────────────────────────────────────────
  // Converts a Windows absolute path (C:\...) to a media:// URL for <audio>.
  // Both this and getTrackMetadata enforce the main-process path allow-list, so
  // the path must have come from a folder/file dialog, a scan, or a download.
  filePathToURL: (filePath) => ipcRenderer.invoke('file:toURL', filePath),

  // Extracts metadata (title, artist, album, duration) from a local file
  // without transferring the full file buffer — main process uses mm.parseFile
  getTrackMetadata: (filePath) => ipcRenderer.invoke('track:getMetadata', filePath),

  findDownloadedTrack: (videoId, folder) => ipcRenderer.invoke('file:findDownloadedTrack', videoId, folder),
  getDownloadedVideoIds: (folder) => ipcRenderer.invoke('file:getDownloadedVideoIds', folder),
  getDefaultDownloadFolder: () => ipcRenderer.invoke('file:getDefaultDownloadFolder'),

  // ── YouTube API ─────────────────────────────────────────────────────────────
  youtubeSearch: (query, type) => ipcRenderer.invoke('youtube:search', query, type),
  youtubeGetSearchSuggestions: (query) => ipcRenderer.invoke('youtube:getSearchSuggestions', query),
  youtubeGetHome: () => ipcRenderer.invoke('youtube:getHome'),
  // `opts.forceDirect` asks for a URL that is known to play in a media element
  // (yt-dlp), used as a one-shot retry when the element rejects a source.
  youtubeGetStreamUrl: (videoId, opts) => ipcRenderer.invoke('youtube:getStreamUrl', videoId, opts),
  audioSetQuality: (quality) => ipcRenderer.invoke('audio:setQuality', quality),
  audioGetQuality: () => ipcRenderer.invoke('audio:getQuality'),
  // Reports the rendition the main process actually resolved (codec, bitrate,
  // itag) so the UI can show real numbers instead of assuming the preset worked.
  onStreamInfo: (callback) => {
    const cb = (_event, data) => callback(data)
    ipcRenderer.on('audio:stream-info', cb)
    return () => ipcRenderer.removeListener('audio:stream-info', cb)
  },
  youtubeGetPlaylist: (playlistId) => ipcRenderer.invoke('youtube:getPlaylist', playlistId),
  youtubeGetPlaylistContinuation: (playlistId) => ipcRenderer.invoke('youtube:getPlaylistContinuation', playlistId),
  youtubeGetExtendedCategory: (query, type) => ipcRenderer.invoke('youtube:getExtendedCategory', query, type),
  youtubeGetUpNextBatch: (seedIds) => ipcRenderer.invoke('youtube:getUpNextBatch', seedIds),
  youtubeGetArtistInfo: (artistName) => ipcRenderer.invoke('youtube:getArtistInfo', artistName),
  youtubeDownloadTrack: (videoId, customFolder) => ipcRenderer.invoke('youtube:downloadTrack', videoId, customFolder),
  downloadTrack: (videoId, customFolder) => ipcRenderer.invoke('youtube:downloadTrack', videoId, customFolder),
  youtubeGetLyrics: (videoId, title, artist) => ipcRenderer.invoke('youtube:getLyrics', videoId, title, artist),
  youtubeTranslateLyrics: (payload, targetLang) => ipcRenderer.invoke('youtube:translateLyrics', payload, targetLang),
  onDownloadCompleted: (callback) => {
    const cb = (_event, data) => callback(data)
    ipcRenderer.on('download:completed', cb)
    return () => ipcRenderer.removeListener('download:completed', cb)
  },
  // Byte-level progress from yt-dlp: { videoId, percent, downloadedBytes, speed, eta }.
  onDownloadProgress: (callback) => {
    const cb = (_event, data) => callback(data)
    ipcRenderer.on('download:progress', cb)
    return () => ipcRenderer.removeListener('download:progress', cb)
  },

  // ── Preferences ─────────────────────────────────────────────────────────────
  loadPreferences: () => ipcRenderer.invoke('preferences:load'),
  savePreferences: (prefs) => ipcRenderer.invoke('preferences:save', prefs),
  
  // ── Playback State & Session ────────────────────────────────────────────────
  loadPlaybackState: () => ipcRenderer.invoke('playback:load'),
  savePlaybackState: (state) => ipcRenderer.invoke('playback:save', state),
  loadPlaybackPosition: () => ipcRenderer.invoke('playback:loadPosition'),
  savePlaybackPosition: (currentTime) => ipcRenderer.invoke('playback:savePosition', currentTime),
  loadSessionState: () => ipcRenderer.invoke('session:load'),
  saveSessionState: (state) => ipcRenderer.invoke('session:save', state),

  // ── Database (Stats, History, Metadata, Artist Art) ────────────────────────
  dbLogPlay: (track) => ipcRenderer.send('db:logPlay', track),
  dbGetAllStats: () => ipcRenderer.invoke('db:getAllStats'),
  dbResetStats: () => ipcRenderer.invoke('db:resetStats'),
  dbGetHistory: () => ipcRenderer.invoke('db:getHistory'),
  dbGetBulkMetadata: (srcArray) => ipcRenderer.invoke('db:getBulkMetadata', srcArray),
  dbCacheMetadata: (src, meta) => ipcRenderer.send('db:cacheMetadata', src, meta),
  dbGetArtistArtCache: () => ipcRenderer.invoke('db:getArtistArtCache'),
  dbSaveArtistArtCache: (artistName, imageUrl) => ipcRenderer.send('db:saveArtistArtCache', artistName, imageUrl),
  dbSaveBulkArtistArtCache: (entries) => ipcRenderer.send('db:saveBulkArtistArtCache', entries),

  // ── Discord Rich Presence & Thumbnail Toolbar ──────────────────────────────
  updateDiscordPresence: (data) => ipcRenderer.invoke('discord:updatePresence', data),
  clearDiscordPresence: () => ipcRenderer.invoke('discord:clearPresence'),
  updateThumbnailToolbar: (isPlaying) => ipcRenderer.invoke('thumbar:update', isPlaying),

  // ── Media Key / Tray Event Listeners ────────────────────────────────────────
  // These let the main process push events to React when media keys are pressed
  // or tray menu items are clicked.
  //
  // Usage in React:
  //   const unsub = window.electronAPI.onMediaKey('playpause', () => togglePlay())
  //   return () => unsub()   // cleanup on unmount
  //
  onMediaKey: (key, callback) => {
    const channel = `mediakey:${key}`
    const handler = (_event) => callback()
    ipcRenderer.on(channel, handler)
    // Return a cleanup function so React can remove the listener on unmount
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onTrayAction: (key, callback) => {
    const channel = `tray:${key}`
    const handler = (_event) => callback()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // ── Authentication ────────────────────────────────────────────────────────────
  authSpotify: () => ipcRenderer.invoke('auth:spotify'),
  spotifyFetchLibrary: () => ipcRenderer.invoke('spotify:fetchLibrary'),
  spotifyGetPlaylist: (id) => ipcRenderer.invoke('spotify:getPlaylist', id),
  spotifyGetUserProfile: () => ipcRenderer.invoke('spotify:getUserProfile'),
  authYouTube: () => ipcRenderer.invoke('auth:youtube'),
  youtubeDisconnect: () => ipcRenderer.invoke('youtube:disconnect'),
  youtubeGetAuthStatus: () => ipcRenderer.invoke('youtube:getAuthStatus'),
  youtubeFetchLibrary: (forceRefresh) => ipcRenderer.invoke('youtube:fetchLibrary', forceRefresh),
  youtubeGetMusicHome: (forceRefresh) => ipcRenderer.invoke('youtube:getMusicHome', forceRefresh),
  youtubeGetUserProfile: () => ipcRenderer.invoke('youtube:getUserProfile'),
  importPlaylist: (url) => ipcRenderer.invoke('importPlaylist', url),
  onYouTubeAuthCode: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('youtube-auth-code', handler)
    return () => ipcRenderer.removeListener('youtube-auth-code', handler)
  },
})
