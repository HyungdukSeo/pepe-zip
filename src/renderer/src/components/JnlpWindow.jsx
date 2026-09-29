import { useState, useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { basename } from '../lib/util.js'

export default function JnlpWindow({ initialPath }) {
  const [jnlpPath, setJnlpPath] = useState(initialPath || '')
  const [step, setStep] = useState(1) // 1: 파싱, 2: JRE, 3: 다운로드, 4: 실행
  const [statusText, setStatusText] = useState('JNLP 애플리케이션 준비 중...')
  const [parsed, setParsed] = useState(null)
  const [jre, setJre] = useState(null)
  const [progress, setProgress] = useState(null)
  const [pid, setPid] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [exitInfo, setExitInfo] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)

  const logEndRef = useRef(null)

  const addLog = (text, type = 'info') => {
    setLogs((prev) => [...prev, { text, type, time: new Date().toLocaleTimeString() }])
  }

  const runningPathRef = useRef(null)

  // JNLP 세션 시작
  const runSession = async (path) => {
    if (!path || runningPathRef.current === path) return
    runningPathRef.current = path
    setJnlpPath(path)
    setError(null)
    setExitInfo(null)
    setPid(null)
    setIsRunning(true)
    setStep(1)
    setStatusText('JNLP 실행 세션 시작...')
    setLogs([])

    try {
      await window.pz.startJnlp(path)
    } catch (e) {
      runningPathRef.current = null
      setError(e.message)
      setIsRunning(false)
      addLog(`실행 실패: ${e.message}`, 'error')
    }
  }

  // initialPath 변경 시 실행
  useEffect(() => {
    if (initialPath) {
      runSession(initialPath)
    }
  }, [initialPath])

  // 액션 및 JNLP 이벤트 수신 (1회 마운트 시 등록)
  useEffect(() => {
    const offAction = window.pz.onAction?.((a) => {
      if (a.type === 'launch-jnlp' && a.path) {
        runSession(a.path)
      }
    })

    const offEvent = window.pz.onJnlpEvent?.((ev) => {
      switch (ev.type) {
        case 'status':
          setStep(ev.step || 1)
          setStatusText(ev.message || ev.title)
          break
        case 'parsed':
          setParsed(ev.data)
          break
        case 'jre':
          setJre(ev.data)
          break
        case 'progress':
          setProgress(ev)
          break
        case 'started':
          setPid(ev.pid)
          setIsRunning(true)
          setStep(4)
          setStatusText(`Java 애플리케이션 실행 중 (PID: ${ev.pid}) · 화면 표시 대기 중...`)
          addLog(`애플리케이션 프로세스가 시작되었습니다. (PID: ${ev.pid})`, 'success')
          addLog('네트워크/DB 초기화 및 GUI 화면 로딩에 수십 초가 소요될 수 있습니다.', 'info')
          break
        case 'stdout':
          addLog(ev.text.trimEnd(), 'stdout')
          break
        case 'stderr':
          addLog(ev.text.trimEnd(), 'stderr')
          break
        case 'process_exit':
          runningPathRef.current = null
          setIsRunning(false)
          setExitInfo({ code: ev.code, signal: ev.signal })
          setStatusText(`프로세스 종료됨 (코드: ${ev.code ?? '없음'})`)
          addLog(`프로세스가 종료되었습니다. (코드: ${ev.code ?? '없음'})`, 'info')
          break
        case 'process_error':
        case 'error':
          runningPathRef.current = null
          setError(ev.message)
          setIsRunning(false)
          addLog(`오류: ${ev.message}`, 'error')
          break
        case 'log':
          addLog(ev.text, ev.level || 'info')
          break
      }
    })

    return () => {
      offAction?.()
      offEvent?.()
    }
  }, [])

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const handleStop = async () => {
    runningPathRef.current = null
    await window.pz.stopJnlp()
    setIsRunning(false)
    addLog('사용자가 프로세스 중지를 요청했습니다.', 'warn')
  }

  const handleOpenCache = () => {
    window.pz.openJnlpCache()
  }

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.time}] ${l.text}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const title = parsed?.title || (jnlpPath ? basename(jnlpPath) : 'JNLP 런처')
  const vendor = parsed?.vendor || (parsed?.codebase ? new URL(parsed.codebase).hostname : '')

  return (
    <div className="jnlp-window">
      {/* 헤더 */}
      <div className="jnlp-header">
        <div className="jnlp-icon-box">
          <Icon name="coffee" size={26} />
        </div>
        <div className="jnlp-title-meta">
          <div className="jnlp-title-row">
            <h1 className="jnlp-title">{title}</h1>
            <span
              className={`jnlp-badge ${
                isRunning ? 'running' : error ? 'error' : exitInfo ? 'done' : 'ready'
              }`}
            >
              {isRunning
                ? `실행 중 (PID: ${pid})`
                : error
                ? '오류 발생'
                : exitInfo
                ? '종료됨'
                : '준비 중'}
            </span>
          </div>
          <div className="jnlp-sub">
            {vendor && <span className="jnlp-vendor">{vendor} · </span>}
            <span className="jnlp-path" title={jnlpPath}>
              {jnlpPath}
            </span>
          </div>
        </div>
      </div>

      {/* 단계 진행바 */}
      <div className="jnlp-steps">
        <div className={`jnlp-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
          <div className="jnlp-step-num">{step > 1 ? '✓' : '1'}</div>
          <div className="jnlp-step-label">JNLP 분석</div>
        </div>
        <div className="jnlp-step-line" />
        <div className={`jnlp-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
          <div className="jnlp-step-num">{step > 2 ? '✓' : '2'}</div>
          <div className="jnlp-step-label">내장 JRE 준비</div>
        </div>
        <div className="jnlp-step-line" />
        <div className={`jnlp-step ${step >= 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}>
          <div className="jnlp-step-num">{step > 3 ? '✓' : '3'}</div>
          <div className="jnlp-step-label">JAR 다운로드</div>
        </div>
        <div className="jnlp-step-line" />
        <div className={`jnlp-step ${step >= 4 ? 'active' : ''}`}>
          <div className="jnlp-step-num">4</div>
          <div className="jnlp-step-label">Java 실행</div>
        </div>
      </div>

      {/* 현재 상태 정보 카드 */}
      <div className="jnlp-status-card">
        <div className="jnlp-status-msg">
          {isRunning && <span className="jnlp-pulse" />}
          <span>{statusText}</span>
        </div>

        {jre && (
          <div className="jnlp-jre-meta">
            <span className="jnlp-meta-tag">
              <Icon name="check" size={13} /> {jre.source} (Java {jre.version})
            </span>
            {parsed?.mainClass && (
              <span className="jnlp-meta-tag" title={`Main Class: ${parsed.mainClass}`}>
                Class: {parsed.mainClass.split('.').pop()}
              </span>
            )}
            {parsed?.jars?.length > 0 && (
              <span className="jnlp-meta-tag">
                라이브러리: {parsed.jars.length}개
              </span>
            )}
          </div>
        )}

        {/* 다운로드 진행률 바 */}
        {progress && step === 3 && (
          <div className="jnlp-progress-wrap">
            <div className="jnlp-progress-info">
              <span>{progress.jarName}</span>
              <span>
                {progress.cached ? '캐시됨' : '다운로드 중'} ({progress.index}/{progress.total})
              </span>
            </div>
            <div className="jnlp-bar-bg">
              <div
                className="jnlp-bar-fill"
                style={{ width: `${Math.round((progress.index / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="jnlp-error-box">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 실시간 콘솔 로그 */}
      <div className="jnlp-console-section">
        <div className="jnlp-console-header">
          <div className="jnlp-console-title">
            <Icon name="terminal" size={14} />
            <span>콘솔 로그</span>
            <span className="jnlp-log-count">({logs.length})</span>
          </div>
          <div className="jnlp-console-tools">
            <label className="jnlp-scroll-toggle">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              자동 스크롤
            </label>
            <button className="link-btn" onClick={() => setLogs([])}>
              지우기
            </button>
            <button className="link-btn" onClick={handleCopyLogs}>
              {copied ? '복사됨!' : '로그 복사'}
            </button>
          </div>
        </div>

        <div className="jnlp-console-body">
          {logs.length === 0 ? (
            <div className="jnlp-log-empty">기록된 콘솔 출력이 없습니다.</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className={`jnlp-log-line ${l.type}`}>
                <span className="jnlp-log-time">{l.time}</span>
                <span className="jnlp-log-text">{l.text}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* 하단 제어 바 */}
      <div className="jnlp-footer">
        <button className="btn sm ghost" onClick={handleOpenCache} title="다운로드된 캐시 폴더 열기">
          <Icon name="folder" size={14} />
          캐시 폴더
        </button>
        <div className="spacer" />
        {isRunning && (
          <button
            className="btn sm"
            onClick={() => window.pz.activateJnlp?.()}
            title="Java GUI 창을 화면 맨 앞으로 가져옵니다"
          >
            <Icon name="maximize" size={14} />
            창 앞으로 가져오기
          </button>
        )}
        {isRunning ? (
          <button className="btn sm danger" onClick={handleStop}>
            <Icon name="stop" size={14} />
            프로세스 중지
          </button>
        ) : (
          <button className="btn sm primary" onClick={() => { runningPathRef.current = null; runSession(jnlpPath) }} disabled={!jnlpPath}>
            <Icon name="play" size={14} />
            다시 실행
          </button>
        )}
        <button className="btn sm" onClick={() => window.pz.closeWindow()}>
          닫기
        </button>
      </div>
    </div>
  )
}
