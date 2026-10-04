import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [
        {
            name: 'css-as-text',
            enforce: 'pre',
            async resolveId(source, importer, options) {
                if (!source.endsWith('.css') || !importer) {
                    return null
                }
                const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
                return resolved ? `${resolved.id}?inline` : null
            },
        },
    ],
    test: { css: { include: [/\.css/] } },
})
