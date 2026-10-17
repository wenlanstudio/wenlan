// Scrollbars are styled thin and empty by default (see the `::-webkit-scrollbar`
// rules in `assets/styles/index.css`), and two signals bring a thumb back:
//
//   - the pointer resting over a scroll area marked `mt-scroll-area` (pure CSS
//     `:hover`), and
//   - a scroll actually happening: regardless of where it comes from, the
//     element that scrolls gets `mt-scroll-active` for as long as it keeps
//     scrolling. That is the only way to reveal scrollbars that live inside
//     subtrees we do not own (Element Plus poppers, CodeMirror, ...).
//
// `scroll` does not bubble, so listening has to happen in the capture phase on
// the document; `event.target` is then the element (or document) that scrolled.
const ACTIVE_CLASS = 'mt-scroll-active'
const SETTLE_DELAY = 600
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

export const listenForScrollbarReveal = (): void => {
  const reveal = (target: EventTarget | null): void => {
    // A whole-document scroll has its target on `document`/`<html>`, which has
    // no class list — that document itself is what is scrolling, so nothing to
    // mark: the document scroll bar follows its own scroll container below.
    if (!(target instanceof Element)) return

    target.classList.add(ACTIVE_CLASS)
    const pending = timers.get(target)
    if (pending !== undefined) clearTimeout(pending)

    timers.set(
      target,
      setTimeout(() => {
        target.classList.remove(ACTIVE_CLASS)
        timers.delete(target)
      }, SETTLE_DELAY)
    )
  }

  document.addEventListener('scroll', (event) => reveal(event.target), true)
}
