import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  isWritableDocPath,
  putLabCopy,
  sanitizeSegment,
  shouldKeepCopy,
  writeLabDoc
} from '../../../src/main/teaching/labCopy'

/**
 * E4 实验副本落盘的护栏（main/teaching/labCopy.ts）：
 *
 * 发布定格下本地副本是「作答面」——todo 回填会写进文件。这里钉住最容易翻车的
 * 三件事：① 同 releaseId 重开必须保留学生已回填的本地文件；② 回填写入只放行
 * sidecar 认识的、projectsRoot 内 doc/ 下的 .md（渲染端给的路径一律不信）；
 * ③ courseKey/文件名清洗后不存在路径逃逸。
 */

let root = ''

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lab-copy-'))
})

const docFile = (name = '实验.md'): string => path.join(root, 'BD101', 'doc', name)

describe('sanitizeSegment', () => {
  it('剥离路径分隔符与 Windows 保留字符', () => {
    expect(sanitizeSegment('BD101')).toBe('BD101')
    expect(sanitizeSegment('第3章 MapReduce')).toBe('第3章 MapReduce')
    expect(sanitizeSegment('a/b\\c:d*e?"f"|g')).toBe('abcdefg')
  })

  it('空串与纯点 throws', () => {
    expect(() => sanitizeSegment('')).toThrow()
    expect(() => sanitizeSegment('..')).toThrow()
    expect(() => sanitizeSegment('///')).toThrow()
  })
})

describe('shouldKeepCopy', () => {
  it('同 releaseId 且文件在 → 保留；换 releaseId → 重写', () => {
    const sidecar = { '实验.md': { releaseId: 7, savedAt: '' } }
    expect(shouldKeepCopy(sidecar, '实验.md', 7, true)).toBe(true)
    expect(shouldKeepCopy(sidecar, '实验.md', 8, true)).toBe(false)
    expect(shouldKeepCopy(sidecar, '实验.md', 7, false)).toBe(false)
    expect(shouldKeepCopy({}, '实验.md', 7, true)).toBe(false)
  })
})

describe('putLabCopy', () => {
  it('落盘 + sidecar 登记；同 releaseId 重开保留学生回填', () => {
    const first = putLabCopy(root, {
      courseKey: 'BD101',
      fileName: '实验.md',
      content: '# 教师版',
      releaseId: 7
    })
    expect(first.kept).toBe(false)
    expect(readFileSync(docFile(), 'utf8')).toBe('# 教师版')
    expect(existsSync(path.join(root, 'BD101', 'doc', '.wenlan-copies.json'))).toBe(true)

    // 学生回填把本地文件改了
    writeFileSync(docFile(), '# 教师版 + 学生回填代码', 'utf8')
    const again = putLabCopy(root, {
      courseKey: 'BD101',
      fileName: '实验.md',
      content: '# 教师版',
      releaseId: 7
    })
    expect(again.kept).toBe(true)
    expect(again.docPath).toBe(docFile())
    expect(readFileSync(docFile(), 'utf8')).toBe('# 教师版 + 学生回填代码')
  })

  it('换 releaseId（教师发新版本）→ 整篇重写', () => {
    putLabCopy(root, { courseKey: 'BD101', fileName: '实验.md', content: 'v1', releaseId: 7 })
    const next = putLabCopy(root, { courseKey: 'BD101', fileName: '实验.md', content: 'v2', releaseId: 8 })
    expect(next.kept).toBe(false)
    expect(readFileSync(docFile(), 'utf8')).toBe('v2')
  })

  it('force（还原）→ 无视保留判定强制重写', () => {
    putLabCopy(root, { courseKey: 'BD101', fileName: '实验.md', content: 'v1', releaseId: 7 })
    writeFileSync(docFile(), '学生改过', 'utf8')
    const restored = putLabCopy(root, {
      courseKey: 'BD101',
      fileName: '实验.md',
      content: 'v1',
      releaseId: 7,
      force: true
    })
    expect(restored.kept).toBe(false)
    expect(readFileSync(docFile(), 'utf8')).toBe('v1')
  })

  it('非 .md 文件名与非法 releaseId 拒绝', () => {
    expect(() =>
      putLabCopy(root, { courseKey: 'BD101', fileName: '实验.txt', content: 'x', releaseId: 7 })
    ).toThrow()
    expect(() =>
      putLabCopy(root, { courseKey: 'BD101', fileName: '实验.md', content: 'x', releaseId: 0 })
    ).toThrow()
  })
})

describe('writeLabDoc / isWritableDocPath', () => {
  it('sidecar 认识的 doc/ 下 .md 才可写回', () => {
    putLabCopy(root, { courseKey: 'BD101', fileName: '实验.md', content: '原稿', releaseId: 7 })
    const ok = writeLabDoc(root, docFile(), '回填后')
    expect(ok).toBe(true)
    expect(readFileSync(docFile(), 'utf8')).toBe('回填后')
  })

  it('root 外 / 非 doc 目录 / sidecar 不认识 → 拒写', () => {
    putLabCopy(root, { courseKey: 'BD101', fileName: '实验.md', content: '原稿', releaseId: 7 })
    // root 外
    expect(writeLabDoc(root, path.join(tmpdir(), 'elsewhere', '实验.md'), 'x')).toBe(false)
    // 非 doc 目录
    const codeDir = path.join(root, 'BD101', 'code')
    mkdir(codeDir)
    const rogue = path.join(codeDir, '实验.md')
    writeFileSync(rogue, 'x', 'utf8')
    expect(writeLabDoc(root, rogue, 'x')).toBe(false)
    // sidecar 不认识
    const stranger = path.join(root, 'BD101', 'doc', '陌生.md')
    writeFileSync(stranger, 'x', 'utf8')
    expect(writeLabDoc(root, stranger, 'x')).toBe(false)
    expect(isWritableDocPath(root, stranger, {})).toBe(false)
  })

  it('courseKey 清洗：带分隔符的课程目录也逃不出 root', () => {
    const put = putLabCopy(root, {
      courseKey: 'a/b\\c',
      fileName: 'x.md',
      content: 'x',
      releaseId: 1
    })
    expect(put.docPath.startsWith(path.normalize(root + path.sep))).toBe(true)
    expect(put.docPath).toContain('abc')
    rmSync(put.docPath, { force: true })
  })
})

const mkdir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}
