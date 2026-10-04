export function extensionBrowser(): typeof chrome {
    return (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome
}
