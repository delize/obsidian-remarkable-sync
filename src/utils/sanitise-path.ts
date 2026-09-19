import { log } from './log'

/**
 * Characters that cannot appear in a vault path component.
 *
 * This is the UNION of every platform's rules, applied on every host rather
 * than only the host's own. A vault is synced between machines: a name that is
 * legal on macOS and illegal on Windows is still a broken name, and the machine
 * that wrote it is not the machine that discovers that.
 *
 * `\ / : * ? " < >` and `|` are filesystem restrictions across Windows, Android
 * and the POSIX platforms. `[ ] # ^` are legal in a file name on macOS and
 * Linux but break an Obsidian wikilink, and `|` breaks one too: `#` reads as a
 * heading reference, `^` as a block reference, `|` as an alias separator, and
 * `]]` closes the link early.
 *
 * The trailing `+` collapses a RUN of replaced characters into a single
 * hyphen, so `a<>b` is `a-b` rather than `a--b`. Runs of hyphens the user typed
 * themselves are left alone, which is why `-` is deliberately not in the class.
 */
const UNSAFE_CHARACTERS = /[\\/:*?"<>|[\]#^]+/g

/**
 * Remove control characters.
 *
 * Removed rather than replaced: a hyphen standing in for an invisible byte is a
 * hyphen the user cannot explain, and no name carries meaning in U+0000-U+001F.
 *
 * Written as a code-point filter rather than a character class because a
 * control-character class is a `no-control-regex` error and the rule gate
 * refuses an inline disable. Iterating code points reads better regardless.
 */
function stripControlCharacters(value: string): string {
    let result = ''
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0
        if (code < 0x20 || 0x7f === code) continue
        result += char
    }
    return result
}

/** Obsidian excludes dot-prefixed files from the vault index entirely. */
const LEADING_DOTS = /^\.+/

/** Windows strips these at creation time, silently moving the file. */
const TRAILING_DOTS_AND_SPACES = /[. ]+$/

const ONLY_HYPHENS = /^-+$/

/**
 * Reserved on Windows whatever the extension: `CON.md` is still `CON`.
 *
 * The forum thread this work came from does not mention these, but omitting
 * them would make the character rule portable and the name rule not, which is
 * incoherent. The failure without it is a bare `EINVAL` from the adapter, on
 * Windows only, with nothing in the message to explain it.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
    'con',
    'prn',
    'aux',
    'nul',
    ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
])

/** What a name becomes when sanitising leaves nothing usable. */
export const FALLBACK_NAME = 'Untitled'

/**
 * Longest permitted name, in UTF-8 BYTES rather than characters.
 *
 * ext4 and APFS cap a path component at 255 bytes, so a 100-character CJK name
 * is 300 bytes and fails. 150 leaves room for what callers append afterwards
 * (`-P001.jpeg`, `.pdf`, ` (annotated)`) and keeps a nested path clear of
 * Windows' 260-character path limit.
 */
export const MAX_NAME_BYTES = 150

/** Bytes reserved for the `-` and the 6-character discriminator. */
const DISCRIMINATOR_BYTES = 7

const utf8 = new TextEncoder()

function byteLength(value: string): number {
    return utf8.encode(value).length
}

/**
 * djb2, rendered base36 and padded to 6 characters.
 *
 * Only used to keep two truncated names apart, so collision resistance matters
 * far more than cryptographic strength. Deterministic, which is what lets the
 * skip-if-unchanged write guard keep working across syncs.
 */
function discriminator(value: string): string {
    let hash = 5381
    for (const char of value) {
        // `| 0` keeps this in int32 rather than drifting into float territory.
        hash = ((hash << 5) + hash + char.codePointAt(0)!) | 0
    }
    return Math.abs(hash).toString(36).padStart(6, '0').slice(-6)
}

/**
 * Truncate to `MAX_NAME_BYTES`, appending a discriminator when it fires.
 *
 * The discriminator is not decoration. The ` (annotated)`, ` (highlights)` and
 * ` (text)` suffixes are appended by the caller BEFORE the name reaches here,
 * so a long `X` and the same name plus ` (annotated)` would truncate to the
 * identical string and the annotated PDF would overwrite the source. That is
 * strictly worse than the over-long name it set out to fix.
 *
 * Iterates code points, never `slice`, so a surrogate pair is never split in
 * half.
 */
function truncate(name: string): string {
    if (byteLength(name) <= MAX_NAME_BYTES) {
        return name
    }

    const budget = MAX_NAME_BYTES - DISCRIMINATOR_BYTES
    let stem = ''
    let used = 0
    for (const char of name) {
        const size = byteLength(char)
        if (used + size > budget) break
        stem += char
        used += size
    }

    const result = `${stem}-${discriminator(name)}`
    log(`Name too long for a file path, shortened to "${result}"`, 'warn')
    return result
}

/**
 * Make one path COMPONENT safe to write into a vault.
 *
 * Idempotent by construction, and that is a requirement rather than a nicety:
 * the migration reporter compares an old path against a new one and would
 * report a move that never happened if a clean name did not survive unchanged,
 * and the highlights note derives a wikilink target from the same stem the
 * writer derives a file name from, so the two must agree.
 *
 * Deliberately does NOT call Obsidian's `normalizePath`. That function carries
 * no doc comment and guarantees nothing about illegal characters, and it
 * applies Unicode NFC normalisation, which changes the BYTES of the path. Files
 * written by earlier versions on macOS may be recorded NFD; renormalising would
 * make `getAbstractFileByPath` miss them and rewrite every file on every sync.
 */
export function sanitiseName(name: string): string {
    let result = stripControlCharacters(name)
    result = result.replace(UNSAFE_CHARACTERS, '-')
    result = result.replace(LEADING_DOTS, '-')
    result = result.trim()
    result = truncate(result)
    result = result.replace(TRAILING_DOTS_AND_SPACES, '')

    if ('' === result || ONLY_HYPHENS.test(result)) {
        // `///` reduces to `-`, which is legal but useless, and two different
        // garbage names would collide there anyway.
        return FALLBACK_NAME
    }

    if (RESERVED_DEVICE_NAMES.has(result.toLowerCase())) {
        return `${result}-`
    }

    return result
}

/**
 * Make a multi-segment relative path safe, one component at a time.
 *
 * `folderPath` arrives pre-joined from the cloud service, so it has to be split
 * back apart: sanitising it as one name would turn a real hierarchy into a
 * single hyphenated folder.
 *
 * `.` and `..` segments are DROPPED rather than sanitised, so `../../etc`
 * becomes `etc` rather than `-/-/etc`. Sanitising them would leave a path that
 * looks deliberate; dropping them is what actually contains the traversal.
 * Empty segments go for the same reason, so `a//b` is `a/b`.
 */
export function sanitiseRelativePath(path: string): string {
    return path
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => '' !== segment && '.' !== segment && '..' !== segment)
        .map(sanitiseName)
        .join('/')
}

/**
 * Whether a user-supplied target folder is usable as written.
 *
 * Returns a message to show, or null when the value is fine. Used where the
 * value should be REFUSED rather than quietly rewritten: silently changing what
 * someone just typed into a settings field is worse than telling them why it
 * cannot be used.
 *
 * An empty string is valid and means the vault root, which is the documented
 * default.
 */
export function validateVaultFolderPath(value: string): string | null {
    if ('' === value) {
        return null
    }

    if (sanitiseRelativePath(value) !== value) {
        return 'Folder path cannot contain \\ / : * ? " < > | [ ] # ^, "..", or leading dots.'
    }

    return null
}
