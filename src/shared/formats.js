// 메인·렌더러가 함께 쓰는 포맷 정의

// 열기(목록 보기/풀기) 가능한 확장자 — 파일 선택 필터, 파일 연결, 우클릭 메뉴에 쓰인다
export const ARCHIVE_EXTS = [
  '7z', 'zip', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'tbz', 'xz', 'txz', 'zst', 'tzst',
  'lzma', 'tlz', 'z', 'taz', 'iso', 'cab', 'arj', 'lzh', 'lha', 'wim', 'cpio', 'rpm', 'deb',
  'jar', 'war', 'apk', 'xpi', 'zipx', '001', 'dmg', 'xar', 'squashfs', 'vhd', 'vhdx', 'udf'
]

// 파일 연결·우클릭 "풀기" 대상으로 등록할 흔한 확장자 (전부 등록하면 OS 가 지저분해진다)
export const ASSOC_EXTS = ['7z', 'zip', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'iso', 'cab', 'arj', 'lzh', 'lha', 'wim', 'zipx', '001']

// 한 번에 풀려면 7z 두 개를 파이프로 이어야 하는 "압축된 tar"
const COMPOUND_TAR = /\.(tar\.(gz|bz2|xz|zst|lzma|z)|tgz|tbz2?|txz|tzst|tlz|taz)$/i
export const isCompoundTar = (p) => COMPOUND_TAR.test(p)

export const COMPRESS_FORMATS = [
  { id: '7z', label: '7Z', ext: '.7z', password: true, encryptNames: true, volumes: true },
  { id: 'zip', label: 'ZIP', ext: '.zip', password: true, volumes: true },
  { id: 'tar', label: 'TAR', ext: '.tar', volumes: true },
  { id: 'tgz', label: 'TAR.GZ', ext: '.tar.gz', volumes: true },
  { id: 'txz', label: 'TAR.XZ', ext: '.tar.xz', volumes: true },
  { id: 'tbz2', label: 'TAR.BZ2', ext: '.tar.bz2', volumes: true }
]
export const formatById = (id) => COMPRESS_FORMATS.find((f) => f.id === id) || COMPRESS_FORMATS[0]

export const LEVELS = [
  { v: 0, label: '저장 (압축 안 함)' },
  { v: 1, label: '가장 빠르게' },
  { v: 3, label: '빠르게' },
  { v: 5, label: '보통' },
  { v: 7, label: '최대' },
  { v: 9, label: '울트라' }
]

// 파일 이름에서 압축 확장자를 떼어 "기본 이름"을 만든다 (폴더 이름·출력 이름용)
const STRIP = [
  /\.(tar\.(gz|bz2|xz|zst|lzma|z))$/i,
  /\.part0*1\.rar$/i,
  /\.(7z|zip|rar|tar|wim)\.0*1$/i,
  /\.(7z|zip|rar|tar|gz|tgz|bz2|tbz2|tbz|xz|txz|zst|tzst|lzma|tlz|z|taz|iso|cab|arj|lzh|lha|wim|cpio|rpm|deb|jar|war|apk|xpi|zipx|001|dmg|xar|squashfs|vhdx?|udf)$/i
]
export function archiveBaseName(fileName) {
  for (const re of STRIP) if (re.test(fileName)) return fileName.replace(re, '') || fileName
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function isArchiveName(fileName) {
  const n = fileName.toLowerCase()
  if (isCompoundTar(n)) return true
  if (/\.(7z|zip|rar|tar|wim)\.\d{3}$/.test(n) || /\.part\d+\.rar$/.test(n) || /\.r\d{2}$/.test(n) || /\.z\d{2}$/.test(n)) return true
  const ext = n.slice(n.lastIndexOf('.') + 1)
  return ARCHIVE_EXTS.includes(ext)
}

// 분할 압축의 2번째 이후 조각인지 (여러 조각을 한꺼번에 선택해 "풀기" 했을 때 첫 조각만 풀기 위함)
export function isSecondaryVolume(fileName) {
  const n = fileName.toLowerCase()
  let m = n.match(/\.(?:7z|zip|rar|tar|wim)\.(\d{3})$/) || n.match(/\.(\d{3})$/)
  if (m) return parseInt(m[1], 10) > 1
  m = n.match(/\.part(\d+)\.rar$/)
  if (m) return parseInt(m[1], 10) > 1
  return /\.r\d{2}$/.test(n) || /\.z\d{2}$/.test(n)
}

export const CODEPAGES = [
  { v: '', label: '자동 (시스템 기본)' },
  { v: '949', label: '한국어 (CP949)' },
  { v: '65001', label: 'UTF-8' },
  { v: '932', label: '일본어 (Shift-JIS)' },
  { v: '936', label: '중국어 간체 (GBK)' },
  { v: '950', label: '중국어 번체 (Big5)' },
  { v: '1252', label: '서유럽 (CP1252)' },
  { v: '866', label: '러시아어 (CP866)' }
]
