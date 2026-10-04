export type ImpactCategory = 'production' | 'test' | 'generated'

export const IMPACT_CATEGORIES: ImpactCategory[] = ['production', 'test', 'generated']

export interface DiffFileFacts {
    path: string
    previousPath?: string
    additions: number | null
    deletions: number | null
    githubGenerated: boolean
    fileHeader: string[] | null
}

export interface FileImpact {
    path: string
    category: ImpactCategory
    reason: string
    additions: number | null
    deletions: number | null
    markersChecked: boolean
}

export interface CategoryTotals {
    files: number
    additions: number
    deletions: number
}

export interface ImpactSummary {
    totals: Record<ImpactCategory, CategoryTotals>
    uncountedFiles: number
    uncheckedFiles: number
    notLoadedFiles: number | null
    complete: boolean
}

const LOCKFILES = new Set([
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lockb',
    'poetry.lock',
    'uv.lock',
    'Pipfile.lock',
    'Cargo.lock',
    'Gemfile.lock',
    'composer.lock',
    'go.sum',
])

const GENERATED_PATHS = [
    /\.min\.(js|css)$/,
    /\.pb\.go$/,
    /_pb2(_grpc)?\.pyi?$/,
    /(^|\/)__generated__\//,
    /\.generated\.[^/]+$/,
]

const TEST_PATHS = [
    /\.(test|spec)\.[cm]?[jt]sx?$/,
    /(^|\/)__tests__\//,
    /(^|\/)__snapshots__\//,
    /(^|\/)tests?\//,
    /(^|\/)test_[^/]+\.py$/,
    /_test\.py$/,
    /(^|\/)conftest\.py$/,
]

const HEADER_LINES = 10

const COMMENT_START = /^\s*(\/\/|\/\*|\*|#|<!--|--)\s*/

const GENERATED_MARKERS = [/^@generated\b/, /^Code generated .* DO NOT EDIT\.?/, /^(This file (is|was) )?(auto-?generated|automatically generated)\b/i]

function fileName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1)
}

function isStandardArtifact(path: string): boolean {
    return LOCKFILES.has(fileName(path)) || GENERATED_PATHS.some((pattern) => pattern.test(path))
}

function commentText(line: string): string | null {
    const start = COMMENT_START.exec(line)
    return start ? line.slice(start[0].length) : null
}

function leadingComments(fileHeader: string[]): string[] {
    const comments: string[] = []
    for (const line of fileHeader.slice(0, HEADER_LINES)) {
        if (line.trim() === '' || line.startsWith('#!')) {
            continue
        }
        const text = commentText(line)
        if (text === null) {
            break
        }
        comments.push(text)
    }
    return comments
}

function hasGeneratedHeader(fileHeader: string[]): boolean {
    return leadingComments(fileHeader).some((text) => GENERATED_MARKERS.some((marker) => marker.test(text)))
}

export function classifyFile(facts: DiffFileFacts): FileImpact {
    const markersChecked = facts.fileHeader !== null
    const impact = (category: ImpactCategory, reason: string): FileImpact => ({
        path: facts.path,
        category,
        reason,
        additions: facts.additions,
        deletions: facts.deletions,
        markersChecked,
    })
    if (facts.githubGenerated) {
        return impact('generated', 'GitHub marks this file as generated')
    }
    if (isStandardArtifact(facts.path)) {
        return impact('generated', 'Matches a standard generated file name')
    }
    if (facts.fileHeader && hasGeneratedHeader(facts.fileHeader)) {
        return impact('generated', 'The file header says it is generated')
    }
    if (TEST_PATHS.some((pattern) => pattern.test(facts.path))) {
        return impact('test', 'Path follows a test file convention')
    }
    return impact(
        'production',
        markersChecked ? 'No generated or test evidence' : 'No generated or test evidence in the path; the start of the file is not shown, so its header was not checked',
    )
}

function emptyTotals(): Record<ImpactCategory, CategoryTotals> {
    return {
        production: { files: 0, additions: 0, deletions: 0 },
        test: { files: 0, additions: 0, deletions: 0 },
        generated: { files: 0, additions: 0, deletions: 0 },
    }
}

export function summarizeImpact(files: FileImpact[], expectedFiles: number | null): ImpactSummary {
    const totals = emptyTotals()
    let uncountedFiles = 0
    let uncheckedFiles = 0
    for (const file of files) {
        const total = totals[file.category]
        total.files += 1
        if (file.additions === null || file.deletions === null) {
            uncountedFiles += 1
        } else {
            total.additions += file.additions
            total.deletions += file.deletions
        }
        if (!file.markersChecked && file.category !== 'generated') {
            uncheckedFiles += 1
        }
    }
    const notLoadedFiles = expectedFiles === null ? null : Math.max(0, expectedFiles - files.length)
    return {
        totals,
        uncountedFiles,
        uncheckedFiles,
        notLoadedFiles,
        complete: notLoadedFiles === 0 && uncountedFiles === 0 && uncheckedFiles === 0,
    }
}
