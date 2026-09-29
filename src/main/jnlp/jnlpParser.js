// JNLP (Java Network Launch Protocol) XML 파서
import { URL } from 'node:url'

function decodeXml(s) {
  if (!s) return ''
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

// 간단하고 견고한 XML 태그 파서
function parseXmlTags(xml) {
  // 주석 제거
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '')
  const tagRe = /<([a-zA-Z0-9_\-:]+)((?:\s+[^=>\s]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g
  const tokens = []
  let m
  while ((m = tagRe.exec(clean)) !== null) {
    if (m[1]) {
      const tagName = m[1].toLowerCase()
      const attrStr = m[2] || ''
      const isSelfClosing = m[3] === '/'
      const attrs = {}
      const attrRe = /([a-zA-Z0-9_\-:]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
      let am
      while ((am = attrRe.exec(attrStr)) !== null) {
        attrs[am[1].toLowerCase()] = decodeXml(am[2] ?? am[3] ?? am[4] ?? '')
      }
      tokens.push({ type: 'open', name: tagName, attrs, self: isSelfClosing })
    } else if (m[4]) {
      const text = decodeXml(m[4].trim())
      if (text) tokens.push({ type: 'text', text })
    }
  }
  return tokens
}

// OS 일치 여부 확인 (Mac OS X, Windows, Linux)
function matchOs(osAttr) {
  if (!osAttr) return true
  const cur = process.platform
  const target = osAttr.toLowerCase()
  if (cur === 'darwin') return target.includes('mac') || target.includes('darwin')
  if (cur === 'win32') return target.includes('win')
  if (cur === 'linux') return target.includes('linux') || target.includes('unix')
  return true
}

export function parseJnlp(rawXmlContent, fallbackBaseUrl = '') {
  // 주석(<!-- ... -->) 제거하여 비활성화된 인자나 태그가 파싱되지 않도록 함
  const xmlContent = (rawXmlContent || '').replace(/<!--[\s\S]*?-->/g, '')

  // 기본 정규식으로 핵심 구조 추출
  const result = {
    spec: '1.0+',
    codebase: '',
    href: '',
    title: '',
    vendor: '',
    homepage: '',
    description: '',
    icon: '',
    allPermissions: false,
    javaVersion: '1.8+',
    javaVmArgs: [],
    jars: [],
    nativeLibs: [],
    properties: {},
    mainClass: '',
    args: []
  }

  // <jnlp> 루트 속성 추출
  const jnlpMatch = xmlContent.match(/<jnlp\b([^>]*)>/i)
  if (jnlpMatch) {
    const attrs = jnlpMatch[1]
    const cb = attrs.match(/codebase\s*=\s*["']([^"']*)["']/i)
    if (cb) result.codebase = cb[1]
    const hr = attrs.match(/href\s*=\s*["']([^"']*)["']/i)
    if (hr) result.href = hr[1]
    const sp = attrs.match(/spec\s*=\s*["']([^"']*)["']/i)
    if (sp) result.spec = sp[1]
  }

  if (!result.codebase && fallbackBaseUrl) {
    result.codebase = fallbackBaseUrl
  }

  // <information>
  const infoMatch = xmlContent.match(/<information\b[^>]*>([\s\S]*?)<\/information>/i)
  if (infoMatch) {
    const block = infoMatch[1]
    const titleM = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    if (titleM) result.title = decodeXml(titleM[1].trim())
    const vendorM = block.match(/<vendor\b[^>]*>([\s\S]*?)<\/vendor>/i)
    if (vendorM) result.vendor = decodeXml(vendorM[1].trim())
    const descM = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)
    if (descM) result.description = decodeXml(descM[1].trim())
    const iconM = block.match(/<icon\b[^>]*href\s*=\s*["']([^"']*)["']/i)
    if (iconM) result.icon = iconM[1]
    const hpM = block.match(/<homepage\b[^>]*href\s*=\s*["']([^"']*)["']/i)
    if (hpM) result.homepage = hpM[1]
  }

  // <security>
  if (/<all-permissions\s*\/?>/i.test(xmlContent)) {
    result.allPermissions = true
  }

  // <application-desc> 또는 <applet-desc>
  const appDescMatch = xmlContent.match(/<application-desc\b([^>]*)>([\s\S]*?)<\/application-desc>/i)
    || xmlContent.match(/<application-desc\b([^>]*)\/>/i)
  if (appDescMatch) {
    const attrs = appDescMatch[1]
    const mc = attrs.match(/main-class\s*=\s*["']([^"']*)["']/i)
    if (mc) result.mainClass = mc[1]
    if (appDescMatch[2]) {
      const argRe = /<argument\b[^>]*>([\s\S]*?)<\/argument>/gi
      let am
      while ((am = argRe.exec(appDescMatch[2])) !== null) {
        result.args.push(decodeXml(am[1].trim()))
      }
    }
  } else {
    const appletMatch = xmlContent.match(/<applet-desc\b([^>]*)>/i)
    if (appletMatch) {
      const mc = appletMatch[1].match(/main-class\s*=\s*["']([^"']*)["']/i)
      if (mc) result.mainClass = mc[1]
    }
  }

  // <resources> 블록들 분석 (OS 필터링 포함)
  const resBlockRe = /<resources\b([^>]*)>([\s\S]*?)<\/resources>/gi
  let rbm
  while ((rbm = resBlockRe.exec(xmlContent)) !== null) {
    const resAttrs = rbm[1]
    const body = rbm[2]
    const osMatch = resAttrs.match(/os\s*=\s*["']([^"']*)["']/i)
    if (osMatch && !matchOs(osMatch[1])) {
      continue // 다른 OS 용 리소스는 스킵
    }

    // j2se / java 태그
    const javaMatch = body.match(/<(?:j2se|java)\b([^>]*)\/?>/i)
    if (javaMatch) {
      const jattrs = javaMatch[1]
      const verM = jattrs.match(/version\s*=\s*["']([^"']*)["']/i)
      if (verM) result.javaVersion = verM[1]
      const vmArgsM = jattrs.match(/java-vm-args\s*=\s*["']([^"']*)["']/i)
      if (vmArgsM) {
        result.javaVmArgs = vmArgsM[1]
          .split(/\s+/)
          .map((a) => a.trim())
          .filter(Boolean)
      }
      const maxHeapM = jattrs.match(/max-heap-size\s*=\s*["']([^"']*)["']/i)
      if (maxHeapM) {
        result.javaVmArgs.push(`-Xmx${maxHeapM[1]}`)
      }
      const initHeapM = jattrs.match(/initial-heap-size\s*=\s*["']([^"']*)["']/i)
      if (initHeapM) {
        result.javaVmArgs.push(`-Xms${initHeapM[1]}`)
      }
    }

    // jar 태그들
    const jarRe = /<jar\b([^>]*)\/?>/gi
    let jm
    while ((jm = jarRe.exec(body)) !== null) {
      const jAttrs = jm[1]
      const hrefM = jAttrs.match(/href\s*=\s*["']([^"']*)["']/i)
      if (hrefM) {
        const isMain = /main\s*=\s*["']true["']/i.test(jAttrs)
        const download = jAttrs.match(/download\s*=\s*["']([^"']*)["']/i)?.[1] || 'eager'
        const size = parseInt(jAttrs.match(/size\s*=\s*["']([^"']*)["']/i)?.[1] || '0', 10)
        result.jars.push({
          href: hrefM[1],
          main: isMain,
          download,
          size
        })
      }
    }

    // nativelib 태그들
    const natRe = /<nativelib\b([^>]*)\/?>/gi
    let nm
    while ((nm = natRe.exec(body)) !== null) {
      const nAttrs = nm[1]
      const hrefM = nAttrs.match(/href\s*=\s*["']([^"']*)["']/i)
      if (hrefM) {
        result.nativeLibs.push({ href: hrefM[1] })
      }
    }

    // property 태그들
    const propRe = /<property\b([^>]*)\/?>/gi
    let pm
    while ((pm = propRe.exec(body)) !== null) {
      const pAttrs = pm[1]
      const nameM = pAttrs.match(/name\s*=\s*["']([^"']*)["']/i)
      const valM = pAttrs.match(/value\s*=\s*["']([^"']*)["']/i)
      if (nameM && valM) {
        result.properties[nameM[1]] = valM[1]
      }
    }
  }

  // URL 정규화 (codebase 기준)
  const resolveUrl = (rel) => {
    if (!rel) return ''
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel)) return rel
    if (!result.codebase) return rel
    try {
      const base = result.codebase.endsWith('/') ? result.codebase : result.codebase + '/'
      return new URL(rel, base).href
    } catch {
      return rel
    }
  }

  result.jars = result.jars.map((j) => ({ ...j, url: resolveUrl(j.href) }))
  result.nativeLibs = result.nativeLibs.map((n) => ({ ...n, url: resolveUrl(n.href) }))
  if (result.icon) result.iconUrl = resolveUrl(result.icon)

  return result
}
