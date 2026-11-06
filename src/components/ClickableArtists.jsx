import React from 'react'

export default function ClickableArtists({ artistString, className = "", style = {} }) {
  if (!artistString) return null
  const artists = artistString.split(/,\s*|\s+&\s+/).filter(Boolean)
  return (
    <span className={className} style={style}>
      {artists.map((artist, idx) => (
        <React.Fragment key={idx}>
          <span
            className="hover:underline hover:text-white cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              window.dispatchEvent(new CustomEvent('open-artist', { detail: artist }))
            }}
          >
            {artist}
          </span>
          {idx < artists.length - 1 && <span className="mx-1 opacity-50">,</span>}
        </React.Fragment>
      ))}
    </span>
  )
}
