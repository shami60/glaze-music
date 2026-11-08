import React, { useState, useRef, useEffect } from 'react'
import { usePlayer } from '../context/usePlayer'
import { EQ_PRESETS, detectEQPreset } from '../context/PlayerContext'
import { useLibrary } from '../context/LibraryContext'
import { THEMES } from '../themes'
import { APPEARANCE_THEMES } from '../appearanceThemes'
import { CUSTOM_PRESETS, customSwatch } from '../customTheme'
import ListeningInsightsDashboard from './ListeningInsightsDashboard'
import { UpdateRow, useUpdateStatus } from './UpdateBanner'
import { buildBackupPayload, applyBackupSettings, describeBackup, remapBackupPaths } from '../backup'

// Backdrop presets are a compact picker, not a gallery: one row of small tiles
// with the name underneath. The old 3-column 16:10 grid made this one section
// taller than the rest of the page.
const THEME_TILE_W = 116

// ── Icons ──────────────────────────────────────────────────────────────────
function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
    </svg>
  )
}

function MagicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M7.5 5.6 10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29a.9959.9959 0 0 0-1.41 0L1.29 18.96a.9959.9959 0 0 0 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05a.9959.9959 0 0 0 0-1.41l-2.33-2.35zm-1.03 5.49-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z"/>
    </svg>
  )
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67a.528.528 0 0 1-.13-.33c0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 8 6.5 8 8 8.67 8 9.5 7.33 11 6.5 11zm3-4C8.67 7 8 6.33 8 5.5S8.67 4 9.5 4s1.5.67 1.5 1.5S10.33 7 9.5 7zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 4 14.5 4s1.5.67 1.5 1.5S15.33 7 14.5 7zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 8 17.5 8s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
    </svg>
  )
}

// Presets map to real renditions in the main process (see STREAM_QUALITY_PRESETS
// in electron/main.cjs). The bitrate in each label is what YouTube actually
// serves at that tier — not a marketing number.
const STREAM_QUALITY_OPTIONS = [
  { id: 'high', label: 'High', detail: 'Best available — Opus ~160 kbps (slower to start)' },
  { id: 'medium', label: 'Medium', detail: 'Balanced — AAC ~128 kbps, starts instantly' },
  { id: 'low', label: 'Low', detail: 'Data saver — AAC ~50 kbps' },
]

function QualityIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </svg>
  )
}

function EqualizerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z"/>
    </svg>
  )
}

function HeadphonesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/>
    </svg>
  )
}

function CloudBackupIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
    </svg>
  )
}

export default function SettingsView({
  folders = [],
  isScanning,
  onAddFolder,
  onRemoveFolder,
  localInsights,
  setLocalInsights,
  customThemes = [],
  setCustomThemes,
  downloadFolder,
  setDownloadFolder,
  userProfile,
  setUserProfile
}) {
  const {
    theme, setTheme,
    appearance, setAppearance,
    customAccent, setCustomAccent, customMode, setCustomMode,
    ambience, setAmbience, motion, setMotion,
    eqGains, updateEqualizer, resetEqualizer, applyEQPreset, EQ_BANDS,
    is8D, setIs8D,
    panSpeed, setPanSpeed,
    reverbPreset, setReverbPreset,
    crossfade, setCrossfade,
    playbackSpeed, setPlaybackSpeed,
    isAutoplay, setIsAutoplay,
    streamQuality, applyStreamQuality, streamInfo,
    sleepTimer, setSleepTimerMinutes, setSleepTimerEndOfTrack, clearSleepTimer
  } = usePlayer()

  // Drives the blinking dot beside the "Software updates" heading, so a pending
  // update is noticed without scrolling to the row and reading the status line.
  const updateState = useUpdateStatus()
  const updateNeedsAttention = updateState.status === 'available' || updateState.status === 'ready'

  // Derived, never stored: the dropdown must reflect what the bands are actually
  // doing, including after a restart or when a band is dragged by hand.
  const eqPreset = detectEQPreset(eqGains)

  // Local countdown only. The player context deliberately stores a static
  // deadline, so this ticking value never re-renders every usePlayer consumer.
  const [sleepRemaining, setSleepRemaining] = useState(null)
  useEffect(() => {
    if (sleepTimer?.mode !== 'timed') { setSleepRemaining(null); return }
    const tick = () => setSleepRemaining(Math.max(0, sleepTimer.deadline - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sleepTimer])

  const {
    playlists = [],
    favourites = new Set(),
    streamingFavourites = [],
    followedArtists = [],
    restoreLibraryData
  } = useLibrary() || {}

  const [newThemeImg, setNewThemeImg] = useState(null)
  const [newThemeName, setNewThemeName] = useState('')

  const saveNewTheme = () => {
    const name = (newThemeName || '').trim()
    if (!name || !newThemeImg) return
    const id = `custom-${Date.now()}`
    setCustomThemes(prev => [...(prev || []), { id, name, img: newThemeImg }])
    setTheme(id)
    setNewThemeImg(null)
    setNewThemeName('')
  }

  // Backup & Restore State
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [pendingBackup, setPendingBackup] = useState(null) // Parsed backup for inspection
  // Library folders named by the backup that do not exist on this machine, and
  // the old→new mapping the user picks for them. Without this, restoring on a PC
  // with a different drive letter produced an empty library with no explanation.
  const [missingRoots, setMissingRoots] = useState([])
  const [relinkMap, setRelinkMap] = useState({})
  const [restoreMode, setRestoreMode] = useState('replace') // 'replace' | 'merge'
  const [toastMessage, setToastMessage] = useState(null) // { type: 'success' | 'error', text: '' }
  const fileInputRef = useRef(null)

  const showToast = (text, type = 'success') => {
    setToastMessage({ text, type })
    setTimeout(() => setToastMessage(null), 5000)
  }

  // ── Handler: Export All Data to File ─────────────────────────────────────────
  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const favArray = Array.from(favourites || [])
      // Read the real version instead of hardcoding it — the old literal
      // ('1.0.2') had already drifted from package.json.
      let appVersion = 'unknown'
      try {
        appVersion = (await window.electronAPI?.getAppVersion?.()) || 'unknown'
      } catch { /* non-fatal: version is informational */ }

      const backupData = buildBackupPayload({
        appVersion,
        userProfile,
        playlists,
        favourites: favArray,
        streamingFavourites,
        followedArtists,
        folders,
        downloadFolder,
        customThemes,
        // Everything the app persists as a preference. Keep this list in step
        // with BACKUP_SETTING_KEYS in src/backup.js — a key missing here is
        // dropped from the file without any warning.
        settings: {
          theme, localInsights, is8D, panSpeed, reverbPreset, eqGains,
          appearance, customAccent, customMode, ambience, motion,
          streamQuality, playbackSpeed, crossfade, isAutoplay,
        },
      })

      // 1. Try Native Electron Save Dialog
      if (window.electronAPI?.exportBackup) {
        const res = await window.electronAPI.exportBackup(backupData)
        if (res?.success) {
          showToast(`✓ All data exported successfully to ${res.filePath.split(/[\\/]/).pop()}`)
        } else if (res?.error) {
          showToast(`Export failed: ${res.error}`, 'error')
        }
      } else {
        // 2. Browser Blob Fallback
        const jsonStr = JSON.stringify(backupData, null, 2)
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const dateStr = new Date().toISOString().split('T')[0]
        a.href = url
        a.download = `glaze-backup-${dateStr}.glaze`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        showToast('✓ Glaze data exported successfully as .glaze file')
      }
    } catch (err) {
      console.error('Export failed:', err)
      showToast(`Export error: ${err.message}`, 'error')
    } finally {
      setIsExporting(false)
    }
  }

  // ── Handler: Trigger File Picker for Import ──────────────────────────────────
  const handleTriggerImport = async () => {
    if (window.electronAPI?.importBackup) {
      setIsImporting(true)
      try {
        const res = await window.electronAPI.importBackup()
        if (res?.success && res.data) {
          setPendingBackup(res.data)
          setMissingRoots(Array.isArray(res.missingRoots) ? res.missingRoots : [])
          setRelinkMap({})
        } else if (res?.error) {
          showToast(`Failed to open backup: ${res.error}`, 'error')
        }
      } catch (err) {
        showToast(`Import error: ${err.message}`, 'error')
      } finally {
        setIsImporting(false)
      }
    } else {
      fileInputRef.current?.click()
    }
  }

  const closeRestoreDialog = () => {
    setPendingBackup(null)
    setMissingRoots([])
    setRelinkMap({})
  }

  // ── Handler: Relink a folder the backup references but this PC lacks ────────
  const handleLocateRoot = async (oldRoot) => {
    const picked = await window.electronAPI?.openFolderDialog?.()
    if (!picked) return
    setRelinkMap(prev => ({ ...prev, [oldRoot]: picked }))
    setMissingRoots(prev => prev.filter(r => r !== oldRoot))
  }

  // ── Handler: File input change (Browser fallback) ────────────────────────────
  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result)
        const verdict = describeBackup(parsed)
        if (!verdict.ok) {
          showToast(verdict.error, 'error')
        } else {
          setPendingBackup(parsed)
          setMissingRoots([])
          setRelinkMap({})
          if (verdict.legacy) {
            showToast('Note: this backup predates format versioning. Restoring with best-effort compatibility.')
          }
        }
      } catch (err) {
        showToast('Invalid backup file. Could not parse JSON data.', 'error')
      }
    }
    reader.readAsText(file)
    e.target.value = '' // Reset
  }

  // ── Handler: Execute Restore on Confirmed Backup ─────────────────────────────
  const handleConfirmRestore = () => {
    if (!pendingBackup) return

    // Apply any folder relinking first: every local path in playlists and likes
    // has to be rewritten to the new root, or the restore points at a drive that
    // does not exist on this machine.
    const backup = Object.keys(relinkMap).length
      ? remapBackupPaths(pendingBackup, relinkMap)
      : pendingBackup

    try {
      // 1. Restore User Profile
      if (backup.userProfile && setUserProfile) {
        setUserProfile(backup.userProfile)
        try {
          localStorage.setItem('glaze_profile', JSON.stringify(backup.userProfile))
          localStorage.setItem('glaze_setup_complete', 'true')
        } catch {}
      }

      // 2. Restore Library Data (Playlists, Liked Songs, Artists, Folders)
      if (restoreLibraryData) {
        restoreLibraryData(backup, restoreMode)
      }

      // 3. Restore Custom Themes
      if (Array.isArray(backup.customThemes) && setCustomThemes) {
        if (restoreMode === 'replace') {
          setCustomThemes(backup.customThemes)
          try { localStorage.setItem('glaze_custom_themes', JSON.stringify(backup.customThemes)) } catch {}
        } else {
          setCustomThemes(prev => {
            const existingIds = new Set(prev.map(t => t.id))
            const toAdd = backup.customThemes.filter(t => !existingIds.has(t.id))
            const merged = [...prev, ...toAdd]
            try { localStorage.setItem('glaze_custom_themes', JSON.stringify(merged)) } catch {}
            return merged
          })
        }
      }

      // 4. Restore preferences. This used to hand-pick six keys, so the colour
      // theme, custom accent, ambience, motion, stream quality, playback speed
      // and crossfade were written to the file and then never applied. The
      // helper type-checks each value and reports what it actually restored.
      const appliedSettings = applyBackupSettings(backup.appSettings, {
        setTheme,
        setLocalInsights,
        setIs8D,
        setPanSpeed,
        setReverbPreset,
        applyEqGains: (gains) => { if (updateEqualizer) gains.forEach((g, i) => updateEqualizer(i, g)) },
        setAppearance,
        setCustomAccent,
        setCustomMode,
        setAmbience,
        setMotion,
        applyStreamQuality,
        setPlaybackSpeed,
        setCrossfade,
        setIsAutoplay,
      })

      const plCount = Array.isArray(backup.playlists) ? backup.playlists.length : 0
      const favCount = (Array.isArray(backup.favourites) ? backup.favourites.length : 0) + (Array.isArray(backup.streamingFavourites) ? backup.streamingFavourites.length : 0)
      const artistCount = Array.isArray(backup.followedArtists) ? backup.followedArtists.length : 0
      const profileName = backup.userProfile?.userName || 'Profile'

      showToast(`✓ Restored: ${profileName} (${plCount} playlists, ${favCount} liked songs, ${artistCount} followed artists, ${appliedSettings.length} settings)`)
      closeRestoreDialog()
    } catch (err) {
      console.error('Restore failed:', err)
      showToast(`Failed to restore data: ${err.message}`, 'error')
    }
  }

  return (
    <div className="flex flex-col h-full text-white/90 overflow-y-auto select-none">
      <div className="p-8 max-w-[1600px] w-full mx-auto pb-24">
        
        {/* Top Title */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <span className="text-[10.5px] font-black uppercase tracking-widest text-white/50">Preferences</span>
            <h2 className="text-3xl font-black tracking-tight text-white mt-0.5">Settings</h2>
          </div>
        </div>

        {/* ── Toast Notification Banner ──────────────────────────────────────── */}
        {toastMessage && (
          <div 
            className={`mb-6 p-4 rounded-2xl border flex items-center justify-between gap-3 animate-in fade-in duration-200 shadow-xl ${
              toastMessage.type === 'error' 
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-200' 
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2.5 text-sm font-semibold">
              <span>{toastMessage.type === 'error' ? '⚠️' : '✓'}</span>
              <span>{toastMessage.text}</span>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-xs opacity-60 hover:opacity-100 px-2 py-1 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Audio Quality Section ────────────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <QualityIcon />
              <h3 className="text-xl font-semibold">Audio quality</h3>
            </div>
            {streamInfo && streamInfo.bitrate > 0 && (
              <span className="text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-white/45">
                Now playing {streamInfo.codec} {Math.round(streamInfo.bitrate / 1000)}k
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {STREAM_QUALITY_OPTIONS.map(option => {
              const selected = streamQuality === option.id
              return (
                <button
                  key={option.id}
                  onClick={() => applyStreamQuality(option.id)}
                  aria-pressed={selected}
                  className="text-left rounded-xl px-4 py-3.5 transition-colors cursor-pointer hover:bg-white/5"
                  style={{
                    background: 'var(--glass-card)',
                    border: `1px solid ${selected ? 'var(--hairline-strong)' : 'var(--hairline)'}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-semibold ${selected ? 'text-white' : 'text-white/70'}`}>
                      {option.label}
                    </span>
                    {selected && <CheckIcon />}
                  </div>
                  <div className="text-xs text-white/45 leading-relaxed">{option.detail}</div>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            Streaming tops out around 160 kbps because the source is YouTube — there is no
            lossless stream to offer. FLAC and ALAC files in your own library always play at
            their native quality, whatever is selected here.
          </p>
        </section>

        {/* ── Equalizer Section ────────────────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2.5">
              <EqualizerIcon />
              <h3 className="text-xl font-semibold">Equalizer</h3>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={eqPreset}
                onChange={(e) => applyEQPreset(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 focus:outline-none cursor-pointer"
                title="Equaliser preset"
                aria-label="Equaliser preset"
              >
                {Object.keys(EQ_PRESETS).map((name) => (
                  <option key={name} value={name} className="bg-[var(--surface-1)] text-white">{name}</option>
                ))}
                {/* Only offered when the bands match nothing, so the control can
                    never claim a preset it is not actually applying. */}
                {eqPreset === 'Custom' && (
                  <option value="Custom" className="bg-[var(--surface-1)] text-white">Custom</option>
                )}
              </select>
              <button 
                onClick={resetEqualizer}
                className="text-[10px] uppercase tracking-widest font-bold px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-white/10 text-white/40 hover:text-white/80 cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>
          
          <div className="bg-black/20 rounded-2xl p-8 border border-white/5">
            <div className="flex justify-between items-end h-40 gap-1">
              {EQ_BANDS.map((freq, i) => (
                <div key={freq} className="flex flex-col items-center gap-4 flex-1 h-full">
                  <div className="relative flex-1 w-1.5 bg-white/5 rounded-full group">
                    {/* Center line */}
                    <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/10 pointer-events-none" />
                    
                    {/* Fill */}
                    <div 
                      className="absolute left-0 right-0 rounded-full transition-all duration-75" 
                      style={{ 
                        height: `${(Math.abs(eqGains[i]) / 12) * 50}%`,
                        bottom: eqGains[i] >= 0 ? '50%' : `calc(50% - ${(Math.abs(eqGains[i]) / 12) * 50}%)`,
                        backgroundColor: eqGains[i] >= 0 ? 'rgba(167, 139, 250, 0.4)' : 'rgba(239, 68, 68, 0.4)'
                      }} 
                    />

                    {/* Hidden Native Slider */}
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={eqGains[i]}
                      onChange={(e) => updateEqualizer(i, parseFloat(e.target.value))}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: '160px',
                        height: '24px',
                        margin: 0,
                        padding: 0,
                        transformOrigin: 'center center',
                        transform: 'translate(-50%, -50%) rotate(-90deg)',
                        opacity: 0,
                        cursor: 'pointer',
                        zIndex: 10
                      }}
                    />

                    {/* Visual Handle */}
                    <div 
                      className="absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] pointer-events-none z-0 border border-black/20"
                      style={{ bottom: `calc(${(eqGains[i] + 12) / 24 * 100}% - 7px)` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/35 font-bold tracking-tighter uppercase">
                    {freq >= 1000 ? `${freq/1000}k` : freq}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-4 px-2">
              <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">Bass</span>
              <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">Mid</span>
              <span className="text-[9px] font-bold text-white/25 uppercase tracking-widest">Treble</span>
            </div>
          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── 8D Audio Section ────────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <HeadphonesIcon />
                <h3 className="text-xl font-semibold">8D Audio</h3>
              </div>
              <p className="text-sm text-white/40 ml-7">
                Immersive spatial audio effect. Best experienced with headphones.
              </p>
            </div>
            <button
              onClick={() => setIs8D(!is8D)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                is8D ? 'bg-red-500' : 'bg-white/10'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  is8D ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* 8D Speed Control */}
          {is8D && (
            <div className="mt-6 ml-7">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/60">Rotation Speed</span>
                <span className="text-xs text-white/40 tabular-nums">
                  {panSpeed <= 1000 ? 'Very Fast' : panSpeed <= 1800 ? 'Fast' : panSpeed <= 2800 ? 'Normal' : panSpeed <= 4000 ? 'Slow' : 'Very Slow'}
                </span>
              </div>
              <input
                type="range"
                min={500}
                max={6000}
                step={100}
                value={panSpeed}
                onChange={e => setPanSpeed(Number(e.target.value))}
                className="w-full h-1 rounded-full cursor-pointer accent-red-500"
                style={{
                  background: `linear-gradient(to right, rgba(239,68,68,0.7) ${((panSpeed - 500) / 5500) * 100}%, rgba(var(--ink-rgb),0.1) ${((panSpeed - 500) / 5500) * 100}%)`
                }}
              />
              <div className="flex justify-between text-[10px] text-white/25 mt-1">
                <span>Fast</span>
                <span>Slow</span>
              </div>
            </div>
          )}
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Room Models / Reverb Section ────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-purple-400">
              <path d="M12 3L2 12h3v8h14v-8h3L12 3zm0 11.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            <h3 className="text-xl font-semibold">Acoustic Room Models</h3>
          </div>
          <p className="text-sm text-white/40 ml-7 mb-5">
            Simulate different listening environments using dynamic convolution reverb.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 ml-7">
            {[
              { id: 'none', name: 'None (Dry)' },
              { id: 'studio', name: 'Cozy Studio' },
              { id: 'room', name: 'Living Room' },
              { id: 'hall', name: 'Concert Hall' },
              { id: 'cathedral', name: 'Cathedral' },
            ].map((preset) => {
              const active = reverbPreset === preset.id
              return (
                <button
                  key={preset.id}
                  onClick={() => setReverbPreset(preset.id)}
                  className={`px-4 py-3 rounded-xl border text-center transition-all duration-200 cursor-pointer ${
                    active 
                      ? 'bg-purple-500/20 border-purple-500/50 text-purple-200 font-medium' 
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  <p className="text-sm">{preset.name}</p>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Playback: Crossfade & Sleep Timer ───────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-sky-400">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z"/>
            </svg>
            <h3 className="text-xl font-semibold">Playback</h3>
          </div>
          <p className="text-sm text-white/40 ml-7 mb-5">
            Blend one track into the next, and stop playback automatically.
          </p>

          <div className="ml-7 space-y-6">
            {/* Crossfade */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/70">Crossfade</span>
                <span className="text-xs text-white/40">
                  {crossfade > 0 ? `${crossfade}s` : 'Off'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="12"
                step="1"
                value={crossfade}
                onChange={(e) => setCrossfade(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgba(56,189,248,0.7) ${(crossfade / 12) * 100}%, rgba(var(--ink-rgb),0.1) ${(crossfade / 12) * 100}%)`
                }}
              />
              <div className="flex justify-between text-[10px] text-white/25 mt-1">
                <span>Off</span>
                <span>12s</span>
              </div>
            </div>

            {/* Sleep timer */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/70">Sleep timer</span>
                <span className="text-xs text-white/40">
                  {sleepTimer?.mode === 'endOfTrack'
                    ? 'End of track'
                    : sleepRemaining != null
                      ? `${Math.floor(sleepRemaining / 60000)}:${String(Math.floor((sleepRemaining % 60000) / 1000)).padStart(2, '0')} left`
                      : 'Off'}
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[15, 30, 45, 60].map((m) => {
                  const active = sleepTimer?.mode === 'timed' && sleepTimer.minutes === m
                  return (
                    <button
                      key={m}
                      onClick={() => (active ? clearSleepTimer() : setSleepTimerMinutes(m))}
                      className={`px-3 py-2 rounded-xl border text-center text-sm transition-all duration-200 cursor-pointer ${
                        active
                          ? 'bg-sky-500/20 border-sky-500/50 text-sky-200 font-medium'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80'
                      }`}
                    >
                      {m}m
                    </button>
                  )
                })}
                <button
                  onClick={setSleepTimerEndOfTrack}
                  className={`px-3 py-2 rounded-xl border text-center text-sm transition-all duration-200 cursor-pointer ${
                    sleepTimer?.mode === 'endOfTrack'
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-200 font-medium'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  End
                </button>
                <button
                  onClick={clearSleepTimer}
                  disabled={!sleepTimer}
                  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-center text-sm text-white/60 hover:bg-white/10 hover:text-white/80 transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-default"
                >
                  Off
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Appearance Section ──────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <PaletteIcon />
            <h3 className="text-xl font-semibold">Appearance</h3>
          </div>
          <p className="text-sm text-white/40 mb-5 ml-7">
            Recolours the entire app — canvas, panels, borders, glass and accent.
            <span className="text-white/60 font-medium"> Liquid Glass</span> stays the default.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {APPEARANCE_THEMES.map(t => (
              <AppearanceCard
                key={t.id}
                theme={t}
                swatch={t.id === 'custom' ? customSwatch(customAccent, customMode) : t.swatch}
                isLight={t.id === 'custom' ? customMode === 'light' : t.mode === 'light'}
                selected={appearance === t.id}
                onSelect={() => setAppearance(t.id)}
              />
            ))}
          </div>

          {appearance === 'custom' && (
            <div
              className="mt-4 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-5"
              style={{ background: 'var(--glass-card)', border: '1px solid var(--hairline)' }}
            >
              {/* Colour */}
              <div className="flex items-center gap-3">
                <label
                  className="relative w-11 h-11 rounded-xl overflow-hidden cursor-pointer shrink-0"
                  style={{ border: '1px solid var(--hairline-strong)' }}
                  title="Pick a colour"
                >
                  <span className="absolute inset-0" style={{ background: customAccent }} />
                  <input
                    type="color"
                    value={customAccent}
                    onChange={e => setCustomAccent(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label="Custom accent colour"
                  />
                </label>
                <div>
                  <div className="text-sm font-medium text-white/85">Your colour</div>
                  <div className="text-xs text-white/40 tabular-nums">{customAccent.toUpperCase()}</div>
                </div>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap items-center gap-2">
                {CUSTOM_PRESETS.map(c => (
                  <button
                    key={c}
                    onClick={() => setCustomAccent(c)}
                    className="w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110"
                    style={{
                      background: c,
                      outline: customAccent.toLowerCase() === c ? '2px solid var(--color-white)' : 'none',
                      outlineOffset: '2px',
                    }}
                    title={c}
                    aria-label={`Use ${c}`}
                  />
                ))}
              </div>

              {/* Light / dark */}
              <div
                className="flex items-center gap-1 p-1 rounded-lg sm:ml-auto shrink-0"
                style={{ background: 'var(--glass-card)', border: '1px solid var(--hairline)' }}
              >
                {['dark', 'light'].map(m => (
                  <button
                    key={m}
                    onClick={() => setCustomMode(m)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold capitalize cursor-pointer transition-colors"
                    style={{
                      background: customMode === m ? 'var(--theme-accent)' : 'transparent',
                      color: customMode === m ? '#fff' : 'var(--color-white)',
                      opacity: customMode === m ? 1 : 0.55,
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ambient colour bleed — the cover art tints the whole app. */}
          <div
            className="mt-4 flex items-center justify-between gap-4 rounded-xl px-4 py-3"
            style={{ background: 'var(--glass-card)', border: '1px solid var(--hairline)' }}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-white/85">Ambient colour</div>
              <div className="text-xs text-white/40">
                Let the cover art tint the background, the player and the now-playing bar.
              </div>
            </div>
            <button
              onClick={() => setAmbience(!ambience)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                ambience ? 'bg-indigo-500' : 'bg-white/10'
              }`}
              aria-label="Ambient colour"
              aria-pressed={ambience}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  ambience ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Motion master switch — hovers, presses, menu fades. */}
          <div
            className="mt-3 flex items-center justify-between gap-4 rounded-xl px-4 py-3"
            style={{ background: 'var(--glass-card)', border: '1px solid var(--hairline)' }}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-white/85">Motion &amp; animation</div>
              <div className="text-xs text-white/40">
                Smooth hovers, presses and menu transitions. Turn off for a still, instant UI.
              </div>
            </div>
            <button
              onClick={() => setMotion(!motion)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                motion ? 'bg-indigo-500' : 'bg-white/10'
              }`}
              aria-label="Motion and animation"
              aria-pressed={motion}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  motion ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Theme Section ───────────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <MagicIcon />
            <h3 className="text-xl font-semibold">Backdrop</h3>
          </div>
          <p className="text-sm text-white/40 mb-5 ml-7">
            The image behind the glass. <span className="text-white/60 font-medium">Dynamic</span> shifts with your music's album art.
          </p>

          <div className="flex flex-wrap gap-x-3 gap-y-4">
            {THEMES.map(t => (
              <ThemeCard
                key={t.id}
                theme={t}
                selected={theme === t.id}
                onSelect={() => setTheme(t.id)}
              />
            ))}
            {customThemes?.map(t => (
              <ThemeCard
                key={t.id}
                theme={t}
                selected={theme === t.id}
                onSelect={() => setTheme(t.id)}
                onDelete={() => {
                  if (theme === t.id) setTheme('dynamic')
                  setCustomThemes(prev => prev.filter(ct => ct.id !== t.id))
                }}
                isCustom={true}
              />
            ))}
            
            {/* Upload — a small tile that matches the presets. The naming step
                opens as a single compact row underneath instead of replacing the
                tile with a form, which used to make the whole grid taller. */}
            {!newThemeImg && (
              <button
                onClick={async () => {
                  if (!window.electronAPI) return
                  const base64 = await window.electronAPI.openImageDialog()
                  if (base64) {
                    setNewThemeImg(base64)
                    setNewThemeName('')
                  }
                }}
                className="group flex flex-col items-center cursor-pointer"
                style={{ width: THEME_TILE_W }}
                title="Upload a custom backdrop"
              >
                <span
                  className="w-full rounded-xl flex items-center justify-center transition-colors"
                  style={{
                    aspectRatio: '16/10',
                    outline: '2px dashed rgba(var(--ink-rgb),0.22)',
                    background: 'rgba(var(--ink-rgb),0.02)',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className="w-5 h-5 text-white/40 group-hover:text-white/70 transition-colors">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="mt-1.5 text-[11px] text-white/45 group-hover:text-white/70 truncate">Upload</span>
              </button>
            )}
          </div>

          {/* Naming a freshly uploaded image: one compact row, not a form that
              replaces a tile and grows the grid. */}
          {newThemeImg && (
            <div className="mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2"
              style={{ background: 'var(--glass-card)', border: '1px solid var(--hairline)' }}
            >
              <img src={newThemeImg} alt="" className="w-10 h-7 rounded object-cover shrink-0" />
              <input
                type="text"
                autoFocus
                placeholder="Theme name…"
                value={newThemeName}
                onChange={e => setNewThemeName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newThemeName.trim()) saveNewTheme()
                  else if (e.key === 'Escape') { setNewThemeImg(null); setNewThemeName('') }
                }}
                className="flex-1 min-w-0 max-w-[220px] bg-transparent text-sm text-white/90 px-2 py-1 rounded border border-white/15 outline-none focus:border-white/35 placeholder:text-white/30"
              />
              <button
                onClick={saveNewTheme}
                className="text-[11px] uppercase font-bold px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                Save
              </button>
              <button
                onClick={() => { setNewThemeImg(null); setNewThemeName('') }}
                className="text-[11px] uppercase font-bold px-2.5 py-1 rounded bg-white/5 hover:bg-white/15 text-white/60 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Music Folders Section ────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <FolderIcon />
            <h3 className="text-xl font-semibold">Music Folders</h3>
          </div>
          <p className="text-sm text-white/40 mb-5 ml-7">
            Add folders containing your music files. Glaze Music will scan them and automatically group your songs.
          </p>

          <div
            className="rounded-xl p-5 mb-5 space-y-2"
            style={{ background: 'rgba(var(--ink-rgb),0.04)', border: '1px solid rgba(var(--ink-rgb),0.08)' }}
          >
            {folders.length === 0 ? (
              <p className="text-sm text-white/25 italic">No folders added yet.</p>
            ) : (
              folders.map(folder => (
                <div
                  key={folder}
                  className="flex items-center justify-between rounded-lg p-3"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(var(--ink-rgb),0.05)' }}
                >
                  <span className="text-sm font-medium truncate mr-4 text-white/70">{folder}</span>
                  <button
                    onClick={() => onRemoveFolder(folder)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    style={{ background: 'rgba(239,68,68,0.15)', color: 'rgb(252,165,165)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            onClick={onAddFolder}
            disabled={isScanning}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border disabled:opacity-50 cursor-pointer"
            style={{ background: 'rgba(var(--ink-rgb),0.06)', borderColor: 'rgba(var(--ink-rgb),0.12)', color: 'rgba(var(--ink-rgb),0.8)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--ink-rgb),0.12)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--ink-rgb),0.06)' }}
          >
            {isScanning ? '⏳ Scanning...' : '+ Add Music Folder'}
          </button>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Downloads Section ────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            <h3 className="text-xl font-semibold">Downloads Location</h3>
          </div>
          <p className="text-sm text-white/40 mb-5 ml-7">
            Choose where your downloaded tracks will be saved.
          </p>
          <div className="flex items-center gap-4 ml-7">
            <div className="flex-1 rounded-xl p-3 bg-white/5 border border-white/10 text-white/70 text-sm truncate">
              {downloadFolder || 'Default (Music/Glaze Downloads)'}
            </div>
            <button
              onClick={async () => {
                if (!window.electronAPI) return
                const folder = await window.electronAPI.openFolderDialog()
                if (folder) setDownloadFolder(folder)
              }}
              className="shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            >
              Change Location
            </button>
          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Save & Restore Data (Backup & Migration) Section ────────────── */}
        <section className="mb-12">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-1.5 rounded-xl bg-gradient-to-tr from-emerald-500/30 to-teal-500/20 text-emerald-400 border border-emerald-500/30">
              <CloudBackupIcon />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Save & Restore Data (Backup)</h3>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-white/50 mb-6">
            Export your complete Glaze collection — profile, playlists, liked songs, followed artists, library folders, backdrops, colour theme and audio settings — to a single backup file, so you can restore it after reinstalling Windows or moving to a new PC.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Export Card */}
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between hover:border-white/20 transition-all">
              <div>
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center mb-3.5 border border-emerald-500/30">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                  </svg>
                </div>
                <h4 className="text-base font-bold text-white mb-1">Export / Save All Data</h4>
                <p className="text-xs text-white/50 leading-relaxed mb-4">
                  Creates a snapshot with your account details, <span className="text-white/80 font-semibold">{playlists.length} playlists</span>, <span className="text-white/80 font-semibold">{favourites.size + streamingFavourites.length} liked songs</span>, and followed artists.
                </p>
              </div>

              <button
                onClick={handleExportData}
                disabled={isExporting}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-lg cursor-pointer disabled:opacity-50"
              >
                {isExporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Exporting...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    <span>Save / Export Backup</span>
                  </>
                )}
              </button>
            </div>

            {/* Import Card */}
            <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between hover:border-white/20 transition-all">
              <div>
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center mb-3.5 border border-purple-500/30">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
                  </svg>
                </div>
                <h4 className="text-base font-bold text-white mb-1">Import & Restore Data</h4>
                <p className="text-xs text-white/50 leading-relaxed mb-4">
                  Restore your profile, playlists, and favorites from an existing <span className="text-white/80 font-semibold">.glaze</span> or <span className="text-white/80 font-semibold">.json</span> backup file.
                </p>
              </div>

              <button
                onClick={handleTriggerImport}
                disabled={isImporting}
                className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all border border-white/15 cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Loading File...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>
                    <span>Import Backup File</span>
                  </>
                )}
              </button>

              {/* Hidden file input for browser fallback */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".glaze,.json"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>

          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── Software Updates ────────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center gap-2.5 mb-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-emerald-400">
              <path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
            </svg>
            <h3 className="text-xl font-semibold">Software updates</h3>
            {updateNeedsAttention && (
              <span
                className="relative flex h-2.5 w-2.5"
                title={updateState.status === 'ready' ? 'Update ready — restart to apply' : 'Update available'}
              >
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${updateState.status === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${updateState.status === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              </span>
            )}
          </div>
          <p className="text-sm text-white/40 mb-4 ml-7">
            Glaze Music checks for a new version shortly after launch and every four hours.
            Nothing downloads until you say so, and an update never interrupts playback.
          </p>
          <div className="ml-7 flex items-center justify-between gap-4 rounded-xl px-4 py-3"
            style={{ background: 'var(--glass-card)', border: '1px solid var(--hairline)' }}
          >
            <UpdateRow />
          </div>
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />


        {/* ── Local Insights & Analytics Section ───────────────────────────── */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-indigo-400">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h2v5zm4 4H8v-2h8v2z"/>
                </svg>
                <h3 className="text-xl font-semibold">Listening Insights & Analytics</h3>
              </div>
              <p className="text-sm text-white/40 ml-7">
                Track your personal listening trends, top artists, and hourly heatmaps.
              </p>
            </div>
            <button
              onClick={() => setLocalInsights(!localInsights)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                localInsights ? 'bg-indigo-500' : 'bg-white/10'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  localInsights ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {localInsights && (
            <ListeningInsightsDashboard />
          )}
        </section>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 mb-10" />

        {/* ── About & Credits ─────────────────────────────────────────────── */}
        <section className="mb-10 text-center pb-6">
          <h2 className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase mb-6">
            About
          </h2>
          
          <div className="inline-block relative">
            <h1 className="text-2xl font-black tracking-tight text-white/90 mb-2 drop-shadow-sm">
              GLAZE MUSIC
            </h1>
          </div>
          
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-white/60 mb-3 mt-4">
            Made by <span className="text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.4)] font-bold">Ahtesham Khan Niazi</span>
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-4">
            {/* Discord */}
            <button 
              onClick={() => window.electronAPI?.openExternal('https://discordapp.com/users/niazi.x')}
              className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-[#5865F2]"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
              <span className="text-sm font-medium">niazi.x</span>
            </button>

            {/* Instagram */}
            <button 
              onClick={() => window.electronAPI?.openExternal('https://instagram.com/shamikhan.x')}
              className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-[#E1306C]"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              <span className="text-sm font-medium">shamikhan.x</span>
            </button>

            {/* LinkedIn */}
            <button 
              onClick={() => window.electronAPI?.openExternal('https://www.linkedin.com/in/ahtesham-khan-niazi-34578b3a1')}
              className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-[#0A66C2]"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              <span className="text-sm font-medium">Ahtesham Khan Niazi</span>
            </button>

            {/* Official site */}
            <button 
              onClick={() => window.electronAPI?.openExternal('https://shami60.github.io/glaze-music')}
              className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white cursor-pointer"
              title="Open the official Glaze Music site"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-emerald-400"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 010-4h3.38a16.5 16.5 0 000 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A8.03 8.03 0 015.07 16zm2.95-8H5.07a8.03 8.03 0 014.33-3.56A15.65 15.65 0 008.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.6 14.6 0 010-4h4.68a14.6 14.6 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.5 16.5 0 000-4h3.38a8.2 8.2 0 010 4h-3.38z"/></svg>
              <span className="text-sm font-medium">Official Glaze Music Site</span>
            </button>

            {/* Source code */}
            <button 
              onClick={() => window.electronAPI?.openExternal('https://github.com/shami60/glaze-music')}
              className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white cursor-pointer"
              title="View the source on GitHub"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white/90"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
              <span className="text-sm font-medium">GitHub</span>
            </button>
          </div>
        </section>

      </div>

      {/* ── MODAL: CONFIRM & INSPECT RESTORE DATA ── */}
      {pendingBackup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="bg-[var(--surface-2)] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-2xl">
            
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center border border-emerald-500/30">
                <CloudBackupIcon />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Restore Glaze Backup</h3>
                <p className="text-xs text-white/50">
                  Exported on {pendingBackup.exportedAt ? new Date(pendingBackup.exportedAt).toLocaleDateString() : 'Unknown Date'}
                  {' · '}
                  {pendingBackup.schemaVersion === undefined
                    ? 'legacy format'
                    : `format v${pendingBackup.schemaVersion}`}
                  {pendingBackup.appVersion ? ` · app ${pendingBackup.appVersion}` : ''}
                </p>
              </div>
            </div>

            {/* Profile snapshot */}
            {pendingBackup.userProfile && (
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3.5 mb-4">
                <img
                  src={pendingBackup.userProfile.profileImage || pendingBackup.userProfile.avatar}
                  alt=""
                  className="w-12 h-12 rounded-xl object-cover bg-white/10"
                  onError={e => { e.target.style.opacity = '0.3' }}
                />
                <div>
                  <p className="text-sm font-bold text-white leading-tight">{pendingBackup.userProfile.userName || 'User'}</p>
                  <p className="text-xs text-white/40 mt-0.5">{pendingBackup.userProfile.userHandle || '@user'}</p>
                </div>
              </div>
            )}

            {/* Content summary pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <p className="text-xs font-black text-emerald-400">
                  {Array.isArray(pendingBackup.playlists) ? pendingBackup.playlists.length : 0}
                </p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Playlists</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <p className="text-xs font-black text-rose-400">
                  {(Array.isArray(pendingBackup.favourites) ? pendingBackup.favourites.length : 0) + (Array.isArray(pendingBackup.streamingFavourites) ? pendingBackup.streamingFavourites.length : 0)}
                </p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Liked Songs</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <p className="text-xs font-black text-sky-400">
                  {Array.isArray(pendingBackup.followedArtists) ? pendingBackup.followedArtists.length : 0}
                </p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Artists</p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                <p className="text-xs font-black text-purple-400">
                  {Array.isArray(pendingBackup.customThemes) ? pendingBackup.customThemes.length : 0}
                </p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Themes</p>
              </div>
            </div>

            {/* Folders the backup references that are not on this PC. Restoring
                without relinking leaves every local track pointing at a missing
                path — a library that looks restored but plays nothing. */}
            {missingRoots.length > 0 && (
              <div className="mb-5 p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10">
                <p className="text-xs font-bold text-amber-200 mb-1">
                  {missingRoots.length} folder{missingRoots.length > 1 ? 's' : ''} from this backup
                  {missingRoots.length > 1 ? ' are' : ' is'} not on this PC
                </p>
                <p className="text-[10.5px] text-amber-200/60 mb-2.5">
                  Local songs and playlists point at these paths. Relink them to where the music lives
                  now — or restore anyway and add the folder afterwards.
                </p>
                <div className="space-y-1.5">
                  {missingRoots.map(root => (
                    <div key={root} className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-white/50" title={root}>{root}</span>
                      <button
                        onClick={() => handleLocateRoot(root)}
                        className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 cursor-pointer"
                      >
                        Locate…
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* What the relink will rewrite, so the mapping is visible. */}
            {Object.keys(relinkMap).length > 0 && (
              <div className="mb-5 p-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 space-y-1">
                {Object.entries(relinkMap).map(([from, to]) => (
                  <p key={from} className="text-[10.5px] text-emerald-200/80 truncate" title={`${from} → ${to}`}>
                    <span className="font-mono text-white/40 line-through">{from}</span>
                    {' → '}
                    <span className="font-mono text-emerald-200">{to}</span>
                  </p>
                ))}
              </div>
            )}

            {/* Mode selection: Replace vs Merge */}
            <div className="mb-6">
              <label className="text-xs font-bold text-white/60 mb-2 block">Restore Strategy:</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setRestoreMode('replace')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    restoreMode === 'replace'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <p className="text-xs font-bold mb-0.5">Clean Restore</p>
                  <p className="text-[10.5px] opacity-60">Overwrites with backup (Recommended for fresh setups)</p>
                </button>
                <button
                  type="button"
                  onClick={() => setRestoreMode('merge')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    restoreMode === 'merge'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <p className="text-xs font-bold mb-0.5">Merge</p>
                  <p className="text-[10.5px] opacity-60">Combines backup with any current songs & playlists</p>
                </button>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-white/10">
              <button
                onClick={closeRestoreDialog}
                className="px-4 py-2.5 rounded-full text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestore}
                className="px-6 py-2.5 rounded-full text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black hover:scale-105 active:scale-95 transition-all shadow-xl cursor-pointer"
              >
                Restore Now
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}

// ── AppearanceCard component ───────────────────────────────────────────────
// Draws a miniature of the real UI (rail, card, dock) from the theme's
// [canvas, surface, accent] swatch, so the picker shows a palette rather than
// a colour chip. The actual theme lives in index.css.
function AppearanceCard({ theme, selected, onSelect, swatch, isLight }) {
  const [canvas, surface, accent] = swatch || theme.swatch
  // The custom theme has no fixed mode, so the parent passes the resolved one.
  const light = isLight ?? theme.mode === 'light'
  const ink = light ? 'rgba(12,14,20,0.80)' : 'rgba(var(--ink-rgb),0.82)'
  const inkSoft = light ? 'rgba(12,14,20,0.28)' : 'rgba(var(--ink-rgb),0.26)'
  const hair = light ? 'rgba(12,14,20,0.14)' : 'rgba(var(--ink-rgb),0.14)'
  const glass = light ? 'rgba(var(--ink-rgb),0.60)' : 'rgba(var(--ink-rgb),0.07)'

  return (
    <div className="group">
      <button
        onClick={onSelect}
        className="relative w-full rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
        style={{
          aspectRatio: '16/10',
          background: canvas,
          outline: selected ? `2px solid ${accent}` : `1px solid ${hair}`,
          outlineOffset: selected ? '2px' : '0px',
          transform: selected ? 'scale(1.02)' : 'scale(1)',
          boxShadow: selected ? `0 0 22px ${accent}44` : 'none',
        }}
        aria-label={`${theme.name} appearance`}
        aria-pressed={selected}
      >
        {/* Rail */}
        <div
          className="absolute inset-y-0 left-0 flex flex-col gap-1.5 py-2 px-2"
          style={{ width: '26%', background: surface, borderRight: `1px solid ${hair}` }}
        >
          <div className="rounded-full mb-1" style={{ width: '50%', height: 3, background: accent }} />
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: i === 0 ? '84%' : '68%',
                height: 3,
                background: i === 0 ? accent : inkSoft,
                opacity: i === 0 ? 0.85 : 0.7,
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="absolute inset-y-0 right-0 flex flex-col gap-1.5 py-2 pr-2" style={{ left: '26%', paddingLeft: '7%' }}>
          <div
            className="rounded-md flex items-center gap-1.5 p-1.5"
            style={{ background: glass, border: `1px solid ${hair}`, height: '46%' }}
          >
            <div className="rounded" style={{ width: 14, height: 14, background: accent, opacity: 0.9 }} />
            <div className="flex-1 flex flex-col gap-1">
              <div className="rounded-full" style={{ width: '72%', height: 2.5, background: ink, opacity: 0.8 }} />
              <div className="rounded-full" style={{ width: '46%', height: 2, background: inkSoft }} />
            </div>
          </div>

          <div className="flex gap-1.5 flex-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="rounded-md flex-1"
                style={{ background: i === 0 ? `${accent}22` : glass, border: `1px solid ${hair}` }}
              />
            ))}
          </div>

          <div
            className="rounded-full flex items-center px-1.5"
            style={{ background: surface, border: `1px solid ${hair}`, height: 7 }}
          >
            <div className="rounded-full" style={{ width: '38%', height: 2, background: accent }} />
          </div>
        </div>

        {/* Selected tick */}
        {selected && (
          <div
            className="absolute top-1.5 right-1.5 rounded-full p-0.5 flex items-center justify-center"
            style={{ background: accent, color: light ? '#fff' : '#000' }}
          >
            <CheckIcon />
          </div>
        )}
      </button>

      <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
        <span className="text-xs font-semibold text-white/80 truncate">{theme.name}</span>
        <span
          className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
          style={{ background: 'rgba(var(--ink-rgb),0.08)', color: 'rgba(var(--ink-rgb),0.45)' }}
        >
          {theme.mode === 'custom' ? 'yours' : theme.mode}
        </span>
      </div>
      <p className="text-[11px] text-white/35 mt-0.5 leading-snug line-clamp-2">{theme.description}</p>
    </div>
  )
}

// ── ThemeCard component ─────────────────────────────────────────────────────
function ThemeCard({ theme, selected, onSelect, onDelete, isCustom }) {
  const isDynamic = theme.id === 'dynamic'

  return (
    <div className="relative group/card shrink-0" style={{ width: THEME_TILE_W }}>
      <button
        onClick={onSelect}
        className="w-full relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 block"
        style={{
          aspectRatio: '16/10',
          outline: selected ? '2px solid rgba(252,165,165,0.9)' : '1px solid rgba(var(--ink-rgb),0.10)',
          outlineOffset: selected ? '2px' : '0px',
          boxShadow: selected ? '0 0 16px rgba(252,165,165,0.22)' : 'none',
        }}
        aria-label={`${theme.name} backdrop`}
        aria-pressed={selected}
      >
        {isDynamic ? (
          <span
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(ellipse 80% 60% at 70% 20%, rgba(120,80,220,0.7) 0%, transparent 60%),
                radial-gradient(ellipse 60% 70% at 20% 80%, rgba(60,120,220,0.5) 0%, transparent 60%),
                radial-gradient(ellipse 50% 50% at 50% 50%, rgba(220,80,120,0.4) 0%, transparent 70%),
                #0a0a14`,
            }}
          />
        ) : (
          <img
            src={theme.img}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'blur(6px) saturate(130%)', transform: 'scale(1.1)' }}
          />
        )}

        {/* Dark overlay keeps the checkmark readable on any image */}
        <span
          className="absolute inset-0 transition-opacity duration-200"
          style={{ background: 'rgba(0,0,0,0.32)', opacity: selected ? 0.2 : 0.5 }}
        />

        {selected && (
          <span
            className="absolute top-1 left-1 rounded-full p-0.5 flex items-center justify-center"
            style={{ background: 'rgba(252,165,165,0.95)', color: '#000' }}
          >
            <CheckIcon />
          </span>
        )}

        {isDynamic && (
          <span className="absolute top-1 right-1 flex gap-0.5">
            {['rgb(252,165,165)', 'rgb(96,165,250)', 'rgb(52,211,153)'].map((c, i) => (
              <span
                key={i}
                className="w-1 h-1 rounded-full animate-bounce"
                style={{ background: c, animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        )}
      </button>

      {/* Name lives under the tile: a 116px card has no room for a caption bar. */}
      <div className="mt-1.5 flex items-center gap-1 min-w-0">
        <span className={`text-[11px] truncate ${selected ? 'text-white/90 font-semibold' : 'text-white/50'}`}>
          {theme.name}
        </span>
        {isDynamic && (
          <span
            className="text-[8px] font-bold uppercase tracking-wider px-1 rounded-full shrink-0"
            style={{ background: 'rgba(252,165,165,0.2)', color: 'rgb(252,165,165)' }}
          >
            Auto
          </span>
        )}
      </div>

      {isCustom && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.() }}
          className="on-accent absolute -top-1.5 -right-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-full p-0.5 shadow opacity-0 group-hover/card:opacity-100 transition-opacity z-10 cursor-pointer"
          title="Delete backdrop"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      )}
    </div>
  )
}
