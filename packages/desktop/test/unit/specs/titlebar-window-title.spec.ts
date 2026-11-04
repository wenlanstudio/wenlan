import { describe, it, expect } from 'vitest'
import { buildWindowTitle } from '@/components/titleBar/windowTitle'

// KDE task switcher plugins that show application names derive them from the
// trailing "- AppName" of the window title; without it the bare filename
// "Untitled-1" showed up as just "1". The app name is 文览 since the 1.0.0
// branding (8ece16a9), so these expectations follow windowTitle.ts's APP_NAME.
describe('buildWindowTitle', () => {
  describe('on Linux/Windows', () => {
    it('appends the app name to the filename', () => {
      expect(buildWindowTitle('Untitled-1', '', false)).toBe('Untitled-1 - 文览')
    })

    it('appends the app name after the project name', () => {
      expect(buildWindowTitle('notes.md', 'myproject', false)).toBe(
        'notes.md - myproject - 文览'
      )
    })

    it('shows the project name when no file is open', () => {
      expect(buildWindowTitle('', 'myproject', false)).toBe('myproject - 文览')
    })

    it('falls back to the app name when nothing is open', () => {
      expect(buildWindowTitle(undefined, '', false)).toBe('文览')
    })
  })

  describe('on macOS', () => {
    it('keeps the document-only title', () => {
      expect(buildWindowTitle('notes.md', 'myproject', true)).toBe('notes.md - myproject')
      expect(buildWindowTitle('Untitled-1', '', true)).toBe('Untitled-1')
      expect(buildWindowTitle(undefined, '', true)).toBe('')
    })
  })
})
