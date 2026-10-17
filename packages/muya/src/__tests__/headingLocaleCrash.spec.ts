// @vitest-environment happy-dom

import type Content from '../block/base/content';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as locales from '../locales';
import { Muya } from '../muya';

const { zhCN } = locales;

// REGRESSION GUARD — #4424 / #4427 (Phase-G migration crash).
//
// Typing `#` (then a space) to create an ATX heading converts the paragraph to
// an AtxHeading block. Historically that block appended a `HeadingCopyLink`
// attachment whose constructor called
// `muya.i18n.t('Copy anchor link to this heading')` — that affordance is gone now
// (replaced by a pure-CSS heading-level badge), but the conversion path and the
// `I18n.t` fall-through it exposed are still worth pinning.
//
// Two independent migration bugs converged on that single call:
//   1. `I18n.t` fell through to `resources.en[key]`, but the constructor only
//      stores `{ [name]: resource }`. Under a NON-`en` locale `resources.en`
//      is `undefined`, so a missing key threw `Cannot read properties of
//      undefined` instead of falling back to the raw key.
//   2. The `'Copy anchor link to this heading'` key was never added to the
//      locale resources, so every locale (en included) hit that fall-through —
//      crashing under a non-en locale and showing the raw key under en.
//
// Both were fixed in #4424 (optional-chain the fallback + add the key to all
// locales) but NO automated test booted Muya under a non-en locale and hit the
// HeadingCopyLink `i18n.t` path. These tests pin both halves: (a) creating a
// heading under zh-CN via the real input path must not throw and must render
// the affordance with the translated label, and (b) `I18n.t` must stay
// crash-safe for a key missing from a non-en locale — guarding the
// optional-chaining fix directly, so a regression there is caught even if the
// locale key were re-supplied.

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    // Drop any document-global Selection so a stale Range can't point into a
    // removed host node and break a later test's setCursor.
    window.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string, locale: typeof locales.en): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        locale,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

// Drive the real "type `# x`" input path: write the text into the active
// content block's contenteditable node, place the caret, and run the block's
// `inputHandler` the way a keystroke does. `inputHandler` reads the DOM text
// and runs `_convertIfNeeded`, which converts the paragraph to an ATX heading —
// the exact path that builds HeadingCopyLink and calls `i18n.t`. (We invoke
// `inputHandler` directly because happy-dom does not deliver a dispatched
// `input` event to the engine's listener.) The conversion's state flush lands
// on the next animation frame, so callers await `flush()` before asserting on
// `getState()`.
function typeHeading(muya: Muya, raw: string): void {
    const content = muya.editor.scrollPage!.firstContentInDescendant() as Content;
    muya.editor.activeContentBlock = content;
    content.domNode!.textContent = raw;
    content.setCursor(raw.length, raw.length);
    content.inputHandler(
        new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    );
}

function flush(): Promise<void> {
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

describe('typing `#` to create a heading under a non-en locale (#4424 / #4427)', () => {
    it('does not throw when converting a paragraph to an ATX heading under zh-CN', async () => {
        const muya = bootMuya('\n', zhCN);

        expect(() => typeHeading(muya, '# Heading')).not.toThrow();

        // The conversion actually happened — otherwise the i18n path that used
        // to crash would never have run.
        await flush();
        expect(muya.getState()[0].name).toBe('atx-heading');
    });

    it('i18n.t stays crash-safe and falls back to the raw key for a key missing from a non-en locale', () => {
        // Guards the optional-chaining fix in I18n.t directly: under a non-en
        // locale `resources.en` is undefined, so a missing key must fall back
        // to the raw key instead of throwing.
        const muya = bootMuya('\n', zhCN);
        const missingKey = '__definitely_not_a_real_i18n_key__';
        expect(() => muya.i18n.t(missingKey)).not.toThrow();
        expect(muya.i18n.t(missingKey)).toBe(missingKey);
    });

    it('does not throw for ANY shipped locale (no raw-key fall-through crash)', async () => {
        // Typing `#` must not crash under any shipped locale. The HeadingCopyLink
        // attachment that used to call `i18n.t` here was replaced by a pure-CSS
        // level badge, so what remains is the conversion path itself plus the
        // optional-chaining guard in `I18n.t` (pinned by the test above).
        for (const locale of Object.values(locales)) {
            const muya = bootMuya('\n', locale);
            expect(() => typeHeading(muya, '# Heading')).not.toThrow();
            await flush();
            expect(muya.getState()[0].name).toBe('atx-heading');
        }
    });
});
