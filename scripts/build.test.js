import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
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

it('keeps Chrome sign-in on its first-party client when Firefox setup is exported', async () => {
    execFileSync('node', ['scripts/build.mjs'], { cwd: workspace, env: { ...process.env, POSTHOG_OAUTH_CLIENT_ID: 'firefox-only-client' } })
    let respondToRequest
    let authorization
    const chrome = {
        identity: {
            getRedirectURL: () => 'https://coegljbgaffjilmoampifafjigkdmjaf.chromiumapp.org/',
            launchWebAuthFlow: async ({ url }) => { authorization = new URL(url); return undefined },
        },
        storage: { local: { set: async () => undefined } },
        runtime: { onMessage: { addListener: (listener) => { respondToRequest = listener } } },
    }
    runInNewContext(readFileSync(join(workspace, 'dist/background.js'), 'utf8'), { chrome, URL, URLSearchParams, crypto, TextEncoder, btoa })
    await new Promise((resolve) => respondToRequest({ type: 'auth:signIn', host: 'https://oauth.posthog.com' }, {}, resolve))
    expect(authorization.searchParams.get('client_id')).toBe('https://posthog.com/.well-known/oauth/visual-review/client-metadata.json')
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://coegljbgaffjilmoampifafjigkdmjaf.chromiumapp.org/')
})
