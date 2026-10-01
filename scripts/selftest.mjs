// 엔진·작업 로직 통합 테스트:  npx electron scripts/selftest.mjs
import { app } from 'electron'
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'

const ROOT = join(import.meta.dirname, '..')
process.env.PEPEZIP_BIN_DIR = join(ROOT, 'resources', 'bin', `${process.platform}-${process.arch}`)
const sz = await import('../src/main/sevenzip.js')
const { extractJob, compressJob, testJob, addJob } = await import('../src/main/jobs.js')

const T = join(os.tmpdir(), 'pepezip-selftest')
rmSync(T, { recursive: true, force: true })
const src = join(T, 'src')
mkdirSync(join(src, '프로젝트', '하위 폴더'), { recursive: true })
writeFileSync(join(src, '프로젝트', 'readme.txt'), '안녕하세요')
writeFileSync(join(src, '프로젝트', '하위 폴더', 'data.bin'), randomBytes(200000))
writeFileSync(join(src, 'loose.txt'), 'loose')
writeFileSync(join(src, 'big.bin'), randomBytes(40 * 1024 * 1024))

let pass = 0
let fail = 0
const ctx = () => ({ progress: () => {}, status: () => {}, signal: new AbortController().signal })
async function t(name, fn) {
  try {
    await fn()
    pass++
    console.log('  ✓', name)
  } catch (e) {
    fail++
    console.log('  ✗', name, '→', e.kind || '', e.message)
  }
}
const ok = (c, m) => {
  if (!c) throw new Error(m || 'assert')
}
const rejects = async (p, kind) => {
  try {
    await p
  } catch (e) {
    ok(e.kind === kind, `expected ${kind}, got ${e.kind}: ${e.message}`)
    return
  }
  throw new Error(`expected ${kind}, resolved`)
}

const P = (n) => join(src, n)
const out = (n) => join(T, 'out', n)
const SEP = sz.ENTRY_SEP

await t('7z 압축 + 이름 암호화', async () => {
  const r = await compressJob({ sources: [P('프로젝트')], output: out('enc.7z'), format: '7z', level: 5, password: '비번123', encryptNames: true }, ctx())
  ok(existsSync(r.output))
})
await t('암호 없이 목록 → password 오류', () => rejects(sz.list(out('enc.7z')), 'password'))
await t('맞는 암호로 목록', async () => {
  const r = await sz.list(out('enc.7z'), { password: '비번123' })
  ok(r.entries.some((e) => e.path.endsWith('readme.txt')), JSON.stringify(r.entries.map((e) => e.path)))
  ok(r.editable && r.encrypted)
})
await t('풀기: 암호 없음 → password', () => rejects(extractJob({ archive: out('enc.7z'), dest: join(T, 'x1') }, ctx()), 'password'))
await t('풀기: 틀린 암호 → password, 찌꺼기 없음', async () => {
  await rejects(extractJob({ archive: out('enc.7z'), dest: join(T, 'x1'), password: 'nope' }, ctx()), 'password')
  ok(readdirSync(join(T, 'x1')).length === 0, readdirSync(join(T, 'x1')).join())
})
await t('스마트 풀기: 최상위 폴더 하나 → 그대로', async () => {
  const r = await extractJob({ archive: out('enc.7z'), dest: join(T, 'x1'), password: '비번123', mode: 'smart' }, ctx())
  ok(existsSync(join(T, 'x1', '프로젝트', '하위 폴더', 'data.bin')))
  ok(readFileSync(join(T, 'x1', '프로젝트', 'readme.txt'), 'utf8') === '안녕하세요')
  ok(r.openPath.endsWith('프로젝트'))
})
await t('ZIP (한글, 여러 항목) + 스마트 풀기 → 폴더 생성', async () => {
  await compressJob({ sources: [P('프로젝트'), P('loose.txt')], output: out('여러개.zip'), format: 'zip', level: 5 }, ctx())
  const r = await extractJob({ archive: out('여러개.zip'), dest: join(T, 'x2'), mode: 'smart' }, ctx())
  ok(existsSync(join(T, 'x2', '여러개', 'loose.txt')) && existsSync(join(T, 'x2', '여러개', '프로젝트', 'readme.txt')), readdirSync(join(T, 'x2')).join())
  ok(r.openPath.endsWith('여러개'))
})
await t('덮어쓰기 정책: skip / rename / overwrite', async () => {
  writeFileSync(join(T, 'x2', '여러개', 'loose.txt'), 'CHANGED')
  let r = await extractJob({ archive: out('여러개.zip'), dest: join(T, 'x2'), mode: 'smart', overwrite: 'skip' }, ctx())
  ok(readFileSync(join(T, 'x2', '여러개', 'loose.txt'), 'utf8') === 'CHANGED' && r.skipped >= 1)
  r = await extractJob({ archive: out('여러개.zip'), dest: join(T, 'x2'), mode: 'smart', overwrite: 'rename' }, ctx())
  ok(existsSync(join(T, 'x2', '여러개', 'loose (2).txt')), readdirSync(join(T, 'x2', '여러개')).join())
  r = await extractJob({ archive: out('여러개.zip'), dest: join(T, 'x2'), mode: 'smart', overwrite: 'overwrite' }, ctx())
  ok(readFileSync(join(T, 'x2', '여러개', 'loose.txt'), 'utf8') === 'loose')
})
await t('ZIP AES 암호 (헤더 공개) → 목록 OK, 풀기는 암호 요구', async () => {
  await compressJob({ sources: [P('loose.txt')], output: out('aes.zip'), format: 'zip', level: 5, password: 'pw' }, ctx())
  const r = await sz.list(out('aes.zip'))
  ok(r.encrypted && r.entries.length === 1)
  await rejects(extractJob({ archive: out('aes.zip'), dest: join(T, 'x3') }, ctx()), 'password')
  await extractJob({ archive: out('aes.zip'), dest: join(T, 'x3'), password: 'pw' }, ctx())
  ok(existsSync(join(T, 'x3', 'loose.txt')))
})
for (const f of ['tgz', 'txz', 'tbz2', 'tar']) {
  await t(`${f} 압축 → 목록(파이프) → 풀기`, async () => {
    const r = await compressJob({ sources: [P('프로젝트')], output: out(`p-${f}`), format: f, level: 5 }, ctx())
    const l = await sz.list(r.output)
    ok(l.entries.some((e) => e.path.endsWith('data.bin')), `${r.output}: ${l.entries.map((e) => e.path)}`)
    ok(f === 'tar' || l.compound, 'compound')
    await extractJob({ archive: r.output, dest: join(T, `x-${f}`), mode: 'smart' }, ctx())
    ok(existsSync(join(T, `x-${f}`, '프로젝트', '하위 폴더', 'data.bin')))
  })
}
await t('분할 압축 → .001 로 목록/풀기', async () => {
  const r = await compressJob({ sources: [P('프로젝트')], output: out('vol.7z'), format: '7z', level: 0, volumeSize: 50 * 1024 }, ctx())
  ok(r.output.endsWith('.001'), r.output)
  const l = await sz.list(r.output)
  ok(!l.editable, 'multivolume should be read-only')
  await extractJob({ archive: r.output, dest: join(T, 'x-vol'), mode: 'folder' }, ctx())
  ok(existsSync(join(T, 'x-vol', 'vol', '프로젝트', 'readme.txt')), readdirSync(join(T, 'x-vol')).join())
})
await t('선택 항목만 풀기 (stripPrefix)', async () => {
  await extractJob(
    { archive: out('여러개.zip'), dest: join(T, 'x-sel'), mode: 'here', files: [`프로젝트${SEP}하위 폴더`, `프로젝트${SEP}하위 폴더${SEP}data.bin`], stripPrefix: '프로젝트' },
    ctx()
  )
  ok(existsSync(join(T, 'x-sel', '하위 폴더', 'data.bin')) && !existsSync(join(T, 'x-sel', 'loose.txt')), readdirSync(join(T, 'x-sel')).join())
})
await t('편집: 하위 폴더에 추가 / 이름 바꾸기 / 삭제', async () => {
  const a = out('여러개.zip')
  await addJob({ archive: a, sources: [P('loose.txt')], inside: `프로젝트${SEP}하위 폴더` }, ctx())
  let l = await sz.list(a)
  ok(l.entries.some((e) => e.path === `프로젝트${SEP}하위 폴더${SEP}loose.txt`), l.entries.map((e) => e.path).join(' | '))
  await sz.renameEntries(a, [['loose.txt', '이름바뀜.txt']])
  l = await sz.list(a)
  ok(l.entries.some((e) => e.path === '이름바뀜.txt'), l.entries.map((e) => e.path).join(' | '))
  await sz.deleteEntries(a, ['이름바뀜.txt'])
  l = await sz.list(a)
  ok(!l.entries.some((e) => e.path === '이름바뀜.txt'))
})
await t('검사(test) 정상', () => testJob({ archive: out('여러개.zip') }, ctx()))
await t('압축 파일이 아님', () => rejects(sz.list(P('loose.txt')), 'notArchive'))
await t('취소: 큰 파일 풀기 도중 abort → canceled, 스테이징 정리', async () => {
  await compressJob({ sources: [P('big.bin')], output: out('big.7z'), format: '7z', level: 1 }, ctx())
  const ac = new AbortController()
  const c = { ...ctx(), signal: ac.signal, status: (m) => m === '푸는 중…' && setTimeout(() => ac.abort(), 30) }
  await rejects(extractJob({ archive: out('big.7z'), dest: join(T, 'x-cancel') }, c), 'canceled')
  ok(readdirSync(join(T, 'x-cancel')).length === 0, readdirSync(join(T, 'x-cancel')).join())
})
await t('손상 파일 → corrupt', async () => {
  const buf = readFileSync(out('big.7z'))
  buf.fill(0x55, 5000, 9000)
  writeFileSync(out('broken.7z'), buf)
  await rejects(testJob({ archive: out('broken.7z') }, ctx()), 'corrupt')
})
await t('진행률 보고', async () => {
  const seen = []
  await compressJob({ sources: [P('big.bin')], output: out('prog.zip'), format: 'zip', level: 3, overwrite: 'replace' }, { ...ctx(), progress: (p) => seen.push(p.percent) })
  ok(seen.length > 1 && Math.max(...seen) > 50, JSON.stringify(seen.slice(0, 20)))
})
await t('기존 결과물 + rename → "이름 (2)"', async () => {
  const r = await compressJob({ sources: [P('loose.txt')], output: out('aes.zip'), format: 'zip', level: 5, overwrite: 'rename' }, ctx())
  ok(r.output.endsWith('aes (2).zip'), r.output)
})

const { parseJnlp } = await import('../src/main/jnlp/jnlpParser.js')
const { findJava } = await import('../src/main/jnlp/jreFinder.js')

await t('JNLP XML 파싱 테스트', async () => {
  const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<jnlp spec="1.0+" codebase="http://ktc.example.com/app/" href="test.jnlp">
  <information>
    <title>KTC Test App</title>
    <vendor>KTC Co.</vendor>
    <description>테스트용 JNLP 앱</description>
  </information>
  <security><all-permissions/></security>
  <resources>
    <j2se version="1.8+" java-vm-args="-Xmx512m"/>
    <jar href="lib/main.jar" main="true"/>
    <jar href="lib/helper.jar"/>
    <property name="app.mode" value="client"/>
  </resources>
  <application-desc main-class="com.ktc.Main">
    <argument>--server=10.0.0.1</argument>
  </application-desc>
</jnlp>`

  const parsed = parseJnlp(sampleXml)
  ok(parsed.title === 'KTC Test App', `title: ${parsed.title}`)
  ok(parsed.vendor === 'KTC Co.', `vendor: ${parsed.vendor}`)
  ok(parsed.mainClass === 'com.ktc.Main', `mainClass: ${parsed.mainClass}`)
  ok(parsed.allPermissions === true, 'allPermissions')
  ok(parsed.jars.length === 2, `jars: ${parsed.jars.length}`)
  ok(parsed.jars[0].url === 'http://ktc.example.com/app/lib/main.jar', `jar url: ${parsed.jars[0].url}`)
  ok(parsed.properties['app.mode'] === 'client', `prop: ${parsed.properties['app.mode']}`)
  ok(parsed.args[0] === '--server=10.0.0.1', `arg: ${parsed.args[0]}`)
  ok(parsed.javaVmArgs.includes('-Xmx512m'), `vmargs: ${parsed.javaVmArgs}`)
})

await t('앱 내장 JRE 검색 및 버전 확인', async () => {
  const jre = findJava()
  ok(jre && jre.path, 'jre found')
  ok(jre.version && jre.version.startsWith('1.8'), `jre version: ${jre.version}`)
  ok(jre.isBundled === true, `isBundled: ${jre.isBundled}`)
  console.log(`    (감지된 JRE: ${jre.source} / ${jre.path} / ${jre.version})`)
})

await t('작업 이력 관리 (압축/자바 런처 분할, 중복 제거, 최신순 배치, 최대 10개 제한)', async () => {
  const settingsModule = await import('../src/main/settings.js')
  const { addRecent, addRecentJnlp, removeRecent, removeRecentJnlp, clearRecent, clearRecentJnlp, getSettings } = settingsModule

  // 1. 초기화
  clearRecent()
  clearRecentJnlp()
  let s = getSettings()
  ok(s.recent.length === 0, 'recent cleared')
  ok(s.recentJnlp.length === 0, 'recentJnlp cleared')

  // 2. 압축 파일 이력 추가 및 중복 제거, 최신순 정렬
  addRecent('/path/to/archive1.zip')
  addRecent('/path/to/archive2.7z')
  addRecent('/path/to/archive1.zip') // 중복 추가 -> 맨 위로 이동해야 함
  s = getSettings()
  ok(s.recent.length === 2, `archive count: ${s.recent.length}`)
  ok(s.recent[0] === '/path/to/archive1.zip', 'archive1 at top')
  ok(s.recent[1] === '/path/to/archive2.7z', 'archive2 at second')

  // 3. 12개 추가 시 최대 10개로 제한 확인
  for (let i = 3; i <= 15; i++) {
    addRecent(`/path/to/archive${i}.zip`)
  }
  s = getSettings()
  ok(s.recent.length === 10, `archive max 10: ${s.recent.length}`)
  ok(s.recent[0] === '/path/to/archive15.zip', 'latest archive at top')
  ok(!s.recent.includes('/path/to/archive1.zip'), 'oldest evicted')

  // 4. 자바 런처 이력 추가 및 중복 제거, 최신순 정렬, 최대 10개 확인
  addRecentJnlp('/path/to/app1.jnlp')
  addRecentJnlp('/path/to/app2.jnlp')
  addRecentJnlp('/path/to/app1.jnlp') // 중복 재실행 -> 맨 위로
  s = getSettings()
  ok(s.recentJnlp.length === 2, `jnlp count: ${s.recentJnlp.length}`)
  ok(s.recentJnlp[0] === '/path/to/app1.jnlp', 'app1 at top')
  ok(s.recentJnlp[1] === '/path/to/app2.jnlp', 'app2 at second')

  for (let i = 3; i <= 15; i++) {
    addRecentJnlp(`/path/to/app${i}.jnlp`)
  }
  s = getSettings()
  ok(s.recentJnlp.length === 10, `jnlp max 10: ${s.recentJnlp.length}`)
  ok(s.recentJnlp[0] === '/path/to/app15.jnlp', 'latest jnlp at top')

  // 5. 개별 항목 삭제
  removeRecentJnlp('/path/to/app15.jnlp')
  s = getSettings()
  ok(s.recentJnlp.length === 9, 'deleted 1 item')
  ok(s.recentJnlp[0] === '/path/to/app14.jnlp', 'new top item')
})

console.log(`\n${pass} passed, ${fail} failed`)
app.exit(fail ? 1 : 0)

