import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const chromeManifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'))

it('builds a Firefox package with a stable identity and executable background script', () => {
    execFileSync('node', ['scripts/build.mjs', '--browser=firefox'])
    const manifest = JSON.parse(readFileSync('dist-firefox/manifest.json', 'utf8'))
    expect(manifest.background).toEqual({ scripts: ['background.js'] })
    expect(manifest.browser_specific_settings.gecko).toMatchObject({ id: 'visual-review@posthog.com', strict_min_version: '128.0' })
    expect(manifest.key).toBeUndefined()
        expect(readFileSync('dist-firefox/background.js', 'utf8')).not.toMatch(/\bexport\s*\{/)
})

it('preserves the Chrome identity and module worker in the default build', () => {
    execFileSync('node', ['scripts/build.mjs'])
    const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'))
    expect(manifest.key).toBe(chromeManifest.key)
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' })
    expect(manifest.browser_specific_settings).toBeUndefined()
})
