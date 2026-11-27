"""把 dist/ 下的发布资产按平台目录镜像到 OSS（wenlanstudio-downloads，青岛）。

用法：python scripts/sync-release-to-oss.py [distDir]   （release.yml / sync-oss.yml 调用）

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

大文件走分片断点续传（oss2.resumable_upload），每件失败重试 3 次；
外层 workflow 还套了 timeout 命令，防止上传连接停滞时无限挂住。
"""
import os
import sys
import tempfile
import time

try:
    import oss2
except ImportError:
    print('ERROR: oss2 not installed (pip install oss2)')
    sys.exit(1)

DIST = sys.argv[1] if len(sys.argv) > 1 else 'dist'
BUCKET = 'wenlanstudio-downloads'
ENDPOINT = 'https://oss-cn-qingdao.aliyuncs.com'
TIMEOUT = int(os.environ.get('OSS_TIMEOUT_SECONDS', '180'))
RETRIES = int(os.environ.get('OSS_RETRIES', '3'))
RESUMABLE_THRESHOLD = 8 * 1024 * 1024
PART_SIZE = 8 * 1024 * 1024


def log(message):
    print(message, flush=True)


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


def remote_size(bucket, key):
    try:
        return int(bucket.get_object_meta(key).content_length)
    except oss2.exceptions.NoSuchKey:
        return None
    except Exception as exc:  # noqa: BLE001 — 探测失败只降级为「重新上传」
        log(f'WARN meta {key}: {exc}')
        return None


def upload_one(bucket, key, local, store):
    size = os.path.getsize(local)
    if size >= RESUMABLE_THRESHOLD and remote_size(bucket, key) == size:
        log(f'skip {key} (same size already on OSS: {size} bytes)')
        return

    for attempt in range(1, RETRIES + 1):
        try:
            if size >= RESUMABLE_THRESHOLD:
                oss2.resumable_upload(
                    bucket, key, local,
                    store=store,
                    multipart_threshold=RESUMABLE_THRESHOLD,
                    part_size=PART_SIZE,
                    num_threads=4,
                )
            else:
                bucket.put_object_from_file(key, local)
            log(f'uploaded {key} ({size} bytes)')
            return
        except Exception as exc:  # noqa: BLE001 — 逐件重试，最后统一失败退出
            log(f'FAILED attempt {attempt}/{RETRIES} {key}: {exc}')
            if attempt == RETRIES:
                raise
            time.sleep(2 ** attempt)


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
    bucket = oss2.Bucket(auth, ENDPOINT, BUCKET, connect_timeout=TIMEOUT)
    store = oss2.ResumableStore(
        root=os.path.join(tempfile.gettempdir(), 'wenlan-oss-upload')
    )

    failed = []
    for name in sorted(os.listdir(DIST)):
        local = os.path.join(DIST, name)
        if not os.path.isfile(local):
            continue
        key = target_key(name)
        if key is None:
            print(f'skip {name}', flush=True)
            continue
        try:
            upload_one(bucket, key, local, store)
        except Exception:  # noqa: BLE001 — 记录后继续传下一件
            failed.append(key)

    if failed:
        print(f'OSS sync FAILED for {len(failed)} file(s): {failed}', flush=True)
        sys.exit(1)
    print('OSS sync done', flush=True)


if __name__ == '__main__':
    main()
