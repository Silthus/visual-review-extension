import { afterEach, expect, it, vi } from 'vitest'
import { signIn } from './auth'

afterEach(() => vi.unstubAllGlobals())

it('explains the missing Firefox OAuth registration before opening sign-in', async () => {
    const launchWebAuthFlow = vi.fn()
    vi.stubGlobal('browser', { identity: {
        getRedirectURL: () => 'https://example.extensions.allizom.org/',
        launchWebAuthFlow,
    } })
    await expect(signIn('https://oauth.posthog.com')).rejects.toThrow('Firefox needs a registered OAuth client')
    expect(launchWebAuthFlow).not.toHaveBeenCalled()
})

it.each(['registered-firefox-client', 'https://posthog.com/.well-known/oauth/visual-review/client-metadata.json'])('uses configured client %s with the Firefox callback and PKCE through token exchange', async (clientId) => {
    vi.resetModules()
    vi.stubGlobal('POSTHOG_OAUTH_CLIENT_ID', clientId)
    const redirectUri = 'https://example.extensions.allizom.org/'
    let authorization: URL | undefined
    let tokenRequest: URLSearchParams | undefined
    vi.stubGlobal('browser', { identity: {
        getRedirectURL: () => redirectUri,
        launchWebAuthFlow: async ({ url }: { url: string }) => {
            authorization = new URL(url)
            return `${redirectUri}?code=example-code&state=${authorization.searchParams.get('state')}`
        },
    } })
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        tokenRequest = init.body as URLSearchParams
        expect(init.credentials).toBe('omit')
        return new Response(JSON.stringify({ access_token: 'example-token', expires_in: 3600 }))
    })
    const { signIn: configuredSignIn } = await import('./auth')
    const session = await configuredSignIn('https://oauth.posthog.com')
    expect(session.clientId).toBe(clientId)
    expect(authorization!.searchParams.get('client_id')).toBe(clientId)
    expect(authorization!.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(authorization!.searchParams.get('code_challenge_method')).toBe('S256')
    expect(tokenRequest!.get('redirect_uri')).toBe(redirectUri)
    expect(tokenRequest!.get('client_id')).toBe(clientId)
    expect(tokenRequest!.get('code')).toBe('example-code')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tokenRequest!.get('code_verifier')!))
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(authorization!.searchParams.get('code_challenge')).toBe(challenge)
})
