// 공식 7-Zip 콘솔 바이너리를 resources/bin/<platform>-<arch>/ 로 받아온다.
//   node scripts/fetch-7zip.mjs            → 현재 OS/아키텍처만
//   node scripts/fetch-7zip.mjs --all      → win/mac/linux 전부 (배포용)
//   node scripts/fetch-7zip.mjs linux-x64  → 지정한 대상만
import { mkdir, writeFile, rm, readdir, rename, chmod, stat, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const VERSION = '26.03'
const V = VERSION.replace('.', '')
const BASE = `https://github.com/ip7z/7zip/releases/download/${VERSION}`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'resources', 'bin')
const CACHE = join(ROOT, '.cache', '7zip')

const TARGETS = {
  'win32-x64': { file: `7z${V}-x64.exe`, kind: 'win' },
  'win32-arm64': { file: `7z${V}-arm64.exe`, kind: 'win' },
  'linux-x64': { file: `7z${V}-linux-x64.tar.xz`, kind: 'tar' },
  'linux-arm64': { file: `7z${V}-linux-arm64.tar.xz`, kind: 'tar' },
  // mac 빌드는 universal(x64+arm64) 한 파일이다
  'darwin-x64': { file: `7z${V}-mac.tar.xz`, kind: 'tar' },
  'darwin-arm64': { file: `7z${V}-mac.tar.xz`, kind: 'tar' }
}

async function download(name) {
  const dest = join(CACHE, name)
  if (existsSync(dest) && (await stat(dest)).size > 0) return dest
  await mkdir(CACHE, { recursive: true })
  process.stdout.write(`  ↓ ${name} ... `)
  const res = await fetch(`${BASE}/${name}`, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`)
  return dest
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr?.toString() || r.error}`)
  return r
}

// tar.xz 풀기: Windows 에서는 이미 받아 둔 윈도우용 7z 로, 그 외에는 시스템 tar 로.
async function untarXz(archive, outDir) {
  await mkdir(outDir, { recursive: true })
  if (process.platform !== 'win32') return run('tar', ['-xJf', archive, '-C', outDir])
  const host7z = await ensureHostWin7z()
  run(host7z, ['x', '-y', archive, `-o${outDir}`]) // .tar.xz → .tar
  const tar = (await readdir(outDir)).find((f) => f.endsWith('.tar'))
  run(host7z, ['x', '-y', join(outDir, tar), `-o${outDir}`])
  await rm(join(outDir, tar))
}

let hostWin7z
async function ensureHostWin7z() {
  if (hostWin7z) return hostWin7z
  const key = `win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  const exe = join(BIN, key, '7z.exe')
  if (!existsSync(exe)) await fetchTarget(key)
  return (hostWin7z = exe)
}

async function fetchTarget(key) {
  const t = TARGETS[key]
  if (!t) throw new Error(`알 수 없는 대상: ${key} (가능: ${Object.keys(TARGETS).join(', ')})`)
  const out = join(BIN, key)
  const exeName = t.kind === 'win' ? '7z.exe' : '7zz'
  if (existsSync(join(out, exeName))) return console.log(`✓ ${key} (이미 있음)`)
  console.log(`● ${key}`)
  const archive = await download(t.file)
  await mkdir(out, { recursive: true })

  if (t.kind === 'win') {
    // 설치 파일은 7z SFX 이므로 7zr.exe 로 7z.exe + 7z.dll 만 꺼낸다 (7z.dll 이 있어야 RAR 등 전 포맷 지원)
    if (process.platform !== 'win32') throw new Error('윈도우용 엔진은 Windows 에서 받아야 합니다')
    const sevenZr = await download('7zr.exe')
    run(sevenZr, ['e', '-y', archive, '7z.exe', '7z.dll', 'License.txt', `-o${out}`])
  } else {
    const tmp = join(CACHE, `x-${key}`)
    await rm(tmp, { recursive: true, force: true })
    await untarXz(archive, tmp)
    await rename(join(tmp, '7zz'), join(out, '7zz'))
    if (existsSync(join(tmp, 'License.txt'))) await copyFile(join(tmp, 'License.txt'), join(out, 'License.txt'))
    await rm(tmp, { recursive: true, force: true })
    await chmod(join(out, '7zz'), 0o755)
  }
  console.log(`✓ ${key} → resources/bin/${key}/${exeName}`)
}

const args = process.argv.slice(2)
const keys = args.includes('--all')
  ? Object.keys(TARGETS)
  : args.length
    ? args
    : [`${os.platform()}-${os.arch()}`]

try {
  for (const k of keys) await fetchTarget(k)
} catch (e) {
  console.error('✗', e.message)
  process.exit(1)
}
