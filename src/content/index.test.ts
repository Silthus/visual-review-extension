import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { mockFilesChangedPage } from './impact/mockGithubDiff'

const MODULES: Record<string, string> = { 'impact.js': resolve('src/content/impact/index.ts') }

let dom: JSDOM
let getURL: ReturnType<typeof vi.fn>
let sendMessage: ReturnType<typeof vi.fn>

function installGlobals(url: string): void {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, pretendToBeVisual: true })
    const window = dom.window
    getURL = vi.fn((name: string) => MODULES[name] ?? name)
    sendMessage = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    vi.stubGlobal('location', window.location)
    vi.stubGlobal('MutationObserver', window.MutationObserver)
    vi.stubGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window))
    vi.stubGlobal('chrome', {
        runtime: { getURL, sendMessage },
        storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined }, onChanged: { addListener() {}, removeListener() {} } },
    })
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await new Promise((done) => dom.window.requestAnimationFrame(done))
        await new Promise((done) => setTimeout(done, 0))
    }
}

function navigate(path: string, page: Node | null): void {
    dom.window.history.pushState(null, '', path)
    const body = document.createElement('body')
    body.append(...(page ? [page] : []))
    document.body = body
    document.dispatchEvent(new dom.window.Event('turbo:load'))
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

it('stays quiet on GitHub pages that are not a PR diff', async () => {
    installGlobals('https://github.com/PostHog/posthog')
    await import('./index')
    await settle()
    navigate('/PostHog/posthog/pull/7', null)
    await settle()
    expect(getURL).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(document.getElementById('posthog-code-impact')).toBeNull()
})

it('shows code impact on any PR diff when signed out, and cleans up after navigating away', async () => {
    installGlobals('https://github.com/PostHog/posthog/pull/7')
    await import('./index')
    await settle()
    navigate('/PostHog/posthog/pull/7/files', mockFilesChangedPage(document, [{ path: 'src/a.test.ts', additions: 2, deletions: 1, lines: ['+it()'] }]))
    await settle()
    expect(getURL).toHaveBeenCalledWith('impact.js')
    await vi.waitFor(() => expect(document.querySelector('[data-vr-impact-badge]')?.textContent).toBe('Test'))

    navigate('/PostHog/posthog/pull/8/files', mockFilesChangedPage(document, [{ path: 'src/b.ts', additions: 1, deletions: 0, lines: ['+b'] }]))
    await settle()
    await vi.waitFor(() => expect([...document.querySelectorAll('[data-vr-impact-badge]')].map((badge) => badge.textContent)).toEqual(['Production']))

    navigate('/PostHog/posthog/pull/8', null)
    await settle()
    await vi.waitFor(() => expect(document.getElementById('posthog-code-impact')).toBeNull())
    expect(document.getElementById('posthog-code-impact-style')).toBeNull()
    expect(document.documentElement.hasAttribute('data-vr-generated')).toBe(false)
    expect(getURL).not.toHaveBeenCalledWith('sidebar.js')
})
