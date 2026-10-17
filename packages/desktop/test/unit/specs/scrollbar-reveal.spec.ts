import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { listenForScrollbarReveal } from '@/util/scrollbarReveal'

// The renderer's scrollbars are invisible until needed: `util/scrollbarReveal`
// tags whichever element is scrolling with `mt-scroll-active`, which the
// `::-webkit-scrollbar-thumb` rules in `assets/styles/index.css` match on to
// paint the thumb. Behaviour that matters:
//   - `scroll` does not bubble, so the listener must be a capture listener on
//     document and still fire for a scroll inside a nested container.
//   - the reveal is temporary: once the scroll settles the class has to go away
//     again, and a new scroll while still revealed must extend, not duplicate.

const ACTIVE = 'mt-scroll-active'
const SETTLE_DELAY = 600

const scroll = (target: EventTarget): void => {
  target.dispatchEvent(new Event('scroll'))
}

describe('scrollbar reveal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listenForScrollbarReveal()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals the thumb of the element that scrolls, then hides it again', () => {
    const host = document.createElement('div')
    const inner = document.createElement('div')
    host.appendChild(inner)
    document.body.appendChild(host)

    scroll(inner)
    expect(inner.classList.contains(ACTIVE)).toBe(true)
    // Only the scrolling element is revealed, not every ancestor.
    expect(host.classList.contains(ACTIVE)).toBe(false)

    vi.advanceTimersByTime(SETTLE_DELAY - 1)
    expect(inner.classList.contains(ACTIVE)).toBe(true)

    vi.advanceTimersByTime(1)
    expect(inner.classList.contains(ACTIVE)).toBe(false)

    host.remove()
  })

  it('extends the reveal while the scroll keeps going', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)

    scroll(el)
    vi.advanceTimersByTime(400)
    scroll(el)
    vi.advanceTimersByTime(400)

    expect(el.classList.contains(ACTIVE)).toBe(true)

    vi.advanceTimersByTime(SETTLE_DELAY)
    expect(el.classList.contains(ACTIVE)).toBe(false)

    el.remove()
  })

  it('keeps each scrolling element on its own timer', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)

    scroll(first)
    vi.advanceTimersByTime(400)
    scroll(second)
    vi.advanceTimersByTime(400)

    expect(first.classList.contains(ACTIVE)).toBe(false)
    expect(second.classList.contains(ACTIVE)).toBe(true)

    vi.advanceTimersByTime(SETTLE_DELAY)
    expect(second.classList.contains(ACTIVE)).toBe(false)

    first.remove()
    second.remove()
  })

  it('ignores scroll events that do not come from an element', () => {
    // A whole-window scroll reports the document as target; there is no element
    // to mark, and touching one would be a crash rather than a reveal.
    expect(() => scroll(document)).not.toThrow()
    expect(() => scroll(window)).not.toThrow()
  })
})
