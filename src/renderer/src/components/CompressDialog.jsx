import { useEffect, useMemo, useState } from 'react'
import { Modal, PasswordField, usePrompt, useToast } from './ui.jsx'
import Icon, { FileIcon } from './Icon.jsx'
import { COMPRESS_FORMATS, LEVELS, formatById } from '@shared/formats.js'
import { basename, dirname, joinPath, fmtSize, fmtCount, fileCategory } from '../lib/util.js'

const SPLITS = [
  { v: 0, label: '분할 안 함' },
  { v: 10, label: '10 MB' },
  { v: 100, label: '100 MB' },
  { v: 700, label: '700 MB (CD)' },
  { v: 1024, label: '1 GB' },
  { v: 4092, label: '4 GB (FAT32)' },
  { v: 4480, label: '4.7 GB (DVD)' },
  { v: -1, label: '직접 입력…' }
]

// 확장자만 새 포맷 것으로 바꾼다 (.tar.gz 같은 이중 확장자 포함)
function swapExt(p, fmt) {
  const stripped = p.replace(/\.(tar\.(gz|xz|bz2)|7z|zip|tar)$/i, '')
  return stripped + fmt.ext
}

export default function CompressDialog({ initialFiles = [], settings, onClose, inline }) {
  const prompt = usePrompt()
  const toast = useToast()
  const d = settings.compress
  const [files, setFiles] = useState(initialFiles)
  const [stats, setStats] = useState({})
  const [format, setFormat] = useState(d.format)
  const [output, setOutput] = useState('')
  const [outputTouched, setOutputTouched] = useState(false)
  const [level, setLevel] = useState(d.level)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [encryptNames, setEncryptNames] = useState(d.encryptNames)
  const [zipCrypto, setZipCrypto] = useState(d.zipCrypto)
  const [split, setSplit] = useState(0)
  const [customSplit, setCustomSplit] = useState('')
  const [solid, setSolid] = useState(d.solid)
  const [separate, setSeparate] = useState(false)
  const [deleteSources, setDeleteSources] = useState(false)
  const [openFolder, setOpenFolder] = useState(d.openFolder)
  const [busy, setBusy] = useState(false)
  const fmt = formatById(format)

  // 파일 크기 합계
  useEffect(() => {
    const missing = files.filter((f) => !stats[f])
    if (!missing.length) return
    window.pz.stat(missing).then((list) => setStats((s) => ({ ...s, ...Object.fromEntries(list.map((x) => [x.path, x])) })))
  }, [files])

  // 기본 출력 경로 (사용자가 직접 고치기 전까지만 자동)
  useEffect(() => {
    if (outputTouched || !files.length) return
    window.pz.defaultOutput(files, format).then(setOutput)
  }, [files, format, outputTouched])

  const total = useMemo(() => {
    let size = 0, count = 0, partial = false
    for (const f of files) {
      const s = stats[f]
      if (!s) continue
      size += s.size
      count += s.count
      partial ||= s.partial
    }
    return { size, count, partial }
  }, [files, stats])

  const changeFormat = (id) => {
    setFormat(id)
    if (output) setOutput(swapExt(output, formatById(id)))
  }

  const addFiles = async (dirs) => {
    const picked = await window.pz.pick({ dirs, title: dirs ? '압축할 폴더' : '압축할 파일' })
    if (picked.length) setFiles((f) => [...new Set([...f, ...picked])])
  }

  const browse = async () => {
    const p = await window.pz.saveAs(output || undefined, format)
    if (p) {
      setOutput(swapExt(p, fmt))
      setOutputTouched(true)
    }
  }

  const volumeBytes = () => {
    const mb = split === -1 ? parseFloat(customSplit) : split
    return mb > 0 ? Math.round(mb * 1024 * 1024) : 0
  }

  const pwMismatch = password && password2 !== password
  const canSubmit = files.length && output && !pwMismatch && !busy && !(split === -1 && !(parseFloat(customSplit) > 0))

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    try {
      const outDir = dirname(output)
      const common = {
        format,
        level,
        password: fmt.password && password ? password : undefined,
        encryptNames: format === '7z' && encryptNames,
        zipCrypto: format === 'zip' && zipCrypto,
        solid,
        volumeSize: volumeBytes() || undefined,
        deleteSources,
        openFolder
      }
      let jobs
      if (separate && files.length > 1) {
        jobs = await Promise.all(
          files.map(async (f) => ({ ...common, sources: [f], output: joinPath(outDir, basename(await window.pz.defaultOutput([f], format))) }))
        )
      } else jobs = [{ ...common, sources: files, output: swapExt(output, fmt) }]

      const clashes = []
      for (const j of jobs) if (await window.pz.exists(j.output)) clashes.push(j.output)
      let overwrite = 'rename'
      if (clashes.length) {
        const pick = await prompt.choose({
          title: '같은 이름의 파일이 있습니다',
          message: clashes.length === 1 ? `'${basename(clashes[0])}' 파일이 이미 있습니다.` : `${clashes.length}개의 결과 파일이 이미 있습니다.`,
          options: [
            { value: 'rename', label: '새 이름으로 저장' },
            { value: 'replace', label: '덮어쓰기' }
          ]
        })
        if (!pick) return
        overwrite = pick
      }
      if (deleteSources) {
        const ok = await prompt.confirm({ title: '원본 삭제', message: '압축이 끝나면 원본 파일을 휴지통으로 보냅니다. 계속할까요?', okText: '계속', danger: true })
        if (!ok) return
      }
      for (const j of jobs) await window.pz.startTask('compress', { ...j, overwrite })
      window.pz.setSettings({ compress: { format, level, zipCrypto, encryptNames, solid, openFolder } })
      onClose(true)
    } catch (e) {
      toast('error', e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="압축하기"
      icon="compress"
      onClose={() => onClose(false)}
      width={620}
      inline={inline}
      className="compress-dialog"
      footer={
        <>
          <span className="foot-note">
            {files.length ? `${fmtCount(files.length)}개 항목 · ${fmtSize(total.size)}${total.partial ? '+' : ''}` : ''}
          </span>
          <button className="btn" onClick={() => onClose(false)}>취소</button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            <Icon name="compress" size={16} /> 압축 시작
          </button>
        </>
      }
    >
      <div className="field">
        <div className="field-label">
          압축할 항목
          <span className="spacer" />
          <button className="link-btn" onClick={() => addFiles(false)}>+ 파일</button>
          <button className="link-btn" onClick={() => addFiles(true)}>+ 폴더</button>
        </div>
        <div className="file-chips">
          {files.length === 0 && <div className="empty-chip">항목을 추가하세요</div>}
          {files.map((f) => {
            const s = stats[f]
            return (
              <div key={f} className="file-chip" title={f}>
                <FileIcon category={s?.isDir ? 'folder' : fileCategory(f)} size={16} />
                <span className="name">{basename(f)}</span>
                {s && <span className="meta">{fmtSize(s.size)}</span>}
                <button className="icon-btn ghost xs" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label="제외" title="목록에서 빼기">
                  <Icon name="x" size={13} stroke={2.2} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="field">
        <label className="field-label">저장 위치</label>
        <div className="row">
          <input
            className="grow mono"
            value={output}
            spellCheck={false}
            onChange={(e) => {
              setOutput(e.target.value)
              setOutputTouched(true)
            }}
          />
          <button className="btn" onClick={browse}>찾아보기…</button>
        </div>
        {separate && files.length > 1 && <div className="hint">각 항목이 이 폴더에 따로 압축됩니다: {dirname(output)}</div>}
      </div>

      <div className="field">
        <label className="field-label">형식</label>
        <div className="segmented">
          {COMPRESS_FORMATS.map((f) => (
            <button key={f.id} className={format === f.id ? 'on' : ''} onClick={() => changeFormat(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="field-label">압축 레벨</label>
          <select value={level} onChange={(e) => setLevel(+e.target.value)}>
            {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label">분할 압축</label>
          <div className="row">
            <select className="grow" value={split} onChange={(e) => setSplit(+e.target.value)} disabled={!fmt.volumes}>
              {SPLITS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            {split === -1 && (
              <input className="num" type="number" min="1" placeholder="MB" value={customSplit} onChange={(e) => setCustomSplit(e.target.value)} />
            )}
          </div>
        </div>
      </div>

      {fmt.password ? (
        <div className="field">
          <label className="field-label">암호 설정 <span className="muted">(선택)</span></label>
          <div className="grid2">
            <PasswordField value={password} onChange={setPassword} placeholder="암호" />
            <PasswordField value={password2} onChange={setPassword2} placeholder="암호 확인" invalid={pwMismatch} />
          </div>
          {pwMismatch && <div className="hint error-text">암호가 일치하지 않습니다</div>}
          {password && format === '7z' && (
            <label className="check">
              <input type="checkbox" checked={encryptNames} onChange={(e) => setEncryptNames(e.target.checked)} /> 파일 이름도 암호화 (암호 없이는 목록도 볼 수 없음)
            </label>
          )}
          {password && format === 'zip' && (
            <label className="check">
              <input type="checkbox" checked={zipCrypto} onChange={(e) => setZipCrypto(e.target.checked)} /> 호환 모드 ZipCrypto (Windows 기본 탐색기로도 열림, 보안 약함)
            </label>
          )}
        </div>
      ) : (
        <div className="hint">TAR 계열 형식은 암호를 지원하지 않습니다. 암호가 필요하면 7Z 또는 ZIP 을 선택하세요.</div>
      )}

      <div className="options">
        {format === '7z' && (
          <label className="check">
            <input type="checkbox" checked={solid} onChange={(e) => setSolid(e.target.checked)} /> 솔리드 압축 (압축률↑, 일부만 풀 때 느림)
          </label>
        )}
        {files.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /> 각 항목을 따로 압축
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={deleteSources} onChange={(e) => setDeleteSources(e.target.checked)} /> 압축 후 원본을 휴지통으로
        </label>
        <label className="check">
          <input type="checkbox" checked={openFolder} onChange={(e) => setOpenFolder(e.target.checked)} /> 완료 후 폴더 열기
        </label>
      </div>
    </Modal>
  )
}
