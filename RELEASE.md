# Glaze Music — Release Guide

Everything needed to ship a public Windows build. Written 28 September 2026 against
`electron-builder 26.8.1`.

> **Version note.** This guide uses the **v26** signing API (`win.signtoolOptions` /
> `win.azureSignOptions`). electron-builder **v27 renamed this** to a unified `win.sign` object
> with a `type` field. If you upgrade, re-check the shape before copying any snippet below.

---

## 0. Version control, CI and updates — already in place

Done on 2026-11-06, so this section is no longer a to-do list:

- git repository with a public remote at **`shami60/glaze-music`**
- GitHub Actions CI on every push (lint, logic checks, build)
- tag-driven releases — the tag is the only manual step
- working auto-update from GitHub Releases

**For anything update-related, read `UPDATES.md` instead of this guide.** It covers the pipeline, the
rules that must not be broken, and the gotchas that cost us real time.

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

## 4. Auto-update — implemented, see `UPDATES.md`

Live since 2026-11-06: `electron-updater` against GitHub Releases, triggered by a version tag, built and
uploaded by GitHub Actions. `electron/updater.cjs` holds the wiring; `UPDATES.md` holds the rules.

Two corrections to what this section used to say:

1. **`latest.yml` is produced.** It always was — by full NSIS builds. `--dir` builds skip it, which is
   what made it look missing.
2. **Signing is not required for updates.** This guide claimed `win.verifyUpdateCodeSignature` would
   reject unsigned updates; an unsigned 1.0.4 updated itself to 1.0.5 successfully. Signing matters for
   SmartScreen warnings, not for the updater.

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

## 7. Known open items — state at 1.0.5

Re-measured on 2026-11-06. Several items from the 1.0.3 list are done; do not re-open them.

**Resolved**
- `library:scan` no longer self-authorises a renderer-supplied folder. `addAllowedRoot` / `addAllowedFile`
  are called only from the four native entry points, and every path-taking handler asserts first.
- CI exists (`.github/workflows/ci.yml`): lint, the two `node:assert` scripts, and a build on every push.

**Still open**
- **Accessibility is partial, not absent.** 20 `aria-*`, 8 `role=`, 70 of 72 images have `alt`. What is
  missing is narrower than the old note claimed: ~10 icon-only buttons with no label, no focus trap in
  modals, no `aria-live` for track changes, no roving tabindex in long lists.
- **No test runner.** `scripts/test-backup.mjs` and `scripts/test-art-sizes.mjs` are real assertions and
  now run in CI, but there is no framework (Vitest was the plan) and nothing covers lyrics timing, LRC
  parsing or path guards.
- **77 ESLint warnings**, 0 errors. A new warning means dead code or a stale dep array.
- **Installer is unsigned** — SmartScreen warns on first run. Updates work regardless (see `UPDATES.md`).
- Phase B (perf: context memoisation, queue bound) and Phase D (features) not started.
