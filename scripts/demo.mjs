import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemo } from './demo-fixtures.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.GITSCOPE_DEMO_PORT || 3417)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('GITSCOPE_DEMO_PORT must be an integer between 1024 and 65535')
await access(path.join(project, '.next', 'BUILD_ID')).catch(() => { throw new Error('Run bun run build before starting the demo.') })
const demo = await createDemo(path.join(project, '.demo'))
const origin = `http://127.0.0.1:${port}`
console.log(`\nGitScope synthetic demo: ${origin}/?${demo.query}\nDashboard: ${origin}\nNo real repositories, external services or user settings are used.\n`)
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: project, stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', GITSCOPE_DEMO: '1', GITSCOPE_CONFIG_DIR: demo.state, GITSCOPE_DIST_DIR: '.next', GITSCOPE_PUBLIC_URL: origin },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
server.on('exit', (code) => { process.exitCode = code ?? 0 })
