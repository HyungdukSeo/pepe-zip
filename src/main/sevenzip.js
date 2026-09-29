// 7-Zip 콘솔(7z.exe / 7zz) 래퍼.
// 모든 호출은 -sccUTF-8 로 출력을 UTF-8 로 고정하고, stdin 은 닫아 둔다(암호 프롬프트로 멈추지 않도록).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, chmodSync, writeFileSync, rmSync } from 'node:fs'
import { writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { isCompoundTar } from '../shared/formats.js'

const IS_WIN = process.platform === 'win32'
export const ENTRY_SEP = IS_WIN ? '\\' : '/'

export function binPath() {
  const exe = IS_WIN ? '7z.exe' : '7zz'
  const dir = process.env.PEPEZIP_BIN_DIR
    ? process.env.PEPEZIP_BIN_DIR
    : app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin', `${process.platform}-${process.arch}`)
  const p = join(dir, exe)
  if (!IS_WIN && existsSync(p)) {
    try { chmodSync(p, 0o755) } catch { /* 읽기 전용 볼륨(AppImage) 이면 이미 실행 권한이 있다 */ }
  }
  return p
}

function childEnv() {
  const env = { ...process.env }
  // 리눅스에서 로케일이 없으면 7zz 가 비ASCII 파일 이름을 깨뜨린다
  if (process.platform === 'linux' && !env.LC_ALL && !env.LANG) env.LC_ALL = 'C.UTF-8'
  return env
}

// 읽기 작업에는 암호가 없어도 -p 를 넘긴다: 안 넘기면 암호 걸린 파일에서 7z 가 stdin 프롬프트로 대기한다.
// (쓰기 작업에서는 이 가짜 암호로 암호화돼 버리므로 절대 쓰지 말 것 — optPw 사용)
const NO_PASS = '-p__pepezip_no_password__'
const pwArg = (pw) => (pw ? `-p${pw}` : NO_PASS)
const optPw = (pw) => (pw ? [`-p${pw}`] : [])

export class SevenZipError extends Error {
  constructor(kind, message, detail) {
    super(message)
    this.kind = kind // password | notArchive | corrupt | disk | notFound | canceled | failed
    this.detail = detail
  }
}

export function classifyError(code, stderr) {
  const s = stderr || ''
  if (code === 255) return new SevenZipError('canceled', '취소되었습니다')
  if (/wrong password|encrypted archive|can ?not open encrypted/i.test(s))
    return new SevenZipError('password', '암호가 필요하거나 올바르지 않습니다', s)
  if (/is not archive|cannot open the file as/i.test(s))
    return new SevenZipError('notArchive', '압축 파일이 아니거나 지원하지 않는 형식입니다', s)
  if (/unexpected end|data error|crc failed|headers error|unavailable data|is not the first volume/i.test(s))
    return new SevenZipError('corrupt', '압축 파일이 손상되었거나 일부 조각이 없습니다', s)
  if (/not enough space|no space left/i.test(s)) return new SevenZipError('disk', '디스크 공간이 부족합니다', s)
  const first = s.split('\n').map((l) => l.trim()).find((l) => /error/i.test(l)) || s.trim().split('\n').pop()
  return new SevenZipError('failed', first || `7-Zip 오류 (코드 ${code})`, s)
}

// " 45% 12 - 폴더\파일.txt" 형태의 진행률 줄을 해석한다. 줄 구분은 \r 또는 \b.
function progressParser(onProgress) {
  let buf = ''
  let last = -1
  return (chunk) => {
    buf += chunk.toString('utf8')
    const parts = buf.split(/[\r\n\b]+/)
    buf = parts.pop()
    for (const p of parts) {
      const m = p.match(/^\s*(\d{1,3})%(?:\s+\d+)?(?:\s+[-+=URTD.]\s+(.*))?/)
      if (!m) continue
      const percent = Math.min(100, +m[1])
      const file = (m[2] || '').trim()
      if (percent !== last || file) {
        last = percent
        onProgress?.({ percent, file })
      }
    }
  }
}

/**
 * 7z 프로세스 하나 또는 파이프로 이은 두 개를 실행한다.
 * steps: [{ args, cwd, progress: 'stdout'|'stderr' }]  (두 개면 앞 단계의 stdout → 뒤 단계의 stdin)
 */
export function run(steps, { onProgress, signal } = {}) {
  if (!Array.isArray(steps)) steps = [steps]
  const exe = binPath()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new SevenZipError('canceled', '취소되었습니다'))
    const procs = []
    const stderrs = steps.map(() => '')
    const stdouts = steps.map(() => '')
    let finished = 0
    let canceled = false
    const codes = []

    const onAbort = () => {
      canceled = true
      for (const p of procs) {
        try { p.kill() } catch { /* 이미 끝남 */ }
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    steps.forEach((step, i) => {
      const piped = steps.length > 1
      const p = spawn(exe, step.args, {
        cwd: step.cwd,
        env: childEnv(),
        windowsHide: true,
        stdio: [piped && i > 0 ? 'pipe' : 'ignore', 'pipe', 'pipe']
      })
      procs.push(p)
      const parse = step.progress ? progressParser(onProgress) : null
      const isDataOut = piped && i < steps.length - 1
      if (!isDataOut) {
        p.stdout.on('data', (d) => {
          if (step.progress === 'stdout') parse(d)
          else if (stdouts[i].length < 64 * 1024 * 1024) stdouts[i] += d.toString('utf8')
        })
      }
      p.stderr.on('data', (d) => {
        if (step.progress === 'stderr') parse(d)
        const s = d.toString('utf8')
        if (stderrs[i].length < 256 * 1024) stderrs[i] += s
      })
      let ended = false
      const end = (code) => {
        if (ended) return
        ended = true
        codes[i] = codes[i] ?? code
        if (++finished === steps.length) done()
      }
      p.on('error', (e) => {
        codes[i] = -1
        stderrs[i] += `\n${e.message}`
        // 실행 자체가 실패하면(ENOENT 등) close 가 오지 않을 수 있다
        if (!p.pid) end(-1)
      })
      p.on('close', end)
    })

    if (steps.length > 1) {
      const [a, b] = procs
      a.stdout.pipe(b.stdin)
      // 뒤쪽이 먼저 죽으면 앞쪽은 EPIPE 를 받는다 — 결과 판정은 종료 코드로 한다
      a.stdout.on('error', () => {})
      b.stdin.on('error', () => {})
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      if (canceled) return reject(new SevenZipError('canceled', '취소되었습니다'))
      // 0 = 성공, 1 = 경고(일부 파일 잠김 등) — 둘 다 결과는 있음
      const badIdx = codes.findIndex((c) => c !== 0 && c !== 1)
      if (badIdx >= 0) {
        const allErr = stderrs.join('\n')
        return reject(classifyError(codes[badIdx], allErr + '\n' + stdouts.join('\n')))
      }
      resolve({ stdout: stdouts[stdouts.length - 1], stderr: stderrs.join('\n'), warnings: codes.includes(1) })
    }
  })
}

const BASE = ['-sccUTF-8', '-scsUTF-8']
// 주의: "@목록파일" 인자는 "--" 뒤에 두면 파일 이름으로 취급된다. 목록 파일을 쓰는 명령에는 "--" 를 넣지 않는다
// (경로는 모두 절대 경로라 '-' 로 시작하지 않는다).
const PROG = ['-bso0', '-bse2', '-bsp1']

async function withListFile(paths, fn) {
  if (!paths?.length) return fn(null)
  const dir = await mkdtemp(join(os.tmpdir(), 'pepezip-l-'))
  const file = join(dir, 'list.txt')
  await writeFile(file, paths.join('\n'), 'utf8')
  try {
    return await fn(`@${file}`)
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const cpArg = (archive, codepage) => (codepage && /\.(zip|zipx|jar)(\.\d+)?$/i.test(archive) ? [`-mcp=${codepage}`] : [])

// ───────────────────────── 목록 ─────────────────────────

export function parseSlt(raw) {
  const text = raw.replace(/\r\n?/g, '\n')
  const sepIdx = text.indexOf('\n----------\n')
  const head = sepIdx >= 0 ? text.slice(0, sepIdx) : text
  const body = sepIdx >= 0 ? text.slice(sepIdx + 12) : ''

  // 분할 압축은 "Type = Split" 섹션 뒤에 실제 형식 섹션이 한 번 더 온다 → 마지막 섹션이 기준, 앞 섹션의 볼륨 정보는 합친다
  const info = {}
  const hStart = head.indexOf('\n--\n')
  if (hStart >= 0) {
    const sections = head.slice(hStart + 4).split(/\n--\n/)
    const parsed = sections.map((sec) => {
      const o = {}
      let lastKey
      for (const line of sec.split('\n')) {
        if (line === '----') break // 컨테이너 안의 파일 한 개 설명(Split 섹션) — 무시
        const i = line.indexOf(' = ')
        if (i > 0) o[(lastKey = line.slice(0, i))] = line.slice(i + 3)
        else if (lastKey && line && !/^(WARNINGS?|ERRORS?):/.test(line)) o[lastKey] += '\n' + line
      }
      return o
    })
    Object.assign(info, parsed[parsed.length - 1])
    const split = parsed.find((o) => o.Type === 'Split')
    if (split) {
      info.Volumes = split.Volumes
      info.Multivolume = '+'
      info['Physical Size'] = split['Total Physical Size'] || info['Physical Size']
    }
  }

  const entries = []
  let cur = null
  const flush = () => {
    if (cur && cur.Path !== undefined) entries.push(cur)
    cur = null
  }
  for (const line of body.split('\n')) {
    if (line === '') { flush(); continue }
    const i = line.indexOf(' = ')
    if (i < 0) continue
    cur ??= {}
    cur[line.slice(0, i)] = line.slice(i + 3)
  }
  flush()

  return {
    info,
    entries: entries.map((e) => ({
      path: e.Path,
      isDir: e.Folder === '+' || /^D/.test(e.Attributes || '') || /^d/.test(e.Mode || ''),
      size: e.Size ? Number(e.Size) : 0,
      packed: e['Packed Size'] ? Number(e['Packed Size']) : null,
      mtime: e.Modified || '',
      crc: e.CRC || '',
      encrypted: e.Encrypted === '+',
      method: e.Method || '',
      attributes: e.Attributes || e.Mode || ''
    }))
  }
}

export async function list(archive, { password, codepage, signal } = {}) {
  if (!existsSync(archive)) throw new SevenZipError('notFound', '파일을 찾을 수 없습니다')
  let res
  let compound = false
  if (isCompoundTar(archive)) {
    try {
      res = await run(
        [
          { args: ['x', '-so', ...BASE, '--', archive] },
          { args: ['l', '-slt', '-si', '-ttar', ...BASE] }
        ],
        { signal }
      )
      compound = true
    } catch (e) {
      if (e.kind === 'canceled') throw e
      res = null // 안쪽이 tar 가 아니면 일반 방식으로 다시 연다
    }
  }
  if (!res) res = await run({ args: ['l', '-slt', ...BASE, pwArg(password), ...cpArg(archive, codepage), '--', archive] }, { signal })
  const parsed = parseSlt(res.stdout)
  if (compound) {
    const outer = await run({ args: ['l', '-slt', ...BASE, '--', archive] }, { signal }).catch(() => null)
    const outerInfo = outer ? parseSlt(outer.stdout).info : {}
    parsed.info = { ...parsed.info, Type: `${outerInfo.Type || 'gz'} + tar`, 'Physical Size': outerInfo['Physical Size'] }
  }
  const t = (parsed.info.Type || '').toLowerCase()
  const multi = parsed.info.Multivolume === '+' || Number(parsed.info.Volumes || 1) > 1
  return {
    ...parsed,
    compound,
    sep: ENTRY_SEP,
    encrypted: parsed.entries.some((e) => e.encrypted) || /7zAES|AES/i.test(parsed.info.Method || ''),
    editable: !compound && !multi && ['7z', 'zip', 'tar', 'wim'].includes(t)
  }
}

// ───────────────────────── 풀기 / 테스트 ─────────────────────────

/** archive 를 outDir 로 푼다. files 가 있으면 그 경로만(경로 구조 유지). */
export function extract(archive, outDir, { files, password, codepage, onProgress, signal } = {}) {
  return withListFile(files, (listArg) => {
    const tail = listArg ? [listArg] : []
    if (isCompoundTar(archive)) {
      return run(
        [
          { args: ['x', '-so', '-bsp2', ...BASE, '--', archive], progress: 'stderr' },
          { args: ['x', '-si', '-ttar', '-y', '-aoa', `-o${outDir}`, '-bso0', ...BASE, ...tail] }
        ],
        { onProgress, signal }
      ).catch((e) => {
        // 안쪽이 tar 가 아닌 단일 .gz 등 → 일반 방식
        if (e.kind === 'canceled') throw e
        return extractPlain()
      })
    }
    return extractPlain()

    function extractPlain() {
      return run(
        {
          args: ['x', '-y', '-aoa', `-o${outDir}`, ...PROG, ...BASE, pwArg(password), ...cpArg(archive, codepage), archive, ...tail],
          progress: 'stdout'
        },
        { onProgress, signal }
      )
    }
  })
}

/** 드래그 아웃용 동기 풀기 (startDrag 는 드래그 이벤트 처리 중에 호출돼야 함) */
export function extractSync(archive, outDir, { files, password, codepage }) {
  const listFile = join(outDir, '.pepezip-list.txt')
  writeFileSync(listFile, files.join('\n'), 'utf8')
  const r = spawnSync(binPath(), ['x', '-y', '-aoa', `-o${outDir}`, '-bso0', '-bsp0', ...BASE, pwArg(password), ...cpArg(archive, codepage), archive, `@${listFile}`], {
    env: childEnv(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  rmSync(listFile, { force: true })
  if (r.status !== 0 && r.status !== 1) throw classifyError(r.status, r.stderr?.toString('utf8'))
}

export function test(archive, { password, onProgress, signal } = {}) {
  if (isCompoundTar(archive)) {
    return run([{ args: ['t', ...PROG, ...BASE, '--', archive], progress: 'stdout' }], { onProgress, signal })
  }
  return run({ args: ['t', ...PROG, ...BASE, pwArg(password), '--', archive], progress: 'stdout' }, { onProgress, signal })
}

// ───────────────────────── 압축 ─────────────────────────

const TAR_WRAP = { tgz: 'gzip', txz: 'xz', tbz2: 'bzip2' }

/**
 * opts: { format, level, method, password, encryptNames, zipCrypto, solid, volumeSize(bytes), cwd }
 * sources 는 절대 경로(7z 가 각자 이름만 남겨 저장) 또는 cwd 기준 상대 경로.
 */
export function compress(sources, output, opts = {}, { onProgress, signal } = {}) {
  const { format = '7z', level = 5, password, encryptNames, zipCrypto, solid = true, volumeSize, cwd, method } = opts
  const vol = volumeSize ? [`-v${Math.max(1, Math.floor(volumeSize))}b`] : []
  const ssw = IS_WIN ? ['-ssw'] : []

  return withListFile(sources, (listArg) => {
    if (TAR_WRAP[format]) {
      return run(
        [
          { args: ['a', '-ttar', '-so', '-an', '-bsp2', ...ssw, ...BASE, listArg], cwd, progress: 'stderr' },
          { args: ['a', `-t${TAR_WRAP[format]}`, '-si', `-mx${level}`, '-mmt=on', '-y', '-bso0', '-bsp0', ...vol, ...BASE, output], cwd }
        ],
        { onProgress, signal }
      )
    }
    const args = ['a', `-t${format}`, '-y', ...PROG, ...BASE, ...ssw, ...vol]
    if (format === '7z') {
      args.push(`-mx${level}`, '-mmt=on')
      if (method) args.push(`-m0=${method}`)
      if (!solid) args.push('-ms=off')
      if (password) {
        args.push(...optPw(password))
        if (encryptNames) args.push('-mhe=on')
      }
    } else if (format === 'zip') {
      args.push(`-mx${level}`, '-mmt=on', '-mcu=on') // mcu: 파일 이름을 UTF-8 로 → 맥/리눅스에서도 한글 안 깨짐
      if (method) args.push(`-mm=${method}`)
      if (password) args.push(...optPw(password), `-mem=${zipCrypto ? 'ZipCrypto' : 'AES256'}`)
    }
    args.push(output, listArg)
    return run({ args, cwd, progress: 'stdout' }, { onProgress, signal })
  })
}

// ───────────────────────── 편집 (7z/zip/tar) ─────────────────────────

export function addFiles(archive, sources, { cwd, password, encryptNames, onProgress, signal } = {}) {
  return withListFile(sources, (listArg) => {
    const args = ['a', '-y', ...PROG, ...BASE, ...(IS_WIN ? ['-ssw'] : [])]
    if (/\.zip$/i.test(archive)) args.push('-mcu=on')
    if (password) args.push(...optPw(password), ...(encryptNames ? ['-mhe=on'] : []))
    args.push(archive, listArg)
    return run({ args, cwd, progress: 'stdout' }, { onProgress, signal })
  })
}

export function deleteEntries(archive, paths, { password } = {}) {
  return withListFile(paths, (listArg) => run({ args: ['d', '-y', ...PROG, ...BASE, ...optPw(password), archive, listArg] }))
}

export function renameEntries(archive, pairs, { password } = {}) {
  // rn 은 목록 파일 대신 "원래 새것 원래 새것 ..." 인자를 받는다
  const flat = pairs.flatMap(([a, b]) => [a, b])
  return run({ args: ['rn', '-y', ...PROG, ...BASE, ...optPw(password), '--', archive, ...flat] })
}
