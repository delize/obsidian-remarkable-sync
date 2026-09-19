import {
    DEFAULT_SETTINGS,
    MAX_AUTO_SYNC_INTERVAL_MINUTES,
    MIN_AUTO_SYNC_INTERVAL_MINUTES
} from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { log } from '../../utils/log'
import { sanitiseRelativePath } from '../../utils/sanitise-path'

const IMAGE_FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp'])

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * Merge the settings stored in `data.json` over the defaults.
 *
 * Driven by the keys of `DEFAULT_SETTINGS` rather than a hand-written list of
 * assignments. The previous hand-written version silently dropped any setting
 * whose line was forgotten, which meant the value round-tripped to disk
 * correctly and then reset to its default on the next launch. Iterating the
 * defaults makes that impossible: a new setting is picked up as soon as it has
 * a default.
 *
 * Only keys present in `DEFAULT_SETTINGS` are copied, so unrelated `data.json`
 * entries (notably `tokens`, which must never enter `PluginSettings` because
 * the settings object is written to the debug log) cannot leak in.
 *
 * Values whose type does not match the default are ignored rather than trusted,
 * so a hand-edited or corrupted file degrades to defaults instead of poisoning
 * the plugin.
 */
export function mergeLoadedSettings(loaded: unknown): PluginSettings {
    const merged: PluginSettings = { ...DEFAULT_SETTINGS }

    if (!loaded || 'object' !== typeof loaded) {
        return merged
    }

    const source = loaded as Record<string, unknown>
    const target = merged as unknown as Record<string, unknown>

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        const value = source[key]

        // Absent, or explicitly null: keep the default.
        if (undefined === value || null === value) continue

        // `typeof null === 'object'` is already excluded above.
        const defaultValue = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key]
        if (typeof value !== typeof defaultValue) continue

        target[key] = value
    }

    // `typeof` cannot see union members or object shapes, so the fields with
    // a narrower contract than "same primitive type" are validated explicitly:
    // a hand-edited file must degrade to defaults, not poison the plugin.
    if (!IMAGE_FORMATS.has(merged.imageFormat)) {
        merged.imageFormat = DEFAULT_SETTINGS.imageFormat
    }
    if (!Number.isFinite(merged.imageQuality)) {
        merged.imageQuality = DEFAULT_SETTINGS.imageQuality
    } else {
        merged.imageQuality = clamp(merged.imageQuality, 0.1, 1)
    }
    if (!Number.isFinite(merged.autoSyncIntervalMinutes)) {
        merged.autoSyncIntervalMinutes = DEFAULT_SETTINGS.autoSyncIntervalMinutes
    } else {
        merged.autoSyncIntervalMinutes = clamp(
            merged.autoSyncIntervalMinutes,
            MIN_AUTO_SYNC_INTERVAL_MINUTES,
            MAX_AUTO_SYNC_INTERVAL_MINUTES
        )
    }
    // `typeof` says "string", which does not stop `../../etc` from escaping
    // the vault or a `:` from breaking the write on Windows. Sanitised rather
    // than rejected: this path is non-interactive and must not break startup.
    const safeTargetFolder = sanitiseRelativePath(merged.targetFolder)
    if (safeTargetFolder !== merged.targetFolder) {
        log(
            `Target folder "${merged.targetFolder}" is not a usable vault path; ` +
                `using "${safeTargetFolder}"`,
            'warn'
        )
        merged.targetFolder = safeTargetFolder
    }

    // Everything downstream iterates `syncStore.notebooks`; an array or a
    // missing map would throw far from here.
    const store = merged.syncStore as unknown
    if (
        !store ||
        'object' !== typeof store ||
        Array.isArray(store) ||
        !(store as Record<string, unknown>)['notebooks'] ||
        'object' !== typeof (store as Record<string, unknown>)['notebooks'] ||
        Array.isArray((store as Record<string, unknown>)['notebooks'])
    ) {
        merged.syncStore = DEFAULT_SETTINGS.syncStore
    }

    return merged
}
