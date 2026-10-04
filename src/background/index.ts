import { extensionBrowser } from '../shared/browser'
import { errorMessage } from '../shared/errors'
import { CLOUD_AUTH_HOST, normalizeHost } from '../shared/host'
import type { AuthState, Request, ResponseMap } from '../shared/messages'
import { repoIndexItem } from '../shared/repoIndex'
import { storageItem } from '../shared/storage'
import type { CurrentUser, Paginated, ProjectBasic } from '../shared/types'
import { revoke, signIn, signInSetupError } from './auth'
import { refreshRepoIndex } from './repoIndex'
import {
    ApiError,
    api,
    clearAccount,
    type Profile,
    profileItem,
    SessionEndedError,
    sessionItem,
} from './session'
import { getPrResults } from './visualReview'

const lastHostItem = storageItem<string>('lastHost')

/** Work out which projects the token can reach, following the same rules as PostHog's MCP server. */
async function discoverProfile(scopedTeams: number[], scopedOrganizations: string[]): Promise<Profile> {
    const me = await api<CurrentUser>('/api/users/@me/')
    const orgIds = scopedOrganizations.length ? scopedOrganizations : me.organizations.map((o) => o.id)

    const pages = await Promise.all(
        orgIds.map((orgId) =>
            api<Paginated<ProjectBasic>>(`/api/organizations/${orgId}/projects/?limit=200`).catch((error) => {
                // The token may not cover every org the user belongs to.
                if (error instanceof ApiError) {
                    return { results: [] }
                }
                throw error
            })
        )
    )
    const projects = pages.flatMap((page) => page.results.map(({ id, name }) => ({ id, name })))

    let visible = scopedTeams.length ? projects.filter((p) => scopedTeams.includes(p.id)) : projects
    if (visible.length === 0 && me.team) {
        visible = [{ id: me.team.id, name: me.team.name }]
    }
    visible.sort((a, b) => a.name.localeCompare(b.name))

    const current = me.team && visible.some((p) => p.id === me.team!.id) ? me.team.id : visible[0]?.id
    return { email: me.email, projectId: current, projects: visible }
}

async function authState(): Promise<AuthState> {
    const [session, profile, lastHost, index] = await Promise.all([
        sessionItem.get(),
        profileItem.get(),
        lastHostItem.get(),
        repoIndexItem.get(),
    ])
    if (!session) {
        return { signedIn: false, host: lastHost ?? CLOUD_AUTH_HOST, signInError: signInSetupError() }
    }
    return {
        signedIn: true,
        host: session.apiHost,
        email: profile?.email,
        projectId: profile?.projectId,
        projects: profile?.projects ?? [],
        trackedRepos: index ? Object.values(index.repos).map((r) => r.fullName).sort() : [],
        indexBuiltAt: index?.builtAt || undefined,
    }
}

async function rebuildIndex(): Promise<void> {
    const profile = await profileItem.get()
    if (profile) {
        await refreshRepoIndex(profile.projects, profile.projectId)
    }
}

async function doSignIn(host: string): Promise<void> {
    const authHost = normalizeHost(host)
    if (!authHost) {
        throw new Error(`${host} isn't a valid URL`)
    }
    await lastHostItem.set(authHost)
    const session = await signIn(authHost)
    await sessionItem.set(session)
    try {
        await profileItem.set(await discoverProfile(session.scopedTeams, session.scopedOrganizations))
    } catch (error) {
        await clearAccount()
        throw error
    }
    // An empty index marks the account as signed in for content scripts. If the first build
    // fails, it stays stale, and the next visit to a PR retries it through needsRefresh().
    await repoIndexItem.set({ builtAt: 0, repos: {} })
    await rebuildIndex().catch(() => undefined)
}

async function doSignOut(): Promise<void> {
    const session = await sessionItem.get()
    await clearAccount()
    if (session) {
        await revoke(session)
    }
}

async function handle(request: Request): Promise<ResponseMap[Request['type']]> {
    switch (request.type) {
        case 'auth:get':
            return authState()
        case 'auth:signIn':
            return doSignIn(request.host)
        case 'auth:signOut':
            return doSignOut()
        case 'project:set': {
            const profile = await profileItem.get()
            if (profile) {
                await profileItem.set({ ...profile, projectId: request.projectId })
                // The preferred project decides which one wins for repos set up in several.
                await rebuildIndex()
            }
            return
        }
        case 'index:refresh':
            return rebuildIndex()
        case 'pr:results':
            try {
                return await getPrResults(request.pr, request.entry)
            } catch (error) {
                if (error instanceof SessionEndedError) {
                    return { kind: 'signed_out' }
                }
                return { kind: 'error', message: errorMessage(error) }
            }
    }
}

extensionBrowser().runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
    handle(request)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }))
    return true // keep the channel open for the async response
})
