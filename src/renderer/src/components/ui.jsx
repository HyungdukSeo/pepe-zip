// 공용 UI: 모달, 확인/암호 프롬프트, 토스트 (alert/prompt/confirm 네이티브 창은 쓰지 않는다)
import { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react'
import Icon from './Icon.jsx'

export function Modal({ title, icon, children, footer, onClose, width = 480, inline = false, className = '' }) {
  useEffect(() => {
    if (!onClose) return
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const body = (
    <div className={`modal ${inline ? 'modal-inline' : ''} ${className}`} style={inline ? undefined : { width }} role="dialog" aria-label={title}>
      <div className="modal-head">
        {icon && <Icon name={icon} size={18} />}
        <h2>{title}</h2>
        {onClose && (
          <button className="icon-btn ghost" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  )
  if (inline) return body
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      {body}
    </div>
  )
}

export function PasswordField({ value, onChange, placeholder = '암호', autoFocus, onEnter, invalid }) {
  const [show, setShow] = useState(false)
  return (
    <div className={`pw-field ${invalid ? 'invalid' : ''}`}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      <button type="button" className="icon-btn ghost" tabIndex={-1} onClick={() => setShow(!show)} aria-label={show ? '암호 숨기기' : '암호 보기'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </div>
  )
}

// ───── 프롬프트 (Promise 기반) ─────
const PromptCtx = createContext(null)
export const usePrompt = () => useContext(PromptCtx)

export function PromptProvider({ children }) {
  const [queue, setQueue] = useState([])
  const seq = useRef(0)
  const push = useCallback((p) => new Promise((resolve) => setQueue((q) => [...q, { ...p, resolve, id: ++seq.current }])), [])
  const api = useRef({
    confirm: (o) => push({ type: 'confirm', ...o }),
    choose: (o) => push({ type: 'choose', ...o }),
    password: (o) => push({ type: 'password', ...o }),
    text: (o) => push({ type: 'text', ...o })
  }).current
  const cur = queue[0]
  const done = (v) => {
    cur.resolve(v)
    setQueue((q) => q.slice(1))
  }
  return (
    <PromptCtx.Provider value={api}>
      {children}
      {cur?.type === 'confirm' && <ConfirmModal {...cur} onDone={done} />}
      {cur?.type === 'choose' && <ChooseModal {...cur} onDone={done} />}
      {cur?.type === 'password' && <PasswordModal key={cur.id} {...cur} onDone={done} />}
      {cur?.type === 'text' && <TextModal key={cur.id} {...cur} onDone={done} />}
    </PromptCtx.Provider>
  )
}

function ConfirmModal({ title, message, okText = '확인', cancelText = '취소', danger, onDone }) {
  return (
    <Modal
      title={title}
      icon={danger ? 'alert' : 'info'}
      onClose={() => onDone(false)}
      width={420}
      footer={
        <>
          <button className="btn" onClick={() => onDone(false)}>{cancelText}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} autoFocus onClick={() => onDone(true)}>{okText}</button>
        </>
      }
    >
      <p className="prompt-msg">{message}</p>
    </Modal>
  )
}

// 여러 버튼 중 하나 선택 → 값 반환 (취소 시 null)
function ChooseModal({ title, message, options, onDone }) {
  return (
    <Modal
      title={title}
      icon="alert"
      onClose={() => onDone(null)}
      width={440}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>취소</button>
          {options.map((o, i) => (
            <button key={o.value} className={`btn ${i === options.length - 1 ? 'primary' : ''}`} autoFocus={i === options.length - 1} onClick={() => onDone(o.value)}>
              {o.label}
            </button>
          ))}
        </>
      }
    >
      <p className="prompt-msg">{message}</p>
    </Modal>
  )
}

function PasswordModal({ title = '암호 입력', name, wrong, onDone }) {
  const [pw, setPw] = useState('')
  const ok = () => pw && onDone(pw)
  return (
    <Modal
      title={title}
      icon="lock"
      onClose={() => onDone(null)}
      width={400}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>취소</button>
          <button className="btn primary" disabled={!pw} onClick={ok}>확인</button>
        </>
      }
    >
      {name && <div className="pw-target" title={name}><Icon name="archive" size={15} /> {name}</div>}
      <p className={`prompt-msg ${wrong ? 'error-text' : ''}`}>{wrong ? '암호가 올바르지 않습니다. 다시 입력하세요.' : '이 압축 파일은 암호로 보호되어 있습니다.'}</p>
      <PasswordField value={pw} onChange={setPw} autoFocus onEnter={ok} invalid={wrong && !pw} />
    </Modal>
  )
}

function TextModal({ title, label, value: initial = '', okText = '확인', validate, onDone }) {
  const [v, setV] = useState(initial)
  const ref = useRef()
  useEffect(() => {
    // 확장자 앞까지만 선택 (탐색기와 같은 동작)
    const el = ref.current
    const dot = initial.lastIndexOf('.')
    el.focus()
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const err = validate?.(v)
  const ok = () => !err && v.trim() && onDone(v.trim())
  return (
    <Modal
      title={title}
      icon="edit"
      onClose={() => onDone(null)}
      width={420}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>취소</button>
          <button className="btn primary" disabled={!!err || !v.trim()} onClick={ok}>{okText}</button>
        </>
      }
    >
      {label && <label className="field-label">{label}</label>}
      <input ref={ref} className={`full ${err ? 'invalid' : ''}`} value={v} spellCheck={false} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      {err && <div className="hint error-text">{err}</div>}
    </Modal>
  )
}

// ───── 토스트 ─────
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((kind, text) => {
    const id = Math.random().toString(36).slice(2)
    setItems((l) => [...l.slice(-3), { id, kind, text }])
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ───── 우클릭 메뉴 ─────
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef()
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    const r = ref.current.getBoundingClientRect()
    setPos({ left: Math.min(x, window.innerWidth - r.width - 6), top: Math.min(y, window.innerHeight - r.height - 6) })
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [x, y, onClose])
  return (
    <div className="ctx-menu" ref={ref} style={pos} onMouseDown={(e) => e.stopPropagation()} role="menu">
      {items.map((it, i) =>
        it === '-' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon ? <Icon name={it.icon} size={15} /> : <span style={{ width: 15 }} />}
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        )
      )}
    </div>
  )
}
