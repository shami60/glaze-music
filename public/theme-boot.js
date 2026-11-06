// Apply the saved appearance before first paint.
//
// This lives in its own file (rather than inline in index.html) so the CSP can keep
// `script-src 'self'` with no `'unsafe-inline'` — an inline block would force us to
// allow any injected inline script too. Without it, a user on a light theme sees a
// dark flash while preferences load over IPC.
// The id is validated here as well as in the app: a retired theme (Obsidian,
// Midnight, Forest, Nord, Neon, Graphite) is still sitting in localStorage, and
// writing it to data-theme would match no CSS block — leaving the window
// un-themed until React corrects it.
try {
  var VALID = ['liquid-glass', 'daylight', 'sandstone', 'custom']
  var savedAppearance = localStorage.getItem('glaze:appearance')
  if (savedAppearance && VALID.indexOf(savedAppearance) !== -1) {
    document.documentElement.dataset.theme = savedAppearance
  } else if (savedAppearance) {
    localStorage.setItem('glaze:appearance', 'daylight')
    document.documentElement.dataset.theme = 'daylight'
  }
} catch (e) {
  /* localStorage can be unavailable; the app falls back to the default theme */
}
