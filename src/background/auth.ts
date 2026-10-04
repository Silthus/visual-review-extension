import { extensionBrowser } from '../shared/browser'
import { errorMessage } from '../shared/errors'
import { errorDetail } from './http'

// visual_review:read — runs, repos. user:read — /api/users/@me/.
// project:read + organization:read — list the projects the token can see.
// The metadata document caps the client at these too, so keep the two lists in sync.
const SCOPES = ['visual_review:read', 'user:read', 'project:read', 'organization:read']

// Lives in PostHog/posthog.com at static/.well-known/oauth/visual-review/client-metadata.json. It
// registers https://<extension id>.chromiumapp.org/, which the manifest's `key` pins.
const DEFAULT_CLIENT_ID = 'https://posthog.com/.well-known/oauth/visual-review/client-metadata.json'
const CONFIGURED_CLIENT_ID = typeof POSTHOG_OAUTH_CLIENT_ID === 'undefined' ? null : POSTHOG_OAUTH_CLIENT_ID
const CLIENT_ID = CONFIGURED_CLIENT_ID ?? DEFAULT_CLIENT_ID

export interface Session {
    authHost: string
    apiHost: string
    clientId: string
    accessToken: string
    refreshToken: string | null
    expiresAt: number
    scopedTeams: number[]
    scopedOrganizations: string[]
}

interface TokenResponse {
    access_token: string
    refresh_token?: string
    expires_in: number
    scoped_teams?: number[]
    scoped_organizations?: string[]
    posthog_base_url?: string
}

/** Signing in didn't work: cancelled, rejected, or a broken response. */
export class SignInError extends Error {}

/** The refresh token is no longer accepted; the user has to sign in again. */
export class RefreshRejectedError extends Error {}

function base64Url(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(byteLength: number): string {
    return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function pkceChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    return base64Url(new Uint8Array(digest))
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(body),
        credentials: 'omit',
    })
}

function toSession(authHost: string, clientId: string, token: TokenResponse, previous?: Session): Session {
    return {
        authHost,
        // The cloud proxy tells us which region the user landed in; self-hosted is its own API host.
        apiHost: token.posthog_base_url ? new URL(token.posthog_base_url).origin : (previous?.apiHost ?? authHost),
        clientId,
        accessToken: token.access_token,
        // CIMD clients get non-rotating refresh tokens, so keep the old one if none comes back.
        refreshToken: token.refresh_token ?? previous?.refreshToken ?? null,
        expiresAt: Date.now() + token.expires_in * 1000,
        scopedTeams: token.scoped_teams ?? previous?.scopedTeams ?? [],
        scopedOrganizations: token.scoped_organizations ?? previous?.scopedOrganizations ?? [],
    }
}

export function signInSetupError(redirectUri = extensionBrowser().identity.getRedirectURL()): string | undefined {
    if (!CONFIGURED_CLIENT_ID && redirectUri !== 'https://coegljbgaffjilmoampifafjigkdmjaf.chromiumapp.org/') {
        return `Firefox needs a registered OAuth client for ${redirectUri}. Build with POSTHOG_OAUTH_CLIENT_ID set to that public client ID. See the Firefox setup in README.`
    }
}

export async function signIn(authHost: string): Promise<Session> {
    const redirectUri = extensionBrowser().identity.getRedirectURL()
    const setupError = signInSetupError(redirectUri)
    if (setupError) {
        throw new SignInError(setupError)
    }
    const verifier = randomString(48)
    const state = randomString(16)
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: SCOPES.join(' '),
        state,
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
    })

    let redirect: string | undefined
    try {
        redirect = await extensionBrowser().identity.launchWebAuthFlow({ url: `${authHost}/oauth/authorize?${params}`, interactive: true })
    } catch (error) {
        throw new SignInError(errorMessage(error))
    }
    if (!redirect) {
        throw new SignInError('Sign-in was cancelled')
    }

    const result = new URL(redirect).searchParams
    const error = result.get('error')
    if (error) {
        throw new SignInError(result.get('error_description') || error)
    }
    if (result.get('state') !== state) {
        throw new SignInError('Sign-in response did not match the request (state mismatch)')
    }
    const code = result.get('code')
    if (!code) {
        throw new SignInError('PostHog did not return an authorization code')
    }

    const response = await postForm(`${authHost}/oauth/token`, {
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: verifier,
    })
    if (!response.ok) {
        throw new SignInError(`Token exchange failed: ${(await errorDetail(response)).message}`)
    }
    return toSession(authHost, CLIENT_ID, (await response.json()) as TokenResponse)
}

export async function refresh(session: Session): Promise<Session> {
    if (!session.refreshToken) {
        throw new RefreshRejectedError('No refresh token')
    }
    const response = await postForm(`${session.authHost}/oauth/token`, {
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: session.clientId,
    })
    if (!response.ok) {
        const { message } = await errorDetail(response)
        // 400/401 means the grant is dead; anything else is worth retrying later.
        if (response.status === 400 || response.status === 401) {
            throw new RefreshRejectedError(message)
        }
        throw new Error(`Couldn't refresh the PostHog session: ${message}`)
    }
    return toSession(session.authHost, session.clientId, (await response.json()) as TokenResponse, session)
}

export async function revoke(session: Session): Promise<void> {
    const tokens = [session.refreshToken, session.accessToken].filter((t): t is string => !!t)
    await Promise.allSettled(
        tokens.map((token) => postForm(`${session.authHost}/oauth/revoke`, { token, client_id: session.clientId }))
    )
}
