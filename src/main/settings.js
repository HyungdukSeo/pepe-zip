// 설정은 userData/settings.json 에 둔다 (렌더러 localStorage 는 다중 실행 시 잠금 문제가 있어 쓰지 않음)
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DEFAULTS = {
  theme: 'system', // system | light | dark
  compress: { format: 'zip', level: 5, zipCrypto: false, encryptNames: true, solid: true, openFolder: false },
  extract: { mode: 'smart', overwrite: 'overwrite', codepage: '', openFolder: true },
  autoCloseProgress: true,
  recent: []
}

let cache
const file = () => join(app.getPath('userData'), 'settings.json')

function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v
  }
  return out
}

export function getSettings() {
  if (cache) return cache
  try {
    cache = merge(DEFAULTS, JSON.parse(readFileSync(file(), 'utf8')))
  } catch {
    cache = structuredClone(DEFAULTS)
  }
  return cache
}

export function setSettings(patch) {
  cache = merge(getSettings(), patch)
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(cache, null, 2))
  } catch (e) {
    console.error('settings save failed', e)
  }
  return cache
}

export function addRecent(path) {
  const recent = [path, ...getSettings().recent.filter((p) => p !== path)].slice(0, 12)
  return setSettings({ recent })
}
