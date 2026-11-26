import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { setFeedURLMock, checkForUpdatesMock, logMocks, tmpDirHolder } = vi.hoisted(() => ({
  setFeedURLMock: vi.fn(),
  checkForUpdatesMock: vi.fn(),
  logMocks: { info: vi.fn(), warn: vi.fn() },
  tmpDirHolder: { dir: '' }
}))

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpDirHolder.dir
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    setFeedURL: setFeedURLMock,
    checkForUpdates: checkForUpdatesMock
  }
}))

vi.mock('electron-log', () => ({
  default: {
    info: logMocks.info,
    warn: logMocks.warn
  }
}))

import {
  orderedCandidates,
  checkForUpdatesAcrossFeeds,
  isFeedChainRunning
} from '../../../src/main/updateFeeds'

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

/** checkForUpdates 按 setFeedURL 最后一次收到的 url 决定成败：url 含 oss 字样
 *  时 reject（模拟 OSS 挂掉），否则 resolve 出"无更新"。 */
function stubUpdaterBehavior(opts: { ossRejects: boolean } = { ossRejects: true }): void {
  let currentUrl = ''
  setFeedURLMock.mockImplementation((options: { url?: string }) => {
    currentUrl = options?.url ?? ''
  })
  checkForUpdatesMock.mockImplementation(() => {
    if (opts.ossRejects && currentUrl.includes('oss-cn-qingdao')) {
      return Promise.reject(new Error('ETIMEDOUT (oss unreachable)'))
    }
    return Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0' } })
  })
}

describe('updateFeeds', () => {
  beforeEach(() => {
    tmpDirHolder.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wenlan-update-feeds-'))
    setFeedURLMock.mockReset()
    checkForUpdatesMock.mockReset()
    logMocks.info.mockClear()
    logMocks.warn.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDirHolder.dir, { recursive: true, force: true })
    setPlatform('win32')
  })

  it('候选顺序：oss → github → ghproxy，oss 目录随平台', () => {
    setPlatform('win32')
    expect(orderedCandidates().map((c) => c.id)).toEqual(['oss', 'github', 'ghproxy'])
    expect((orderedCandidates()[0].options as { url: string }).url.endsWith('/win')).toBe(true)

    setPlatform('darwin')
    expect((orderedCandidates()[0].options as { url: string }).url.endsWith('/mac')).toBe(true)

    setPlatform('linux')
    expect((orderedCandidates()[0].options as { url: string }).url.endsWith('/linux')).toBe(true)
  })

  it('OSS 成功：链即停、lastGood 落盘、updateAvailable 透传', async() => {
    setPlatform('win32')
    stubUpdaterBehavior({ ossRejects: false })
    checkForUpdatesMock.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '9' } })

    const result = await checkForUpdatesAcrossFeeds()

    expect(result).toEqual({ ok: true, source: 'oss', updateAvailable: true })
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(fs.readFileSync(path.join(tmpDirHolder.dir, 'update-feed.json'), 'utf8'))
    ).toEqual({ lastGood: 'oss' })
  })

  it('OSS 挂：自动换到 github 且 lastGood 记忆生效（下次 github 排最前）', async() => {
    setPlatform('win32')
    stubUpdaterBehavior({ ossRejects: true })

    const result = await checkForUpdatesAcrossFeeds()

    expect(result).toEqual({ ok: true, source: 'github', updateAvailable: false })
    expect(setFeedURLMock).toHaveBeenCalledTimes(2)
    expect(
      JSON.parse(fs.readFileSync(path.join(tmpDirHolder.dir, 'update-feed.json'), 'utf8'))
    ).toEqual({ lastGood: 'github' })

    // 记忆生效：github 升到首位
    expect(orderedCandidates().map((c) => c.id)).toEqual(['github', 'oss', 'ghproxy'])
  })

  it('全部源失败：ok:false 且链旗标复位', async() => {
    setPlatform('win32')
    setFeedURLMock.mockImplementation(() => {})
    checkForUpdatesMock.mockRejectedValue(new Error('network dead'))

    const result = await checkForUpdatesAcrossFeeds()

    expect(result.ok).toBe(false)
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(3)
    expect(isFeedChainRunning()).toBe(false)
  })

  it('链进行中 isFeedChainRunning 为真（error 监听靠它静默中间失败）', async() => {
    setPlatform('win32')
    checkForUpdatesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          expect(isFeedChainRunning()).toBe(true)
          resolve({ isUpdateAvailable: false, updateInfo: { version: '0' } })
        })
    )
    expect(isFeedChainRunning()).toBe(false)
    await checkForUpdatesAcrossFeeds()
    expect(isFeedChainRunning()).toBe(false)
  })
})
