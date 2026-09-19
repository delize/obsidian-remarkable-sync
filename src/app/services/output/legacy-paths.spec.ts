import { test, expect, describe, beforeEach } from 'bun:test'
import type { TAbstractFile, Vault } from 'obsidian'
import {
    buildLegacyPathPairs,
    reportLegacyOutputPaths,
    resetLegacyPathNotices
} from './legacy-paths'

/**
 * A vault that holds the given paths and counts how often it is asked.
 *
 * The count matters: the whole point of dropping unmoved pairs is that a clean
 * name costs nothing, and only a counting fake can prove that.
 */
function createProbeVault(existing: readonly string[] = []): {
    vault: Pick<Vault, 'getAbstractFileByPath'>
    lookups: string[]
} {
    const held = new Set<string>(existing)
    const lookups: string[] = []

    return {
        vault: {
            getAbstractFileByPath: (path: string): TAbstractFile | null => {
                lookups.push(path)
                // The reporter only tests for presence, so a tagged object is
                // enough; it never reads the value.
                return held.has(path) ? ({ path } as TAbstractFile) : null
            }
        },
        lookups
    }
}

describe('buildLegacyPathPairs', () => {
    test('returns nothing for a name that needed no sanitising', () => {
        // The most important case in this module. Every notebook in a vault
        // goes through here on every sync, so a clean name must cost nothing
        // and report nothing. Only holds because sanitiseName is idempotent.
        expect(buildLegacyPathPairs('rM', 'Work', 'Meeting')).toEqual([])
    })

    test('pairs each old output path with where it lands now', () => {
        const pairs = buildLegacyPathPairs('rM', 'Work', 'Trips/Japan')

        // The image folder plus the five whole-document outputs.
        expect(pairs).toHaveLength(6)
        expect(pairs.map((p) => p.oldPath)).toEqual([
            'rM/Work/Trips/Japan',
            'rM/Work/Trips/Japan.pdf',
            'rM/Work/Trips/Japan.epub',
            'rM/Work/Trips/Japan (annotated).pdf',
            'rM/Work/Trips/Japan (highlights).md',
            'rM/Work/Trips/Japan (text).md'
        ])
        expect(pairs.map((p) => p.newPath)).toEqual([
            'rM/Work/Trips-Japan',
            'rM/Work/Trips-Japan.pdf',
            'rM/Work/Trips-Japan.epub',
            'rM/Work/Trips-Japan (annotated).pdf',
            'rM/Work/Trips-Japan (highlights).md',
            'rM/Work/Trips-Japan (text).md'
        ])
    })

    test('reports the folder path moving even when the name is clean', () => {
        // The reMarkable folder is sanitised too, so output moves without the
        // notebook name itself changing.
        const pairs = buildLegacyPathPairs('', 'Q3:notes', 'Meeting')

        expect(pairs[0]?.oldPath).toBe('Q3:notes/Meeting')
        expect(pairs[0]?.newPath).toBe('Q3-notes/Meeting')
    })
})

describe('reportLegacyOutputPaths', () => {
    beforeEach(() => {
        resetLegacyPathNotices()
    })

    test('asks the vault nothing when no path moved', async () => {
        const { vault, lookups } = createProbeVault()

        expect(await reportLegacyOutputPaths(vault, 'rM', 'Work', 'Meeting')).toEqual([])
        expect(lookups).toHaveLength(0)
    })

    test('returns only the old paths that actually exist', async () => {
        const { vault } = createProbeVault(['rM/Trips/Japan.pdf'])

        const found = await reportLegacyOutputPaths(vault, 'rM', '', 'Trips/Japan')

        expect(found).toHaveLength(1)
        expect(found[0]?.oldPath).toBe('rM/Trips/Japan.pdf')
        expect(found[0]?.newPath).toBe('rM/Trips-Japan.pdf')
    })

    test('a vault that throws does not break the sync', async () => {
        // Advisory reporting must never abort a sync that would otherwise
        // succeed.
        const vault: Pick<Vault, 'getAbstractFileByPath'> = {
            getAbstractFileByPath: (): TAbstractFile | null => {
                throw new Error('vault unavailable')
            }
        }

        expect(await reportLegacyOutputPaths(vault, '', '', 'Trips/Japan')).toEqual([])
    })
})
