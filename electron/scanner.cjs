// Recursive audio-file walker.
//
// This used to be a synchronous `fs.readdirSync` recursion inlined in the
// `library:scan` IPC handler. Two problems with that:
//
//   1. It ran on the main process, which also pumps IPC, window events, the
//      tray and the protocol handlers — so a large library froze the whole UI
//      for the duration of the walk. It is async now and awaits between
//      directories, so the event loop keeps turning.
//   2. Being a closure inside the handler made it untestable. It lives in its
//      own module so the traversal rules (depth cap, symlink/junction loop
//      protection, extension filter, ordering) can be exercised directly.
//
// Traversal is depth-first in readdir order. That ordering is load-bearing:
// `library_files.position` records the order files come back in, so changing it
// reshuffles every existing user's library.

const fs = require('fs')
const path = require('path')

const DEFAULT_MAX_DEPTH = 40
const DEFAULT_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus']

/**
 * Walk `rootDir` and collect audio file paths.
 *
 * @param {string} rootDir  Directory to walk.
 * @param {object} [options]
 * @param {number} [options.maxDepth=40]      Directory depth cap.
 * @param {Set<string>|string[]} [options.extensions]  Lowercase extensions to keep.
 * @param {(message: string) => void} [options.onWarn] Sink for non-fatal warnings.
 * @returns {Promise<{files: string[], visited: number, depthLimited: number, inaccessible: number}>}
 */
async function walkAudioFiles(rootDir, options = {}) {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    extensions = DEFAULT_EXTENSIONS,
    onWarn = () => {},
  } = options

  const extSet = extensions instanceof Set ? extensions : new Set(extensions)
  const files = []
  // Windows directory junctions are reported as directories by readdir, so a
  // self-referential link would recurse until the stack blew. Track real paths.
  const visited = new Set()
  let depthLimited = 0
  let inaccessible = 0

  async function walk(dirPath, depth) {
    if (depth > maxDepth) {
      depthLimited++
      onWarn(`Depth limit reached, skipping: ${dirPath}`)
      return
    }

    let realPath
    try {
      realPath = await fs.promises.realpath(dirPath)
    } catch {
      return // broken link or vanished mid-walk
    }
    if (visited.has(realPath)) return
    visited.add(realPath)

    let entries
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    } catch {
      // Skip folders we cannot read (permission errors, etc.)
      inaccessible++
      onWarn(`Skipping inaccessible directory: ${dirPath}`)
      return
    }

    const subdirectories = []
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        subdirectories.push(fullPath)
      } else if (entry.isFile()) {
        if (extSet.has(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath)
        }
      }
    }

    // Depth-first, in order — but each step yields to the event loop.
    for (const sub of subdirectories) {
      await walk(sub, depth + 1)
    }
  }

  if (!rootDir || typeof rootDir !== 'string') {
    return { files: [], visited: 0, depthLimited: 0, inaccessible: 0 }
  }

  try {
    await walk(rootDir, 0)
  } catch (err) {
    onWarn(`Walk aborted: ${err?.message || err}`)
  }

  return { files, visited: visited.size, depthLimited, inaccessible }
}

module.exports = { walkAudioFiles, DEFAULT_MAX_DEPTH, DEFAULT_EXTENSIONS }
