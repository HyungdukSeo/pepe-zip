// 렌더러 공용 유틸 (경로·형식·트리)

let OS_SEP = '/'
export const setPlatform = (p) => (OS_SEP = p === 'win32' ? '\\' : '/')
export const osSep = () => OS_SEP

export function basename(p) {
  const s = p.replace(/[\\/]+$/, '')
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1)
}
export function dirname(p) {
  const s = p.replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i < 0) return ''
  if (i === 0) return s[0] // "/"
  if (/^[A-Za-z]:$/.test(s.slice(0, i))) return s.slice(0, i + 1) // "C:\"
  return s.slice(0, i)
}
export function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') || p : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(OS_SEP)
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
export function fmtSize(n) {
  if (n == null || isNaN(n)) return ''
  if (n < 1024) return `${n} B`
  let i = 0
  let v = n
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${UNITS[i]}`
}
export const fmtCount = (n) => n.toLocaleString('ko-KR')

// 7z 의 "2026-09-29 11:26:31.8050431" → "2026-09-29 11:26"
export const fmtDate = (s) => (s ? s.slice(0, 16) : '')

export function ratio(size, packed) {
  if (!size || packed == null) return ''
  return `${Math.max(0, Math.round((1 - packed / size) * 100))}%`
}

const CATS = [
  ['image', /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?|heic|avif|psd)$/i],
  ['video', /\.(mp4|mkv|avi|mov|wmv|webm|flv|m4v|ts)$/i],
  ['audio', /\.(mp3|wav|flac|aac|ogg|m4a|wma|opus)$/i],
  ['archive', /\.(7z|zip|rar|tar|gz|tgz|bz2|xz|zst|iso|cab|arj|lzh|wim|jar|apk|dmg|\d{3})$/i],
  ['doc', /\.(pdf|docx?|xlsx?|pptx?|hwpx?|txt|md|rtf|odt|ods|odp|csv|epub)$/i],
  ['code', /\.(js|jsx|ts|tsx|json|html?|css|scss|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|sh|bat|ps1|xml|ya?ml|toml|ini|sql|kt|swift)$/i],
  ['exe', /\.(exe|msi|dll|app|deb|rpm|appimage|bin|so|dylib)$/i]
]
export const fileCategory = (name) => CATS.find(([, re]) => re.test(name))?.[0] || 'file'

export function typeLabel(node) {
  if (node.isDir) return '폴더'
  const i = node.name.lastIndexOf('.')
  return i > 0 ? `${node.name.slice(i + 1).toUpperCase()} 파일` : '파일'
}

// ───── 압축 파일 항목 → 트리 ─────
function mk(name, key, path, parent, isDir) {
  return { name, key, path, parent, isDir, implicit: true, children: isDir ? new Map() : null, size: 0, packed: 0, mtime: '', crc: '', encrypted: false, method: '', files: 0, dirs: 0 }
}

export function buildTree(entries, sep) {
  const root = mk('', '', '', null, true)
  root.implicit = false
  const byKey = new Map([['', root]])
  for (const e of entries) {
    const parts = e.path.split(sep).filter((p) => p && p !== '.')
    if (!parts.length) continue
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1
      let child = node.children.get(parts[i])
      if (!child) {
        const key = node.key ? `${node.key}/${parts[i]}` : parts[i]
        child = mk(parts[i], key, parts.slice(0, i + 1).join(sep), node, !last || e.isDir)
        node.children.set(parts[i], child)
        byKey.set(key, child)
      } else if (!last && !child.isDir) {
        // 같은 이름의 파일과 폴더가 겹치는 이상한 아카이브 — 폴더로 취급
        child.isDir = true
        child.children = new Map()
      }
      if (last) {
        child.implicit = false
        child.path = e.path
        child.isDir = child.isDir || e.isDir
        if (child.isDir && !child.children) child.children = new Map()
        Object.assign(child, { size: e.isDir ? 0 : e.size, packed: e.packed ?? 0, mtime: e.mtime, crc: e.crc, encrypted: e.encrypted, method: e.method })
      }
      node = child
    }
  }
  ;(function agg(n) {
    if (!n.isDir) return
    let s = 0, p = 0, f = 0, d = 0
    for (const c of n.children.values()) {
      agg(c)
      s += c.size
      p += c.packed || 0
      if (c.isDir) { f += c.files; d += 1 + c.dirs } else f++
      if (c.encrypted) n.hasEncrypted = true
      if (c.hasEncrypted) n.hasEncrypted = true
    }
    n.size = s; n.packed = p; n.files = f; n.dirs = d
  })(root)
  return { root, byKey }
}

/** 노드들과 그 하위의 "실제로 존재하는" 항목 경로 (7z 목록 파일용) */
export function collectPaths(nodes) {
  const out = []
  const walk = (n) => {
    if (!n.implicit && n.key) out.push(n.path)
    if (n.children) for (const c of n.children.values()) walk(c)
  }
  nodes.forEach(walk)
  return out
}

export const anyEncrypted = (nodes) => nodes.some((n) => n.encrypted || n.hasEncrypted)

export function sortNodes(list, { key, dir }) {
  const m = dir === 'asc' ? 1 : -1
  const cmpName = (a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' })
  return [...list].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    if (key === 'size') r = a.size - b.size
    else if (key === 'packed') r = (a.packed || 0) - (b.packed || 0)
    else if (key === 'mtime') r = (a.mtime || '').localeCompare(b.mtime || '')
    else if (key === 'type') r = typeLabel(a).localeCompare(typeLabel(b))
    return (r || cmpName(a, b)) * m
  })
}
