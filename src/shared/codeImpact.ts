export type ImpactCategory = 'production' | 'test' | 'generated'

export const IMPACT_CATEGORIES: ImpactCategory[] = ['production', 'test', 'generated']

export interface DiffFileFacts {
    path: string
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
}

const LOCKFILES = new Set([
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
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
    /(^|\/)tests\.py$/,
]

export const HEADER_LINES = 40

const GENERATED_MARKERS = [/^@generated\b/, /^Code generated .* DO NOT EDIT\.?/, /^This (file|code) (is|was) (auto-?generated|automatically generated)\b/i, /^(auto-?generated|automatically generated) (by|from|with)\b/i]

const SLASH = /^\s*(\/\/+|\/\*+)\s*/
const BLOCK_ONLY = /^\s*\/\*+\s*/
const HASH = /^\s*#+\s*/
const MARKUP = /^\s*<!--\s*/
const DASH = /^\s*(--+|\/\*+)\s*/

const COMMENT_SYNTAX: [RegExp, RegExp][] = [
    [/\.([cm]?[jt]sx?|go|java|kts?|swift|c|h|cc|cpp|hpp|cs|rs|dart|scala|php|proto|scss|less)$/i, SLASH],
    [/\.css$/i, BLOCK_ONLY],
    [/(\.(py|pyi|sh|bash|zsh|rb|ya?ml|toml|r|pl|tf|graphql|gql)|(^|\/)(Dockerfile|Makefile))$/i, HASH],
    [/\.(md|mdx|markdown|html?|xml|svg|vue|svelte)$/i, MARKUP],
    [/\.(sql|lua|hs)$/i, DASH],
]

const BLOCK_INTERIOR_START = /^\s*\*+\s*/

const BLOCK_CLOSERS: Record<string, string> = { '/*': '*/', '<!--': '-->' }

function fileName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1)
}

function isStandardArtifact(path: string): boolean {
    return LOCKFILES.has(fileName(path)) || GENERATED_PATHS.some((pattern) => pattern.test(path))
}

function hasCodeAfter(line: string, closer: string, from: number): boolean {
    const close = line.indexOf(closer, from)
    return close >= 0 && line.slice(close + closer.length).trim() !== ''
}

function openedBlock(line: string): { closer: string; closed: boolean; codeAfter: boolean } | null {
    const trimmed = line.trimStart()
    const opener = Object.keys(BLOCK_CLOSERS).find((open) => trimmed.startsWith(open))
    if (!opener) {
        return null
    }
    const closer = BLOCK_CLOSERS[opener]!
    return { closer, closed: trimmed.includes(closer, opener.length), codeAfter: hasCodeAfter(trimmed, closer, opener.length) }
}

function commentSyntax(path: string): RegExp | null {
    return COMMENT_SYNTAX.find(([files]) => files.test(path))?.[1] ?? null
}

function textAfter(line: string, pattern: RegExp): string {
    const start = pattern.exec(line)
    return start ? line.slice(start[0].length) : line.trim()
}

interface LeadingComments {
    comments: string[]
    complete: boolean
}

function leadingComments(fileHeader: string[], commentStart: RegExp | null): LeadingComments {
    const comments: string[] = []
    let openCloser: string | null = null
    for (const line of commentStart ? fileHeader.slice(0, HEADER_LINES) : []) {
        if (openCloser) {
            comments.push(textAfter(line, BLOCK_INTERIOR_START))
            if (hasCodeAfter(line, openCloser, 0)) {
                return { comments, complete: true }
            }
            openCloser = line.includes(openCloser) ? null : openCloser
            continue
        }
        if (line.trim() === '' || line.startsWith('#!')) {
            continue
        }
        if (!commentStart!.test(line)) {
            return { comments, complete: true }
        }
        comments.push(textAfter(line, commentStart!))
        const block = openedBlock(line)
        if (block?.codeAfter) {
            return { comments, complete: true }
        }
        openCloser = block && !block.closed ? block.closer : null
    }
    return { comments, complete: !commentStart || fileHeader.length === 0 }
}

function hasGeneratedMarker(comments: string[]): boolean {
    return comments.some((text) => GENERATED_MARKERS.some((marker) => marker.test(text)))
}

export function classifyFile(facts: DiffFileFacts): FileImpact {
    const commentStart = commentSyntax(facts.path)
    const header = facts.fileHeader === null ? null : leadingComments(facts.fileHeader, commentStart)
    const markersChecked = header?.complete ?? false
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
    if (header && hasGeneratedMarker(header.comments)) {
        return impact('generated', 'Its leading comment block says it is generated')
    }
    if (TEST_PATHS.some((pattern) => pattern.test(facts.path))) {
        return impact('test', 'Path follows a test file convention')
    }
    return impact(
        'production',
        markersChecked ? 'No generated or test evidence' : 'No generated or test evidence in the path; the diff does not show the whole leading comment block, so it was not checked for a generated marker',
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
    }
}
