import Icon from './Icon.jsx'
import { fmtSize } from '../lib/util.js'

const KIND = { extract: ['extract', '풀기'], compress: ['compress', '압축'], test: ['test', '검사'], add: ['add', '추가'] }

function elapsed(t) {
  if (t.status !== 'running' || !t.startedAt || t.percent < 3) return ''
  const sec = (Date.now() - t.startedAt) / 1000
  const left = Math.round((sec / t.percent) * (100 - t.percent))
  if (!isFinite(left) || left < 1) return ''
  return left >= 60 ? `약 ${Math.floor(left / 60)}분 ${left % 60}초 남음` : `약 ${left}초 남음`
}

export function TaskItem({ t, onPassword }) {
  const [icon, label] = KIND[t.kind] || ['file', t.kind]
  const running = t.status === 'running'
  const queued = t.status === 'queued'
  const sub =
    t.status === 'error'
      ? t.error
      : t.status === 'done'
        ? t.kind === 'compress' && t.result?.size
          ? `완료 · ${fmtSize(t.result.size)}`
          : t.message
        : running && t.file
          ? t.file
          : t.message
  return (
    <div className={`task ${t.status}`}>
      <div className="task-icon">
        <Icon name={t.status === 'error' ? 'alert' : t.status === 'done' ? 'check' : icon} size={18} />
      </div>
      <div className="task-main">
        <div className="task-title">
          <span className="task-kind">{label}</span>
          <span className="task-name" title={t.title}>{t.title}</span>
          {running && <span className="task-pct">{t.percent}%</span>}
        </div>
        {(running || queued) && (
          <div className={`progress ${queued || (running && t.percent === 0) ? 'indeterminate' : ''}`}>
            <div style={{ width: `${t.percent}%` }} />
          </div>
        )}
        <div className="task-sub" title={sub}>
          {sub}
          {running && elapsed(t) && <span className="muted"> · {elapsed(t)}</span>}
        </div>
      </div>
      <div className="task-actions">
        {(running || queued) && (
          <button className="icon-btn" title="취소" onClick={() => window.pz.cancelTask(t.id)}>
            <Icon name="x" size={15} />
          </button>
        )}
        {t.status === 'error' && t.errorKind === 'password' && (
          <button className="btn sm" onClick={() => onPassword(t)}>
            <Icon name="lock" size={14} /> 암호 입력
          </button>
        )}
        {t.status === 'error' && t.errorKind !== 'password' && (
          <button className="icon-btn" title="다시 시도" onClick={() => window.pz.retryTask(t.id, {})}>
            <Icon name="retry" size={15} />
          </button>
        )}
        {t.status === 'done' && t.result?.openPath && (
          <button
            className="icon-btn"
            title="폴더 열기"
            onClick={() => (t.result.revealInFolder ? window.pz.reveal(t.result.openPath) : window.pz.openPath(t.result.openPath))}
          >
            <Icon name="reveal" size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function TaskList({ tasks, onPassword }) {
  if (!tasks.length) return null
  return (
    <div className="task-list">
      {tasks.map((t) => (
        <TaskItem key={t.id} t={t} onPassword={onPassword} />
      ))}
    </div>
  )
}
