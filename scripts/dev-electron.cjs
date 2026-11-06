const { spawn } = require('child_process')
const electron = require('electron')

delete process.env.ELECTRON_RUN_AS_NODE
process.env.NODE_ENV = 'development'

const child = spawn(electron, ['.'], { stdio: 'inherit', windowsHide: false })

child.on('close', (code, signal) => {
  console.log(`[dev-electron] child closed with code: ${code}, signal: ${signal}`)
  process.exit(code ?? 0)
})

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))

