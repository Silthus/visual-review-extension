import type { PullRequestRef } from './types'

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/

export function parsePullRequestUrl(url: string): PullRequestRef | null {
    let pathname: string
    try {
        const parsed = new URL(url)
        if (parsed.hostname !== 'github.com') {
            return null
        }
        pathname = parsed.pathname
    } catch {
        return null
    }
    const match = PR_PATH.exec(pathname)
    if (!match) {
        return null
    }
    const [, owner, repo, number] = match
    return { owner: owner!, repo: repo!, number: Number(number) }
}

export function repoFullName(pr: PullRequestRef): string {
    return `${pr.owner}/${pr.repo}`
}

/** Identifies one PR, e.g. "PostHog/posthog#123". */
export function prKey(pr: PullRequestRef): string {
    return `${repoFullName(pr)}#${pr.number}`
}

const PR_DIFF_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)(\/|$)/

export function isPullRequestDiffUrl(url: string): boolean {
    return parsePullRequestUrl(url) !== null && PR_DIFF_PATH.test(new URL(url).pathname)
}
