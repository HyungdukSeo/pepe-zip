import { useCallback, useEffect, useRef, useState } from 'react'
import { ToastProvider, PromptProvider, usePrompt, useToast, Modal } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import HomeView from './components/HomeView.jsx'
import ArchiveView from './components/ArchiveView.jsx'
import CompressDialog from './components/CompressDialog.jsx'
import ExtractDialog from './components/ExtractDialog.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import TaskList from './components/TaskList.jsx'
import { isArchiveName, CODEPAGES } from '@shared/formats.js'
import { basename, dirname, setPlatform, buildTree, collectPaths, anyEncrypted, fmtSize, fmtCount } from './lib/util.js'

const pz = window.pz
const DRAG_LIMIT = 512 * 1024 * 1024 // 끌어내기는 동기로 풀기 때문에 큰 항목은 "풀기"로 안내

export default function Root() {
  return (
    <ToastProvider>
      <PromptProvider>
        <App />
      </PromptProvider>
    </ToastProvider>
  )
}

function App() {
  const prompt = usePrompt()
  const toast = useToast()
  const [boot, setBoot] = useState(null)
  const [settings, setSettings] = useState(null)
  const [tasks, setTasks] = useState([])
  const [dialog, setDialog] = useState(null)
  const [archive, setArchive] = useState(null)
  const [loading, setLoading] = useState(null)
  const [cwdKey, setCwdKey] = useState('')
  const [selection, setSelection] = useState(() => new Set())
  const [dragOver, setDragOver] = useState(false)
  const [taskPanelOpen, setTaskPanelOpen] = useState(true)
  const [integrationHint, setIntegrationHint] = useState(null)

  const mini = boot?.mode === 'mini'
  const S = useRef({})
  S.current = { settings, archive, cwdKey, boot, tasks }

  // ───── 압축 파일 열기/새로고침 ─────
  const openArchive = useCallback(
    async (path, { password, keepCwd = false, codepage, headerEncrypted = false } = {}) => {
      setLoading(path)
      const cp = codepage ?? S.current.archive?.codepage ?? S.current.settings?.extract.codepage ?? ''
      try {
        const r = await pz.list(path, { password, codepage: cp })
        const tree = buildTree(r.entries, r.sep)
        setArchive({ path, info: r.info, tree, sep: r.sep, editable: r.editable, encrypted: r.encrypted, compound: r.compound, password, headerEncrypted, codepage: cp })
        if (!keepCwd || !tree.byKey.has(S.current.cwdKey)) setCwdKey('')
        setSelection(new Set())
        document.title = `${basename(path)} - PePe Zip`
        setSettings((s) => ({ ...s, recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 12) }))
      } catch (e) {
        if (e.kind === 'password') {
          const pw = await prompt.password({ name: basename(path), wrong: !!password })
          if (pw) return openArchive(path, { password: pw, keepCwd, codepage: cp, headerEncrypted: true })
        } else toast('error', `${basename(path)}: ${e.message}`)
      } finally {
        setLoading((l) => (l === path ? null : l))
      }
    },
    [prompt, toast]
  )
  const reload = () => {
    const a = S.current.archive
    if (a) openArchive(a.path, { password: a.password, keepCwd: true, headerEncrypted: a.headerEncrypted })
  }
  const closeArchive = () => {
    setArchive(null)
    setCwdKey('')
    setSelection(new Set())
    document.title = 'PePe Zip'
    pz.setWindowArchive(null)
  }

  // ───── 메인에서 온 동작 (우클릭 메뉴, 파일 연결 등) ─────
  const handleAction = (a) => {
    if (a.type === 'open') openArchive(a.path)
    else if (a.type === 'compress-dialog') setDialog({ type: 'compress', files: a.files })
    else if (a.type === 'extract-dialog') setDialog({ type: 'extract', archives: a.archives })
  }
  const actionRef = useRef(handleAction)
  actionRef.current = handleAction

  useEffect(() => {
    const offs = [
      pz.onTask((t) =>
        setTasks((list) => {
          const i = list.findIndex((x) => x.id === t.id)
          if (i < 0) return [...list, t]
          const next = list.slice()
          next[i] = t
          return next
        })
      ),
      pz.onAction((a) => actionRef.current(a)),
      pz.onToast((t) => toast(t.kind, t.text)),
      pz.onConfirmClose(async () => {
        const ok = await prompt.confirm({ title: '작업 진행 중', message: '진행 중인 작업을 취소하고 창을 닫을까요?', okText: '취소하고 닫기', cancelText: '계속 진행', danger: true })
        if (ok) pz.closeWindow(true)
      })
    ]
    pz.init().then((b) => {
      setPlatform(b.platform)
      setBoot(b)
      setSettings(b.settings)
      setTasks(b.tasks)
      // 첫 렌더 전에 처리하므로 ref 에도 바로 넣어 둔다
      S.current = { ...S.current, settings: b.settings, boot: b, tasks: b.tasks }
      b.actions.forEach((a) => actionRef.current(a))
      if (b.mode === 'full' && !b.settings.integrationPrompted) {
        pz.integrationStatus().then((st) => {
          if (!st.contextMenu)
            setIntegrationHint(
              b.platform === 'darwin' ? 'Finder 빠른 동작에 PePe Zip 을 추가할까요?' : '파일 관리자 우클릭 메뉴에 PePe Zip(풀기·압축)을 등록할까요?'
            )
        })
      }
    })
    return () => offs.forEach((off) => off())
  }, [])

  // 테마
  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

  // ───── 작업: 암호 요청 / 완료 후 처리 ─────
  const handled = useRef(new Set())
  const pendingPw = useRef({})
  const askTaskPassword = useCallback(
    async (t) => {
      const pw = await prompt.password({ name: t.title, wrong: t.params.hasPassword })
      if (pw) {
        pendingPw.current[t.id] = pw
        pz.retryTask(t.id, { password: pw })
      } else pz.cancelTask(t.id)
    },
    [prompt]
  )
  useEffect(() => {
    for (const t of tasks) {
      const key = `${t.id}:${t.startedAt}:${t.status}`
      if (handled.current.has(key)) continue
      if (t.status === 'error' && t.errorKind === 'password') {
        handled.current.add(key)
        askTaskPassword(t)
      } else if (t.status === 'done') {
        handled.current.add(key)
        const a = S.current.archive
        const pw = pendingPw.current[t.id]
        if (a && t.params.archive === a.path) {
          if (pw) setArchive((x) => (x ? { ...x, password: pw } : x))
          if (t.kind === 'add') reload()
        }
        if (!mini && t.kind === 'test') toast('success', `${t.title}: ${t.message}`)
      } else if (t.status === 'error' && !mini) {
        handled.current.add(key)
        toast('error', `${t.title}: ${t.error}`)
      }
    }
  }, [tasks])

  // ───── 진행 창(mini): 크기 맞추기, 끝나면 닫기 ─────
  const miniRef = useRef()
  useEffect(() => {
    if (!mini) return
    // 내용 높이와, 떠 있는 프롬프트(암호 입력 등) 높이 중 큰 쪽에 창을 맞춘다
    let last = 0
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const modal = document.querySelector('.overlay .modal')
        const h = Math.max(miniRef.current?.scrollHeight || 0, modal ? modal.scrollHeight + 48 : 0)
        if (h && h !== last) {
          last = h
          pz.fitWindow(h)
        }
      })
    }
    const ro = new ResizeObserver(fit)
    if (miniRef.current) ro.observe(miniRef.current)
    const mo = new MutationObserver(() => {
      const m = document.querySelector('.overlay .modal')
      if (m) ro.observe(m)
      fit()
    })
    mo.observe(document.body, { childList: true, subtree: true })
    fit()
    return () => {
      ro.disconnect()
      mo.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [mini, !!dialog])
  useEffect(() => {
    if (!mini || dialog || !settings) return
    const active = tasks.some((t) => t.status === 'running' || t.status === 'queued')
    const failed = tasks.some((t) => t.status === 'error')
    if (active || failed) return
    const allDone = tasks.every((t) => t.status === 'done')
    if (tasks.length && allDone && !settings.autoCloseProgress) return
    const timer = setTimeout(() => pz.closeWindow(), tasks.length ? 1200 : 400)
    return () => clearTimeout(timer)
  }, [mini, dialog, tasks, settings])

  // ───── 탐색기 동작 ─────
  const needPassword = async (a, nodes) => {
    if (a.password || !anyEncrypted(nodes)) return a.password
    const pw = await prompt.password({ name: basename(a.path) })
    if (pw) setArchive((x) => ({ ...x, password: pw }))
    return pw
  }

  const actions = {
    openNode: async (n, retryPw) => {
      const a = archive
      const password = retryPw ?? (await needPassword(a, [n]))
      if (n.encrypted && !password) return
      if (n.size > 50 * 1024 * 1024) toast('info', `${n.name} 여는 중… (${fmtSize(n.size)})`)
      try {
        await pz.openEntry({ archive: a.path, path: n.path, password, codepage: a.codepage, sep: a.sep })
      } catch (e) {
        if (e.kind === 'password') {
          const pw = await prompt.password({ name: basename(a.path), wrong: true })
          if (pw) {
            setArchive((x) => ({ ...x, password: pw }))
            return actions.openNode(n, pw)
          }
        } else toast('error', `${n.name}: ${e.message}`)
      }
    },
    extractNodes: async (nodes, cwd, quick) => {
      const a = archive
      const selectionInfo = { files: collectPaths(nodes), stripPrefix: cwd.key ? cwd.path : undefined, count: nodes.length }
      if (!quick) return setDialog({ type: 'extract', archives: [a.path], selection: selectionInfo, knownPassword: a.password })
      await pz.startTask('extract', {
        archive: a.path,
        dest: dirname(a.path),
        mode: 'here',
        ...selectionInfo,
        password: a.password,
        codepage: a.codepage,
        overwrite: settings.extract.overwrite,
        openFolder: settings.extract.openFolder
      })
    },
    deleteNodes: async (nodes) => {
      const a = archive
      if (!a.editable || !nodes.length) return
      const ok = await prompt.confirm({
        title: '압축 파일에서 삭제',
        message: nodes.length === 1 ? `'${nodes[0].name}' 을(를) 압축 파일에서 삭제할까요? 되돌릴 수 없습니다.` : `${fmtCount(nodes.length)}개 항목을 압축 파일에서 삭제할까요? 되돌릴 수 없습니다.`,
        okText: '삭제',
        danger: true
      })
      if (!ok) return
      try {
        await pz.deleteEntries({ archive: a.path, paths: collectPaths(nodes), password: a.password })
        toast('success', '삭제했습니다')
        reload()
      } catch (e) {
        toast('error', e.message)
      }
    },
    renameNode: async (n) => {
      const a = archive
      if (!a.editable) return
      const siblings = new Set([...n.parent.children.keys()])
      const name = await prompt.text({
        title: '이름 바꾸기',
        value: n.name,
        okText: '바꾸기',
        validate: (v) => (/[\\/:*?"<>|]/.test(v) ? '다음 문자는 쓸 수 없습니다: \\ / : * ? " < > |' : v !== n.name && siblings.has(v) ? '같은 이름이 이미 있습니다' : null)
      })
      if (!name || name === n.name) return
      const newPath = n.parent.key ? `${n.parent.path}${a.sep}${name}` : name
      const pairs = collectPaths([n]).map((p) => [p, newPath + p.slice(n.path.length)])
      try {
        await pz.renameEntries({ archive: a.path, pairs, password: a.password })
        reload()
      } catch (e) {
        toast('error', e.message)
      }
    },
    dragOut: (nodes, cwd) => {
      const a = archive
      if (a.compound) return toast('info', 'TAR.GZ 계열은 끌어내기 대신 "풀기"를 사용하세요')
      if (anyEncrypted(nodes) && !a.password) return toast('info', '암호가 걸린 항목입니다. 먼저 파일을 열거나 풀어서 암호를 입력하세요')
      const size = nodes.reduce((s, n) => s + n.size, 0)
      if (size > DRAG_LIMIT) return toast('info', `큰 항목(${fmtSize(size)})은 끌어내기 대신 "풀기"를 사용하세요`)
      pz.dragOut({ archive: a.path, files: collectPaths(nodes), tops: nodes.map((n) => n.name), stripPrefix: cwd.key ? cwd.path : '', password: a.password, codepage: a.codepage, sep: a.sep })
    }
  }

  const addToArchive = async (paths) => {
    const a = archive
    if (!a.editable) return toast('info', `${a.info.Type || '이'} 형식은 파일을 추가할 수 없습니다 (7Z·ZIP·TAR 만 편집 가능)`)
    const cwd = a.tree.byKey.get(cwdKey) || a.tree.root
    let password = a.password
    if (a.encrypted && !password) {
      password = await prompt.password({ title: '암호 입력', name: basename(a.path) })
      if (!password) return
      setArchive((x) => ({ ...x, password }))
    }
    const where = cwd.key ? `'${cwd.name}' 폴더` : '최상위'
    const ok = await prompt.confirm({ title: '압축 파일에 추가', message: `${fmtCount(paths.length)}개 항목을 ${basename(a.path)} 의 ${where}에 추가할까요?${password ? ' (같은 암호로 암호화됩니다)' : ''}`, okText: '추가' })
    if (!ok) return
    pz.startTask('add', { archive: a.path, sources: paths, inside: cwd.key ? cwd.path : '', password, encryptNames: a.headerEncrypted })
  }

  // ───── 창 전체 드롭 ─────
  const onDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    if (mini) return
    const paths = [...e.dataTransfer.files].map((f) => pz.pathForFile(f)).filter((p) => p && !p.startsWith(boot.tempRoot))
    if (!paths.length) return
    const oneArchive = paths.length === 1 && isArchiveName(basename(paths[0]))
    if (archive) {
      if (oneArchive) {
        const pick = await prompt.choose({
          title: basename(paths[0]),
          message: '끌어 놓은 압축 파일을 어떻게 할까요?',
          options: [{ value: 'add', label: '현재 압축 파일에 추가' }, { value: 'open', label: '열기' }]
        })
        if (pick === 'open') return openArchive(paths[0])
        if (pick !== 'add') return
      }
      return addToArchive(paths)
    }
    if (oneArchive) openArchive(paths[0])
    else setDialog({ type: 'compress', files: paths })
  }

  // ───── 단축키 ─────
  useEffect(() => {
    if (mini) return
    const h = (e) => {
      if (!(e.ctrlKey || e.metaKey) || dialog) return
      const k = e.key.toLowerCase()
      if (k === 'o') { e.preventDefault(); openDialog() }
      else if (k === 'n' && !e.shiftKey) { e.preventDefault(); setDialog({ type: 'compress', files: [] }) }
      else if (k === 'e' && archive) { e.preventDefault(); setDialog({ type: 'extract', archives: [archive.path], knownPassword: archive.password }) }
      else if (k === 'w' && archive) { e.preventDefault(); closeArchive() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const openDialog = async () => {
    const files = await pz.openArchiveDialog()
    if (files[0]) openArchive(files[0])
    // 여러 개 고르면 나머지는 새 창에서 연다 — 메인이 --open 으로 처리
    if (files.length > 1) toast('info', '첫 번째 파일만 열었습니다')
  }

  const closeDialog = (submitted) => {
    setDialog(null)
    if (mini && !submitted && !S.current.tasks.length) pz.closeWindow()
  }

  if (!boot || !settings) return <div className="boot" />

  // ───── 진행 창 ─────
  if (mini) {
    return (
      <div className="mini" ref={miniRef}>
        {dialog?.type === 'compress' && <CompressDialog inline initialFiles={dialog.files} settings={settings} onClose={closeDialog} />}
        {dialog?.type === 'extract' && <ExtractDialog inline archives={dialog.archives} home={boot.home} settings={settings} onClose={closeDialog} />}
        {!dialog && (
          <>
            <div className="mini-head">
              <Icon name="archive" size={16} />
              <span>PePe Zip</span>
              <span className="muted">· 작업 {tasks.length}개</span>
            </div>
            <TaskList tasks={tasks} onPassword={askTaskPassword} />
          </>
        )}
      </div>
    )
  }

  const hasArchive = !!archive
  const cwdNode = archive ? archive.tree.byKey.get(cwdKey) || archive.tree.root : null
  const selNodes = archive ? [...selection].map((k) => archive.tree.byKey.get(k)).filter(Boolean) : []
  const isZip = archive && /zip/i.test(archive.info.Type || '')
  const visibleTasks = tasks.filter((t) => t.status !== 'canceled')

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => !e.relatedTarget && setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="toolbar">
        <button className="tool" onClick={openDialog} title="압축 파일 열기 (Ctrl+O)">
          <Icon name="open" size={20} /> <span>열기</span>
        </button>
        <button className="tool" onClick={() => setDialog({ type: 'compress', files: [] })} title="새로 압축 (Ctrl+N)">
          <Icon name="compress" size={20} /> <span>압축</span>
        </button>
        <div className="tool-sep" />
        <button className="tool" disabled={!hasArchive} onClick={() => setDialog({ type: 'extract', archives: [archive.path], knownPassword: archive.password })} title="풀기 (Ctrl+E)">
          <Icon name="extract" size={20} /> <span>풀기</span>
        </button>
        <button
          className="tool"
          disabled={!hasArchive || !archive.editable}
          onClick={async () => {
            const files = await pz.pick({ title: '추가할 파일' })
            if (files.length) addToArchive(files)
          }}
          title={archive && !archive.editable ? '이 형식은 편집할 수 없습니다' : '파일 추가'}
        >
          <Icon name="add" size={20} /> <span>추가</span>
        </button>
        <button className="tool" disabled={!hasArchive || !archive.editable || !selNodes.length} onClick={() => actions.deleteNodes(selNodes)} title="선택 항목 삭제 (Del)">
          <Icon name="trash" size={20} /> <span>삭제</span>
        </button>
        <button className="tool" disabled={!hasArchive} onClick={() => pz.startTask('test', { archive: archive.path, password: archive.password })} title="압축 파일 검사">
          <Icon name="test" size={20} /> <span>검사</span>
        </button>
        <button className="tool" disabled={!hasArchive} onClick={() => setDialog({ type: 'info' })} title="압축 파일 정보">
          <Icon name="info" size={20} /> <span>정보</span>
        </button>
        <span className="spacer" />
        {isZip && (
          <select
            className="cp-select"
            title="ZIP 파일 이름 인코딩 — 이름이 깨져 보이면 바꿔 보세요"
            value={archive.codepage || ''}
            onChange={(e) => openArchive(archive.path, { password: archive.password, keepCwd: true, codepage: e.target.value })}
          >
            {CODEPAGES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        )}
        {hasArchive && (
          <button className="icon-btn" onClick={closeArchive} title="압축 파일 닫기 (Ctrl+W)">
            <Icon name="x" size={18} />
          </button>
        )}
        <button className="icon-btn" onClick={() => pz.newWindow()} title="새 창">
          <Icon name="window" size={18} />
        </button>
        <button className="icon-btn" onClick={() => setDialog({ type: 'settings' })} title="설정">
          <Icon name="settings" size={18} />
        </button>
      </header>

      <main className="content">
        {loading && (
          <div className="loading">
            <div className="spinner" /> {basename(loading)} 여는 중…
          </div>
        )}
        {!loading && !hasArchive && (
          <HomeView
            recent={settings.recent}
            onOpen={openDialog}
            onOpenPath={(p) => openArchive(p)}
            onCompress={() => setDialog({ type: 'compress', files: [] })}
            integrationHint={integrationHint}
            onSetupIntegration={async () => {
              try {
                await pz.integrationInstall({ contextMenu: true, associations: true })
                toast('success', boot.platform === 'win32' ? '등록했습니다. 탐색기에서 파일을 우클릭해 보세요 (Windows 11: 더 많은 옵션 표시)' : '등록했습니다')
              } catch (e) {
                toast('error', e.message)
              }
              setIntegrationHint(null)
              pz.setSettings({ integrationPrompted: true }).then(setSettings)
            }}
            onDismissHint={() => {
              setIntegrationHint(null)
              pz.setSettings({ integrationPrompted: true }).then(setSettings)
            }}
          />
        )}
        {!loading && hasArchive && (
          <ArchiveView archive={archive} cwdKey={cwdKey} setCwdKey={setCwdKey} selection={selection} setSelection={setSelection} actions={actions} />
        )}
      </main>

      {visibleTasks.length > 0 && (
        <section className={`task-dock ${taskPanelOpen ? '' : 'collapsed'}`}>
          <div className="task-dock-head">
            <button className="task-dock-toggle" onClick={() => setTaskPanelOpen(!taskPanelOpen)}>
              <Icon name="chevronDown" size={14} style={{ transform: taskPanelOpen ? undefined : 'rotate(180deg)' }} />
              <span>작업</span>
              <span className="muted">
                {visibleTasks.filter((t) => t.status === 'running').length
                  ? `${visibleTasks.filter((t) => t.status === 'running').length}개 진행 중`
                  : `${visibleTasks.length}개`}
              </span>
            </button>
            <span className="spacer" />
            {visibleTasks.some((t) => !['running', 'queued'].includes(t.status)) && (
              <button
                className="link-btn"
                onClick={() => {
                  for (const t of tasks) if (!['running', 'queued'].includes(t.status)) pz.dismissTask(t.id)
                  setTasks((l) => l.filter((t) => ['running', 'queued'].includes(t.status)))
                }}
              >
                완료된 항목 지우기
              </button>
            )}
          </div>
          {taskPanelOpen && <TaskList tasks={visibleTasks} onPassword={askTaskPassword} />}
        </section>
      )}

      {dragOver && (
        <div className="drop-overlay">
          <div>
            <Icon name={archive ? 'add' : 'compress'} size={36} />
            <p>{archive ? (archive.editable ? `${basename(archive.path)} 의 ${cwdNode.key ? `'${cwdNode.name}'` : '최상위'}에 추가` : '이 형식은 파일을 추가할 수 없습니다') : '놓으면 열거나 압축합니다'}</p>
          </div>
        </div>
      )}

      {dialog?.type === 'compress' && <CompressDialog initialFiles={dialog.files} settings={settings} onClose={closeDialog} />}
      {dialog?.type === 'extract' && (
        <ExtractDialog archives={dialog.archives} selection={dialog.selection} knownPassword={dialog.knownPassword} home={boot.home} settings={settings} onClose={closeDialog} />
      )}
      {dialog?.type === 'settings' && <SettingsDialog platform={boot.platform} settings={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
      {dialog?.type === 'info' && archive && <InfoDialog archive={archive} onClose={() => setDialog(null)} />}
    </div>
  )
}

function InfoDialog({ archive, onClose }) {
  const i = archive.info
  const r = archive.tree.root
  const phys = Number(i['Physical Size']) || 0
  const rows = [
    ['파일', archive.path],
    ['형식', i.Type],
    ['크기', phys ? `${fmtSize(phys)} (${fmtCount(phys)} 바이트)` : ''],
    ['원본 크기', fmtSize(r.size)],
    ['압축률', phys && r.size ? `${Math.max(0, Math.round((1 - phys / r.size) * 100))}% 절약` : ''],
    ['파일 / 폴더', `${fmtCount(r.files)}개 / ${fmtCount(r.dirs)}개`],
    ['압축 방식', i.Method],
    ['솔리드', i.Solid === '+' ? '예' : i.Solid === '-' ? '아니요' : ''],
    ['블록', i.Blocks],
    ['암호', archive.encrypted ? (archive.headerEncrypted ? '예 (파일 이름까지 암호화)' : '예') : '아니요'],
    ['분할 볼륨', i.Volumes ? `${i.Volumes}개` : i.Multivolume === '+' ? '예' : ''],
    ['편집', archive.editable ? '가능' : '읽기 전용'],
    ['주석', i.Comment]
  ].filter(([, v]) => v)
  return (
    <Modal title="압축 파일 정보" icon="info" onClose={onClose} width={520} footer={<button className="btn primary" onClick={onClose}>닫기</button>}>
      <dl className="info-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={k === '파일' ? 'mono' : ''}>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}
