import { Notice } from 'obsidian'
import type { Vault } from 'obsidian'
import { log } from '../../../utils/log'
import { ANNOTATED_SUFFIX, buildDocumentPath, buildPagePath } from './markdown-writer.service'
import { HIGHLIGHTS_SUFFIX, TYPED_TEXT_SUFFIX } from './document-output.service'

/** Where output used to land, and where it lands now. */
export interface LegacyPathPair {
    readonly oldPath: string
    readonly newPath: string
}

/**
 * Paths already reported this session, so a repeat sync stays quiet.
 *
 * Automatic sync runs on a timer over every notebook, so an unconditional
 * Notice would repeat forever for anyone who chooses not to clean up. The log
 * line still fires every run, so the console record stays complete.
 */
const notified = new Set<string>()

/** Clears the once-per-session Notice suppression. For tests. */
export function resetLegacyPathNotices(): void {
    notified.clear()
}

/**
 * Join path parts the way the writer did BEFORE names were sanitised.
 *
 * Deliberately duplicated rather than calling the builders: this encodes a
 * frozen historical layout, and it must not drift when the builders change.
 */
function joinRaw(...parts: readonly string[]): string {
    return parts.filter((part) => '' !== part).join('/')
}

/**
 * The output paths a notebook would have used before sanitisation, paired with
 * where each one lands now.
 *
 * Pure, and returns only pairs that actually MOVED. A name with nothing to
 * sanitise yields an empty array, so the caller performs no vault lookups at
 * all and nothing is reported. That comparison is only trustworthy because
 * `sanitiseName` is idempotent: a clean name has to survive unchanged, or every
 * notebook in the vault would look like it had moved.
 *
 * Probes the per-notebook image FOLDER rather than each page image, which is
 * what keeps this at six lookups whether the notebook has three pages or three
 * hundred.
 */
export function buildLegacyPathPairs(
    targetFolder: string,
    folderPath: string,
    notebookName: string
): LegacyPathPair[] {
    const oldBase = joinRaw(targetFolder, folderPath)

    const candidates: LegacyPathPair[] = [
        {
            // The per-notebook image folder.
            oldPath: joinRaw(oldBase, notebookName),
            newPath: buildPagePath(targetFolder, folderPath, notebookName, 0, 'x')
                .split('/')
                .slice(0, -1)
                .join('/')
        },
        ...(
            [
                ['', 'pdf'],
                ['', 'epub'],
                [ANNOTATED_SUFFIX, 'pdf'],
                [HIGHLIGHTS_SUFFIX, 'md'],
                [TYPED_TEXT_SUFFIX, 'md']
            ] as const
        ).map(([suffix, extension]) => ({
            oldPath: joinRaw(oldBase, `${notebookName}${suffix}.${extension}`),
            newPath: buildDocumentPath(
                targetFolder,
                folderPath,
                `${notebookName}${suffix}`,
                extension
            )
        }))
    ]

    return candidates.filter((pair) => pair.oldPath !== pair.newPath)
}

/**
 * Report output still sitting at a pre-sanitisation path.
 *
 * The plugin never moves, renames or deletes a vault file. This tells the user
 * where the old output is and where the new output goes, and leaves the
 * decision to them.
 *
 * Never throws. Advisory reporting must not be able to abort a sync that would
 * otherwise succeed, which is the same reasoning `ensureParentFolder` and the
 * skip-if-unchanged comparison already apply in the writer.
 */
export async function reportLegacyOutputPaths(
    vault: Pick<Vault, 'getAbstractFileByPath'>,
    targetFolder: string,
    folderPath: string,
    notebookName: string
): Promise<LegacyPathPair[]> {
    const found: LegacyPathPair[] = []

    try {
        for (const pair of buildLegacyPathPairs(targetFolder, folderPath, notebookName)) {
            if (vault.getAbstractFileByPath(pair.oldPath)) {
                found.push(pair)
            }
        }
    } catch (error) {
        log('Could not check for output at the old path', 'debug', error)
        return found
    }

    if (0 === found.length) {
        return found
    }

    for (const pair of found) {
        log(
            `Output may still exist at the old path "${pair.oldPath}"; ` +
                `new output goes to "${pair.newPath}". Nothing was moved or deleted.`,
            'warn'
        )
    }

    const first = found[0]
    if (first && !notified.has(first.oldPath)) {
        notified.add(first.oldPath)
        const more = found.length > 1 ? ` (and ${found.length - 1} more, see the console)` : ''
        new Notice(
            `${notebookName}: older output is still at "${first.oldPath}"${more}. ` +
                `New output goes to "${first.newPath}".`
        )
    }

    return found
}
