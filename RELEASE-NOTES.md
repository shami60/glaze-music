# What's new in 1.0.11

- **Fixed: some songs would not start at all.** A safety measure added in 1.0.10 could
  switch off the fallback downloader after one slow lookup, so anything the fast path
  could not serve failed outright. The fallback is now always allowed to try.
- A song that fails to load is retried automatically after a short pause.

---

_Keep this file short: it is shown inside the app, in a box about 130 px tall._
