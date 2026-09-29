import Icon from './Icon.jsx'
import { basename, dirname } from '../lib/util.js'

export default function HomeView({ recent, onOpen, onOpenPath, onCompress, integrationHint, onSetupIntegration, onDismissHint }) {
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
        <p className="muted small formats">7Z · ZIP · RAR · TAR · GZ · XZ · BZ2 · ZST · ISO · CAB · WIM · JNLP(내장 JRE) 외 40여 가지 형식</p>
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

      {recent.length > 0 && (
        <div className="recent">
          <h3>최근 연 압축 파일</h3>
          <div className="recent-list">
            {recent.map((p) => (
              <button key={p} className="recent-item" onClick={() => onOpenPath(p)} title={p}>
                <Icon name="archive" size={16} />
                <span className="recent-name">{basename(p)}</span>
                <span className="recent-dir muted">{dirname(p)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
