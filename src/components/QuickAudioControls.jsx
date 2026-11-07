import React, { useState, useRef, useEffect } from 'react'
import { usePlayer } from '../context/usePlayer'

// Shared by the sliding pill and the buttons, so the two can never disagree
// about order or count.
const EQ_TABS = [
  { id: 'eq', label: '10-Band EQ' },
  { id: 'space', label: 'Spatial & Room' },
]

export default function QuickAudioControls({ className = "" }) {
  const {
    is8D,
    setIs8D,
    panSpeed,
    setPanSpeed,
    reverbPreset,
    setReverbPreset,
    eqGains,
    updateEqualizer,
    resetEqualizer,
    applyEQPreset,
    EQ_BANDS,
    accentColor = '#ef4444'
  } = usePlayer()

  const [showModal, setShowModal] = useState(false)
  const [activeTab, setActiveTab] = useState('eq') // 'eq' | 'spatial' | 'room'
  const modalRef = useRef(null)

  // Close on Escape or outside click
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowModal(false)
    }
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target) && !e.target.closest('.audio-fx-trigger')) {
        setShowModal(false)
      }
    }
    if (showModal) {
      window.addEventListener('keydown', handleKeyDown)
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showModal])

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* ── Equalizer Modal Trigger Pill ──────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="audio-fx-trigger flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white border border-white/10 text-xs font-bold transition-all duration-200 shadow-md cursor-pointer select-none active:scale-95"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-indigo-400">
          <path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z"/>
        </svg>
        <span>Equalizer</span>
        {is8D && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" title="8D Audio Active" />
        )}
      </button>

      {/* ── Floating Liquid Glass Modal ────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div
            ref={modalRef}
            className="w-full max-w-xl rounded-3xl bg-[var(--surface-0)]/95 border border-white/15 p-6 shadow-2xl backdrop-blur-3xl relative flex flex-col gap-5 text-white animate-in zoom-in-95 duration-200"
            style={{
              boxShadow: '0 25px 80px -15px rgba(0,0,0,0.8), 0 0 40px rgba(var(--ink-rgb),0.05)'
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                {/* Sliders, not a bar chart — the old glyph read as "statistics".
                    Neutral glass instead of hardcoded indigo, so it follows the theme. */}
                <div className="w-10 h-10 rounded-2xl bg-white/[0.08] border border-white/20 flex items-center justify-center text-white/80 shadow-lg">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="w-5 h-5">
                    <path d="M3.5 7h5.5M13.5 7h7" />
                    <path d="M3.5 12h2.5M10.5 12h10" />
                    <path d="M3.5 17h8.5M16.5 17h4" />
                    <circle cx="11.5" cy="7" r="1.9" fill="currentColor" stroke="none" />
                    <circle cx="8.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
                    <circle cx="14.5" cy="17" r="1.9" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Audio Studio & EQ</h3>
                  <p className="text-xs text-white/50">Fine-tune frequencies, spatial 8D, and room acoustics</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                title="Close"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="relative flex items-center gap-2 bg-white/[0.04] p-1 rounded-2xl border border-white/5">
              {/* One pill that glides between tabs, rather than each button painting
                  its own background — that is what reads as a liquid pill instead of
                  three separate highlights appearing and disappearing.
                  translateX is a multiple of (pill width + gap), so the maths holds
                  at any container width. */}
              <span
                aria-hidden="true"
                className="lg-tab-pill absolute top-1 bottom-1 rounded-xl pointer-events-none"
                style={{
                  width: 'calc((100% - 16px) / 2)',
                  transform: `translateX(calc(${EQ_TABS.findIndex(t => t.id === activeTab)} * (100% + 8px)))`,
                }}
              />
              {EQ_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative z-10 flex-1 py-1.5 text-xs font-bold rounded-xl transition-colors cursor-pointer ${
                    activeTab === tab.id ? 'text-white' : 'text-white/55 hover:text-white/85'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── TAB 1: 10-Band EQ ────────────────────────────────────────── */}
            {activeTab === 'eq' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/70">Presets:</span>
                  <div className="flex items-center gap-2">
                    <select
                      onChange={(e) => applyEQPreset(e.target.value)}
                      className="text-xs px-3 py-1.5 rounded-xl border border-white/15 bg-white/10 text-white font-medium focus:outline-none cursor-pointer"
                      defaultValue="Flat"
                    >
                      <option value="Flat" className="bg-[var(--surface-1)] text-white">Flat</option>
                      <option value="Bass Booster" className="bg-[var(--surface-1)] text-white">Bass Booster</option>
                      <option value="Electronic" className="bg-[var(--surface-1)] text-white">Electronic</option>
                      <option value="Vocal Booster" className="bg-[var(--surface-1)] text-white">Vocal Booster</option>
                      <option value="Classical" className="bg-[var(--surface-1)] text-white">Classical</option>
                      <option value="Jazz" className="bg-[var(--surface-1)] text-white">Jazz</option>
                      <option value="Rock" className="bg-[var(--surface-1)] text-white">Rock</option>
                    </select>
                    <button
                      onClick={resetEqualizer}
                      className="text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white border border-white/10 transition-all cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* 10-Band Graphic Slider Deck */}
                <div className="bg-black/40 rounded-2xl p-5 border border-white/5">
                  <div className="flex justify-between items-end h-36 gap-1">
                    {EQ_BANDS?.map((freq, i) => (
                      <div key={freq} className="flex flex-col items-center gap-2.5 flex-1 h-full">
                        <span className="text-[9px] text-white/40 font-mono tabular-nums">
                          {eqGains[i] > 0 ? `+${eqGains[i]}` : eqGains[i]}
                        </span>
                        <div className="relative flex-1 w-2 bg-white/10 rounded-full group">
                          {/* Center 0dB Line */}
                          <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/20 pointer-events-none" />
                          
                          {/* Colored Gain Fill */}
                          <div
                            className="absolute left-0 right-0 rounded-full transition-all duration-75"
                            style={{
                              height: `${(Math.abs(eqGains[i]) / 12) * 50}%`,
                              bottom: eqGains[i] >= 0 ? '50%' : `calc(50% - ${(Math.abs(eqGains[i]) / 12) * 50}%)`,
                              backgroundColor: eqGains[i] >= 0 ? '#a855f7' : '#ef4444'
                            }}
                          />

                          {/* Native Range Slider */}
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
                              width: '140px',
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

                          {/* Knob Handle — glass capsule, same language as the sliders */}
                          <div
                            className="lg-eq-knob absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none z-0"
                            style={{ bottom: `calc(${(eqGains[i] + 12) / 24 * 100}% - 5.5px)` }}
                          />
                        </div>
                        <span className="text-[10px] text-white/50 font-bold tracking-tighter uppercase">
                          {freq >= 1000 ? `${freq/1000}k` : freq}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 2: Spatial & Room ──────────────────────────────────────
                Merged: both controls answer "make it sound like somewhere else",
                and split across two tabs each one felt thin. */}
            {activeTab === 'space' && (
              <div className="flex flex-col gap-5 py-2">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Enable 8D Spatial Panning</span>
                      {is8D && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-black uppercase">Active</span>}
                    </h4>
                    <p className="text-xs text-white/50 mt-0.5">Smooth binaural rotation across left and right audio channels</p>
                  </div>
                  <button
                    onClick={() => setIs8D(!is8D)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      is8D ? 'bg-emerald-500' : 'bg-white/10'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        is8D ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {is8D && (
                  <div className="flex flex-col gap-2 p-4 rounded-2xl bg-black/30 border border-white/5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/70 font-semibold">Rotation Speed:</span>
                      <span className="text-emerald-400 font-bold">
                        {panSpeed <= 1000 ? '⚡ Ultra Fast' : panSpeed <= 1800 ? 'Fast' : panSpeed <= 2800 ? 'Normal (Natural)' : panSpeed <= 4000 ? 'Slow' : 'Very Slow'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={500}
                      max={6000}
                      step={100}
                      value={panSpeed}
                      onChange={e => setPanSpeed(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full cursor-pointer accent-emerald-400 mt-2"
                    />
                    <div className="flex justify-between text-[10px] text-white/30 mt-1 font-medium">
                      <span>Fast (1s)</span>
                      <span>Slow (6s)</span>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-1">
                  <p className="text-xs text-white/60">Simulate physical acoustic environments using convolution reverb:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: 'none', name: 'None (Dry)', desc: 'Pure direct sound' },
                    { id: 'studio', name: 'Cozy Studio', desc: 'Warm intimate room' },
                    { id: 'room', name: 'Living Room', desc: 'Natural home acoustics' },
                    { id: 'hall', name: 'Concert Hall', desc: 'Wide auditorium reverberation' },
                    { id: 'cathedral', name: 'Cathedral', desc: 'Deep atmospheric decay' },
                  ].map((preset) => {
                    const active = reverbPreset === preset.id
                    return (
                      <button
                        key={preset.id}
                        onClick={() => setReverbPreset(preset.id)}
                        className={`p-3 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                          active
                            // Theme-aware: `text-purple-200` is a literal Tailwind
                            // colour, so on a light theme it was light-on-light and
                            // nearly invisible. `text-white` maps to the theme ink.
                            ? 'bg-white/20 border-white/45 text-white shadow-lg'
                            : 'bg-white/[0.03] border-white/10 text-white/60 hover:bg-white/[0.08] hover:text-white'
                        }`}
                      >
                        <p className="text-xs font-bold">{preset.name}</p>
                        <p className="text-[10px] text-white/40 mt-0.5">{preset.desc}</p>
                      </button>
                    )
                  })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
