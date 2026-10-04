import { HEADER_LINES, type DiffFileFacts } from '../../shared/codeImpact'

export interface DiffFile {
    container: HTMLElement
    badgeSlot: HTMLElement | null
    facts: DiffFileFacts
}

function lineCount(summary: string, word: string): number | null {
    const match = new RegExp(`([\\d,]+) ${word}s?\\b`).exec(summary)
    return match ? Number(match[1]!.replace(/,/g, '')) : null
}

function sideLines(table: Element, side: 'left' | 'right'): Map<number, string> {
    const lines = new Map<number, string>()
    for (const row of table.querySelectorAll('tr[data-hunk]')) {
        const numbers = row.querySelectorAll('td.blob-num')
        const number = numbers[side === 'left' ? 0 : 1]?.getAttribute('data-line-number')
        const code = row.querySelector(`[data-split-side="${side}"] .blob-code-inner`) ?? row.querySelector('td:not([data-split-side]) .blob-code-inner')
        if (number && Number(number) > HEADER_LINES) {
            break
        }
        if (number && code) {
            lines.set(Number(number), code.textContent ?? '')
        }
    }
    return lines
}

function fileHeader(container: Element, deleted: boolean): string[] | null {
    const content = container.querySelector('.js-file-content')
    if (content?.querySelector(':scope > .highlight.empty')?.textContent?.includes('Binary file not shown')) {
        return []
    }
    const table = content?.querySelector('table.diff-table')
    if (!table) {
        return null
    }
    const lines = sideLines(table, deleted ? 'left' : 'right')
    if (!lines.has(1)) {
        return null
    }
    const header: string[] = []
    for (let number = 1; number <= HEADER_LINES && lines.has(number); number++) {
        header.push(lines.get(number)!)
    }
    return header
}

const GITHUB_GENERATED = 'data-vr-github-generated'

function hiddenDiffReason(container: Element): string {
    return container.querySelector('.js-file-content p[id^="hidden-diff-reason-"]')?.textContent ?? ''
}

function isGithubGenerated(container: HTMLElement): boolean {
    if (hiddenDiffReason(container).includes('generated files are not rendered by default')) {
        container.setAttribute(GITHUB_GENERATED, '')
    }
    return container.hasAttribute(GITHUB_GENERATED)
}

export function forgetGithubGenerated(doc: Document): void {
    doc.querySelectorAll(`[${GITHUB_GENERATED}]`).forEach((container) => container.removeAttribute(GITHUB_GENERATED))
}

function readDiffFile(container: HTMLElement): DiffFile {
    const header = container.querySelector('.file-header')
    const path = header?.getAttribute('data-path') ?? container.getAttribute('data-tagsearch-path') ?? ''
    const summary = header?.querySelector('.sr-only')?.textContent ?? ''
    const deleted = container.getAttribute('data-file-deleted') === 'true'
    return {
        container,
        badgeSlot: header?.querySelector<HTMLElement>('.file-info') ?? null,
        facts: {
            path,
            additions: lineCount(summary, 'addition'),
            deletions: lineCount(summary, 'deletion'),
            githubGenerated: isGithubGenerated(container),
            fileHeader: fileHeader(container, deleted),
        },
    }
}

export function readDiffFiles(doc: Document): DiffFile[] {
    return [...doc.querySelectorAll<HTMLElement>('#files .file[data-tagsearch-path]')].map(readDiffFile)
}

export function expectedFileCount(doc: Document): number | null {
    const treeFiles = doc.querySelectorAll('li[id^="file-tree-item-diff-"]').length
    return treeFiles > 0 ? treeFiles : null
}

const DIFF_REGIONS = '#files, [role="tree"]'

function asElement(node: Node): Element | null {
    return node.nodeType === 1 ? (node as Element) : node.parentElement
}

export function isDiffChange(target: Node, changed: Node): boolean {
    const element = asElement(changed)
    return !!asElement(target)?.closest(DIFF_REGIONS) || (!!element && (element.matches(DIFF_REGIONS) || !!element.querySelector(DIFF_REGIONS)))
}

export function placeOverview(doc: Document, host: HTMLElement): void {
    const files = doc.getElementById('files')
    if (files && host.nextElementSibling !== files) {
        files.insertAdjacentElement('beforebegin', host)
    }
}
