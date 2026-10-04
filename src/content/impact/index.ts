import { storageItem, onStorageChange } from '../../shared/storage'
import { GENERATED_MODES, startCodeImpact, type CodeImpactHandle, type GeneratedMode, type ModeStore } from './codeImpact'

const generatedModeItem = storageItem<GeneratedMode>('generatedMode')

function validMode(mode: GeneratedMode | null): GeneratedMode {
    return mode && GENERATED_MODES.includes(mode) ? mode : 'show'
}

const storedModeStore: ModeStore = {
    get: async () => validMode(await generatedModeItem.get()),
    set: (mode) => generatedModeItem.set(mode),
    subscribe: (listener) => onStorageChange([generatedModeItem], () => void storedModeStore.get().then(listener)),
}

export function mountCodeImpact(): CodeImpactHandle {
    return startCodeImpact(document, storedModeStore)
}
