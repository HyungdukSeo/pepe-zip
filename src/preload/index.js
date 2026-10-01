import { contextBridge, ipcRenderer, webUtils } from 'electron'

// 메인은 { ok, value } | { ok:false, kind, message } 로 돌려준다 → 실패는 kind 가 붙은 Error 로 던진다
async function call(ch, ...args) {
  const r = await ipcRenderer.invoke(ch, ...args)
  if (r.ok) return r.value
  const e = new Error(r.message)
  e.kind = r.kind
  throw e
}

const on = (ch) => (cb) => {
  const h = (_e, v) => cb(v)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

contextBridge.exposeInMainWorld('pz', {
  init: () => call('init'),
  list: (archive, opts) => call('list', archive, opts),

  startTask: (kind, params) => call('task:start', kind, params),
  retryTask: (id, patch) => call('task:retry', id, patch),
  cancelTask: (id) => call('task:cancel', id),
  dismissTask: (id) => call('task:dismiss', id),

  openArchiveDialog: () => call('dialog:openArchive'),
  pick: (opts) => call('dialog:pick', opts),
  chooseDir: (p) => call('dialog:chooseDir', p),
  saveAs: (p, format) => call('dialog:saveAs', p, format),

  stat: (paths) => call('fs:stat', paths),
  exists: (p) => call('fs:exists', p),
  defaultOutput: (sources, format) => call('fs:defaultOutput', sources, format),

  openPath: (p) => call('shell:open', p),
  reveal: (p) => call('shell:reveal', p),
  openDefaultApps: () => call('shell:defaultApps'),

  openEntry: (o) => call('archive:openEntry', o),
  deleteEntries: (o) => call('archive:delete', o),
  renameEntries: (o) => call('archive:rename', o),
  dragOut: (o) => ipcRenderer.send('drag-out', o),

  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  addRecentJnlp: (p) => call('recent:addJnlp', p),
  removeRecent: (p, type) => call('recent:remove', { path: p, type }),
  clearRecent: (type) => call('recent:clear', type),

  integrationStatus: () => call('shell:status'),
  integrationInstall: (o) => call('shell:install', o),
  integrationUninstall: (o) => call('shell:uninstall', o),

  fitWindow: (h) => call('window:fit', h),
  setWindowArchive: (p) => call('window:setArchive', p),
  closeWindow: (force) => call('window:close', force),
  newWindow: () => call('window:newFull'),

  // JNLP
  launchJnlp: (p) => call('jnlp:launch', p),
  startJnlp: (p) => call('jnlp:start', p),
  stopJnlp: () => call('jnlp:stop'),
  activateJnlp: () => call('jnlp:activate'),
  openJnlpCache: () => call('jnlp:openCache'),
  getJreInfo: () => call('jnlp:getJreInfo'),
  onJnlpEvent: on('jnlp:event'),

  // Electron 32+ 에서 File.path 가 사라져 드롭한 파일의 경로는 이걸로 얻는다
  pathForFile: (f) => webUtils.getPathForFile(f),

  onTask: on('task'),
  onAction: on('action'),
  onToast: on('toast'),
  onConfirmClose: on('confirm-close')
})
