import { describe, expect, it } from 'vitest'

import { normalizeSvgFence } from '@/util/svgFence'

/**
 * ` ```svg ` 围栏在「文 / 栏 / 页」里的规范化护栏。
 *
 * 栅格那一半要用 canvas，jsdom 没有，留给真机 e2e；这里验的是进 canvas
 * 之前的全部校验——尺寸、XML 合法性、foreignObject、注释清洗，以及
 * 写回 markup 的显式宽高（分页要按它量高度）。
 */
const svg = (attrs = 'viewBox="0 0 200 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="200" height="100" fill="#f00"/></svg>`

describe('normalizeSvgFence', () => {
  it('viewBox 优先于 width="100%"，产出显式数值宽高', () => {
    const out = normalizeSvgFence(svg('width="100%" height="100%" viewBox="0 0 320 180"'))
    expect(out.width).toBe(320)
    expect(out.height).toBe(180)
    expect(out.markup).toContain('width="320"')
    expect(out.markup).toContain('height="180"')
    expect(out.markup).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('数值宽高与逗号分隔的 viewBox 都认', () => {
    expect(normalizeSvgFence(svg('width="240" height="120px"'))).toMatchObject({ width: 240, height: 120 })
    expect(normalizeSvgFence(svg('viewBox="0, 0, 640, 360"'))).toMatchObject({ width: 640, height: 360 })
  })

  it('开标签扫描跳过引号里的 >（aria-label 常带）', () => {
    const out = normalizeSvgFence(svg('aria-label="a > b" viewBox="0 0 480 240"'))
    expect(out).toMatchObject({ width: 480, height: 240 })
  })

  it('剥掉含 -- 的非法 XML 注释后仍能解析', () => {
    const dirty = `<?xml version="1.0"?><!--?plantuml-src abc-- def-- -->${svg()}`
    expect(normalizeSvgFence(dirty).width).toBe(200)
  })

  it('补 xmlns（作者常漏写）', () => {
    const out = normalizeSvgFence('<svg viewBox="0 0 80 40"><circle r="10"/></svg>')
    expect(out.markup).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toMatchObject({ width: 80, height: 40 })
  })

  it('没有可量基准的一律硬失败，不猜 300×150', () => {
    expect(() => normalizeSvgFence(svg('width="100%" height="100%"'))).toThrow(/量不出尺寸/)
    expect(() => normalizeSvgFence(svg('width="10cm" height="5cm"'))).toThrow(/量不出尺寸/)
    expect(() => normalizeSvgFence(svg('viewBox="0 0 0 100"'))).toThrow(/量不出尺寸/)
  })

  it('空围栏 / 片段 / 非法 XML / foreignObject 给人话错误', () => {
    expect(() => normalizeSvgFence('  \n ')).toThrow(/是空的/)
    expect(() => normalizeSvgFence('x.png')).toThrow(/完整的 <svg/)
    expect(() => normalizeSvgFence('<svg viewBox="0 0 10 10"><rect></svg>')).toThrow(/合法 XML/)
    expect(() =>
      normalizeSvgFence('<svg viewBox="0 0 10 10"><foreignObject><div>x</div></foreignObject></svg>')
    ).toThrow(/foreignObject/)
  })
})
