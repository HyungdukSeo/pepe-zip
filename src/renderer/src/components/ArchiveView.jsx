import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Icon, { FileIcon } from './Icon.jsx'
import { ContextMenu } from './ui.jsx'
import { basename, fmtSize, fmtDate, fmtCount, ratio, fileCategory, typeLabel, sortNodes } from '../lib/util.js'

const RH = 26 // 행 높이(px) — 가상 스크롤 계산에 쓰인다

function FolderTree({ root, cwdKey, onNavigate, archiveName }) {
  const [expanded, setExpanded] = useState(() => new Set(['']))
  // 현재 폴더의 조상은 항상 펼친다
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const parts = cwdKey ? cwdKey.split('/') : []
      next.add('')
      for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next
    })
  }, [cwdKey])

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const renderNode = (node, depth) => {
    const dirs = sortNodes([...node.children.values()].filter((c) => c.isDir), { key: 'name', dir: 'asc' })
    const open = expanded.has(node.key)
    return (
      <div key={node.key || '/'}>
        <div
          className={`tree-row ${cwdKey === node.key ? 'active' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => onNavigate(node.key)}
          title={node.key ? node.name : archiveName}
        >
          <button
            className={`tree-twisty ${dirs.length ? '' : 'hidden'} ${open ? 'open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.key)
            }}
            tabIndex={-1}
            aria-label={open ? '접기' : '펼치기'}
          >
            <Icon name="chevron" size={12} stroke={2.4} />
          </button>
          {node.key ? <FileIcon category="folder" size={16} /> : <Icon name="archive" size={15} />}
          <span className="tree-name">{node.key ? node.name : archiveName}</span>
        </div>
        {open && dirs.map((d) => renderNode(d, depth + 1))}
      </div>
    )
  }
  return <div className="tree">{renderNode(root, 0)}</div>
}

const COLS = [
  { key: 'name', label: '이름' },
  { key: 'size', label: '크기', num: true },
  { key: 'packed', label: '압축 크기', num: true },
  { key: 'mtime', label: '수정한 날짜' },
  { key: 'type', label: '종류' }
]

function FileTable({ rows, selection, focusIdx, onRowClick, onRowDouble, onContext, sort, setSort, showLocation, onDragStart, onKeyDown, tableRef }) {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  useEffect(() => {
    const el = tableRef.current
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [tableRef])
  // 키보드로 이동한 행이 보이게 스크롤
  useEffect(() => {
    const el = tableRef.current
    if (focusIdx == null || !el) return
    const top = focusIdx * RH
    const headH = 30
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + RH > el.scrollTop + el.clientHeight - headH) el.scrollTop = top + RH - el.clientHeight + headH
  }, [focusIdx, tableRef])

  const start = Math.max(0, Math.floor(scrollTop / RH) - 8)
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / RH) + 8)
  const cols = showLocation ? [...COLS.slice(0, 4), { key: 'loc', label: '위치' }] : COLS

  return (
    <div className="table-scroll" ref={tableRef} tabIndex={0} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      <div className="thead">
        {cols.map((c) => (
          <button
            key={c.key}
            className={`th ${c.num ? 'num' : ''} ${sort.key === c.key ? 'sorted' : ''}`}
            onClick={() => c.key !== 'loc' && setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {c.label}
            {sort.key === c.key && <Icon name="chevronDown" size={12} style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : undefined }} />}
          </button>
        ))}
      </div>
      <div className="tbody" style={{ height: rows.length * RH }}>
        {rows.slice(start, end).map((n, i) => {
          const idx = start + i
          const sel = selection.has(n.key)
          return (
            <div
              key={n.key}
              className={`tr ${sel ? 'selected' : ''} ${focusIdx === idx ? 'focused' : ''}`}
              style={{ top: idx * RH }}
              draggable
              onDragStart={(e) => onDragStart(e, n)}
              onClick={(e) => onRowClick(e, n, idx)}
              onDoubleClick={() => onRowDouble(n)}
              onContextMenu={(e) => onContext(e, n, idx)}
            >
              <div className="td name">
                <FileIcon category={n.isDir ? 'folder' : fileCategory(n.name)} size={17} />
                <span className="fname">{n.name}</span>
                {(n.encrypted || (n.isDir && n.hasEncrypted)) && <Icon name="lock" size={12} className="lock" />}
              </div>
              <div className="td num">{fmtSize(n.size)}</div>
              <div className="td num muted">{n.isDir && !n.packed ? '' : fmtSize(n.packed)}</div>
              <div className="td muted">{fmtDate(n.mtime)}</div>
              <div className="td muted" title={showLocation ? n.parent?.key : undefined}>{showLocation ? n.parent?.key || '/' : typeLabel(n)}</div>
            </div>
          )
        })}
      </div>
      {rows.length === 0 && <div className="table-empty">{showLocation ? '검색 결과가 없습니다' : '빈 폴더'}</div>}
    </div>
  )
}

export default function ArchiveView({ archive, cwdKey, setCwdKey, selection, setSelection, actions }) {
  const { tree } = archive
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const [query, setQuery] = useState('')
  const [focusIdx, setFocusIdx] = useState(null)
  const [menu, setMenu] = useState(null)
  const anchor = useRef(null)
  const tableRef = useRef()
  const history = useRef([])

  const cwd = tree.byKey.get(cwdKey) || tree.root
  const rows = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      const out = []
      for (const n of tree.byKey.values()) {
        if (n.key && n.name.toLowerCase().includes(q)) out.push(n)
        if (out.length >= 5000) break
      }
      return sortNodes(out, sort)
    }
    return sortNodes([...cwd.children.values()], sort)
  }, [cwd, sort, query, tree])

  const navigate = useCallback(
    (key, pushHistory = true) => {
      if (pushHistory && key !== cwdKey) history.current.push(cwdKey)
      setCwdKey(key)
      setQuery('')
      setSelection(new Set())
      setFocusIdx(null)
      anchor.current = null
      tableRef.current?.focus()
    },
    [cwdKey, setCwdKey, setSelection]
  )
  const goUp = () => cwd.parent && navigate(cwd.parent.key)
  const goBack = () => history.current.length && navigate(history.current.pop(), false)

  useEffect(() => {
    tableRef.current?.focus()
  }, [archive.path])

  const selectedNodes = () => rows.filter((n) => selection.has(n.key))

  const open = (n) => {
    if (n.isDir) navigate(n.key)
    else actions.openNode(n)
  }

  const onRowClick = (e, n, idx) => {
    const next = new Set(e.ctrlKey || e.metaKey ? selection : [])
    if (e.shiftKey && anchor.current != null) {
      const [a, b] = [Math.min(anchor.current, idx), Math.max(anchor.current, idx)]
      for (let i = a; i <= b; i++) next.add(rows[i].key)
    } else if (e.ctrlKey || e.metaKey) {
      next.has(n.key) ? next.delete(n.key) : next.add(n.key)
      anchor.current = idx
    } else {
      next.add(n.key)
      anchor.current = idx
    }
    setSelection(next)
    setFocusIdx(idx)
  }

  const onContext = (e, n, idx) => {
    e.preventDefault()
    let sel = selection
    if (!selection.has(n.key)) {
      sel = new Set([n.key])
      setSelection(sel)
      setFocusIdx(idx)
      anchor.current = idx
    }
    const nodes = rows.filter((r) => sel.has(r.key))
    const ed = archive.editable
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: nodes.length === 1 && n.isDir ? '폴더 열기' : '열기', icon: 'open', onClick: () => open(n), disabled: nodes.length !== 1, hint: 'Enter' },
        { label: '풀기…', icon: 'extract', onClick: () => actions.extractNodes(nodes, cwd) },
        { label: '압축 파일 옆에 바로 풀기', icon: 'extract', onClick: () => actions.extractNodes(nodes, cwd, true) },
        '-',
        { label: '이름 바꾸기', icon: 'edit', onClick: () => actions.renameNode(n), disabled: !ed || nodes.length !== 1, hint: 'F2' },
        { label: '삭제', icon: 'trash', danger: true, onClick: () => actions.deleteNodes(nodes), disabled: !ed, hint: 'Del' }
      ]
    })
  }

  const onDragStart = (e, n) => {
    e.preventDefault()
    let nodes = selectedNodes()
    if (!selection.has(n.key)) {
      nodes = [n]
      setSelection(new Set([n.key]))
    }
    actions.dragOut(nodes, cwd)
  }

  const onKeyDown = (e) => {
    const len = rows.length
    const mod = e.ctrlKey || e.metaKey
    const move = (to) => {
      e.preventDefault()
      if (!len) return
      const idx = Math.max(0, Math.min(len - 1, to))
      setFocusIdx(idx)
      if (e.shiftKey && anchor.current != null) {
        const [a, b] = [Math.min(anchor.current, idx), Math.max(anchor.current, idx)]
        setSelection(new Set(rows.slice(a, b + 1).map((r) => r.key)))
      } else {
        anchor.current = idx
        setSelection(new Set([rows[idx].key]))
      }
    }
    if (e.key === 'ArrowDown') move((focusIdx ?? -1) + 1)
    else if (e.key === 'ArrowUp') move((focusIdx ?? 1) - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(len - 1)
    else if (e.key === 'PageDown') move((focusIdx ?? 0) + 15)
    else if (e.key === 'PageUp') move((focusIdx ?? 0) - 15)
    else if (e.key === 'Enter' && focusIdx != null && rows[focusIdx]) open(rows[focusIdx])
    else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); goUp() }
    else if (e.altKey && e.key === 'ArrowLeft') goBack()
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(new Set(rows.map((r) => r.key))) }
    else if (e.key === 'Delete' && archive.editable && selection.size) actions.deleteNodes(selectedNodes())
    else if (e.key === 'F2' && archive.editable && selection.size === 1) actions.renameNode(selectedNodes()[0])
  }

  // 상태 표시줄
  const selNodes = selectedNodes()
  const selSize = selNodes.reduce((s, n) => s + n.size, 0)
  const info = archive.info || {}
  const crumbs = []
  for (let n = cwd; n; n = n.parent) crumbs.unshift(n)

  return (
    <div className="archive-view">
      <div className="addressbar">
        <button className="icon-btn" onClick={goBack} disabled={!history.current.length} title="뒤로 (Alt+←)">
          <Icon name="back" size={16} />
        </button>
        <button className="icon-btn" onClick={goUp} disabled={!cwd.parent} title="상위 폴더 (Backspace)">
          <Icon name="up" size={16} />
        </button>
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.key || '/'} className="crumb-wrap">
              {i > 0 && <Icon name="chevron" size={12} className="crumb-sep" />}
              <button className={`crumb ${i === crumbs.length - 1 ? 'last' : ''}`} onClick={() => navigate(c.key)}>
                {c.key ? c.name : basename(archive.path)}
              </button>
            </span>
          ))}
        </div>
        <div className="search">
          <Icon name="search" size={14} />
          <input
            placeholder="압축 파일 전체에서 찾기"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelection(new Set())
              setFocusIdx(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'ArrowDown') tableRef.current?.focus()
            }}
          />
          {query && (
            <button className="icon-btn ghost xs" onClick={() => setQuery('')} aria-label="검색 지우기">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="split">
        <aside className="sidebar">
          <FolderTree root={tree.root} cwdKey={cwdKey} onNavigate={navigate} archiveName={basename(archive.path)} />
        </aside>
        <FileTable
          rows={rows}
          selection={selection}
          focusIdx={focusIdx}
          onRowClick={onRowClick}
          onRowDouble={open}
          onContext={onContext}
          sort={sort}
          setSort={setSort}
          showLocation={!!query.trim()}
          onDragStart={onDragStart}
          onKeyDown={onKeyDown}
          tableRef={tableRef}
        />
      </div>

      <div className="statusbar">
        <span>{fmtCount(rows.length)}개 항목</span>
        {selNodes.length > 0 && <span>{fmtCount(selNodes.length)}개 선택 · {fmtSize(selSize)}</span>}
        <span className="spacer" />
        {archive.encrypted && <span className="badge"><Icon name="lock" size={11} /> 암호</span>}
        {!archive.editable && <span className="badge muted-badge" title="이 형식은 목록 보기·풀기만 가능합니다">읽기 전용</span>}
        <span className="badge">{info.Type || '?'}</span>
        <span className="muted">
          파일 {fmtCount(tree.root.files)}개 · {fmtSize(tree.root.size)}
          {tree.root.packed ? ` → ${fmtSize(Number(info['Physical Size']) || tree.root.packed)} (${ratio(tree.root.size, Number(info['Physical Size']) || tree.root.packed)} 절약)` : ''}
        </span>
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
