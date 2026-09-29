// 사용자 단위 작업(풀기/압축/테스트/추가). 7z 호출 앞뒤의 파일 정리를 담당한다.
import { mkdir, readdir, rename, rm, stat, lstat, cp, mkdtemp } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, basename, dirname, extname } from 'node:path'
import os from 'node:os'
import { shell } from 'electron'
import * as sz from './sevenzip.js'
import { archiveBaseName, formatById } from '../shared/formats.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Windows 에서는 백신/검색 인덱서가 방금 만든 파일을 잠깐 잡고 있어 rename 이 EPERM 으로 실패할 때가 있다
async function renameRetry(a, b) {
  for (let i = 0; ; i++) {
    try {
      return await rename(a, b)
    } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        if (e.code === 'EXDEV') {
          await cp(a, b, { recursive: true })
          return rm(a, { recursive: true, force: true })
        }
        throw e
      }
      await sleep(80 * (i + 1))
    }
  }
}

/** "이름 (2).ext" 처럼 겹치지 않는 경로를 만든다 */
export function uniquePath(p) {
  if (!existsSync(p)) return p
  const dir = dirname(p)
  const name = basename(p)
  // 다중 확장자(.tar.gz)는 통째로 뒤에 붙인다
  const m = name.match(/^(.*?)((?:\.tar)?\.[^.]+)$/)
  const stem = m && m[1] ? m[1] : name
  const ext = m && m[1] ? m[2] : ''
  for (let i = 2; ; i++) {
    const c = join(dir, `${stem} (${i})${ext}`)
    if (!existsSync(c)) return c
  }
}

const isDir = async (p) => (await lstat(p)).isDirectory()

/** src 안의 항목들을 dst 로 옮기며 기존 파일과 충돌 시 policy(overwrite|skip|rename)를 적용 */
async function mergeMove(src, dst, policy, stats) {
  await mkdir(dst, { recursive: true })
  for (const name of await readdir(src)) {
    const s = join(src, name)
    let d = join(dst, name)
    if (existsSync(d)) {
      if ((await isDir(s)) && (await isDir(d))) {
        await mergeMove(s, d, policy, stats)
        continue
      }
      if (policy === 'skip') { stats.skipped++; continue }
      if (policy === 'rename') d = uniquePath(d)
      else await rm(d, { recursive: true, force: true })
    }
    await renameRetry(s, d)
  }
}

/**
 * 풀기. 항상 대상 폴더 안의 숨은 스테이징 폴더에 먼저 풀고 나서 옮긴다:
 *  - 취소/실패 시 쓰레기가 남지 않고
 *  - 암호 재시도 때 잘못 만들어진 파일과 사용자 파일이 섞이지 않으며
 *  - "스마트 풀기"(최상위가 하나면 그대로, 아니면 폴더 생성)를 목록 조회 없이 판단할 수 있다.
 *
 * params: { archive, dest, mode: smart|here|folder, files?, stripPrefix?, password, codepage, overwrite }
 */
export async function extractJob(params, ctx) {
  const { archive, dest, mode = 'smart', files, stripPrefix, password, codepage, overwrite = 'overwrite' } = params
  if (!existsSync(archive)) throw new sz.SevenZipError('notFound', '압축 파일을 찾을 수 없습니다')

  // 암호가 필요한지 먼저 확인 (헤더가 암호화된 7z/rar 은 목록 단계에서 바로 걸린다)
  if (!password) {
    ctx.status('확인 중…')
    const info = await sz.list(archive, { codepage, signal: ctx.signal })
    const targets = files?.length ? new Set(files) : null
    if (info.entries.some((e) => e.encrypted && (!targets || targets.has(e.path))))
      throw new sz.SevenZipError('password', '암호가 필요합니다')
  }

  await mkdir(dest, { recursive: true })
  const staging = join(dest, `.pepezip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  await mkdir(staging)
  try {
    ctx.status('푸는 중…')
    const r = await sz.extract(archive, staging, { files, password, codepage, onProgress: ctx.progress, signal: ctx.signal })
    ctx.status('정리 중…')
    const root = stripPrefix ? join(staging, stripPrefix) : staging
    if (!existsSync(root)) throw new sz.SevenZipError('failed', '선택한 항목을 압축 파일에서 찾지 못했습니다')
    const items = await readdir(root)
    const folderName = archiveBaseName(basename(archive))
    let target = dest
    let openPath = dest
    if (mode === 'folder' || (mode === 'smart' && items.length !== 1)) {
      target = join(dest, folderName)
      openPath = target
    } else if (items.length === 1) {
      openPath = join(dest, items[0])
    }
    const stats = { skipped: 0 }
    await mergeMove(root, target, overwrite, stats)
    return {
      openPath,
      revealInFolder: mode !== 'folder' && items.length === 1,
      skipped: stats.skipped,
      warnings: r.warnings,
      summary: stats.skipped ? `${stats.skipped}개 건너뜀` : '완료'
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * params: { sources[], output, format, level, method, password, encryptNames, zipCrypto, solid, volumeSize,
 *           overwrite: 'replace'|'rename', deleteSources }
 */
export async function compressJob(params, ctx) {
  const { sources, format } = params
  let output = params.output
  const fmt = formatById(format)
  if (!output.toLowerCase().endsWith(fmt.ext)) output += fmt.ext
  for (const s of sources) if (!existsSync(s)) throw new sz.SevenZipError('notFound', `파일을 찾을 수 없습니다: ${basename(s)}`)

  // 7z 의 a 명령은 기존 파일에 "추가" 하므로 기존 결과물은 치우거나 새 이름을 쓴다
  const existing = existsSync(output) || existsSync(`${output}.001`)
  if (existing) {
    if (params.overwrite === 'replace') {
      await rm(output, { force: true })
      for (let i = 1; existsSync(`${output}.${String(i).padStart(3, '0')}`); i++)
        await rm(`${output}.${String(i).padStart(3, '0')}`, { force: true })
    } else output = uniquePath(output)
  }
  await mkdir(dirname(output), { recursive: true })

  // 임시 이름으로 만든 뒤 완성되면 바꾼다 (취소 시 반쪽 파일이 남지 않게). 분할은 조각 이름 때문에 바로 만든다.
  const tmpOut = params.volumeSize ? output : join(dirname(output), `.pepezip-${Date.now().toString(36)}${fmt.ext}`)
  ctx.status('압축 중…')
  try {
    const r = await sz.compress(sources, tmpOut, params, { onProgress: ctx.progress, signal: ctx.signal })
    if (tmpOut !== output) await renameRetry(tmpOut, output)
    if (params.deleteSources) for (const s of sources) await shell.trashItem(s).catch(() => {})
    const finalPath = params.volumeSize && !existsSync(output) ? `${output}.001` : output
    const size = existsSync(finalPath) ? (await stat(finalPath)).size : 0
    return { openPath: finalPath, revealInFolder: true, output: finalPath, size, warnings: r.warnings, summary: '완료' }
  } catch (e) {
    await rm(tmpOut, { force: true }).catch(() => {})
    if (params.volumeSize) {
      for (let i = 1; existsSync(`${output}.${String(i).padStart(3, '0')}`); i++)
        await rm(`${output}.${String(i).padStart(3, '0')}`, { force: true }).catch(() => {})
    }
    throw e
  }
}

export async function testJob(params, ctx) {
  const { archive, password } = params
  if (!password) {
    ctx.status('확인 중…')
    const info = await sz.list(archive, { signal: ctx.signal })
    if (info.entries.some((e) => e.encrypted)) throw new sz.SevenZipError('password', '암호가 필요합니다')
  }
  ctx.status('검사 중…')
  const r = await sz.test(archive, { password, onProgress: ctx.progress, signal: ctx.signal })
  return { summary: r.warnings ? '경고가 있습니다' : '이상 없음', ok: true }
}

/**
 * 압축 파일 안의 특정 폴더(inside, 7z 경로 구분자 사용)에 파일을 추가한다.
 * 7z 에는 "저장 위치" 옵션이 없어서, 하위 폴더에 넣을 땐 임시 폴더에 같은 구조를 만들어 복사한 뒤 추가한다.
 */
export async function addJob(params, ctx) {
  const { archive, sources, inside, password, encryptNames } = params
  const opts = { password, encryptNames, onProgress: ctx.progress, signal: ctx.signal }
  ctx.status('추가 중…')
  if (!inside) {
    await sz.addFiles(archive, sources, opts)
    return { summary: '추가됨' }
  }
  const tmp = await mkdtemp(join(os.tmpdir(), 'pepezip-add-'))
  try {
    const parts = inside.split(/[\\/]/).filter(Boolean)
    const target = join(tmp, ...parts)
    await mkdir(target, { recursive: true })
    ctx.status('준비 중…')
    for (const s of sources) await cp(s, join(target, basename(s)), { recursive: true })
    ctx.status('추가 중…')
    await sz.addFiles(archive, [parts[0]], { ...opts, cwd: tmp })
    return { summary: '추가됨' }
  } finally {
    rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

export const RUNNERS = { extract: extractJob, compress: compressJob, test: testJob, add: addJob }

/** 출력 경로 기본값: 하나면 "이름.zip", 여러 개면 "상위폴더이름.zip" */
export function defaultOutput(sources, format) {
  const fmt = formatById(format)
  const dir = dirname(sources[0])
  let name
  if (sources.length === 1) {
    const b = basename(sources[0])
    name = existsSync(sources[0]) && !statSync(sources[0]).isDirectory() ? b.slice(0, b.length - extname(b).length) || b : b
  } else name = basename(dir) || 'archive'
  return join(dir, name + fmt.ext)
}
