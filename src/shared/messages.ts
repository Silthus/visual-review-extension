import { extensionBrowser } from './browser'
import type { RepoIndexEntry } from './repoIndex'
import type { ProjectBasic, PrResults, PullRequestRef } from './types'

export interface AuthState {
    signedIn: boolean
    host: string
    email?: string
    projectId?: number
    projects?: ProjectBasic[]
    /** GitHub repos with visual review set up, from the repo index. */
    trackedRepos?: string[]
    indexBuiltAt?: number
}

// Mutations resolve with nothing: every surface re-reads state when browser storage changes.
export type Request =
    | { type: 'auth:get' }
    | { type: 'auth:signIn'; host: string }
    | { type: 'auth:signOut' }
    | { type: 'project:set'; projectId: number }
    | { type: 'index:refresh' }
    | { type: 'pr:results'; pr: PullRequestRef; entry: RepoIndexEntry }

export interface ResponseMap {
    'auth:get': AuthState
    'auth:signIn': void
    'auth:signOut': void
    'project:set': void
    'index:refresh': void
    'pr:results': PrResults
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string }

/** Typed wrapper over browser messaging; the service worker owns all network and token access. */
export async function send<R extends Request>(request: R): Promise<ResponseMap[R['type']]> {
    const response = (await extensionBrowser().runtime.sendMessage(request)) as Envelope<ResponseMap[R['type']]> | undefined
    if (!response) {
        throw new Error('No response from the extension background worker')
    }
    if (!response.ok) {
        throw new Error(response.error)
    }
    return response.data
}
