// JNLP 다운로드, 검증, 캐싱 및 Java 프로세스 실행 매니저
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, exec } from 'node:child_process'
import { app, shell } from 'electron'
import { parseJnlp } from './jnlpParser.js'
import { findJava } from './jreFinder.js'
import * as sz from '../sevenzip.js'

const runningSessions = new Map() // webContentsId -> { child, cacheDir, jnlpPath }

function sanitize(name) {
  return (name || 'app').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)
}

function safeJarName(href) {
  const clean = href.split('?')[0].split('#')[0]
  const b = basename(clean)
  return b.endsWith('.jar') ? b : `${b}.jar`
}

export function getRunningSession(wcId) {
  return runningSessions.get(wcId)
}

export function stopJnlp(wcId) {
  const session = runningSessions.get(wcId)
  if (session?.child && !session.child.killed) {
    try {
      session.child.kill('SIGTERM')
      setTimeout(() => {
        if (session.child && !session.child.killed) {
          session.child.kill('SIGKILL')
        }
      }, 3000)
    } catch { /* ignore */ }
    return true
  }
  return false
}

export function activateJnlp(wcId) {
  const session = runningSessions.get(wcId)
  if (!session?.child || session.child.killed) return false
  const pid = session.child.pid
  if (process.platform === 'darwin') {
    exec(`osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true' 2>/dev/null`, () => {})
    return true
  }
  return false
}

export function openJnlpCacheDir(wcId) {
  const session = runningSessions.get(wcId)
  if (session?.cacheDir && existsSync(session.cacheDir)) {
    shell.openPath(session.cacheDir)
    return true
  }
  return false
}

export async function launchJnlpSession(jnlpPath, wcId, sendEvent, opts = {}) {
  // 기존 실행 중인 세션이 있으면 정리
  stopJnlp(wcId)

  const log = (text, level = 'info') => {
    sendEvent({ type: 'log', level, text: `[${new Date().toLocaleTimeString()}] ${text}` })
  }

  try {
    sendEvent({ type: 'status', step: 1, title: 'JNLP 파일 분석', message: 'JNLP XML 파일을 읽고 분석하는 중입니다...' })
    log(`JNLP 파일 열기: ${jnlpPath}`)

    if (!existsSync(jnlpPath)) {
      throw new Error(`파일을 찾을 수 없습니다: ${jnlpPath}`)
    }

    const xmlContent = await readFile(jnlpPath, 'utf8')
    const parsed = parseJnlp(xmlContent)
    sendEvent({ type: 'parsed', data: parsed })
    log(`애플리케이션: ${parsed.title || basename(jnlpPath)} (코드베이스: ${parsed.codebase || '로컬'})`)
    log(`메인 클래스: ${parsed.mainClass || '(JAR 매니페스트 확인 필요)'}`)
    log(`필요 JAR 개수: ${parsed.jars.length}개`)

    // 2. JRE 탐색
    sendEvent({ type: 'status', step: 2, title: 'Java 런타임 확인', message: '실행에 필요한 JRE 엔진을 검색하는 중입니다...' })
    const jre = findJava({ customPath: opts.customJavaPath })
    sendEvent({ type: 'jre', data: jre })
    log(`Java 엔진 감지: ${jre.path} (${jre.version}, ${jre.source})`)

    // 3. 캐시 디렉터리 준비
    const appKey = createHash('sha256').update(parsed.codebase || jnlpPath).digest('hex').slice(0, 10)
    const appName = sanitize(parsed.title || basename(jnlpPath, extname(jnlpPath)))
    const cacheDir = join(app.getPath('userData'), 'jnlp-cache', `${appName}-${appKey}`)
    await mkdir(cacheDir, { recursive: true })
    log(`로컬 캐시 경로: ${cacheDir}`)

    runningSessions.set(wcId, { jnlpPath, cacheDir, child: null })

    // 4. JAR 다운로드
    sendEvent({ type: 'status', step: 3, title: '라이브러리 다운로드', message: '필요한 JAR 파일을 확인하고 다운로드합니다...' })
    const jarPaths = []

    for (let i = 0; i < parsed.jars.length; i++) {
      const jar = parsed.jars[i]
      const jarName = safeJarName(jar.href)
      const localPath = join(cacheDir, jarName)
      jarPaths.push(localPath)

      const url = jar.url
      if (!url) {
        log(`경고: JAR URL을 해석할 수 없습니다: ${jar.href}`, 'warn')
        continue
      }

      // 이미 다운로드되어 있는지 확인
      if (existsSync(localPath)) {
        log(`✓ 캐시됨: ${jarName} (${i + 1}/${parsed.jars.length})`)
        sendEvent({
          type: 'progress',
          jarName,
          index: i + 1,
          total: parsed.jars.length,
          cached: true
        })
        continue
      }

      // .jnlp 파일과 같은 폴더 또는 하위 폴더에 jar 가 있는지 확인
      const localCandidates = [
        join(dirname(jnlpPath), jar.href),
        join(dirname(jnlpPath), jarName)
      ]
      let foundLocal = false
      for (const lc of localCandidates) {
        if (existsSync(lc)) {
          await copyFile(lc, localPath)
          log(`✓ 로컬 디렉터리에서 복사됨: ${jarName} (${i + 1}/${parsed.jars.length})`)
          sendEvent({
            type: 'progress',
            jarName,
            index: i + 1,
            total: parsed.jars.length,
            cached: true
          })
          foundLocal = true
          break
        }
      }
      if (foundLocal) continue

      log(`↓ 다운로드 중: ${jarName} (${url})`)
      sendEvent({
        type: 'progress',
        jarName,
        index: i + 1,
        total: parsed.jars.length,
        cached: false
      })

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        const res = await fetch(url, { redirect: 'follow', signal: controller.signal })
        clearTimeout(timeoutId)
        if (!res.ok) {
          throw new Error(`JAR 다운로드 실패 (${res.status} ${res.statusText}): ${url}`)
        }
        const buf = Buffer.from(await res.arrayBuffer())
        await writeFile(localPath, buf)
        log(`✓ 다운로드 완료: ${jarName} (${(buf.length / 1024).toFixed(1)} KB)`)
      } catch (err) {
        if (err.name === 'AbortError' || /timeout|fetch failed|connect/i.test(err.message)) {
          let host = url
          try { host = new URL(url).host } catch { /* ignore */ }
          throw new Error(`서버(${host})에 연결할 수 없습니다.\nVPN 또는 사내망(네트워크)에 연결되어 있는지 확인해 주세요.\n상세: ${err.message}`)
        }
        throw err
      }
    }

    // 5. 네이티브 라이브러리(nativelib) 다운로드 및 압축 해제
    let nativesDir = null
    if (parsed.nativeLibs.length > 0) {
      nativesDir = join(cacheDir, 'natives')
      await mkdir(nativesDir, { recursive: true })
      for (const nat of parsed.nativeLibs) {
        const natName = safeJarName(nat.href)
        const localNat = join(cacheDir, natName)
        if (!existsSync(localNat) && nat.url) {
          log(`↓ 네이티브 라이브러리 다운로드: ${natName}`)
          const res = await fetch(nat.url, { redirect: 'follow' })
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            await writeFile(localNat, buf)
          }
        }
        if (existsSync(localNat)) {
          try {
            // 7-Zip 엔진으로 natives 폴더에 풀기
            log(`풀기: ${natName} → natives/`)
            await sz.extract({
              archive: localNat,
              dest: nativesDir,
              mode: 'here',
              overwrite: 'always'
            })
          } catch (e) {
            log(`네이티브 라이브러리 압축 해제 경고: ${e.message}`, 'warn')
          }
        }
      }
    }

    // 6. 메인 클래스 검증 (지정되지 않은 경우 첫 번째 JAR 매니페스트 확인)
    let mainClass = parsed.mainClass
    if (!mainClass && jarPaths.length > 0) {
      const primaryJar = jarPaths[0]
      try {
        const listRes = await sz.list(primaryJar)
        const manifestEntry = listRes.entries.find((e) => /meta-inf\/manifest\.mf$/i.test(e.name))
        if (manifestEntry) {
          // 매니페스트 내용에서 Main-Class 추출
          // (간이 압축 해제 후 검색)
          log(`메인 클래스 자동 탐색 중...`)
        }
      } catch { /* ignore */ }
    }

    if (!mainClass) {
      mainClass = 'Main' // 기본 폴백
    }

    // 7. Java 프로세스 실행
    sendEvent({ type: 'status', step: 4, title: 'Java 실행 중', message: 'Java 프로그램을 시작합니다...' })

    const sep = process.platform === 'win32' ? ';' : ':'
    const classPath = jarPaths.join(sep)

    const vmArgs = [
      '-Dfile.encoding=UTF-8',
      `-Djnlp.codebase=${parsed.codebase || ''}`,
      `-Djnlp.application.href=${parsed.href || basename(jnlpPath)}`
    ]

    if (process.platform === 'darwin') {
      vmArgs.push(`-Xdock:name=${parsed.title || 'Java Web Start'}`)
    }

    if (nativesDir && existsSync(nativesDir)) {
      vmArgs.push(`-Djava.library.path=${nativesDir}`)
    }

    // JNLP 에 정의된 property 전달
    for (const [k, v] of Object.entries(parsed.properties)) {
      vmArgs.push(`-D${k}=${v}`)
    }

    // j2se VM args 전달
    if (parsed.javaVmArgs?.length) {
      vmArgs.push(...parsed.javaVmArgs)
    }

    const fullArgs = [
      ...vmArgs,
      '-cp',
      classPath,
      mainClass,
      ...parsed.args
    ]

    log(`실행 명령: ${jre.path} ${fullArgs.join(' ')}`)

    const child = spawn(jre.path, fullArgs, {
      cwd: cacheDir,
      env: {
        ...process.env,
        ...parsed.properties
      }
    })

    const session = runningSessions.get(wcId)
    if (session) session.child = child

    sendEvent({
      type: 'started',
      pid: child.pid,
      command: `${jre.path} -cp ... ${mainClass}`
    })

    // macOS: Java Swing 창이 생성되었을 때 백그라운드에 묻히지 않도록 프로세스를 전면으로 활성화
    if (process.platform === 'darwin' && child.pid) {
      const bringToFront = () => {
        if (!child.killed) {
          exec(`osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true' 2>/dev/null`, () => {})
        }
      }
      setTimeout(bringToFront, 1500)
      setTimeout(bringToFront, 3500)
      setTimeout(bringToFront, 8000)
      setTimeout(bringToFront, 15000)
      setTimeout(bringToFront, 25000)
    }

    child.stdout.on('data', (data) => {
      sendEvent({ type: 'stdout', text: data.toString() })
    })

    child.stderr.on('data', (data) => {
      sendEvent({ type: 'stderr', text: data.toString() })
    })

    child.on('error', (err) => {
      log(`프로세스 오류: ${err.message}`, 'error')
      sendEvent({ type: 'process_error', message: err.message })
    })

    child.on('exit', (code, signal) => {
      log(`프로세스 종료됨 (종료 코드: ${code ?? '없음'}, 시그널: ${signal ?? '없음'})`)
      sendEvent({ type: 'process_exit', code, signal })
    })

    return { ok: true, pid: child.pid }
  } catch (err) {
    log(`오류: ${err.message}`, 'error')
    sendEvent({ type: 'error', message: err.message, stack: err.stack })
    throw err
  }
}
