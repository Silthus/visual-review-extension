// Runs on every github.com page, so it stays tiny: parse the URL, check the repo index in
// storage, and only load the sidebar module (React + hoggies) for a PR in a tracked repo.
// The code impact module loads on any PR's diff page, signed in or not.

import { extensionBrowser } from '../shared/browser'
import { isPullRequestDiffUrl, parsePullRequestUrl } from '../shared/github'
import { send } from '../shared/messages'
import { lookupRepo, needsRefresh, repoIndexItem } from '../shared/repoIndex'
import { onStorageChange } from '../shared/storage'
import type { CodeImpactHandle } from './impact/codeImpact'
import type { SidebarHandle } from './mount'

const HOST_ID = 'posthog-visual-review'

/**
 * Where the section goes: right after "Labels" in the PR's sidebar, like any other sidebar
 * section. Pages without the sidebar (Files changed, Commits, Checks) show nothing.
 */
function findPlacement(): { el: Element; position: InsertPosition } | null {
    const sidebar = document.querySelector('#partial-discussion-sidebar')
    if (!sidebar) {
        return null
    }
    // GitHub re-renders the Labels section in place when labels change, keyed on this channel.
    const labels =
        sidebar.querySelector('[data-channel-event-name="labels_updated"]') ??
        sidebar.querySelector('.js-issue-labels')?.closest('.discussion-sidebar-item')
    if (labels) {
        return { el: labels, position: 'afterend' }
    }
    const first = sidebar.querySelector('.discussion-sidebar-item')
    return first ? { el: first, position: 'afterend' } : { el: sidebar, position: 'afterbegin' }
}

let host: HTMLElement | null = null
let sidebar: SidebarHandle | null = null
let lastHref = ''
let syncId = 0

/** Put the host in place, or back in place if GitHub re-rendered the sidebar and dropped it. */
function attach(): void {
    if (host && !host.isConnected) {
        const placement = findPlacement()
        placement?.el.insertAdjacentElement(placement.position, host)
    }
}

function unmount(): void {
    sidebar?.unmount()
    host?.remove()
    sidebar = null
    host = null
}

let impact: CodeImpactHandle | null = null

async function syncImpact(id: number): Promise<void> {
    if (!isPullRequestDiffUrl(location.href)) {
        impact?.stop()
        impact = null
        return
    }
    if (impact) {
        return
    }
    const { mountCodeImpact } = (await import(extensionBrowser().runtime.getURL('impact.js'))) as typeof import('./impact')
    if (id === syncId && !impact) {
        impact = mountCodeImpact()
    }
}

async function sync(): Promise<void> {
    const id = ++syncId
    lastHref = location.href
    void syncImpact(id)
    const pr = parsePullRequestUrl(location.href)
    // No index means signed out: signing in happens in the toolbar popup, never on GitHub.
    const index = pr ? await repoIndexItem.get() : null
    const entry = pr && index ? lookupRepo(index, pr) : undefined
    if (id !== syncId) {
        return
    }
    if (index && !entry && needsRefresh(index)) {
        // The repo may have been set up since the index was built. If the rebuild adds it,
        // the storage listener below syncs again.
        void send({ type: 'index:refresh' }).catch(() => undefined)
    }
    if (!pr || !entry) {
        unmount()
        return
    }

    const { mountSidebar } = (await import(extensionBrowser().runtime.getURL('sidebar.js'))) as typeof import('./mount')
    if (id !== syncId) {
        return
    }
    if (sidebar) {
        sidebar.update(pr, entry)
    } else {
        host = document.createElement('div')
        host.id = HOST_ID
        // GitHub's own class, so the section gets the same spacing and divider as its neighbors.
        // Hidden until there's something to show.
        host.className = 'discussion-sidebar-item'
        host.hidden = true
        sidebar = mountSidebar(host, pr, entry)
    }
    attach()
}

let scheduled = false
function schedule(): void {
    if (!scheduled) {
        scheduled = true
        requestAnimationFrame(() => {
            scheduled = false
            void sync()
        })
    }
}

// GitHub navigates with Turbo and React Router and re-renders the sidebar freely. The observer
// is the catch-all for both, so its per-mutation work is a string compare and a flag check.
new MutationObserver(() => {
    if (location.href !== lastHref) {
        schedule()
    } else if (host && !host.isConnected) {
        attach()
    }
}).observe(document.body, { childList: true, subtree: true })
document.addEventListener('turbo:load', schedule)
window.addEventListener('popstate', schedule)
// Sign-in, sign-out, and index rebuilds all land in storage.
onStorageChange([repoIndexItem], schedule)
void sync()
