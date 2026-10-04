import {
    classifyFile,
    IMPACT_CATEGORIES,
    summarizeImpact,
    type FileImpact,
    type ImpactCategory,
    type ImpactSummary,
} from '../../shared/codeImpact'
import { expectedFileCount, placeOverview, readDiffFiles, type DiffFile } from './githubDiff'
import overviewCss from './overview.css'
import pageCss from './page.css'

export type GeneratedMode = 'show' | 'dim' | 'hide'

export const GENERATED_MODES: GeneratedMode[] = ['show', 'dim', 'hide']

export interface ModeStore {
    get(): Promise<GeneratedMode>
    set(mode: GeneratedMode): Promise<void>
    subscribe(listener: (mode: GeneratedMode) => void): () => void
}

export interface CodeImpactHandle {
    readonly scans: number
    stop(): void
}

const HOST_ID = 'posthog-code-impact'
const STYLE_ID = 'posthog-code-impact-style'
const MODE_ATTRIBUTE = 'data-vr-generated'
const CATEGORY_ATTRIBUTE = 'data-vr-impact'
const BADGE_ATTRIBUTE = 'data-vr-impact-badge'

const CATEGORY_LABELS: Record<ImpactCategory, string> = { production: 'Production', test: 'Test', generated: 'Generated' }
const MODE_LABELS: Record<GeneratedMode, string> = { show: 'Show', dim: 'Dim', hide: 'Hide' }

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string): HTMLElementTagNameMap[K] {
    const el = doc.createElement(tag)
    if (text !== undefined) {
        el.textContent = text
    }
    return el
}

function badgeText(category: ImpactCategory, mode: GeneratedMode): string {
    if (category === 'generated' && mode !== 'show') {
        return `Generated · ${mode === 'dim' ? 'dimmed' : 'hidden'}`
    }
    return CATEGORY_LABELS[category]
}

function setAttributeIfChanged(el: Element, name: string, value: string): void {
    if (el.getAttribute(name) !== value) {
        el.setAttribute(name, value)
    }
}

function completenessNotes(summary: ImpactSummary, fileCount: number): { text: string; attention: boolean }[] {
    if (summary.complete) {
        return [{ text: `All ${plural(fileCount, 'changed file')} are counted.`, attention: false }]
    }
    const notes: { text: string; attention: boolean }[] = []
    if (summary.notLoadedFiles === null) {
        notes.push({ text: 'GitHub does not show the total file count here, so files it has not loaded yet may be missing.', attention: true })
    } else if (summary.notLoadedFiles > 0) {
        notes.push({ text: `${plural(summary.notLoadedFiles, 'file is', 'files are')} not loaded yet. Scroll to load them; the counts update.`, attention: true })
    }
    if (summary.uncountedFiles > 0) {
        notes.push({ text: `${plural(summary.uncountedFiles, 'file has', 'files have')} no line counts, such as binary files.`, attention: true })
    }
    if (summary.uncheckedFiles > 0) {
        const files = plural(summary.uncheckedFiles, 'file does', 'files do')
        notes.push({ text: `${files} not show ${summary.uncheckedFiles === 1 ? 'its' : 'their'} first lines, so ${summary.uncheckedFiles === 1 ? 'its' : 'their'} generated header was not checked.`, attention: true })
    }
    return notes
}

class Overview {
    readonly host: HTMLElement
    private readonly panel: HTMLElement
    private lastRendered = ''

    constructor(
        private readonly doc: Document,
        private readonly onModeChange: (mode: GeneratedMode) => void,
    ) {
        this.host = element(doc, 'section')
        this.host.id = HOST_ID
        this.host.hidden = true
        this.host.setAttribute('aria-label', 'Change impact')
        const shadow = this.host.attachShadow({ mode: 'open' })
        const style = element(doc, 'style', overviewCss)
        this.panel = element(doc, 'div')
        this.panel.className = 'panel'
        shadow.append(style, this.panel)
    }

    render(files: FileImpact[], summary: ImpactSummary, mode: GeneratedMode): void {
        const key = JSON.stringify([files, summary, mode])
        if (key === this.lastRendered) {
            return
        }
        this.lastRendered = key
        this.host.hidden = files.length === 0
        this.panel.replaceChildren(this.summaryBlock(summary), this.modeControl(mode), this.notes(summary, files.length), this.reasons(files))
    }

    private summaryBlock(summary: ImpactSummary): HTMLElement {
        const block = element(this.doc, 'div')
        const table = element(this.doc, 'table')
        table.setAttribute('aria-label', 'Lines changed by category')
        const body = element(this.doc, 'tbody')
        for (const category of IMPACT_CATEGORIES) {
            const totals = summary.totals[category]
            const row = element(this.doc, 'tr')
            row.dataset.category = category
            const added = element(this.doc, 'td', `+${totals.additions}`)
            added.className = 'added'
            const deleted = element(this.doc, 'td', `−${totals.deletions}`)
            deleted.className = 'deleted'
            row.append(element(this.doc, 'th', CATEGORY_LABELS[category]), element(this.doc, 'td', plural(totals.files, 'file')), added, deleted)
            body.append(row)
        }
        table.append(body)
        block.append(element(this.doc, 'h2', 'Change impact'), table)
        return block
    }

    private modeControl(mode: GeneratedMode): HTMLElement {
        const fieldset = element(this.doc, 'fieldset')
        fieldset.append(element(this.doc, 'legend', 'Generated lines'))
        const segments = element(this.doc, 'div')
        segments.className = 'segments'
        for (const option of GENERATED_MODES) {
            const label = element(this.doc, 'label')
            const input = element(this.doc, 'input')
            input.type = 'radio'
            input.name = 'generated-mode'
            input.value = option
            input.checked = option === mode
            input.addEventListener('change', () => this.onModeChange(option))
            label.append(input, MODE_LABELS[option])
            segments.append(label)
        }
        fieldset.append(segments)
        return fieldset
    }

    private notes(summary: ImpactSummary, fileCount: number): HTMLElement {
        const list = element(this.doc, 'ul')
        list.className = 'notes'
        for (const note of completenessNotes(summary, fileCount)) {
            const item = element(this.doc, 'li', note.text)
            if (note.attention) {
                item.dataset.tone = 'attention'
            }
            list.append(item)
        }
        list.append(element(this.doc, 'li', 'Generated means GitHub metadata, a standard generated file name, or a generated header comment says so. Tests follow common TypeScript and Python test paths.'))
        return list
    }

    private reasons(files: FileImpact[]): HTMLElement {
        const details = element(this.doc, 'details')
        const flagged = files.filter((file) => file.category !== 'production')
        details.append(element(this.doc, 'summary', `Why ${plural(flagged.length, 'file is', 'files are')} not production`))
        const list = element(this.doc, 'ul')
        for (const file of flagged) {
            const item = element(this.doc, 'li')
            item.append(element(this.doc, 'code', file.path), ` · ${CATEGORY_LABELS[file.category]}: ${file.reason}`)
            list.append(item)
        }
        details.append(list)
        details.hidden = flagged.length === 0
        return details
    }
}

export function startCodeImpact(doc: Document, modeStore: ModeStore): CodeImpactHandle {
    const view = doc.defaultView!
    let mode: GeneratedMode = 'show'
    let scans = 0
    let scheduled = false
    let stopped = false
    const style = element(doc, 'style', pageCss)
    style.id = STYLE_ID
    doc.head.append(style)
    const overview = new Overview(doc, (next) => {
        applyMode(next)
        void modeStore.set(next)
    })

    function isOwnNode(node: Node): boolean {
        return node === overview.host || (node instanceof view.Element && node.hasAttribute(BADGE_ATTRIBUTE))
    }

    function markFile(file: DiffFile, impact: FileImpact): void {
        setAttributeIfChanged(file.container, CATEGORY_ATTRIBUTE, impact.category)
        if (!file.badgeSlot) {
            return
        }
        let badge = file.badgeSlot.querySelector<HTMLElement>(`[${BADGE_ATTRIBUTE}]`)
        if (!badge) {
            badge = element(doc, 'span')
            file.badgeSlot.append(badge)
        }
        setAttributeIfChanged(badge, BADGE_ATTRIBUTE, impact.category)
        setAttributeIfChanged(badge, 'title', `${CATEGORY_LABELS[impact.category]}: ${impact.reason}`)
        const text = badgeText(impact.category, mode)
        if (badge.textContent !== text) {
            badge.textContent = text
        }
    }

    function scan(): void {
        scans += 1
        const files = readDiffFiles(doc)
        const impacts = files.map((file) => classifyFile(file.facts))
        files.forEach((file, i) => markFile(file, impacts[i]!))
        placeOverview(doc, overview.host)
        overview.render(impacts, summarizeImpact(impacts, expectedFileCount(doc)), mode)
    }

    function schedule(): void {
        if (!scheduled && !stopped) {
            scheduled = true
            view.requestAnimationFrame(() => {
                scheduled = false
                if (!stopped) {
                    scan()
                }
            })
        }
    }

    function applyMode(next: GeneratedMode): void {
        mode = next
        setAttributeIfChanged(doc.documentElement, MODE_ATTRIBUTE, next)
        schedule()
    }

    const observer = new view.MutationObserver((mutations) => {
        const external = mutations.some(
            (mutation) => !isOwnNode(mutation.target) && [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !isOwnNode(node)),
        )
        if (external) {
            schedule()
        }
    })
    observer.observe(doc.body, { childList: true, subtree: true })
    const unsubscribe = modeStore.subscribe(applyMode)
    void modeStore.get().then((stored) => {
        if (!stopped) {
            applyMode(stored)
        }
    })
    schedule()

    return {
        get scans() {
            return scans
        },
        stop() {
            stopped = true
            observer.disconnect()
            unsubscribe()
            overview.host.remove()
            style.remove()
            doc.documentElement.removeAttribute(MODE_ATTRIBUTE)
            doc.querySelectorAll(`[${BADGE_ATTRIBUTE}]`).forEach((badge) => badge.remove())
            doc.querySelectorAll(`[${CATEGORY_ATTRIBUTE}]`).forEach((file) => file.removeAttribute(CATEGORY_ATTRIBUTE))
        },
    }
}
