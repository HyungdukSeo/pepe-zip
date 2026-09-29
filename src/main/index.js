import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, nativeImage } from 'electron'
import { join, resolve, dirname, basename } from 'node:path'
import { existsSync, statSync, mkdirSync, rmSync, appendFileSync } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import * as sz from './sevenzip.js'
import { TaskManager } from './tasks.js'
import { defaultOutput } from './jobs.js'
import { getSettings, setSettings, addRecent } from './settings.js'
import { shellIntegration } from './shellIntegration.js'
import { launchJnlpSession, stopJnlp, openJnlpCacheDir, activateJnlp } from './jnlp/jnlpRunner.js'
import { findJava } from './jnlp/jreFinder.js'

const IS_MAC = process.platform === 'darwin'

// 진단: PEPEZIP_DEBUG=1 로 실행하면 userData/debug.log 에 메인·렌더러 로그를 남긴다
const DEBUG = !!process.env.PEPEZIP_DEBUG
function dlog(...a) {
  if (!DEBUG) return
  try {
    appendFileSync(join(app.getPath('userData'), 'debug.log'), `${new Date().toISOString()} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}
`)
  } catch { /* 무시 */ }
}
const TEMP_ROOT = join(os.tmpdir(), 'pepezip-open')

// ───────────────────────── 명령줄 ─────────────────────────
// 우클릭 메뉴는 "exe --플래그 파일" 형태로 실행한다. 탐색기에서 여러 개를 고르면 파일마다 프로세스가 하나씩 뜨므로
// 단일 인스턴스로 모은 뒤 잠깐 기다렸다가 한꺼번에 처리한다.
const FLAGS = {
  '--open': 'open',
  '--extract-smart': 'extract-smart',
  '--extract-here': 'extract-here',
  '--extract-folder': 'extract-folder',
  '--extract-to': 'extract-to',
  '--test': 'test',
  '--compress': 'compress',
  '--zip': 'zip',
  '--7z': '7z'
}

function parseArgs(argv, cwd) {
  let action = null
  const files = []
  const appPath = process.defaultApp ? resolve(app.getAppPath()) : null
  for (const a of argv.slice(1)) {
    if (FLAGS[a]) { action = FLAGS[a]; continue }
    if (a.startsWith('-')) continue // Chromium/Electron 스위치
    const p = resolve(cwd || process.cwd(), a)
    if (appPath && (p === appPath || a === '.')) continue // 개발 모드: electron <앱경로>
    if (existsSync(p)) files.push(p)
  }
  return { action: action || (files.length ? 'open' : null), files }
}

const gotLock = app.requestSingleInstanceLock({ cli: parseArgs(process.argv, process.cwd()) })
if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap() {
  const windows = new Map() // webContents.id → { win, mode, ready, queue }
  const tasks = new TaskManager((wcId, snap) => {
    const w = windows.get(wcId)
    if (w && !w.win.isDestroyed()) w.win.webContents.send('task', snap)
  })
  // 완료 후 결과 폴더 열기 (설정/대화상자 옵션)
  tasks.onDone = (t) => {
    const r = t.result
    if (!t.params.openFolder || !r?.openPath) return
    if (r.revealInFolder) shell.showItemInFolder(r.openPath)
    else shell.openPath(r.openPath)
  }

  // ── 창 ──
  function createWindow(mode = 'full', firstAction) {
    const mini = mode === 'mini'
    const jnlp = mode === 'jnlp'
    const win = new BrowserWindow({
      width: mini ? 520 : jnlp ? 680 : 1120,
      height: mini ? 300 : jnlp ? 560 : 720,
      minWidth: mini ? 420 : jnlp ? 540 : 760,
      minHeight: mini ? 200 : jnlp ? 420 : 480,
      show: false,
      title: jnlp ? 'PePe Zip - JNLP 런처' : 'PePe Zip',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
      autoHideMenuBar: true,
      icon: iconPath(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })
    const id = win.webContents.id
    const entry = { win, mode, ready: false, queue: firstAction ? [firstAction] : [], forceClose: false }
    windows.set(id, entry)
    win.once('ready-to-show', () => win.show())
    win.on('close', (e) => {
      if (entry.forceClose) return
      if (tasks.listFor(id).some((t) => t.status === 'running' || t.status === 'queued')) {
        e.preventDefault()
        win.webContents.send('confirm-close')
      }
    })
    win.on('closed', () => {
      if (mode === 'jnlp') stopJnlp(id)
      tasks.cancelWindow(id)
      windows.delete(id)
    })
    if (DEBUG) win.webContents.on('console-message', (e) => dlog(`[renderer:${mode}]`, e.message))
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools()
    })
    // 외부 링크/드롭된 파일로 창이 이동하지 않게
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const q = `?mode=${mode}`
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + q)
    else win.loadFile(join(__dirname, '../renderer/index.html'), { search: q })
    return entry
  }

  function sendAction(entry, action) {
    if (entry.ready) entry.win.webContents.send('action', action)
    else entry.queue.push(action)
    if (entry.win.isMinimized()) entry.win.restore()
    entry.win.focus()
  }

  const liveEntries = () => [...windows.values()].filter((w) => !w.win.isDestroyed())
  const getMini = () => liveEntries().find((w) => w.mode === 'mini') || createWindow('mini')

  function openJnlpWindow(file) {
    if (!file) return null
    // 이미 같은 JNLP 파일을 열고 있는 창이 있으면 활성화
    const existing = liveEntries().find((w) => w.mode === 'jnlp' && w.jnlpPath === file)
    if (existing) {
      if (existing.win.isMinimized()) existing.win.restore()
      existing.win.focus()
      return existing
    }
    // 대기 중인(파일이 지정되지 않은) JNLP 창이 있으면 재사용
    const idle = liveEntries().find((w) => w.mode === 'jnlp' && !w.jnlpPath)
    if (idle) {
      idle.jnlpPath = file
      sendAction(idle, { type: 'launch-jnlp', path: file })
      return idle
    }
    // 새 창 생성 (firstAction 으로 queue 에 1개만 넣고 중복 전송 방지)
    const entry = createWindow('jnlp', { type: 'launch-jnlp', path: file })
    entry.jnlpPath = file
    return entry
  }

  function openArchiveWindow(file) {
    if (file.toLowerCase().endsWith('.jnlp')) return openJnlpWindow(file)
    // 비어 있는(홈 화면) 전체 창이 있으면 재사용
    const idle = liveEntries().find((w) => w.mode === 'full' && !w.archive)
    const entry = idle || createWindow('full')
    entry.archive = file
    sendAction(entry, { type: 'open', path: file })
  }

  // ── 명령줄 처리 (묶어서) ──
  const pending = new Map()
  let flushTimer
  function queueCli(cli) {
    dlog('cli', cli)
    if (!cli?.action) {
      const full = liveEntries().find((w) => w.mode === 'full')
      if (full) {
        if (full.win.isMinimized()) full.win.restore()
        full.win.focus()
      } else createWindow('full')
      return
    }
    if (!pending.has(cli.action)) pending.set(cli.action, [])
    const list = pending.get(cli.action)
    for (const f of cli.files) if (!list.includes(f)) list.push(f)
    clearTimeout(flushTimer)
    flushTimer = setTimeout(flushCli, 350)
  }

  function flushCli() {
    const s = getSettings()
    for (const [action, files] of pending) {
      if (!files.length) continue
      const archives = files.length > 1 ? files.filter((f) => !isSecondaryVolume(basename(f))) : files
      switch (action) {
        case 'open':
          for (const f of archives) openArchiveWindow(f)
          break
        case 'extract-smart':
        case 'extract-here':
        case 'extract-folder': {
          const mode = { 'extract-smart': 'smart', 'extract-here': 'here', 'extract-folder': 'folder' }[action]
          const m = getMini()
          for (const a of archives)
            tasks.create(m.win.webContents.id, 'extract', { archive: a, dest: dirname(a), mode, overwrite: s.extract.overwrite, codepage: s.extract.codepage, openFolder: s.extract.openFolder })
          break
        }
        case 'test': {
          const m = getMini()
          for (const a of archives) tasks.create(m.win.webContents.id, 'test', { archive: a })
          break
        }
        case 'extract-to':
          sendAction(getMini(), { type: 'extract-dialog', archives })
          break
        case 'compress':
          sendAction(getMini(), { type: 'compress-dialog', files })
          break
        case 'zip':
        case '7z': {
          const m = getMini()
          tasks.create(m.win.webContents.id, 'compress', {
            sources: files,
            output: defaultOutput(files, action),
            format: action,
            level: s.compress.level,
            overwrite: 'rename',
            openFolder: false
          })
          break
        }
      }
    }
    pending.clear()
  }

  app.on('second-instance', (_e, argv, cwd, data) => queueCli(data?.cli || parseArgs(argv, cwd)))

  // macOS: Finder 에서 연결된 파일을 열거나 Dock 아이콘에 끌어다 놓을 때
  const earlyOpen = []
  app.on('open-file', (e, path) => {
    e.preventDefault()
    if (app.isReady()) queueCli({ action: 'open', files: [path] })
    else earlyOpen.push(path)
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = getSettings().theme
    if (IS_MAC) {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      )
    } else Menu.setApplicationMenu(null)

    mkdirSync(TEMP_ROOT, { recursive: true })
    registerIpc()
    const initial = parseArgs(process.argv, process.cwd())
    dlog('start', process.argv, initial)
    if (earlyOpen.length) {
      initial.files.push(...earlyOpen)
      initial.action ||= 'open'
    }
    if (initial.action) queueCli(initial)
    else createWindow('full')
  })

  app.on('activate', () => {
    if (!liveEntries().length) createWindow('full')
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    try { rmSync(TEMP_ROOT, { recursive: true, force: true }) } catch { /* 열려 있는 파일은 다음에 */ }
  })

  // ───────────────────────── IPC ─────────────────────────
  function registerIpc() {
    const entryOf = (e) => windows.get(e.sender.id)
    // 에러의 kind 를 렌더러까지 전달하려고 결과를 봉투에 싸서 돌려준다
    const handle = (ch, fn) =>
      ipcMain.handle(ch, async (e, ...args) => {
        try {
          return { ok: true, value: await fn(e, ...args) }
        } catch (err) {
          if (err.detail) console.error(`[${ch}]`, err.detail)
          return { ok: false, kind: err.kind || 'failed', message: err.message }
        }
      })

    handle('init', (e) => {
      const entry = entryOf(e)
      entry.ready = true
      const actions = entry.queue.splice(0)
      return {
        mode: entry.mode,
        platform: process.platform,
        version: app.getVersion(),
        sep: sz.ENTRY_SEP,
        home: os.homedir(),
        tempRoot: TEMP_ROOT,
        settings: getSettings(),
        tasks: tasks.listFor(e.sender.id),
        actions
      }
    })

    handle('list', async (e, archive, opts = {}) => {
      const r = await sz.list(archive, opts)
      const entry = entryOf(e)
      if (entry) entry.archive = archive
      addRecent(archive)
      return r
    })

    handle('task:start', (e, kind, params) => tasks.create(e.sender.id, kind, params))
    handle('task:retry', (_e, id, patch) => tasks.retry(id, patch))
    handle('task:cancel', (_e, id) => tasks.cancel(id))
    handle('task:dismiss', (_e, id) => tasks.dismiss(id))

    handle('dialog:openArchive', async (e) => {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '압축 파일 열기',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '압축 파일', extensions: ARCHIVE_EXTS }, { name: '모든 파일', extensions: ['*'] }]
      })
      return r.canceled ? [] : r.filePaths
    })
    handle('dialog:pick', async (e, { dirs = false, title } = {}) => {
      const props = [dirs ? 'openDirectory' : 'openFile', 'multiSelections']
      // macOS 는 파일과 폴더를 한 번에 고를 수 있다
      if (IS_MAC) props.push('openFile', 'openDirectory')
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title, properties: props })
      return r.canceled ? [] : r.filePaths
    })
    handle('dialog:chooseDir', async (e, defaultPath) => {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '폴더 선택',
        defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })
      return r.canceled ? null : r.filePaths[0]
    })
    handle('dialog:saveAs', async (e, defaultPath, format) => {
      const f = formatById(format)
      const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '압축 파일 저장 위치',
        defaultPath,
        filters: [{ name: f.label, extensions: [f.ext.slice(1).split('.').pop()] }]
      })
      return r.canceled ? null : r.filePath
    })

    handle('fs:stat', async (_e, paths) => Promise.all(paths.map(statSummary)))
    handle('fs:exists', (_e, p) => existsSync(p) || existsSync(`${p}.001`))
    handle('fs:defaultOutput', (_e, sources, format) => defaultOutput(sources, format))

    handle('shell:open', (_e, p) => shell.openPath(p))
    handle('shell:reveal', (_e, p) => shell.showItemInFolder(p))
    handle('shell:defaultApps', () => {
      if (process.platform === 'win32') return shell.openExternal('ms-settings:defaultapps')
    })

    // 압축 파일 안의 파일을 임시 폴더에 풀어 연결된 프로그램으로 연다
    handle('archive:openEntry', async (_e, { archive, path, password, codepage, sep }) => {
      const dir = join(TEMP_ROOT, createHash('md5').update(archive + statSync(archive).mtimeMs).digest('hex').slice(0, 12))
      const target = join(dir, ...path.split(sep))
      if (!existsSync(target)) {
        mkdirSync(dir, { recursive: true })
        await sz.extract(archive, dir, { files: [path], password, codepage })
      }
      const err = await shell.openPath(target)
      if (err) throw new Error(err)
      return target
    })
    handle('archive:delete', (_e, { archive, paths, password }) => sz.deleteEntries(archive, paths, { password }))
    handle('archive:rename', (_e, { archive, pairs, password }) => sz.renameEntries(archive, pairs, { password }))

    // 드래그 아웃: 선택 항목을 임시 폴더에 동기로 풀고 OS 드래그를 시작한다
    ipcMain.on('drag-out', (e, { archive, files, tops, stripPrefix, password, codepage, sep }) => {
      try {
        const dir = join(TEMP_ROOT, `drag-${Date.now().toString(36)}`)
        mkdirSync(dir, { recursive: true })
        sz.extractSync(archive, dir, { files, password, codepage })
        const base = stripPrefix ? join(dir, ...stripPrefix.split(sep)) : dir
        const out = tops.map((n) => join(base, n)).filter((p) => existsSync(p))
        if (!out.length) return
        e.sender.startDrag({ files: out, file: out[0], icon: dragIcon() })
      } catch (err) {
        e.sender.send('toast', { kind: 'error', text: `끌어내기 실패: ${err.message}` })
      }
    })

    handle('settings:get', () => getSettings())
    handle('settings:set', (_e, patch) => {
      const s = setSettings(patch)
      if (patch.theme) nativeTheme.themeSource = s.theme
      return s
    })

    handle('shell:status', () => shellIntegration.status())
    handle('shell:install', (_e, o) => shellIntegration.install(o))
    handle('shell:uninstall', (_e, o) => shellIntegration.uninstall(o))

    handle('window:fit', (e, h) => {
      const entry = entryOf(e)
      if (entry?.mode !== 'mini') return
      const [w] = entry.win.getContentSize()
      entry.win.setContentSize(w, Math.max(160, Math.min(760, Math.round(h))))
    })
    handle('window:setArchive', (e, p) => {
      const entry = entryOf(e)
      if (entry) entry.archive = p || null
    })
    handle('window:close', (e, force) => {
      const entry = entryOf(e)
      if (!entry) return
      if (force) entry.forceClose = true
      entry.win.close()
    })
    handle('window:newFull', () => void createWindow('full'))

    // JNLP
    handle('jnlp:launch', (e, path) => {
      const caller = entryOf(e)
      if (caller?.mode === 'jnlp') {
        dlog('jnlp:launch ignored from jnlp window itself', path)
        return false
      }
      openJnlpWindow(path)
      return true
    })
    handle('jnlp:start', (e, path) => {
      const wcId = e.sender.id
      const sendEvent = (event) => {
        if (!e.sender.isDestroyed()) {
          e.sender.send('jnlp:event', event)
        }
      }
      const s = getSettings()
      return launchJnlpSession(path, wcId, sendEvent, { customJavaPath: s.jnlp?.customJavaPath })
    })
    handle('jnlp:stop', (e) => {
      return stopJnlp(e.sender.id)
    })
    handle('jnlp:activate', (e) => {
      return activateJnlp(e.sender.id)
    })
    handle('jnlp:openCache', (e) => {
      return openJnlpCacheDir(e.sender.id)
    })
    handle('jnlp:getJreInfo', () => {
      try {
        const s = getSettings()
        return { ok: true, jre: findJava({ customPath: s.jnlp?.customJavaPath }) }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })
  }
}

async function statSummary(p) {
  try {
    const st = await stat(p)
    if (!st.isDirectory()) return { path: p, name: basename(p), isDir: false, size: st.size, count: 1 }
    // 폴더 크기는 최대 2만 개까지만 센다 (거대한 폴더에서 대화상자가 멈추지 않게)
    let size = 0
    let count = 0
    const stack = [p]
    while (stack.length && count < 20000) {
      const d = stack.pop()
      let ents
      try { ents = await readdir(d, { withFileTypes: true }) } catch { continue }
      for (const ent of ents) {
        const full = join(d, ent.name)
        if (ent.isDirectory()) stack.push(full)
        else {
          count++
          try { size += (await stat(full)).size } catch { /* 권한 없음 */ }
        }
      }
    }
    return { path: p, name: basename(p), isDir: true, size, count, partial: stack.length > 0 }
  } catch {
    return { path: p, name: basename(p), missing: true, size: 0, count: 0 }
  }
}

function iconPath() {
  const p = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(p) ? p : undefined
}

let _dragIcon
function dragIcon() {
  if (_dragIcon) return _dragIcon
  const p = iconPath()
  _dragIcon = p ? nativeImage.createFromPath(p).resize({ width: 48, height: 48 }) : nativeImage.createEmpty()
  return _dragIcon
}
