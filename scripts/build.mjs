import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const browser = process.argv.find((arg) => arg.startsWith('--browser='))?.split('=')[1] ?? 'chrome'
if (!['chrome', 'firefox'].includes(browser)) {
    throw new Error(`Unknown browser: ${browser}`)
}
const outdir = browser === 'firefox' ? 'dist-firefox' : 'dist'

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const shared = {
    bundle: true,
    target: browser === 'firefox' ? 'firefox128' : 'chrome120',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    jsx: 'automatic',
    define: {
        'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
        POSTHOG_OAUTH_CLIENT_ID: JSON.stringify(browser === 'firefox' ? process.env.POSTHOG_OAUTH_CLIENT_ID || null : null),
    },
    // Stylesheets are injected as <style> text (the sidebar section lives in a shadow root).
    loader: { '.css': 'text' },
    logLevel: 'info',
}

const builds = [
    { ...shared, entryPoints: { background: 'src/background/index.ts' }, format: browser === 'firefox' ? 'iife' : 'esm', outdir },
    // Content scripts can't be modules, so the loader that runs on every GitHub page is a small IIFE…
    { ...shared, entryPoints: { content: 'src/content/index.ts' }, format: 'iife', outdir },
    // …which dynamic-imports the sidebar module (React + hoggies) only for PRs in tracked repos.
    { ...shared, entryPoints: { sidebar: 'src/content/mount.tsx' }, format: 'esm', outdir },
    { ...shared, entryPoints: { popup: 'src/popup/index.tsx' }, format: 'iife', outdir },
]

async function copyStatic() {
    const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'))
    if (browser === 'firefox') {
        delete manifest.key
        manifest.background = { scripts: ['background.js'] }
        manifest.browser_specific_settings = { gecko: {
            id: 'visual-review@posthog.com',
            strict_min_version: '128.0',
            data_collection_permissions: { required: ['authenticationInfo', 'websiteContent'] },
        } }
    }
    await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 4) + '\n')
    await cp('src/popup/popup.html', `${outdir}/popup.html`)
    await cp('src/assets/icons', `${outdir}/icons`, { recursive: true, filter: (f) => !f.endsWith('.svg') })
    // RoundHog for the popup. @posthog/brand resolves font URLs via import.meta.url, which
    // doesn't survive bundling, so the faces we use are copied and referenced from popup.css.
    await mkdir(`${outdir}/fonts`, { recursive: true })
    for (const face of ['RoundHog', 'RoundHog-Medium', 'RoundHog-SemiBold', 'RoundHog-Bold']) {
        await cp(`node_modules/@posthog/brand/dist/fonts/${face}.woff2`, `${outdir}/fonts/${face}.woff2`)
    }
}

if (watch) {
    const contexts = await Promise.all(builds.map((b) => esbuild.context(b)))
    await copyStatic()
    await Promise.all(contexts.map((c) => c.watch()))
    console.log(`Watching ${browser}… reload the extension after edits.`)
} else {
    await Promise.all(builds.map((b) => esbuild.build(b)))
    await copyStatic()
}
