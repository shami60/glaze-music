# What's new in 1.0.19

- **Fixed a regression from 1.0.17.** Using the signed-in session for playback made every
  player request fail with HTTP 400, so nothing could be resolved at all. Playback asks
  anonymously first again, and only falls back to the session if that fails.
- The downloader tries without cookies first and with them last, because a signed-in
  downloader is subject to a stricter format restriction.

---

_Keep this file short: it is shown inside the app, in a box about 130 px tall._
