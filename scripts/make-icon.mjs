// build/icon.png (1024x1024) 생성 — 외부 이미지 도구 없이 SDF 로 그린다.
// electron-builder 가 이 PNG 로 .ico / .icns 를 만든다.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const N = 1024
const SS = 3 // 슈퍼샘플링 (계단 현상 제거)

const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

const TOP = hex('#5a8dff')
const BOT = hex('#2146c9')
const WHITE = [255, 255, 255]
const LID = hex('#e9efff')
const ZIP = hex('#2f5fe0')
const SHADOW = hex('#173494')

// 한 점의 색 (RGBA, 0..255) — 아래에서 위로 겹쳐 그린다
function shade(x, y) {
  let c = [0, 0, 0, 0]
  const put = (rgb, a) => {
    if (a <= 0) return
    const na = a + c[3] * (1 - a)
    c = [...rgb.map((v, i) => (v * a + c[i] * c[3] * (1 - a)) / (na || 1)), na]
  }
  // 배경 둥근 사각형 + 세로 그라데이션
  if (sdRoundRect(x, y, 512, 512, 440, 440, 200) <= 0) put(mix(TOP, BOT, (y - 72) / 880), 1)
  else return c
  // 상자 그림자
  if (sdRoundRect(x, y, 512, 600, 262, 222, 46) <= 0) put(SHADOW, 0.35)
  // 상자 본체
  if (sdRoundRect(x, y, 512, 580, 250, 210, 40) <= 0) put(WHITE, 1)
  // 뚜껑
  if (sdRoundRect(x, y, 512, 350, 290, 72, 34) <= 0) put(LID, 1)
  if (sdRoundRect(x, y, 512, 350, 290, 72, 34) <= 0 && y > 405) put(hex('#cbd8ff'), 1)
  // 지퍼 (가운데 세로 톱니 + 손잡이)
  const zx = 512
  if (y > 300 && y < 700) {
    const tooth = Math.floor((y - 300) / 34) % 2
    if (sdRoundRect(x, y, zx + (tooth ? 14 : -14), 300 + Math.floor((y - 300) / 34) * 34 + 17, 22, 12, 5) <= 0) put(ZIP, 1)
  }
  if (sdRoundRect(x, y, zx, 730, 44, 58, 22) <= 0) put(ZIP, 1)
  if (sdRoundRect(x, y, zx, 742, 18, 26, 9) <= 0) put(WHITE, 1)
  return c
}

const raw = Buffer.alloc((N * 4 + 1) * N)
for (let py = 0; py < N; py++) {
  raw[py * (N * 4 + 1)] = 0
  for (let px = 0; px < N; px++) {
    let acc = [0, 0, 0, 0]
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const s = shade(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
        acc = [acc[0] + s[0] * s[3], acc[1] + s[1] * s[3], acc[2] + s[2] * s[3], acc[3] + s[3]]
      }
    const a = acc[3] / (SS * SS)
    const o = py * (N * 4 + 1) + 1 + px * 4
    raw[o] = a ? acc[0] / acc[3] : 0
    raw[o + 1] = a ? acc[1] / acc[3] : 0
    raw[o + 2] = a ? acc[2] / acc[3] : 0
    raw[o + 3] = Math.round(a * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`✓ ${out} (${(png.length / 1024).toFixed(0)} KB)`)
