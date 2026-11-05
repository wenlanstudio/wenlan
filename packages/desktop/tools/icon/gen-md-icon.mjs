#!/usr/bin/env node
// gen-md-icon.mjs — 由 build/icons/md.svg 生成本套 Markdown 文档图标：
//   build/icons/md.ico（多尺寸，PNG 内嵌）+ md.icns（PNG 内嵌）+ {16..512}x*/
//   md.png。≤64px 用描边加粗（篆文笔画细，小尺寸糊成一团——Chromium/sharp
//   栅格化下的可辨识兜底；等价于 f96cf332 时代的「加粗简化笔画版」）。
//
// 用法：node tools/icon/gen-md-icon.mjs（在 packages/desktop 下跑；sharp 取
// 根 node_modules）。改 md.svg 后重跑即可，无需其它接线——electron-builder
// fileAssociations 与 installer.nsh 都指向 build/icons/md.ico。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(here, '../../build/icons')

const SVG = await readFile(join(iconsDir, 'md.svg'), 'utf8')

// —— 小尺寸加粗：stroke 宽为字形局部坐标（0..961 高）单位——
// 渲染像素 = w * 0.7699 * (size/1024)；32px 下 w=64 → ~1.5px 描边。
const strokeFor = (size) => {
  if (size <= 32) return 64
  if (size <= 48) return 44
  if (size <= 64) return 26
  return 0
}

const svgAt = (size) => {
  const w = strokeFor(size)
  return SVG.replace(
    /<svg ([^>]*?)width="\d+" height="\d+"/,
    `<svg $1width="${size}" height="${size}"`
  ).replace(
    /<g (transform=[^>]*?fill="#1A1A1C")/,
    `<g $1${w ? ` stroke="#1A1A1C" stroke-width="${w}" stroke-linejoin="round"` : ''}`
  )
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const pngs = new Map()
for (const size of SIZES) {
  const buf = await sharp(Buffer.from(svgAt(size)), { density: 300 }).png().toBuffer()
  pngs.set(size, buf)
}

// —— 各档 hicolor PNG ——
for (const size of SIZES) {
  const dir = join(iconsDir, `${size}x${size}`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'md.png'), pngs.get(size))
}

// —— ICO（PNG 内嵌，Vista+）：16/24/32/48/64/128/256 ——
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const entries = icoSizes.map((size) => pngs.get(size))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(icoSizes.length, 4)
let offset = 6 + 16 * icoSizes.length
const dir = Buffer.alloc(16 * icoSizes.length)
icoSizes.forEach((size, i) => {
  const e = i * 16
  dir.writeUInt8(size >= 256 ? 0 : size, e) // width
  dir.writeUInt8(size >= 256 ? 0 : size, e + 1) // height
  dir.writeUInt8(0, e + 2) // palette
  dir.writeUInt8(0, e + 3) // reserved
  dir.writeUInt16LE(1, e + 4) // planes
  dir.writeUInt16LE(32, e + 6) // bpp
  dir.writeUInt32LE(entries[i].length, e + 8)
  dir.writeUInt32LE(offset, e + 12)
  offset += entries[i].length
})
await writeFile(join(iconsDir, 'md.ico'), Buffer.concat([header, dir, ...entries]))

// —— ICNS（PNG 内嵌）：icp4=16 icp5=32 icp6=64 ic07=128 ic08=256 ic09=512 ——
const icnsTypes = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512]
]
const chunks = [Buffer.from('ICNS')]
let total = 8
const parts = []
for (const [type, size] of icnsTypes) {
  const data = pngs.get(size)
  const head = Buffer.alloc(8)
  head.write(type, 0, 'ascii')
  head.writeUInt32BE(data.length + 8, 4)
  parts.push(head, data)
  total += 8 + data.length
}
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('ICNS', 0, 'ascii')
icnsHeader.writeUInt32BE(total, 4)
await writeFile(join(iconsDir, 'md.icns'), Buffer.concat([icnsHeader, ...parts]))

console.log(
  `md.ico (${icoSizes.length} sizes), md.icns (${icnsTypes.length} types), ${SIZES.length} hicolor PNGs -> ${iconsDir}`
)
