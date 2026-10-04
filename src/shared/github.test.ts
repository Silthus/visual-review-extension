import { describe, expect, it } from 'vitest'

import { isPullRequestDiffUrl, parsePullRequestUrl } from './github'

describe('parsePullRequestUrl', () => {
    it.each([
        ['https://github.com/PostHog/posthog/pull/123', { owner: 'PostHog', repo: 'posthog', number: 123 }],
        ['https://github.com/PostHog/posthog/pull/123/files', { owner: 'PostHog', repo: 'posthog', number: 123 }],
        ['https://github.com/PostHog/posthog/pull/123/changes#diff-abc', { owner: 'PostHog', repo: 'posthog', number: 123 }],
        ['https://github.com/PostHog/posthog/pull/123?w=1', { owner: 'PostHog', repo: 'posthog', number: 123 }],
    ])('parses %s', (url, expected) => {
        expect(parsePullRequestUrl(url)).toEqual(expected)
    })

    it.each([
        'https://github.com/PostHog/posthog/pulls',
        'https://github.com/PostHog/posthog/issues/123',
        'https://github.com/PostHog/posthog/pull/abc',
        'https://gitlab.com/PostHog/posthog/pull/123',
        'not a url',
    ])('ignores %s', (url) => {
        expect(parsePullRequestUrl(url)).toBeNull()
    })
})

describe('isPullRequestDiffUrl', () => {
    it.each([
        'https://github.com/PostHog/posthog/pull/123/files',
        'https://github.com/PostHog/posthog/pull/123/files/abc123..def456',
        'https://github.com/PostHog/posthog/pull/123/changes#diff-abc',
    ])('accepts %s', (url) => {
        expect(isPullRequestDiffUrl(url)).toBe(true)
    })

    it.each([
        'https://github.com/PostHog/posthog/pull/123',
        'https://github.com/PostHog/posthog/pull/123/commits',
        'https://github.com/PostHog/posthog/blob/main/files',
        'https://github.com/PostHog/posthog/pull/123/filesystem',
    ])('rejects %s', (url) => {
        expect(isPullRequestDiffUrl(url)).toBe(false)
    })
})
