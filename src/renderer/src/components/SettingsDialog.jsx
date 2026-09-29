import { useEffect, useState } from 'react'
import { Modal, useToast } from './ui.jsx'
import Icon from './Icon.jsx'
import { COMPRESS_FORMATS, LEVELS, CODEPAGES } from '@shared/formats.js'

const OS_LABEL = {
  win32: { menu: '파일 탐색기 우클릭 메뉴', where: 'Windows 11 에서는 "더 많은 옵션 표시"(Shift+F10) 안에 나타납니다.', assoc: '연결 프로그램 목록에 등록' },
  darwin: { menu: 'Finder 빠른 동작', where: 'Finder 에서 파일 우클릭 → 빠른 동작 / 서비스 에 나타납니다. 처음엔 시스템 설정 → 키보드 → 키보드 단축키 → 서비스에서 켜야 할 수 있습니다.', assoc: null },
  linux: { menu: '파일 관리자 우클릭 메뉴', where: 'Nautilus(스크립트 메뉴), Nemo, Dolphin 을 지원합니다.', assoc: '기본 압축 프로그램으로 지정 (xdg-mime)' }
}

export default function SettingsDialog({ platform, settings, onChange, onClose }) {
  const toast = useToast()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const L = OS_LABEL[platform] || OS_LABEL.linux

  const refresh = () => window.pz.integrationStatus().then(setStatus).catch(() => setStatus({}))
  useEffect(() => { refresh() }, [])

  const act = async (fn, opts, okMsg) => {
    setBusy(true)
    try {
      await fn(opts)
      toast('success', okMsg)
    } catch (e) {
      toast('error', e.message)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const set = (patch) => window.pz.setSettings(patch).then(onChange)

  return (
    <Modal title="설정" icon="settings" onClose={onClose} width={600}>
      <section className="settings-sec">
        <h3>{L.menu}</h3>
        <p className="muted small">{L.where}</p>
        <div className="integration-row">
          <span className={`status-dot ${status?.contextMenu ? 'on' : ''}`} />
          <span>{status == null ? '확인 중…' : status.contextMenu ? '등록됨' : '등록 안 됨'}</span>
          <span className="spacer" />
          {status?.contextMenu && (
            <button className="btn sm" disabled={busy} onClick={() => act(window.pz.integrationUninstall, { contextMenu: true, associations: false }, '우클릭 메뉴를 제거했습니다')}>
              제거
            </button>
          )}
          <button className="btn sm primary" disabled={busy} onClick={() => act(window.pz.integrationInstall, { contextMenu: true, associations: false }, '우클릭 메뉴를 등록했습니다')}>
            {status?.contextMenu ? '다시 등록' : '등록'}
          </button>
        </div>
        {L.assoc && (
          <div className="integration-row">
            <span className={`status-dot ${status?.associations ? 'on' : ''}`} />
            <span>{L.assoc}</span>
            <span className="spacer" />
            {status?.associations && (
              <button className="btn sm" disabled={busy} onClick={() => act(window.pz.integrationUninstall, { contextMenu: false, associations: true }, '파일 연결을 해제했습니다')}>
                해제
              </button>
            )}
            <button className="btn sm" disabled={busy} onClick={() => act(window.pz.integrationInstall, { contextMenu: false, associations: true }, '파일 연결을 등록했습니다')}>
              {status?.associations ? '다시 등록' : '등록'}
            </button>
          </div>
        )}
        {platform === 'win32' && (
          <p className="muted small">
            Windows 는 보안 정책상 앱이 기본 프로그램을 직접 바꿀 수 없습니다. 등록 후{' '}
            <button className="link-btn" onClick={() => window.pz.openDefaultApps()}>기본 앱 설정</button>
            에서 PePe Zip 을 선택하거나, 압축 파일 우클릭 → 연결 프로그램 → PePe Zip → "항상" 을 고르세요.
          </p>
        )}
        {platform === 'darwin' && <p className="muted small">파일 연결: Finder 에서 압축 파일 정보 가져오기(⌘I) → 다음으로 열기 → PePe Zip → 모두 변경.</p>}
      </section>

      <section className="settings-sec">
        <h3>압축 기본값</h3>
        <div className="grid2">
          <div className="field">
            <label className="field-label">형식</label>
            <select value={settings.compress.format} onChange={(e) => set({ compress: { format: e.target.value } })}>
              {COMPRESS_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">레벨 ("ZIP/7Z로 바로 압축"에도 적용)</label>
            <select value={settings.compress.level} onChange={(e) => set({ compress: { level: +e.target.value } })}>
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="settings-sec">
        <h3>풀기 기본값 (우클릭 "자동으로 풀기"에도 적용)</h3>
        <div className="grid2">
          <div className="field">
            <label className="field-label">같은 이름의 파일이 있으면</label>
            <select value={settings.extract.overwrite} onChange={(e) => set({ extract: { overwrite: e.target.value } })}>
              <option value="overwrite">덮어쓰기</option>
              <option value="skip">건너뛰기</option>
              <option value="rename">이름 바꿔서 저장</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">ZIP 파일 이름 인코딩</label>
            <select value={settings.extract.codepage} onChange={(e) => set({ extract: { codepage: e.target.value } })}>
              {CODEPAGES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.extract.openFolder} onChange={(e) => set({ extract: { openFolder: e.target.checked } })} /> 푼 뒤 폴더 열기
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.autoCloseProgress} onChange={(e) => set({ autoCloseProgress: e.target.checked })} /> 우클릭으로 시작한 작업이 끝나면 진행 창 자동으로 닫기
        </label>
      </section>

      <section className="settings-sec">
        <h3>화면</h3>
        <div className="segmented">
          {[['system', '시스템'], ['light', '밝게'], ['dark', '어둡게']].map(([v, l]) => (
            <button key={v} className={settings.theme === v ? 'on' : ''} onClick={() => set({ theme: v })}>
              {l}
            </button>
          ))}
        </div>
      </section>

      <p className="muted small about">
        <Icon name="shield" size={13} /> 압축 엔진: 7-Zip 26.03 (Igor Pavlov, GNU LGPL + unRAR 제한) — 파일은 이 컴퓨터 밖으로 전송되지 않습니다.
      </p>
    </Modal>
  )
}
