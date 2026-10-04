import { afterEach, expect, it, vi } from 'vitest'
import type { Request } from '../shared/messages'

afterEach(() => vi.unstubAllGlobals())

it('shows the Firefox registration prerequisite before requesting host access', async () => {
    type Listener = (request: Request, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => unknown
    let listener: Listener | undefined
    vi.stubGlobal('browser', {
        identity: { getRedirectURL: () => 'https://example.extensions.allizom.org/' },
        storage: { local: { get: async () => ({}) } },
        runtime: { onMessage: { addListener: (callback: Listener) => { listener = callback } } },
    })
    await import('./index')
    const response = await new Promise((resolve) => listener!({ type: 'auth:get' }, {}, resolve))
    expect(response).toMatchObject({ ok: true, data: {
        signedIn: false,
        signInError: expect.stringContaining('Firefox needs a registered OAuth client for https://example.extensions.allizom.org/'),
    } })
})
