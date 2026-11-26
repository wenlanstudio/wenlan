import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'

/**
 * 更新源候选链（2026-11-26）：GitHub 国内连通随机，OSS 镜像为主线路。
 *
 * 候选顺序（last-good 优先）：
 *   oss    — 阿里云 OSS 镜像，CI 每次发版同步（release.yml sync-to-oss step）
 *   github — 官方 GitHub Releases（海外线路 / OSS 缺位的兜底）
 *   ghproxy— gh-proxy.com 包裹的 GitHub latest（第三方免费服务，聊胜于无的末位兜底）
 *
 * 每个平台一个 OSS 子目录：win / mac / linux（electron-updater 的 generic
 * provider 会按平台自动追加 latest.yml / latest-mac.yml / latest-linux.yml）。
 * 目录里 latest*.yml 与安装包、blockmap 同层——blockmap 差量更新靠 Range 请求，
 * OSS 原生支持。
 */

const OSS_BASE = 'https://wenlanstudio-downloads.oss-cn-qingdao.aliyuncs.com'
const GH_OWNER = 'wenlanstudio'
const GH_REPO = 'wenlan'
const GH_LATEST_DIR = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest/download`
const GH_PROXY_DIR = `https://gh-proxy.com/${GH_LATEST_DIR}`

export type FeedId = 'oss' | 'github' | 'ghproxy'

interface FeedCandidate {
  id: FeedId
  options: Parameters<typeof autoUpdater.setFeedURL>[0]
}

function ossDirForPlatform(): string {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

function allCandidates(): FeedCandidate[] {
  const dir = ossDirForPlatform()
  return [
    { id: 'oss', options: { provider: 'generic', url: `${OSS_BASE}/${dir}` } },
    { id: 'github', options: { provider: 'github', owner: GH_OWNER, repo: GH_REPO } },
    { id: 'ghproxy', options: { provider: 'generic', url: GH_PROXY_DIR } }
  ]
}

// ---------------------------------------------------------------
// last-good 源记忆：userData/update-feed.json 单键文件。上次成功过的源排最前，
// 国内机器就不再每次都从更慢的源试起。
// ---------------------------------------------------------------

function lastGoodFile(): string {
  return path.join(app.getPath('userData'), 'update-feed.json')
}

function readLastGood(): FeedId | null {
  try {
    const raw = fs.readFileSync(lastGoodFile(), 'utf8')
    const parsed = JSON.parse(raw) as { lastGood?: FeedId }
    if (
      parsed.lastGood === 'oss' ||
      parsed.lastGood === 'github' ||
      parsed.lastGood === 'ghproxy'
    ) {
      return parsed.lastGood
    }
  } catch {
    // 首次运行 / 文件缺失 / 解析失败——全部视为无记忆。
  }
  return null
}

function writeLastGood(id: FeedId): void {
  try {
    fs.writeFileSync(lastGoodFile(), JSON.stringify({ lastGood: id }))
  } catch (err) {
    log.warn('[update] failed to persist last-good feed:', err)
  }
}

export function orderedCandidates(): FeedCandidate[] {
  const candidates = allCandidates()
  const lastGood = readLastGood()
  if (!lastGood) {
    return candidates
  }
  const preferred = candidates.filter((c) => c.id === lastGood)
  const rest = candidates.filter((c) => c.id !== lastGood)
  return [...preferred, ...rest]
}

// ---------------------------------------------------------------
// 链式检查：逐源 setFeedURL + checkForUpdates，promise reject 即换下一源。
// 链期间 marktext.ts 的 autoUpdater error 监听须保持静默（isFeedChainRunning），
// 否则中间源的失败会对用户弹错误；全部失败的最终上报由调用方负责。
// ---------------------------------------------------------------

let chainRunning = false

export function isFeedChainRunning(): boolean {
  return chainRunning
}

export type FeedChainResult =
  | { ok: true; source: FeedId; updateAvailable: boolean }
  | { ok: false; error: Error }

export async function checkForUpdatesAcrossFeeds(): Promise<FeedChainResult> {
  chainRunning = true
  try {
    for (const candidate of orderedCandidates()) {
      try {
        log.info(`[update] checking feed: ${candidate.id}`)
        autoUpdater.setFeedURL(candidate.options)
        const result = await autoUpdater.checkForUpdates()
        writeLastGood(candidate.id)
        log.info(`[update] feed ok: ${candidate.id} (updateAvailable=${result?.isUpdateAvailable})`)
        return { ok: true, source: candidate.id, updateAvailable: result?.isUpdateAvailable === true }
      } catch (err) {
        log.warn(
          `[update] feed failed: ${candidate.id}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
    return { ok: false, error: new Error('All update feeds failed') }
  } finally {
    chainRunning = false
  }
}
