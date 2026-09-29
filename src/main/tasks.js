// 작업 큐: 진행률을 해당 창으로 보내고, 취소·재시도(암호 입력 후)를 지원한다.
import { basename } from 'node:path'
import { RUNNERS } from './jobs.js'

const MAX_PARALLEL = 2

export class TaskManager {
  constructor(send) {
    this.send = send // (windowId, snapshot) => void
    this.tasks = new Map()
    this.seq = 0
  }

  create(windowId, kind, params) {
    const id = `t${++this.seq}`
    const t = {
      id,
      windowId,
      kind,
      params,
      title: titleOf(kind, params),
      status: 'queued',
      percent: 0,
      file: '',
      message: '대기 중',
      error: null,
      errorKind: null,
      result: null,
      startedAt: 0,
      ctrl: null
    }
    this.tasks.set(id, t)
    this.emit(t)
    this.pump()
    return id
  }

  retry(id, patch = {}) {
    const t = this.tasks.get(id)
    if (!t || t.status === 'running') return false
    Object.assign(t, { params: { ...t.params, ...patch }, status: 'queued', percent: 0, file: '', message: '대기 중', error: null, errorKind: null, result: null })
    this.emit(t)
    this.pump()
    return true
  }

  cancel(id) {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.status === 'running') t.ctrl?.abort()
    else if (t.status === 'queued' || t.status === 'error') {
      t.status = 'canceled'
      t.message = '취소됨'
      this.emit(t)
    }
  }

  dismiss(id) {
    const t = this.tasks.get(id)
    if (!t || t.status === 'running' || t.status === 'queued') return
    this.tasks.delete(id)
  }

  listFor(windowId) {
    return [...this.tasks.values()].filter((t) => t.windowId === windowId).map(snapshot)
  }

  cancelWindow(windowId) {
    for (const t of this.tasks.values()) if (t.windowId === windowId) this.cancel(t.id)
  }

  hasRunning() {
    return [...this.tasks.values()].some((t) => t.status === 'running' || t.status === 'queued')
  }

  emit(t) {
    this.send(t.windowId, snapshot(t))
  }

  pump() {
    const running = [...this.tasks.values()].filter((t) => t.status === 'running').length
    let free = MAX_PARALLEL - running
    for (const t of this.tasks.values()) {
      if (free <= 0) break
      if (t.status === 'queued') {
        free--
        this.start(t)
      }
    }
  }

  async start(t) {
    t.status = 'running'
    t.ctrl = new AbortController()
    t.startedAt = Date.now()
    let lastEmit = 0
    const ctx = {
      signal: t.ctrl.signal,
      progress: ({ percent, file }) => {
        t.percent = percent
        if (file) t.file = file
        const now = Date.now()
        if (now - lastEmit > 100) {
          lastEmit = now
          this.emit(t)
        }
      },
      status: (msg) => {
        t.message = msg
        this.emit(t)
      }
    }
    this.emit(t)
    try {
      t.result = await RUNNERS[t.kind](t.params, ctx)
      t.status = 'done'
      t.percent = 100
      t.message = t.result?.summary || '완료'
      try { this.onDone?.(t) } catch { /* 폴더 열기 실패는 무시 */ }
    } catch (e) {
      if (e.kind === 'canceled') {
        t.status = 'canceled'
        t.message = '취소됨'
      } else {
        t.status = 'error'
        t.errorKind = e.kind || 'failed'
        t.error = e.message
        t.message = e.message
        if (e.detail) console.error(`[task ${t.id}]`, e.detail)
      }
    } finally {
      t.ctrl = null
      t.file = ''
      this.emit(t)
      this.pump()
    }
  }
}

function titleOf(kind, p) {
  switch (kind) {
    case 'extract': return basename(p.archive)
    case 'test': return basename(p.archive)
    case 'add': return basename(p.archive)
    case 'compress': return basename(p.output)
    default: return kind
  }
}

function snapshot(t) {
  const { ctrl, params, ...rest } = t
  // 암호는 렌더러로 되돌려 보내지 않는다
  const { password, ...safe } = params
  return { ...rest, params: { ...safe, hasPassword: !!password } }
}
