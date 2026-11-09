import { useEffect, useState } from 'react'

/**
 * The screen shown while an update installs itself.
 *
 * Without it the app simply disappears: the window closes, the NSIS installer runs
 * silently, and it comes back a few seconds later. That reads as a crash. This gives
 * the moment a shape — what is happening, which version, and the promise that the app
 * returns on its own.
 *
 * Driven by a DOM event rather than context, because the two things that can start an
 * install (`UpdateRow` in Settings, `UpdateBanner`) are nowhere near the root, and
 * threading a setter through them would be more machinery than this is worth.
 */
export default function UpdateOverlay() {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    const onInstalling = (e) => {
      setInfo({
        version: e?.detail?.version || '',
        // A fresh install takes a few seconds; the first run of a new version also has
        // to unpack. Say "a few seconds" and let the bar creep, rather than lie with a
        // fake percentage.
        startedAt: Date.now(),
      })
    }
    const onCancelled = () => setInfo(null)
    window.addEventListener('glaze:installing', onInstalling)
    window.addEventListener('glaze:installing-cancelled', onCancelled)
    return () => {
      window.removeEventListener('glaze:installing', onInstalling)
      window.removeEventListener('glaze:installing-cancelled', onCancelled)
    }
  }, [])

  if (!info) return null

  return (
    <div className="fixed inset-0 z-[100000] flex flex-col items-center justify-center bg-[#08080a] animate-in fade-in duration-300">
      {/* Soft accent bloom, matching the app's own light */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 38%, rgba(239,68,68,0.16) 0%, rgba(239,68,68,0.04) 40%, transparent 72%)',
        }}
      />

      <div className="relative flex flex-col items-center">
        <div className="relative w-16 h-16 mb-7">
          <div
            className="absolute inset-0 rounded-2xl border"
            style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.10)' }}
          />
          <div
            className="absolute inset-0 rounded-2xl border-2 animate-spin"
            style={{ borderColor: 'rgba(255,255,255,0.10)', borderTopColor: 'rgba(255,255,255,0.75)' }}
          />
          <svg viewBox="0 0 24 24" fill="currentColor" className="absolute inset-0 m-auto w-6 h-6" style={{ color: 'rgba(255,255,255,0.9)' }}>
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
          </svg>
        </div>

        <h1 className="text-lg font-semibold tracking-tight" style={{ color: '#ffffff' }}>
          Updating Glaze Music
        </h1>
        <p className="text-sm mt-1.5 tabular-nums" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {info.version ? `Installing ${info.version}` : 'Installing the latest version'}
        </p>

        <div className="mt-6 w-56 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
          <div
            className="h-full w-1/3 rounded-full animate-[updatebar_1.4s_ease-in-out_infinite]"
            style={{ background: 'rgba(255,255,255,0.78)' }}
          />
        </div>

        <p className="mt-5 text-[11px] max-w-[260px] text-center leading-relaxed" style={{ color: 'rgba(255,255,255,0.34)' }}>
          This takes a few seconds. Glaze Music reopens by itself — you don&apos;t need to
          do anything.
        </p>
      </div>

      <style>{`
        @keyframes updatebar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  )
}
