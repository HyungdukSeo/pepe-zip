import { useState } from 'react'
import { Modal, PasswordField, useToast } from './ui.jsx'
import Icon from './Icon.jsx'
import { CODEPAGES, archiveBaseName } from '@shared/formats.js'
import { basename, dirname, joinPath } from '../lib/util.js'

/**
 * archives: 풀 압축 파일 경로 목록
 * selection: 탐색기에서 일부만 풀 때 { files, stripPrefix, count }
 * knownPassword: 탐색기에서 이미 입력한 암호
 */
export default function ExtractDialog({ archives, selection, knownPassword, home, settings, onClose, inline }) {
  const toast = useToast()
  const d = settings.extract
  const srcDir = dirname(archives[0])
  const [dest, setDest] = useState(srcDir)
  const [mode, setMode] = useState(selection ? 'here' : d.mode)
  const [overwrite, setOverwrite] = useState(d.overwrite)
  const [codepage, setCodepage] = useState(d.codepage)
  const [password, setPassword] = useState(knownPassword || '')
  const [openFolder, setOpenFolder] = useState(d.openFolder)
  const hasZip = archives.some((a) => /\.(zip|zipx|jar)(\.\d+)?$/i.test(a))
  const single = archives.length === 1
  const base = archiveBaseName(basename(archives[0]))

  const quick = [
    { label: '압축 파일 위치', path: srcDir },
    { label: '바탕 화면', path: joinPath(home, 'Desktop') },
    { label: '다운로드', path: joinPath(home, 'Downloads') }
  ]

  const browse = async () => {
    const p = await window.pz.chooseDir(dest)
    if (p) setDest(p)
  }

  const preview = () => {
    if (selection) return dest
    const name = single ? base : '<압축 파일 이름>'
    if (mode === 'folder') return joinPath(dest, name)
    if (mode === 'here') return dest
    return `${joinPath(dest, name)}  (최상위가 폴더 하나면 ${dest} 에 바로)`
  }

  async function submit() {
    if (!dest.trim()) return
    try {
      for (const a of archives) {
        // 여러 개를 "압축 파일 위치"로 풀면 각자 자기 폴더에 푼다
        const target = !single && dest === srcDir ? dirname(a) : dest
        await window.pz.startTask('extract', {
          archive: a,
          dest: target,
          mode: selection ? 'here' : mode,
          files: selection?.files,
          stripPrefix: selection?.stripPrefix,
          overwrite,
          codepage,
          password: password || undefined,
          openFolder
        })
      }
      if (!selection) window.pz.setSettings({ extract: { mode, overwrite, codepage, openFolder } })
      onClose(true)
    } catch (e) {
      toast('error', e.message)
    }
  }

  return (
    <Modal
      title={selection ? `선택한 ${selection.count}개 항목 풀기` : single ? '압축 풀기' : `압축 파일 ${archives.length}개 풀기`}
      icon="extract"
      onClose={() => onClose(false)}
      width={560}
      inline={inline}
      footer={
        <>
          <button className="btn" onClick={() => onClose(false)}>취소</button>
          <button className="btn primary" disabled={!dest.trim()} onClick={submit}>
            <Icon name="extract" size={16} /> 풀기
          </button>
        </>
      }
    >
      <div className="archive-list">
        {archives.slice(0, 4).map((a) => (
          <div key={a} className="archive-row" title={a}>
            <Icon name="archive" size={15} /> {basename(a)}
          </div>
        ))}
        {archives.length > 4 && <div className="muted">외 {archives.length - 4}개</div>}
      </div>

      <div className="field">
        <label className="field-label">풀 위치</label>
        <div className="row">
          <input className="grow mono" value={dest} spellCheck={false} onChange={(e) => setDest(e.target.value)} />
          <button className="btn" onClick={browse}>찾아보기…</button>
        </div>
        <div className="chips">
          {quick.map((q) => (
            <button key={q.label} className={`chip ${dest === q.path ? 'on' : ''}`} onClick={() => setDest(q.path)}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {!selection && (
        <div className="field">
          <label className="field-label">폴더 만들기</label>
          <div className="radio-list">
            <label className="radio">
              <input type="radio" checked={mode === 'smart'} onChange={() => setMode('smart')} />
              <div><b>자동</b><span>최상위가 폴더 하나면 그대로, 여러 개면 "{single ? base : '압축 파일 이름'}" 폴더를 만들어 풉니다</span></div>
            </label>
            <label className="radio">
              <input type="radio" checked={mode === 'folder'} onChange={() => setMode('folder')} />
              <div><b>항상 폴더 만들기</b><span>"{single ? base : '압축 파일 이름'}" 폴더 안에 풉니다</span></div>
            </label>
            <label className="radio">
              <input type="radio" checked={mode === 'here'} onChange={() => setMode('here')} />
              <div><b>여기에 바로</b><span>풀 위치에 그대로 풉니다</span></div>
            </label>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="field">
          <label className="field-label">같은 이름의 파일이 있으면</label>
          <select value={overwrite} onChange={(e) => setOverwrite(e.target.value)}>
            <option value="overwrite">덮어쓰기</option>
            <option value="skip">건너뛰기</option>
            <option value="rename">이름 바꿔서 저장</option>
          </select>
        </div>
        {hasZip && (
          <div className="field">
            <label className="field-label">파일 이름 인코딩 (ZIP)</label>
            <select value={codepage} onChange={(e) => setCodepage(e.target.value)}>
              {CODEPAGES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="field">
        <label className="field-label">암호 <span className="muted">(암호가 걸린 경우, 비워 두면 필요할 때 묻습니다)</span></label>
        <PasswordField value={password} onChange={setPassword} placeholder="암호" onEnter={submit} />
      </div>

      <label className="check">
        <input type="checkbox" checked={openFolder} onChange={(e) => setOpenFolder(e.target.checked)} /> 완료 후 폴더 열기
      </label>

      <div className="dest-preview">
        <Icon name="folder" size={14} /> <span className="mono">{preview()}</span>
      </div>
    </Modal>
  )
}
