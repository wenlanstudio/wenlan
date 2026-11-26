"""把 dist/ 下的发布资产按平台目录镜像到 OSS（wenlanstudio-downloads，青岛）。

用法：python scripts/sync-release-to-oss.py [distDir]   （release.yml 的发布 job 调用）

映射规则（与 src/main/updateFeeds.ts 的候选链同口径）：
  wenlan-win-*    → win/     （latest.yml 合并了 x64/arm64 两条目，同目录自选）
  wenlan-mac-*    → mac/
  wenlan-linux-*  → linux/
  latest.yml      → win/     electron-updater on Windows
  latest-mac.yml  → mac/     electron-updater on macOS
  latest-linux.yml→ linux/   electron-updater on Linux
  SHA256SUMS.txt  → 根
  其余（builder-debug.yml 等）跳过。

凭证走环境变量 OSS_AK_ID / OSS_AK_SECRET（GitHub Secrets，
RAM 用户 wenlan-release-bot，仅 wenlanstudio-downloads 桶读写权限）。
"""
import os
import sys

try:
    import oss2
except ImportError:
    print('ERROR: oss2 not installed (pip install oss2)')
    sys.exit(1)

DIST = sys.argv[1] if len(sys.argv) > 1 else 'dist'
BUCKET = 'wenlanstudio-downloads'
ENDPOINT = 'https://oss-cn-qingdao.aliyuncs.com'


def target_key(name):
    if name.startswith('wenlan-win-'):
        return f'win/{name}'
    if name.startswith('wenlan-mac-'):
        return f'mac/{name}'
    if name.startswith('wenlan-linux-'):
        return f'linux/{name}'
    if name == 'latest.yml':
        return f'win/{name}'
    if name == 'latest-mac.yml':
        return f'mac/{name}'
    if name == 'latest-linux.yml':
        return f'linux/{name}'
    if name == 'SHA256SUMS.txt':
        return name
    return None


def main():
    ak_id = os.environ.get('OSS_AK_ID')
    ak_secret = os.environ.get('OSS_AK_SECRET')
    if not ak_id or not ak_secret:
        print('OSS_AK_ID / OSS_AK_SECRET not set — skipping OSS sync (fork builds)')
        return

    if not os.path.isdir(DIST):
        print(f'ERROR: dist dir not found: {DIST}')
        sys.exit(1)

    auth = oss2.Auth(ak_id, ak_secret)
    bucket = oss2.Bucket(auth, ENDPOINT, BUCKET)

    failed = []
    for name in sorted(os.listdir(DIST)):
        local = os.path.join(DIST, name)
        if not os.path.isfile(local):
            continue
        key = target_key(name)
        if key is None:
            print(f'skip {name}')
            continue
        try:
            bucket.put_object_from_file(key, local)
            print(f'uploaded {key} ({os.path.getsize(local)} bytes)')
        except Exception as exc:  # noqa: BLE001 — 逐件上报，最后统一失败退出
            print(f'FAILED {key}: {exc}')
            failed.append(key)

    if failed:
        print(f'OSS sync FAILED for {len(failed)} file(s): {failed}')
        sys.exit(1)
    print('OSS sync done')


if __name__ == '__main__':
    main()
