import { extensionBrowser } from './browser'

export interface StorageItem<T> {
    key: string
    get(): Promise<T | null>
    set(value: T | null): Promise<void>
}

export function storageItem<T>(key: string): StorageItem<T> {
    return {
        key,
        async get() {
            return ((await extensionBrowser().storage.local.get(key))[key] as T | undefined) ?? null
        },
        async set(value) {
            if (value === null) {
                await extensionBrowser().storage.local.remove(key)
            } else {
                await extensionBrowser().storage.local.set({ [key]: value })
            }
        },
    }
}

export function onStorageChange(items: StorageItem<unknown>[], listener: () => void): () => void {
    const keys = new Set(items.map((i) => i.key))
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && Object.keys(changes).some((k) => keys.has(k))) {
            listener()
        }
    }
    extensionBrowser().storage.onChanged.addListener(handler)
    return () => extensionBrowser().storage.onChanged.removeListener(handler)
}
