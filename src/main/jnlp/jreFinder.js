// JRE (Java Runtime Environment) 검색 및 버전 확인
import { spawnSync } from 'node:child_process'
import { existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const JAVA_EXE = IS_WIN ? 'java.exe' : 'java'

function checkExecutable(dir) {
  if (!dir || !existsSync(dir)) return null
  const candidates = [
    join(dir, 'bin', JAVA_EXE),
    join(dir, 'Contents', 'Home', 'bin', JAVA_EXE),
    join(dir, JAVA_EXE)
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      if (!IS_WIN) {
        try { chmodSync(p, 0o755) } catch { /* ignore */ }
      }
      return p
    }
  }
  return null
}

function probeJava(javaPath) {
  try {
    const res = spawnSync(javaPath, ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const out = (res.stderr || '') + (res.stdout || '')
    const verMatch = out.match(/(?:java|openjdk)\s+version\s+"([^"]+)"/i)
      || out.match(/version\s+"([^"]+)"/i)
      || out.match(/(\d+(?:\.\d+)*(?:_[0-9]+)?)/)
    const version = verMatch ? verMatch[1] : 'unknown'
    const is64 = /64-Bit/i.test(out)
    return { valid: true, version, raw: out.split('\n')[0]?.trim() || '', is64 }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

export function findJava({ customPath } = {}) {
  const attempts = []

  // 1. 사용자 지정 경로
  if (customPath) {
    const p = checkExecutable(customPath) || (existsSync(customPath) ? customPath : null)
    if (p) {
      const probe = probeJava(p)
      if (probe.valid) {
        return { path: p, isBundled: false, source: '사용자 지정', version: probe.version, detail: probe.raw }
      }
      attempts.push(`사용자 지정 (${customPath}): 실행 실패 (${probe.error})`)
    } else {
      attempts.push(`사용자 지정 (${customPath}): 파일을 찾을 수 없음`)
    }
  }

  // 2. 환경변수 PEPEZIP_JRE_DIR
  if (process.env.PEPEZIP_JRE_DIR) {
    const p = checkExecutable(process.env.PEPEZIP_JRE_DIR)
    if (p) {
      const probe = probeJava(p)
      if (probe.valid) {
        return { path: p, isBundled: true, source: 'PEPEZIP_JRE_DIR', version: probe.version, detail: probe.raw }
      }
    }
  }

  // 3. 앱 내장 JRE 번들 (resources/jre/<platform>-<arch> 또는 resources/jre)
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd()
  const root = app?.isPackaged ? process.resourcesPath : join(appPath, 'resources')
  const bundledCandidates = [
    join(root, 'jre', `${process.platform}-${process.arch}`),
    join(root, 'jre'),
    join(process.cwd(), 'resources', 'jre', `${process.platform}-${process.arch}`),
    join(process.cwd(), 'resources', 'jre')
  ]
  for (const c of bundledCandidates) {
    const p = checkExecutable(c)
    if (p) {
      const probe = probeJava(p)
      if (probe.valid) {
        return { path: p, isBundled: true, source: '앱 내장 JRE', version: probe.version, detail: probe.raw }
      }
      attempts.push(`내장 JRE (${p}): 유효하지 않음 (${probe.error})`)
    }
  }

  // 4. 환경변수 JAVA_HOME
  if (process.env.JAVA_HOME) {
    const p = checkExecutable(process.env.JAVA_HOME)
    if (p) {
      const probe = probeJava(p)
      if (probe.valid) {
        return { path: p, isBundled: false, source: 'JAVA_HOME', version: probe.version, detail: probe.raw }
      }
    }
  }

  // 5. macOS 전용 java_home 검색
  if (IS_MAC) {
    try {
      const r = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' })
      if (r.status === 0 && r.stdout) {
        const jh = r.stdout.trim()
        const p = checkExecutable(jh)
        if (p) {
          const probe = probeJava(p)
          if (probe.valid) {
            return { path: p, isBundled: false, source: 'macOS java_home', version: probe.version, detail: probe.raw }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 6. 시스템 기본 PATH (/usr/bin/java, where java 등)
  const defaultSys = IS_WIN ? 'java.exe' : '/usr/bin/java'
  if (existsSync(defaultSys) || IS_WIN) {
    const probe = probeJava(defaultSys)
    if (probe.valid) {
      return { path: defaultSys, isBundled: false, source: '시스템 기본 (PATH)', version: probe.version, detail: probe.raw }
    }
  }

  throw new Error(`Java 런타임(JRE)을 찾을 수 없습니다.\n검색 시도:\n${attempts.join('\n') || '- 번들 JRE 및 시스템 Java 없음'}`)
}
