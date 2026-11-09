// Builds native/smtc/smtc.dll — the Windows media-flyout bridge.
//
// Run with:  npm run build:smtc
//
// The DLL is committed, so a release does not depend on this script running. It exists
// so the binary can be reproduced, and so it can be rebuilt after editing smtc.cpp.
//
// Needs the MSVC toolchain and the Windows SDK. Both are located by scanning the usual
// install roots rather than assuming one version — this machine has VS "18" Build Tools
// while most CI runners still call it 2022.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'native', 'smtc', 'smtc.cpp')
const OUT = path.join(ROOT, 'native', 'smtc', 'smtc.dll')

function firstExisting(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p
  return null
}

function findMsvc() {
  const roots = [
    'C:/Program Files/Microsoft Visual Studio',
    'C:/Program Files (x86)/Microsoft Visual Studio',
  ]
  const candidates = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const year of fs.readdirSync(root)) {
      const tools = path.join(root, year, 'BuildTools', 'VC', 'Tools', 'MSVC')
      const ide = path.join(root, year, 'Community', 'VC', 'Tools', 'MSVC')
      const pro = path.join(root, year, 'Professional', 'VC', 'Tools', 'MSVC')
      for (const base of [tools, ide, pro]) {
        if (!fs.existsSync(base)) continue
        for (const ver of fs.readdirSync(base)) {
          candidates.push(path.join(base, ver))
        }
      }
    }
  }
  // Newest toolset wins.
  candidates.sort().reverse()
  return firstExisting(candidates)
}

function findSdk() {
  const roots = ['C:/Program Files (x86)/Windows Kits/10', 'C:/Program Files/Windows Kits/10']
  for (const root of roots) {
    const inc = path.join(root, 'Include')
    if (!fs.existsSync(inc)) continue
    const versions = fs.readdirSync(inc).filter((v) => /^10\./.test(v)).sort().reverse()
    for (const v of versions) {
      if (fs.existsSync(path.join(inc, v, 'cppwinrt', 'winrt', 'Windows.Media.h'))) {
        return { root, ver: v }
      }
    }
  }
  return null
}

const vc = findMsvc()
const sdk = findSdk()
if (!vc || !sdk) {
  console.error('MSVC toolset or Windows SDK not found — cannot build smtc.dll')
  process.exit(1)
}

const cl = path.join(vc, 'bin', 'Hostx64', 'x64', 'cl.exe')
const inc = path.join(sdk.root, 'Include', sdk.ver)
const lib = path.join(sdk.root, 'Lib', sdk.ver)

const env = {
  ...process.env,
  INCLUDE: [
    path.join(vc, 'include'),
    path.join(inc, 'ucrt'),
    path.join(inc, 'shared'),
    path.join(inc, 'um'),
    path.join(inc, 'winrt'),
    path.join(inc, 'cppwinrt'),
  ].join(';'),
  LIB: [
    path.join(vc, 'lib', 'x64'),
    path.join(lib, 'ucrt', 'x64'),
    path.join(lib, 'um', 'x64'),
  ].join(';'),
}

console.log(`toolset: ${vc}`)
console.log(`sdk:     ${sdk.ver}`)

execFileSync(
  cl,
  [
    '-nologo',
    '-EHsc',
    '-std:c++17',
    '-O2',
    '-LD',
    '-MD',
    '-DUNICODE',
    '-D_UNICODE',
    // C++/WinRT still pulls <experimental/coroutine>, which VS 18 rejects outright
    // (error C2338 / STL1011) unless this is defined. Harmless on older toolsets.
    '-D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS',
    SRC,
    '-Fe:' + OUT,
    '-link',
    '-NOLOGO',
    'WindowsApp.lib',
    'ole32.lib',
    'oleaut32.lib',
    'user32.lib',
    'runtimeobject.lib',
  ],
  { stdio: 'inherit', env }
)

console.log(`built ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`)
