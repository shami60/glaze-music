# Glaze Music — Release Guide

Everything needed to ship a public Windows build. Written 28 September 2026 against
`electron-builder 26.8.1`.

> **Version note.** This guide uses the **v26** signing API (`win.signtoolOptions` /
> `win.azureSignOptions`). electron-builder **v27 renamed this** to a unified `win.sign` object
> with a `type` field. If you upgrade, re-check the shape before copying any snippet below.

---

## 0. Do this before anything else: there is no version control

**This project is not a git repository.** No history, no remote, no way to roll back.

```bash
git init
git add .
git commit -m "Initial commit"
```

Then push to a **private** remote immediately. 19,500 lines with no history is the single largest
risk to this project — larger than any bug in `AUDIT-REPORT-V2.md`. It also blocks auto-update
(§4) and CI (Phase C of the roadmap).

---

## 1. What already works

| | |
|---|---|
| Installer | `npm run build:electron` → `dist-electron/Glaze Music Version <version>.exe` (NSIS, x64) |
| Output name | Driven by `build.nsis.artifactName`; reads `version` from `package.json` |
| Differential updates | A `.blockmap` is already emitted next to the installer |
| Crash logs | `<userData>/logs/main.log`, 1 MB cap + one rotation. Minidumps in `<userData>/Crashpad` |
| Crash IPC | `crash:getInfo`, `crash:openLogFolder`, `crash:openDumpFolder` (exposed on `window.electronAPI`) |

`<userData>` on Windows is `%APPDATA%\glaze-music`.

**Verified 28 Sep 2026:** the existing `Glaze Music Version 1.0.3.exe` is **unsigned** — its PE
certificate table is empty. Every user who runs it gets a SmartScreen warning.

---

## 2. Building

```bash
# 1. bump the version first — it drives the artifact name and the installer
#    edit "version" in package.json

# 2. build
npm run build:electron
```

> **Do not remove the `overrides` block in `package.json`.** `discord-rpc` pulls
> `register-scheme` from a raw git URL with no semver, which makes *every* `npm install` fail with
> `Invalid Version:` unless the nested override pins it to the registry build. This is why adding a
> dependency is a deliberate act in this repo, not a routine one.

---

## 3. Code signing

### 3.1 The 2026 landscape — read this before buying anything

| Option | Cost | Eligibility | SmartScreen |
|---|---|---|---|
| **Microsoft Store (MSIX)** | Free | Worldwide | ✅ No warnings — Microsoft re-signs it |
| **Azure Artifact Signing** (ex-Trusted Signing) | ~$9.99/mo | Orgs: USA, Canada, EU, UK. **Individuals: USA and Canada only** | ⚠️ Reputation builds over time |
| **OV certificate** (DigiCert, Sectigo, …) | $150–300/yr | Worldwide | ⚠️ Reputation builds over time |
| **EV certificate** | $400+/yr | Worldwide | ⚠️ **Same as OV** — see below |
| **SignPath Foundation** | Free | Open-source projects | ⚠️ OV-equivalent |
| Self-signed | Free | — | ❌ Blocks installation for the public |

**Two things that are commonly believed and are no longer true:**

1. **EV certificates no longer bypass SmartScreen.** That behaviour was removed in 2024. EV-signed
   files now build reputation exactly like OV ones. Paying the EV premium *solely* to skip
   SmartScreen is no longer justified.
2. **Azure Artifact Signing is geographically restricted.** It is the cheapest option by far, but
   individual developers are limited to the USA and Canada (organizations: USA, Canada, EU, UK).
   **Check your eligibility before planning around it.**

Also note: since June 2023 the CA/Browser Forum requires OV private keys to live on an **HSM or
hardware token**, so an OV certificate comes as a physical USB token or a cloud HSM, not a `.pfx`
you can copy around.

**If the app is going to be open source, look at SignPath Foundation first** — free OV-level
signing for qualifying projects.

### 3.2 Wiring it up

**Recommended: environment variables, no config change.** electron-builder picks these up
automatically, and the secret never lands in `package.json`.

```bash
export WIN_CSC_LINK="/path/to/cert.pfx"   # also accepts base64, or an https:// URL
export WIN_CSC_KEY_PASSWORD="..."
npm run build:electron
```

`CSC_LINK` / `CSC_KEY_PASSWORD` work too as the platform-agnostic fallback.

**Or in `package.json`** — note the nesting, this is the v26 shape:

```json
"win": {
  "signtoolOptions": {
    "certificateFile": "cert.pfx",
    "certificateSubjectName": "Your Name Or Company",
    "signingHashAlgorithms": ["sha256"]
  }
}
```

`certificateSubjectName` (or `certificateSha1`) selects the cert from the Windows certificate
store instead of a file — **required for EV**, whose private key is on hardware and cannot be
exported.

**Azure Artifact Signing** — mutually exclusive with `signtoolOptions`:

```json
"win": {
  "azureSignOptions": {
    "endpoint": "https://weu.codesigning.azure.net/",
    "codeSigningAccountName": "<your account>",
    "certificateProfileName": "<your profile>",
    "publisherName": "CN=Your Name, O=Your Org, C=US"
  }
}
```

plus `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` in the environment.

### 3.3 Turn on `forceCodeSigning` once you have a cert

```json
"win": { "forceCodeSigning": true }
```

Without it, **an unsigned build succeeds silently** — you would not notice the certificate had
expired or the env var was misspelled until users complained. With it, the build fails loudly.

### 3.4 Verify the signature — do not trust "build succeeded"

```bash
signtool verify /pa /v "dist-electron/Glaze Music Version 1.0.3.exe"
```

Or check the PE certificate table (a non-zero size means signed). An unsigned installer still
builds cleanly; only this check proves otherwise.

---

## 4. Auto-update — deferred, and what it will need

Deferred by choice. Two viable routes when you want it:

**(a) `electron-updater`** — the standard route. Requires:
- `npm install electron-updater` (see the `overrides` warning in §2)
- a `publish` block naming a provider, e.g.
  `"publish": [{ "provider": "github", "owner": "...", "repo": "..." }]`
- the provider generating a `latest.yml` alongside the installer. **The current build produces a
  `.blockmap` but no `latest.yml`** — that is exactly what is missing today.
- wiring `autoUpdater.checkForUpdatesAndNotify()` in `main.cjs`, guarded by `app.isPackaged`

**(b) A static manifest** — no dependency. Host a small JSON (`{ version, url, notes }`) anywhere,
fetch it on launch, compare against `app.getVersion()`, and open the installer URL. Roughly 100
lines, and it keeps this repo's dependency tree untouched.

**Two constraints either way:**

1. Auto-update **only works in a packaged build** — `app.isPackaged` is false in dev.
2. `win.verifyUpdateCodeSignature` **defaults to `true`** and validates each update against
   `publisherName`. So **signing and auto-update are linked**: get signing working first, or
   updates will be rejected.

---

## 5. Crash reports — what to tell users

Ask them to attach `%APPDATA%\glaze-music\logs\main.log`. That file now records main-process
warnings, errors, uncaught exceptions, unhandled rejections and any renderer/child-process death —
before this existed, a packaged build recorded none of it, because it has no console.

If the app died hard (froze, vanished), ask for `%APPDATA%\glaze-music\Crashpad` too — those are
the minidumps. Nothing is uploaded anywhere; there is no account and no endpoint.

---

## 6. Pre-release checklist

- [ ] Project is in git, with a remote, and the release commit is pushed
- [ ] `version` bumped in `package.json`
- [ ] `npm run lint` → **0 errors** (warnings should stay at the known 85 baseline)
- [ ] `npm run build` → clean
- [ ] `npm run build:electron` → installer in `dist-electron/`
- [ ] `signtool verify` passes on the installer (§3.4)
- [ ] Installed on a **clean Windows machine or fresh user profile** — not just your dev box
- [ ] First launch completes (no infinite splash) and the library scans
- [ ] Crash log is being written: `%APPDATA%\glaze-music\logs\main.log` exists
- [ ] Uninstaller removes the app and leaves user data intact
- [ ] Release notes list what changed

## 7. Known open items at 1.0.3

Carried from `AUDIT-REPORT-V2.md`. None of these block a private or beta release; the first two
should be resolved before a wide public one.

- `library:scan` accepts a renderer-supplied folder and self-authorises it (see the report's Phase A
  addendum — the fix needs the backup-import flow changed too)
- **Zero `aria-*` / `role=` attributes** — icon-only buttons are unlabelled for screen readers
- **No test runner and no CI.** `scripts/verify-phase-a.cjs` and `scripts/verify-crashlog.cjs` are
  the only harnesses; both are plain scripts, not wired into anything
- 85 ESLint warnings (mostly `react-hooks/exhaustive-deps` and `no-unused-vars`)
- Phase B (perf: context memoisation, queue bound) and Phase D (features) not started
