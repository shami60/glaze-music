# What's new in 1.0.14

- **Restored the way songs are found.** 1.0.10 made loading faster by skipping the
  downloader and asking YouTube directly — but some networks refuse those links, and for
  those people nothing would play. The older order asks the downloader first, which works
  everywhere. A song may take a second or two longer to start; it starts.
- When a song still fails, the downloader refreshes itself and tries once more.
- Failures now record exactly why, so a stuck song can be diagnosed.

---

_Keep this file short: it is shown inside the app, in a box about 130 px tall._
