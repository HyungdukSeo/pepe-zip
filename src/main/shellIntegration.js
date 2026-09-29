// OS 파일 관리자의 우클릭 메뉴·파일 연결 등록/해제.
// 모두 "사용자 단위"로만 등록한다(관리자 권한 불필요, 제거 시 흔적 없이 지워짐).
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdir, rm, chmod, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { ASSOC_EXTS } from '../shared/formats.js'

const run = promisify(execFile)
const APP_NAME = 'PePe Zip'

/** 이 앱을 다시 실행하는 명령 (개발 모드면 electron + 앱 경로) */
function launcher() {
  const exe = process.env.APPIMAGE || process.execPath
  return { exe, pre: process.defaultApp ? [app.getAppPath()] : [] }
}

const ARCHIVE_MENU = [
  ['open', '--open', 'PePe Zip으로 열기'],
  ['smart', '--extract-smart', '자동으로 풀기'],
  ['here', '--extract-here', '여기에 풀기'],
  ['folder', '--extract-folder', '압축 파일 이름의 폴더에 풀기'],
  ['to', '--extract-to', '풀 위치 선택…'],
  ['test', '--test', '압축 파일 검사'],
  ['compress', '--compress', '압축하기…', true]
]
const FILE_MENU = [
  ['compress', '--compress', '압축하기…'],
  ['zip', '--zip', 'ZIP으로 바로 압축'],
  ['7z', '--7z', '7Z로 바로 압축']
]

// ═════════════════════════ Windows ═════════════════════════
const regStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const winCmd = (flag) => {
  const { exe, pre } = launcher()
  return [exe, ...pre].map((p) => `"${p}"`).join(' ') + ` ${flag} "%1"`
}
const CLASSES = 'HKEY_CURRENT_USER\\Software\\Classes'
const PROGID = 'PePeZip.Archive'

function winMenuBlock(base, items, extra = []) {
  const { exe } = launcher()
  const out = [
    `[${base}]`,
    `"MUIVerb"=${regStr(APP_NAME)}`,
    `"Icon"=${regStr(`${exe},0`)}`,
    `"SubCommands"=""`,
    `"MultiSelectModel"="Player"`,
    ...extra,
    ''
  ]
  items.forEach(([key, flag, label, sepBefore], i) => {
    const k = `${base}\\shell\\${String(i + 1).padStart(2, '0')}${key}`
    out.push(`[${k}]`, `"MUIVerb"=${regStr(label)}`)
    if (sepBefore) out.push('"CommandFlags"=dword:00000020')
    out.push('', `[${k}\\command]`, `@=${regStr(winCmd(flag))}`, '')
  })
  return out
}

function winKeys() {
  return {
    all: `${CLASSES}\\*\\shell\\PePeZip`,
    dir: `${CLASSES}\\Directory\\shell\\PePeZip`,
    ext: ASSOC_EXTS.map((e) => `${CLASSES}\\SystemFileAssociations\\.${e}\\shell\\PePeZip`)
  }
}

async function regImport(lines) {
  // reg import 는 UTF-16LE + BOM 이어야 한글이 안 깨진다
  const dir = await mkdtemp(join(os.tmpdir(), 'pepezip-reg-'))
  const f = join(dir, 'pz.reg')
  const text = ['Windows Registry Editor Version 5.00', '', ...lines, ''].join('\r\n')
  await writeFile(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
  try {
    await run('reg.exe', ['import', f], { windowsHide: true })
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const win = {
  async status() {
    const q = (k) => run('reg.exe', ['query', k.replace('HKEY_CURRENT_USER', 'HKCU')], { windowsHide: true }).then(() => true, () => false)
    const k = winKeys()
    return { contextMenu: await q(k.all), associations: await q(`${CLASSES}\\${PROGID}`) }
  },
  async install({ contextMenu = true, associations = true } = {}) {
    const k = winKeys()
    const lines = []
    if (contextMenu) {
      await win.uninstall({ contextMenu: true, associations: false }) // 항목이 바뀌었을 수 있으니 깨끗이 다시
      // 일반 파일: 압축 메뉴만. 압축 파일에는 아래 확장자별 메뉴가 뜨므로 AppliesTo 로 제외한다.
      const not = ASSOC_EXTS.map((e) => `System.FileExtension:=.${e}`).join(' OR ')
      lines.push(...winMenuBlock(k.all, FILE_MENU, [`"AppliesTo"=${regStr(`NOT (${not})`)}`]))
      lines.push(...winMenuBlock(k.dir, FILE_MENU))
      for (const key of k.ext) lines.push(...winMenuBlock(key, ARCHIVE_MENU))
    }
    if (associations) {
      const { exe, pre } = launcher()
      const open = [exe, ...pre].map((p) => `"${p}"`).join(' ') + ' "%1"'
      lines.push(
        `[${CLASSES}\\${PROGID}]`, `@=${regStr('PePe Zip 압축 파일')}`, '',
        `[${CLASSES}\\${PROGID}\\DefaultIcon]`, `@=${regStr(`${exe},0`)}`, '',
        `[${CLASSES}\\${PROGID}\\shell\\open\\command]`, `@=${regStr(open)}`, ''
      )
      // "연결 프로그램" 후보로 등록 — 기본 앱 지정은 Windows 정책상 사용자가 설정 앱에서 직접 해야 한다
      for (const e of ASSOC_EXTS) lines.push(`[${CLASSES}\\.${e}\\OpenWithProgids]`, `"${PROGID}"=hex(0):`, '')
    }
    if (lines.length) await regImport(lines)
  },
  async uninstall({ contextMenu = true, associations = true } = {}) {
    const k = winKeys()
    const lines = []
    if (contextMenu) for (const key of [k.all, k.dir, ...k.ext]) lines.push(`[-${key}]`, '')
    if (associations) {
      lines.push(`[-${CLASSES}\\${PROGID}]`, '')
      for (const e of ASSOC_EXTS) lines.push(`[${CLASSES}\\.${e}\\OpenWithProgids]`, `"${PROGID}"=-`, '')
    }
    await regImport(lines)
  }
}

// ═════════════════════════ macOS (Finder 빠른 동작) ═════════════════════════
const MAC_SERVICES = join(os.homedir(), 'Library', 'Services')
const MAC_ITEMS = [
  ['--extract-smart', '자동으로 풀기', true],
  ['--extract-to', '풀 위치 선택…', true],
  ['--open', '열기', true],
  ['--compress', '압축하기…', false],
  ['--zip', 'ZIP으로 바로 압축', false]
]
const macWorkflowName = (label) => `${APP_NAME} - ${label.replace('…', '')}.workflow`
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

function macInfoPlist(label, archivesOnly) {
  const types = archivesOnly
    ? ['public.archive', 'public.zip-archive', 'org.7-zip.7-zip-archive', 'com.rarlab.rar-archive', 'public.tar-archive', 'org.gnu.gnu-zip-archive', 'public.bzip2-archive', 'org.tukaani.xz-archive', 'public.iso-image']
    : ['public.item']
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>NSServices</key><array><dict>
    <key>NSBackgroundColorName</key><string>background</string>
    <key>NSIconName</key><string>NSActionTemplate</string>
    <key>NSMenuItem</key><dict><key>default</key><string>${xml(`${APP_NAME}: ${label}`)}</string></dict>
    <key>NSMessage</key><string>runWorkflowAsService</string>
    <key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>
    <key>NSSendFileTypes</key><array>${types.map((t) => `<string>${t}</string>`).join('')}</array>
  </dict></array>
</dict></plist>`
}

function macWflow(flag) {
  const { exe, pre } = launcher()
  const cmd = `${[exe, ...pre].map(shq).join(' ')} ${flag} "$@" >/dev/null 2>&1 &`
  const uuid = () => crypto.randomUUID().toUpperCase()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>AMApplicationBuild</key><string>523</string>
  <key>AMApplicationVersion</key><string>2.10</string>
  <key>AMDocumentVersion</key><string>2</string>
  <key>actions</key><array><dict><key>action</key><dict>
    <key>AMAccepts</key><dict><key>Container</key><string>List</string><key>Optional</key><true/><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
    <key>AMActionVersion</key><string>2.0.3</string>
    <key>AMApplication</key><array><string>Automator</string></array>
    <key>AMParameterProperties</key><dict>
      <key>COMMAND_STRING</key><dict/><key>CheckedForUserDefaultShell</key><dict/><key>inputMethod</key><dict/><key>shell</key><dict/><key>source</key><dict/>
    </dict>
    <key>AMProvides</key><dict><key>Container</key><string>List</string><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
    <key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
    <key>ActionName</key><string>Run Shell Script</string>
    <key>ActionParameters</key><dict>
      <key>COMMAND_STRING</key><string>${xml(cmd)}</string>
      <key>CheckedForUserDefaultShell</key><true/>
      <key>inputMethod</key><integer>1</integer>
      <key>shell</key><string>/bin/bash</string>
      <key>source</key><string></string>
    </dict>
    <key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
    <key>CFBundleVersion</key><string>2.0.3</string>
    <key>CanShowSelectedItemsWhenRun</key><false/>
    <key>CanShowWhenRun</key><true/>
    <key>Category</key><array><string>AMCategoryUtilities</string></array>
    <key>Class Name</key><string>RunShellScriptAction</string>
    <key>InputUUID</key><string>${uuid()}</string>
    <key>Keywords</key><array><string>Shell</string></array>
    <key>OutputUUID</key><string>${uuid()}</string>
    <key>UUID</key><string>${uuid()}</string>
    <key>UnlocalizedApplications</key><array><string>Automator</string></array>
    <key>arguments</key><dict/>
    <key>isViewVisible</key><integer>1</integer>
    <key>location</key><string>309.000000:253.000000</string>
    <key>nibPath</key><string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
  </dict><key>isViewVisible</key><integer>1</integer></dict></array>
  <key>connectors</key><dict/>
  <key>workflowMetaData</key><dict>
    <key>applicationBundleIDsByPath</key><dict/>
    <key>applicationPaths</key><array/>
    <key>inputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string>
    <key>outputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
    <key>presentationMode</key><integer>15</integer>
    <key>processesInput</key><false/>
    <key>serviceApplicationBundleID</key><string>com.apple.finder</string>
    <key>serviceApplicationPath</key><string>/System/Library/CoreServices/Finder.app</string>
    <key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string>
    <key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
    <key>serviceProcessesInput</key><false/>
    <key>systemImageName</key><string>NSActionTemplate</string>
    <key>useAutomaticInputType</key><false/>
    <key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
  </dict>
</dict></plist>`
}

const mac = {
  async status() {
    return { contextMenu: existsSync(join(MAC_SERVICES, macWorkflowName(MAC_ITEMS[0][1]))), associations: null }
  },
  async install({ contextMenu = true } = {}) {
    if (!contextMenu) return
    for (const [flag, label, archivesOnly] of MAC_ITEMS) {
      const dir = join(MAC_SERVICES, macWorkflowName(label), 'Contents')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'Info.plist'), macInfoPlist(label, archivesOnly))
      await writeFile(join(dir, 'document.wflow'), macWflow(flag))
    }
    await run('/System/Library/CoreServices/pbs', ['-update']).catch(() => {})
  },
  async uninstall() {
    for (const [, label] of MAC_ITEMS) await rm(join(MAC_SERVICES, macWorkflowName(label)), { recursive: true, force: true })
    await run('/System/Library/CoreServices/pbs', ['-update']).catch(() => {})
  }
}

// ═════════════════════════ Linux (Nautilus / Nemo / Dolphin / .desktop) ═════════════════════════
const XDG_DATA = process.env.XDG_DATA_HOME || join(os.homedir(), '.local', 'share')
const L = {
  nautilus: join(XDG_DATA, 'nautilus', 'scripts', APP_NAME),
  nemo: join(XDG_DATA, 'nemo', 'actions'),
  dolphin: join(XDG_DATA, 'kio', 'servicemenus', 'pepezip.desktop'),
  desktop: join(XDG_DATA, 'applications', 'pepezip.desktop')
}
const MIME = [
  'application/zip', 'application/x-7z-compressed', 'application/vnd.rar', 'application/x-rar', 'application/x-tar',
  'application/gzip', 'application/x-compressed-tar', 'application/x-bzip2', 'application/x-bzip-compressed-tar',
  'application/x-xz', 'application/x-xz-compressed-tar', 'application/zstd', 'application/x-iso9660-image',
  'application/vnd.ms-cab-compressed', 'application/x-arj', 'application/x-lha', 'application/x-cpio'
]
const LINUX_ITEMS = [
  ['smart', '--extract-smart', '자동으로 풀기', true],
  ['to', '--extract-to', '풀 위치 선택…', true],
  ['open', '--open', 'PePe Zip으로 열기', true],
  ['compress', '--compress', '압축하기…', false],
  ['zip', '--zip', 'ZIP으로 바로 압축', false]
]
// .desktop Exec 인자 인용 규칙
const deskq = (s) => `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`
const linuxExec = (flag) => {
  const { exe, pre } = launcher()
  return `${[exe, ...pre].map(deskq).join(' ')} ${flag} %F`
}

const linux = {
  async status() {
    return { contextMenu: existsSync(L.nautilus) || existsSync(L.dolphin), associations: existsSync(L.desktop) }
  },
  async install({ contextMenu = true, associations = true } = {}) {
    const { exe, pre } = launcher()
    if (contextMenu) {
      await linux.uninstall({ contextMenu: true, associations: false })
      // Nautilus: 우클릭 > 스크립트 > PePe Zip
      await mkdir(L.nautilus, { recursive: true })
      for (const [, flag, label] of LINUX_ITEMS) {
        const f = join(L.nautilus, label.replace('…', ''))
        await writeFile(f, `#!/bin/sh\nexec ${[exe, ...pre].map(shq).join(' ')} ${flag} "$@"\n`)
        await chmod(f, 0o755)
      }
      // Nemo (Cinnamon)
      await mkdir(L.nemo, { recursive: true })
      for (const [key, flag, label, arch] of LINUX_ITEMS) {
        await writeFile(
          join(L.nemo, `pepezip-${key}.nemo_action`),
          `[Nemo Action]\nName=${APP_NAME}: ${label}\nExec=${linuxExec(flag)}\nIcon-Name=package-x-generic\nSelection=notnone\n` +
            (arch ? `Mimetypes=${MIME.join(';')};\n` : 'Extensions=any;\n')
        )
      }
      // Dolphin (KDE)
      await mkdir(join(L.dolphin, '..'), { recursive: true })
      const acts = LINUX_ITEMS.map(([k]) => k)
      await writeFile(
        L.dolphin,
        `[Desktop Entry]\nType=Service\nMimeType=all/allfiles;inode/directory;\nActions=${acts.join(';')};\nX-KDE-Submenu=${APP_NAME}\n\n` +
          LINUX_ITEMS.map(([k, flag, label]) => `[Desktop Action ${k}]\nName=${label}\nIcon=package-x-generic\nExec=${linuxExec(flag)}\n`).join('\n')
      )
      await chmod(L.dolphin, 0o755)
    }
    if (associations) {
      await mkdir(join(L.desktop, '..'), { recursive: true })
      await writeFile(
        L.desktop,
        `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nComment=압축 파일 관리자\nExec=${[exe, ...pre].map(deskq).join(' ')} %F\nIcon=package-x-generic\nCategories=Utility;Archiving;Compression;\nMimeType=${MIME.join(';')};\nTerminal=false\n`
      )
      await run('update-desktop-database', [join(L.desktop, '..')]).catch(() => {})
      await run('xdg-mime', ['default', 'pepezip.desktop', ...MIME]).catch(() => {})
    }
  },
  async uninstall({ contextMenu = true, associations = true } = {}) {
    if (contextMenu) {
      await rm(L.nautilus, { recursive: true, force: true })
      for (const [key] of LINUX_ITEMS) await rm(join(L.nemo, `pepezip-${key}.nemo_action`), { force: true })
      await rm(L.dolphin, { force: true })
    }
    if (associations) {
      await rm(L.desktop, { force: true })
      await run('update-desktop-database', [join(L.desktop, '..')]).catch(() => {})
    }
  }
}

const impl = { win32: win, darwin: mac, linux }[process.platform]

export const shellIntegration = {
  platform: process.platform,
  status: () => (impl ? impl.status() : { contextMenu: false, associations: false }),
  install: (o) => impl?.install(o),
  uninstall: (o) => impl?.uninstall(o)
}
