import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CHROME = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: 'google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}
const chrome = process.env.CHROME_PATH ?? DEFAULT_CHROME[process.platform]
const outdir = 'preview/out/screenshots'

// The preview copies fonts out of dist/, so the extension has to be built first.
execFileSync('node', ['scripts/build.mjs'], { stdio: 'inherit' })
execFileSync('node', ['preview/build.mjs'], { stdio: 'inherit' })
await mkdir(outdir, { recursive: true })

const page = pathToFileURL(resolve('preview/out/index.html')).href
const shots = [
    { name: 'sidebar-light', query: 'theme=light', size: '980,1060' },
    { name: 'sidebar-dark', query: 'theme=dark', size: '980,1060' },
    { name: 'popup-signed-in', query: 'popup=signedIn', size: '360,640' },
    { name: 'popup-signed-out', query: 'popup=signedOut', size: '360,520' },
    { name: 'popup-firefox-needs-client-light', query: 'popup=firefoxNeedsClient', size: '360,640' },
    { name: 'popup-firefox-needs-client-dark', query: 'popup=firefoxNeedsClient', size: '360,640', dark: true },
]

for (const { name, query, size, dark } of shots) {
    const file = resolve(outdir, `${name}.png`)
    execFileSync(chrome, [
        '--headless=new',
        '--hide-scrollbars',
        '--force-device-scale-factor=2',
        ...(dark ? ['--force-dark-mode'] : []),
        `--window-size=${size}`,
        // Gives React and the fonts time to settle before the capture.
        '--virtual-time-budget=3000',
        `--screenshot=${file}`,
        `${page}?${query}`,
    ], { stdio: 'ignore' })
    console.log(file)
}
