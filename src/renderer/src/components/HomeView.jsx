import Icon from './Icon.jsx'
import { basename, dirname } from '../lib/util.js'

export default function HomeView({
  recent = [],
  recentJnlp = [],
  onOpen,
  onOpenPath,
  onLaunchJnlp,
  onRemoveRecent,
  onClearRecent,
  onCompress,
  integrationHint,
  onSetupIntegration,
  onDismissHint
}) {
  const archives = (recent || []).slice(0, 10)
  const jnlpList = (recentJnlp || []).slice(0, 10)

  return (
    <div className="home">
      <div className="drop-hero">
        <div className="hero-icon">
          <Icon name="archive" size={40} stroke={1.5} />
        </div>
        <h1>파일을 여기에 끌어다 놓으세요</h1>
        <p className="muted">압축 파일은 열고, 그 밖의 파일·폴더는 압축합니다</p>
        <div className="hero-actions">
          <button className="btn primary lg" onClick={onOpen}>
            <Icon name="open" size={18} /> 압축 파일 열기
          </button>
          <button className="btn lg" onClick={onCompress}>
            <Icon name="compress" size={18} /> 새로 압축하기
          </button>
        </div>
        <p className="muted small formats">
          7Z · ZIP · RAR · TAR · GZ · XZ · BZ2 · ZST · ISO · CAB · WIM · JNLP(내장 JRE) 외 40여 가지 형식
        </p>
      </div>

      {integrationHint && (
        <div className="banner">
          <Icon name="info" size={16} />
          <span>{integrationHint}</span>
          <span className="spacer" />
          <button className="btn sm primary" onClick={onSetupIntegration}>등록</button>
          <button className="btn sm ghost" onClick={onDismissHint}>나중에</button>
        </div>
      )}

      {/* 하단 좌우 2분할 작업 이력 영역 */}
      <div className="home-history-section">
        {/* 좌측: 최근 연 압축 파일 */}
        <div className="history-card">
          <div className="history-card-header">
            <div className="history-card-title">
              <span className="title-icon archive">
                <Icon name="archive" size={14} />
              </span>
              <span>최근 연 압축 파일</span>
              {archives.length > 0 && (
                <span className="history-count-badge">{archives.length}/10</span>
              )}
            </div>
            {archives.length > 0 && onClearRecent && (
              <div className="history-card-tools">
                <button
                  className="history-clear-btn"
                  onClick={() => onClearRecent('archive')}
                  title="압축 파일 열람 기록 지우기"
                >
                  기록 지우기
                </button>
              </div>
            )}
          </div>

          <div className="history-list">
            {archives.length === 0 ? (
              <div className="history-empty-state">
                <div className="history-empty-icon">
                  <Icon name="archive" size={26} stroke={1.4} />
                </div>
                <div className="history-empty-title">최근 연 압축 파일이 없습니다</div>
                <div className="history-empty-sub">압축 파일을 열거나 드롭하면 이곳에 표시됩니다</div>
              </div>
            ) : (
              archives.map((p) => (
                <div
                  key={p}
                  className="history-item"
                  onClick={() => onOpenPath(p)}
                  title={`클릭하여 열기: ${p}`}
                >
                  <div className="history-item-icon archive">
                    <Icon name="archive" size={15} />
                  </div>
                  <div className="history-item-info">
                    <span className="history-item-name">{basename(p)}</span>
                    <span className="history-item-dir">{dirname(p)}</span>
                  </div>
                  <div className="history-item-actions">
                    {onRemoveRecent && (
                      <button
                        className="history-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveRecent(p, 'archive')
                        }}
                        title="기록에서 제거"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 우측: 자바 런처 실행 이력 (원클릭 재실행) */}
        <div className="history-card">
          <div className="history-card-header">
            <div className="history-card-title">
              <span className="title-icon jnlp">
                <Icon name="coffee" size={14} />
              </span>
              <span>자바 런처 실행 이력</span>
              {jnlpList.length > 0 && (
                <span className="history-count-badge">{jnlpList.length}/10</span>
              )}
            </div>
            {jnlpList.length > 0 && onClearRecent && (
              <div className="history-card-tools">
                <button
                  className="history-clear-btn"
                  onClick={() => onClearRecent('jnlp')}
                  title="자바 런처 실행 기록 지우기"
                >
                  기록 지우기
                </button>
              </div>
            )}
          </div>

          <div className="history-list">
            {jnlpList.length === 0 ? (
              <div className="history-empty-state">
                <div className="history-empty-icon">
                  <Icon name="coffee" size={26} stroke={1.4} />
                </div>
                <div className="history-empty-title">최근 실행한 JNLP 파일이 없습니다</div>
                <div className="history-empty-sub">JNLP 파일을 열거나 드롭하면 원클릭으로 재실행할 수 있습니다</div>
              </div>
            ) : (
              jnlpList.map((p) => (
                <div
                  key={p}
                  className="history-item jnlp-item"
                  onClick={() => onLaunchJnlp(p)}
                  title={`클릭하여 자바 런처 즉시 실행: ${p}`}
                >
                  <div className="history-item-icon jnlp">
                    <Icon name="coffee" size={15} />
                  </div>
                  <div className="history-item-info">
                    <span className="history-item-name">{basename(p)}</span>
                    <span className="history-item-dir">{dirname(p)}</span>
                  </div>
                  <div className="history-item-actions">
                    <span className="history-run-tag">
                      <Icon name="play" size={10} />
                      재실행
                    </span>
                    {onRemoveRecent && (
                      <button
                        className="history-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveRecent(p, 'jnlp')
                        }}
                        title="기록에서 제거"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
