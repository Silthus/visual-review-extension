import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'

const chromeManifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'))
const workspace = mkdtempSync(join(tmpdir(), 'visual-review-build-'))

beforeAll(() => {
    cpSync('src', join(workspace, 'src'), { recursive: true })
    mkdirSync(join(workspace, 'scripts'))
    cpSync('scripts/build.mjs', join(workspace, 'scripts/build.mjs'))
    symlinkSync(resolve('node_modules'), join(workspace, 'node_modules'), 'dir')
})
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

it('builds a Firefox package with a stable identity and executable background script', () => {
    execFileSync('node', ['scripts/build.mjs', '--browser=firefox'], { cwd: workspace })
    const manifest = JSON.parse(readFileSync(join(workspace, 'dist-firefox/manifest.json'), 'utf8'))
    expect(manifest.background).toEqual({ scripts: ['background.js'] })
    expect(manifest.browser_specific_settings.gecko).toMatchObject({ id: 'visual-review@posthog.com', strict_min_version: '128.0' })
    expect(manifest.key).toBeUndefined()
    expect(readFileSync(join(workspace, 'dist-firefox/background.js'), 'utf8')).not.toMatch(/\bexport\s*\{/)
})

it('preserves the Chrome identity and module worker in the default build', () => {
    execFileSync('node', ['scripts/build.mjs'], { cwd: workspace })
    const manifest = JSON.parse(readFileSync(join(workspace, 'dist/manifest.json'), 'utf8'))
    expect(manifest.key).toBe(chromeManifest.key)
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' })
    expect(manifest.browser_specific_settings).toBeUndefined()
})
