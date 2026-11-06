#!/usr/bin/env node
// gen-md-icon.mjs — 由 build/icons/md.svg 生成本套 Markdown 文档图标：
//   build/icons/md.ico（多尺寸，PNG 内嵌）+ md.icns（PNG 内嵌）+ {16..512}x*/
//   md.png。字形 = static/icon.png（安装包图标）的反色，几何 1:1 对齐（见 md.svg
//   的 desc）；所有尺寸同一路径、**不加描边**（加粗会把交叉负空间填死，见下）。
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

// —— 尺寸：一律不加粗 ——
// 历史教训（#10 二次修订）：早期给 ≤32px 加 stroke（64 局部单位 ≈1.5px@32px）想让
// 细笔画在小尺寸更实，结果把交叉处的负空间填死——16px 变成黑团、32px 看着像「人」
// 字。安装包图标（static/icon.png）用同一条路径、从不加粗，16/24/32 反而都认得出。
// 字形主干约 32px@1024，缩到 16px 出现亚像素灰是必然（亮底暗线还会视觉变细）；
// 要救只能整幅放大字形，别再动描边。
const svgAt = (size) =>
  SVG.replace(/<svg ([^>]*?)width="\d+" height="\d+"/, `<svg $1width="${size}" height="${size}"`)

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const pngs = new Map()
for (const size of SIZES) {
  // density 只做超采样：SVG 按 300dpi 栅格化成 ~4.2× 大图，再降采样到精确像素
  // 尺寸。少了 resize 这一步，hicolor 目录名 / ICO / ICNS 的标称尺寸与实际
  // 像素不符（16x16 里塞 67×67），Windows/macOS 取图标会挑错槽位或模糊。
  const hi = await sharp(Buffer.from(svgAt(size)), { density: 300 }).png().toBuffer()
  pngs.set(size, await sharp(hi).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer())
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
