import type { DiffFileFacts } from '../../shared/codeImpact'

export interface DiffFile {
    container: HTMLElement
    badgeSlot: HTMLElement | null
    facts: DiffFileFacts
}

const HEADER_LINES = 10

function lineCount(summary: string, word: string): number | null {
    const match = new RegExp(`([\\d,]+) ${word}s?\\b`).exec(summary)
    return match ? Number(match[1]!.replace(/,/g, '')) : null
}

function previousPath(header: Element | null, path: string): string | undefined {
    const title = header?.querySelector('.file-info a[title]')?.getAttribute('title') ?? ''
    const [before, after] = title.split(' → ')
    return after === path ? before : undefined
}

function sideLines(table: Element, side: 'left' | 'right'): Map<number, string> {
    const lines = new Map<number, string>()
    for (const row of table.querySelectorAll('tr[data-hunk]')) {
        const numbers = row.querySelectorAll('td.blob-num')
        const number = numbers[side === 'left' ? 0 : 1]?.getAttribute('data-line-number')
        const code = row.querySelector('.blob-code-inner')
        if (number && code) {
            lines.set(Number(number), code.textContent ?? '')
        }
    }
    return lines
}

function fileHeader(container: Element, deleted: boolean): string[] | null {
    const content = container.querySelector('.js-file-content')
    if (content?.textContent?.includes('Binary file not shown')) {
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

function readDiffFile(container: HTMLElement): DiffFile {
    const header = container.querySelector('.file-header')
    const path = header?.getAttribute('data-path') ?? container.getAttribute('data-tagsearch-path') ?? ''
    const summary = header?.querySelector('.sr-only')?.textContent ?? ''
    const deleted = container.getAttribute('data-file-deleted') === 'true'
    const content = container.querySelector('.js-file-content')?.textContent ?? ''
    return {
        container,
        badgeSlot: header?.querySelector<HTMLElement>('.file-info') ?? null,
        facts: {
            path,
            previousPath: previousPath(header, path),
            additions: lineCount(summary, 'addition'),
            deletions: lineCount(summary, 'deletion'),
            githubGenerated: content.includes('generated files are not rendered by default'),
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

export function placeOverview(doc: Document, host: HTMLElement): void {
    const files = doc.getElementById('files')
    if (files && host.nextElementSibling !== files) {
        files.insertAdjacentElement('beforebegin', host)
    }
}
