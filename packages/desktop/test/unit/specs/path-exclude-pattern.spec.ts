import { describe, it, expect } from 'vitest'
import { checkPathExcludePattern, isDriveRoot } from 'common/filesystem/paths'

// The sidebar watcher calls this from chokidar's `ignored` predicate. A throw
// there aborts the initial traversal and leaves the project tree empty
// (GH#5159), so "does not throw" is as much a requirement as the match result.
describe('checkPathExcludePattern', () => {
  it('excludes nothing when no pattern is configured', () => {
    expect(checkPathExcludePattern('/home/user/notes/README.md', [])).toBe(false)
  })

  it('keeps paths that no pattern matches', () => {
    expect(checkPathExcludePattern('/home/user/notes/README.md', ['*.tmp', 'drafts'])).toBe(false)
  })

  it('excludes paths a pattern matches', () => {
    expect(checkPathExcludePattern('/home/user/notes/scratch.tmp', ['*.tmp'])).toBe(true)
  })

  it('matches a slashless pattern against the basename', () => {
    expect(checkPathExcludePattern('/home/user/notes/drafts', ['drafts'])).toBe(true)
  })

  it('matches patterns that span directories', () => {
    expect(checkPathExcludePattern('/home/user/notes/drafts/post.md', ['**/drafts/**'])).toBe(true)
  })

  it('ignores an empty pathname', () => {
    expect(checkPathExcludePattern('', ['*.tmp'])).toBe(false)
  })
})

describe('isDriveRoot', () => {
  it('detects Windows drive roots with either separator', () => {
    expect(isDriveRoot('D:\\')).toBe(true)
    expect(isDriveRoot('D:/')).toBe(true)
    expect(isDriveRoot('C:')).toBe(true)
    expect(isDriveRoot(' d:\\ ')).toBe(true)
  })

  it('detects POSIX and UNC share roots', () => {
    expect(isDriveRoot('/')).toBe(true)
    expect(isDriveRoot('\\\\server\\share')).toBe(true)
    expect(isDriveRoot('//server/share/')).toBe(true)
  })

  it('does not reject normal directories below a root', () => {
    expect(isDriveRoot('D:\\Projects')).toBe(false)
    expect(isDriveRoot('C:\\Users\\me')).toBe(false)
    expect(isDriveRoot('/home/user/notes')).toBe(false)
    expect(isDriveRoot('\\\\server\\share\\project')).toBe(false)
  })

  it('does not reject empty input', () => {
    expect(isDriveRoot('')).toBe(false)
    expect(isDriveRoot('   ')).toBe(false)
  })
})
