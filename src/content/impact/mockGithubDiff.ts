export interface MockDiffFile {
    path: string
    previousPath?: string
    additions?: number
    deletions?: number
    lines?: string[]
    startLine?: number
    split?: { left: string; right: string }[]
    githubGenerated?: boolean
    collapsed?: boolean
    emptyNotice?: string
    deleted?: boolean
    comment?: string
    commentTable?: boolean
}

function element(doc: Document, tag: string, attributes: Record<string, string> = {}, text?: string): HTMLElement {
    const el = doc.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) {
        el.setAttribute(name, value)
    }
    if (text !== undefined) {
        el.textContent = text
    }
    return el
}

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`
}

function header(doc: Document, file: MockDiffFile): HTMLElement {
    const head = element(doc, 'div', { class: 'file-header js-file-header', 'data-path': file.path, 'data-file-deleted': String(!!file.deleted) })
    const info = element(doc, 'div', { class: 'file-info' })
    if (file.additions !== undefined && file.deletions !== undefined) {
        const changes = file.additions + file.deletions
        info.append(
            element(doc, 'span', { class: 'sr-only' }, `${plural(changes, 'change')}: ${plural(file.additions, 'addition')} & ${plural(file.deletions, 'deletion')}`),
            element(doc, 'span', { class: 'diffstat', 'aria-hidden': 'true' }, String(changes)),
        )
    } else {
        info.append(element(doc, 'span', { class: 'diffstat' }, 'BIN'))
    }
    const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path
    info.append(element(doc, 'a', { class: 'Link--primary Truncate-text', title, href: '#' }, title))
    head.append(info, element(doc, 'div', { class: 'file-actions' }, 'Viewed'))
    return head
}

interface LineNumbers {
    left: number
    right: number
}

function lineNumber(doc: Document, kind: string, number: number | null): HTMLElement {
    return number === null
        ? element(doc, 'td', { class: `blob-num blob-num-${kind} empty-cell` })
        : element(doc, 'td', { class: `blob-num blob-num-${kind} js-linkable-line-number`, 'data-line-number': String(number) })
}

function codeRow(doc: Document, line: string, numbers: LineNumbers): HTMLElement {
    const marker = line[0] === '+' || line[0] === '-' ? line[0] : ' '
    const kind = marker === '+' ? 'addition' : marker === '-' ? 'deletion' : 'context'
    const left = marker === '+' ? null : numbers.left++
    const right = marker === '-' ? null : numbers.right++
    const row = element(doc, 'tr', { 'data-hunk': 'mock' })
    const code = element(doc, 'td', { class: `blob-code blob-code-${kind} js-file-line` })
    code.append(element(doc, 'span', { class: 'blob-code-inner blob-code-marker', 'data-code-marker': marker }, line.slice(1)))
    row.append(lineNumber(doc, kind, left), lineNumber(doc, kind, right), code)
    return row
}

function splitCode(doc: Document, side: 'left' | 'right', text: string | undefined): HTMLElement {
    if (text === undefined) {
        return element(doc, 'td', { class: 'blob-code blob-code-empty empty-cell', 'data-split-side': side })
    }
    const code = element(doc, 'td', { class: 'blob-code js-file-line', 'data-split-side': side })
    code.append(element(doc, 'span', { class: 'blob-code-inner blob-code-marker' }, text))
    return code
}

function splitRow(doc: Document, line: { left: string; right: string }, number: number): HTMLElement {
    const row = element(doc, 'tr', { 'data-hunk': 'mock' })
    row.append(
        lineNumber(doc, 'deletion', number),
        splitCode(doc, 'left', line.left),
        lineNumber(doc, 'addition', number),
        splitCode(doc, 'right', line.right),
    )
    return row
}

function hunkRow(doc: Document, start: number): HTMLElement {
    const row = element(doc, 'tr', { class: 'js-expandable-line js-skip-tagsearch', 'data-position': '0' })
    row.append(
        element(doc, 'td', { class: 'blob-num blob-num-expandable', 'data-line-number': '...' }),
        element(doc, 'td', { class: 'blob-code blob-code-inner blob-code-hunk' }, `@@ -${start} +${start} @@`),
    )
    return row
}

export function expandMockContext(doc: Document, path: string, lines: string[]): void {
    const hunk = doc.querySelector(`[data-tagsearch-path="${path}"] tr.js-expandable-line`)!
    const numbers = { left: 1, right: 1 }
    hunk.replaceWith(
        ...lines.map((line) => {
            const row = codeRow(doc, ` ${line}`, numbers)
            row.removeAttribute('data-hunk')
            row.className = 'blob-expanded'
            return row
        }),
    )
}

function commentTable(doc: Document): HTMLElement {
    const table = element(doc, 'table')
    const row = element(doc, 'tr')
    row.append(element(doc, 'td', {}, 'before'), element(doc, 'td', {}, 'after'))
    table.append(row)
    return table
}

function commentRow(doc: Document, text: string, withTable: boolean): HTMLElement {
    const row = element(doc, 'tr', { class: 'inline-comments js-inline-comments-container' })
    const cell = element(doc, 'td', { colspan: '3' })
    const body = element(doc, 'div', { class: 'review-comment' }, text)
    if (withTable) {
        cell.append(body, commentTable(doc), element(doc, 'button', { type: 'button' }, 'Reply'))
    } else {
        cell.append(body, element(doc, 'button', { type: 'button' }, 'Reply'))
    }
    row.append(cell)
    return row
}

function loadDiffPlaceholder(doc: Document, path: string, reason: string): HTMLElement {
    const id = `hidden-diff-reason-${path.replace(/\W/g, '-')}`
    const loader = element(doc, 'div', { class: 'js-diff-entry-loader' })
    loader.append(
        element(doc, 'button', { type: 'button', class: 'load-diff-button js-diff-load', 'aria-describedby': id }, 'Load diff'),
        element(doc, 'p', { id, class: 'color-fg-muted f6' }, reason),
    )
    return loader
}

export function loadMockDiff(doc: Document, file: MockDiffFile): void {
    const body = doc.querySelector(`[data-tagsearch-path="${file.path}"] .js-file-content`)!
    body.replaceWith(content(doc, { ...file, githubGenerated: false, collapsed: false }))
}

function content(doc: Document, file: MockDiffFile): HTMLElement {
    const body = element(doc, 'div', { class: 'js-file-content' })
    if (file.githubGenerated) {
        body.append(loadDiffPlaceholder(doc, file.path, 'Some generated files are not rendered by default. Learn more about how customized files appear on GitHub.'))
        return body
    }
    if (file.collapsed) {
        body.append(loadDiffPlaceholder(doc, file.path, 'Large diffs are not rendered by default.'))
        return body
    }
    if (file.additions === undefined || file.emptyNotice) {
        body.append(element(doc, 'div', { class: 'data highlight empty' }, file.emptyNotice ?? 'Binary file not shown.'))
        return body
    }
    const table = element(doc, 'table', { class: 'diff-table js-diff-table' })
    const rows = element(doc, 'tbody')
    const numbers = { left: file.startLine ?? 1, right: file.startLine ?? 1 }
    rows.append(hunkRow(doc, numbers.left))
    for (const line of file.lines ?? []) {
        rows.append(codeRow(doc, line, numbers))
    }
    file.split?.forEach((line, i) => rows.append(splitRow(doc, line, i + 1)))
    if (file.comment) {
        rows.append(commentRow(doc, file.comment, !!file.commentTable))
    }
    table.append(rows)
    body.append(table)
    return body
}

export function mockDiffFile(doc: Document, file: MockDiffFile): HTMLElement {
    const entry = element(doc, 'copilot-diff-entry', { 'data-file-path': file.path })
    const container = element(doc, 'div', { class: 'file js-file Details', 'data-tagsearch-path': file.path, 'data-file-deleted': String(!!file.deleted) })
    container.append(header(doc, file), content(doc, file))
    entry.append(container)
    return entry
}

export function mockFilesChangedPage(doc: Document, files: MockDiffFile[], expectedFiles: number = files.length): HTMLElement {
    const page = element(doc, 'div', { class: 'pull-request-tab-content' })
    const tree = element(doc, 'ul', { class: 'ActionList', role: 'tree' })
    for (let i = 0; i < expectedFiles; i++) {
        tree.append(element(doc, 'li', { id: `file-tree-item-diff-${i}`, class: 'ActionList-item js-tree-node', role: 'treeitem' }, files[i]?.path ?? `file-${i}`))
    }
    const list = element(doc, 'div', { id: 'files', class: 'diff-view js-diff-container' })
    const progressive = element(doc, 'div', { class: 'js-diff-progressive-container' })
    for (const file of files) {
        progressive.append(mockDiffFile(doc, file))
    }
    list.append(progressive)
    page.append(tree, list)
    return page
}
