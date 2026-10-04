import { HedgehogError, HedgehogExplorer, HedgehogHourglass, HedgehogSleepy } from '@posthog/brand/hoggies'
import { Logo } from '@posthog/brand/logo'
import { useEffect, useState } from 'react'

import { extensionBrowser } from '../shared/browser'
import { errorMessage } from '../shared/errors'
import { parsePullRequestUrl, repoFullName } from '../shared/github'
import { CLOUD_AUTH_HOST, normalizeHost } from '../shared/host'
import { type AuthState, send } from '../shared/messages'
import { lookupRepo, repoIndexItem } from '../shared/repoIndex'
import { type Hoggie, STATE_COPY } from '../shared/runCopy'
import { overallState } from '../shared/runState'
import { onStorageChange, storageItem } from '../shared/storage'
import { timeAgo } from '../shared/time'
import type { PrResults, PullRequestRef } from '../shared/types'

// Anything that changes what the popup shows lands in one of these keys.
const WATCHED = [storageItem('session'), storageItem('profile'), repoIndexItem]

function hostLabel(host: string): string {
    if (host.includes('us.posthog.com')) {
        return 'US Cloud'
    }
    if (host.includes('eu.posthog.com')) {
        return 'EU Cloud'
    }
    return new URL(host).host
}

function SignedOut({ initialHost, signInError }: { initialHost: string; signInError?: string }) {
    const [mode, setMode] = useState<'cloud' | 'custom'>(initialHost === CLOUD_AUTH_HOST ? 'cloud' : 'custom')
    const [customHost, setCustomHost] = useState(initialHost === CLOUD_AUTH_HOST ? 'http://localhost:8010' : initialHost)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const signIn = async () => {
        if (signInError) {
            return
        }
        setError(null)
        let host = CLOUD_AUTH_HOST
        if (mode === 'custom') {
            const normalized = normalizeHost(customHost)
            if (!normalized) {
                setError('That doesn’t look like a URL')
                return
            }
            host = normalized
        }
        setBusy(true)
        try {
            // Custom hosts aren't in the manifest's host_permissions; ask while we have a user gesture.
            if (mode === 'custom' && !(await extensionBrowser().permissions.request({ origins: [`${host}/*`] }))) {
                throw new Error(`Permission to reach ${host} was declined`)
            }
            await send({ type: 'auth:signIn', host })
        } catch (e) {
            setError(errorMessage(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="stack">
            <div className="hero">
                <HedgehogExplorer size={112} />
                <h1>Visual review, right on the PR</h1>
                <p className="muted">
                    See snapshot changes at the top of every GitHub pull request instead of digging through
                    checks.
                </p>
            </div>

            <div className="segmented" role="radiogroup" aria-label="PostHog instance">
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'cloud'}
                    className={mode === 'cloud' ? 'active' : ''}
                    onClick={() => setMode('cloud')}
                >
                    PostHog Cloud
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'custom'}
                    className={mode === 'custom' ? 'active' : ''}
                    onClick={() => setMode('custom')}
                >
                    Self-hosted / local
                </button>
            </div>

            {mode === 'cloud' ? (
                !signInError && <p className="hint">US or EU is picked automatically when you sign in.</p>
            ) : (
                <label className="field">
                    <span>Instance URL</span>
                    <input
                        className="input"
                        value={customHost}
                        onChange={(e) => setCustomHost(e.target.value)}
                        placeholder="https://posthog.example.com"
                        spellCheck={false}
                    />
                </label>
            )}

            {(signInError || error) && <div className="callout callout--danger">{signInError || error}</div>}

            <button type="button" className="lemon-button lemon-button--primary" onClick={signIn} disabled={busy || !!signInError}>
                <span>{busy ? 'Waiting for PostHog…' : 'Sign in with PostHog'}</span>
            </button>
        </div>
    )
}

function CurrentTab({ pr, auth }: { pr: PullRequestRef | null; auth: AuthState }) {
    const [results, setResults] = useState<PrResults | null>(null)

    useEffect(() => {
        setResults(null)
        if (!pr) {
            return
        }
        void (async () => {
            const index = await repoIndexItem.get()
            const entry = index && lookupRepo(index, pr)
            if (!entry) {
                setResults({ kind: 'repo_not_tracked' })
                return
            }
            try {
                setResults(await send({ type: 'pr:results', pr, entry }))
            } catch (e) {
                setResults({ kind: 'error', message: errorMessage(e) })
            }
        })()
    }, [pr, auth])

    if (!pr) {
        return (
            <div className="card tab-card">
                <HedgehogSleepy size={56} />
                <div>
                    <div className="card-title">Open a pull request</div>
                    <div className="muted small">Results show up at the top of GitHub PR pages.</div>
                </div>
            </div>
        )
    }

    let Illustration: Hoggie = HedgehogSleepy
    let text = 'Loading…'
    let href: string | null = null
    switch (results?.kind) {
        case undefined:
            Illustration = HedgehogHourglass
            break
        case 'runs': {
            const copy = STATE_COPY[overallState(results.runs)]
            Illustration = copy.hoggie
            text = copy.label
            href = results.runs[0]!.url
            break
        }
        case 'no_runs':
            text = 'No runs for this PR yet'
            href = results.repoUrl
            break
        case 'repo_not_tracked':
            text = "This repo isn't set up for visual review in any project you can access"
            break
        case 'error':
            Illustration = HedgehogError
            text = results.message
            break
        case 'signed_out':
            text = 'Your PostHog session ended. Sign in again.'
    }

    return (
        <div className="card tab-card">
            <Illustration size={56} />
            <div className="tab-card-text">
                <div className="card-title">
                    {repoFullName(pr)} #{pr.number}
                </div>
                <div className="muted small">{text}</div>
                {href && (
                    <a className="link small" href={href} target="_blank" rel="noreferrer">
                        Open in PostHog →
                    </a>
                )}
            </div>
        </div>
    )
}

function TrackedRepos({ auth }: { auth: AuthState }) {
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const repos = auth.trackedRepos ?? []

    const refresh = async () => {
        setRefreshing(true)
        setError(null)
        try {
            await send({ type: 'index:refresh' })
        } catch (e) {
            setError(errorMessage(e))
        } finally {
            setRefreshing(false)
        }
    }

    return (
        <div className="card">
            <div className="row">
                <div className="grow">
                    <div className="card-title">
                        Watching {repos.length} repo{repos.length === 1 ? '' : 's'}
                    </div>
                    <div className="muted small">
                        {refreshing
                            ? 'Checking your projects…'
                            : auth.indexBuiltAt
                              ? `Checked ${timeAgo(auth.indexBuiltAt)}`
                              : 'Not checked yet'}
                    </div>
                </div>
                <button
                    type="button"
                    className="lemon-button lemon-button--secondary"
                    onClick={refresh}
                    disabled={refreshing}
                >
                    <span>Refresh</span>
                </button>
            </div>
            {error && <div className="callout callout--danger">{error}</div>}
            {repos.length > 0 ? (
                <ul className="repo-list">
                    {repos.map((name) => (
                        <li key={name}>
                            <a href={`https://github.com/${name}/pulls`} target="_blank" rel="noreferrer">
                                {name}
                            </a>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="hint">
                    None of your projects has visual review set up yet. GitHub pages stay untouched until one does.
                </p>
            )}
        </div>
    )
}

function SignedIn({ auth, pr }: { auth: AuthState; pr: PullRequestRef | null }) {
    const [busy, setBusy] = useState(false)

    const signOut = async () => {
        setBusy(true)
        try {
            await send({ type: 'auth:signOut' })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="stack">
            <CurrentTab pr={pr} auth={auth} />
            <TrackedRepos auth={auth} />

            <div className="card">
                <div className="row">
                    <div className="avatar" aria-hidden="true">
                        {(auth.email ?? '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="grow">
                        <div className="card-title truncate">{auth.email ?? 'Signed in'}</div>
                        <div className="muted small">{hostLabel(auth.host)}</div>
                    </div>
                </div>

                <label className="field">
                    <span>Default project</span>
                    <select
                        className="input"
                        value={auth.projectId ?? ''}
                        onChange={(e) => void send({ type: 'project:set', projectId: Number(e.target.value) })}
                    >
                        {(auth.projects ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </label>
                <p className="hint">Wins when a repo is set up in more than one project.</p>
            </div>

            <div className="footer">
                <a
                    className="link small"
                    href={`${auth.host}/project/${auth.projectId ?? '@current'}/visual_review`}
                    target="_blank"
                    rel="noreferrer"
                >
                    Visual review in PostHog →
                </a>
                <button type="button" className="lemon-button lemon-button--secondary" onClick={signOut} disabled={busy}>
                    <span>Sign out</span>
                </button>
            </div>
        </div>
    )
}

export function Popup() {
    const [auth, setAuth] = useState<AuthState | null>(null)
    const [pr, setPr] = useState<PullRequestRef | null>(null)

    useEffect(() => {
        const loadAuth = () => void send({ type: 'auth:get' }).then(setAuth)
        loadAuth()
        void extensionBrowser().tabs
            .query({ active: true, currentWindow: true })
            .then(([tab]) => setPr(tab?.url ? parsePullRequestUrl(tab.url) : null))
        return onStorageChange(WATCHED, loadAuth)
    }, [])

    return (
        <main className="popup">
            <header className="popup-header">
                <span className="brand-logo" aria-label="PostHog">
                    <Logo.Logomark className="brand-logomark" />
                    <Logo.Wordmark className="brand-wordmark" />
                </span>
                <span className="product-tag">Visual review</span>
            </header>
            {auth && (auth.signedIn ? <SignedIn auth={auth} pr={pr} /> : <SignedOut initialHost={auth.host} signInError={auth.signInError} />)}
            <p className="internal-note">
                An internal tool for the PostHog team. It isn’t a supported PostHog product.
            </p>
        </main>
    )
}
