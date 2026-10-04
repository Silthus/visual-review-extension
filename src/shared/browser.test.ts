import { afterEach, expect, it, vi } from 'vitest'
import { send } from './messages'
import { storageItem } from './storage'

afterEach(() => vi.unstubAllGlobals())

it.each(['browser', 'chrome'])('uses native %s APIs for account storage and background requests', async (namespace) => {
    const values: Record<string, unknown> = {}
    vi.stubGlobal(namespace, {
        storage: { local: {
            get: async (key: string) => ({ [key]: values[key] }),
            set: async (items: Record<string, unknown>) => Object.assign(values, items),
            remove: async (key: string) => { delete values[key] },
        } },
        runtime: { sendMessage: async () => ({ ok: true, data: { signedIn: false, host: 'https://oauth.posthog.com' } }) },
    })
    const account = storageItem<string>('account')
    await account.set('signed in')
    expect(await account.get()).toBe('signed in')
    await account.set(null)
    expect(await account.get()).toBeNull()
    expect(await send({ type: 'auth:get' })).toEqual({ signedIn: false, host: 'https://oauth.posthog.com' })
})
