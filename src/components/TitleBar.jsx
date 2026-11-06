import React from 'react'

function WindowButton({ onClick, title, children, hoverClass }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`no-drag w-8 h-8 flex items-center justify-center rounded-lg text-white/70 transition-all duration-150 ${hoverClass}`}
    >
      {children}
    </button>
  )
}

export default function TitleBar() {
  const minimize   = () => window.electronAPI?.minimizeWindow()
  const miniPlayer = () => window.electronAPI?.toggleMiniPlayer(true)
  const maximize   = () => window.electronAPI?.maximizeWindow()
  const close      = () => window.electronAPI?.closeWindow()

  return (
    <div className="drag-region flex items-center justify-between h-8 px-3 shrink-0 select-none glass-content border-b border-white/[0.04]">
      {/* Left side spacer */}
      <div />

      {/* Right side: Window Controls */}
      <div className="no-drag flex items-center gap-0.5">
        <WindowButton onClick={miniPlayer} title="Mini Player / PiP (Ctrl+Shift+M)" hoverClass="hover:bg-white/10 hover:text-white">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <rect x="11" y="9" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.3" />
          </svg>
        </WindowButton>
        <WindowButton onClick={minimize} title="Minimize" hoverClass="hover:bg-white/10 hover:text-white">
          <svg width="11" height="2" viewBox="0 0 10 2" fill="currentColor"><rect width="10" height="2" rx="1" /></svg>
        </WindowButton>
        <WindowButton onClick={maximize} title="Maximize" hoverClass="hover:bg-white/10 hover:text-white">
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1.5" /></svg>
        </WindowButton>
        <WindowButton onClick={close} title="Close" hoverClass="hover:bg-red-500/80 hover:text-white">
          <svg width="11" height="11" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.8"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
        </WindowButton>
      </div>
    </div>
  )
}
