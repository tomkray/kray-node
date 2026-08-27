/**
 * THE LIBRARY — how the network reads what humanity wrote.
 *
 * KRAY is an internet whose library came first. Every star can be baptized with
 * a name and tattooed with content, and both are already unique in the whole
 * universe forever (the Universal-Keyboard Law and content-uniqueness). What
 * this module adds is not a new power — it is the READING: a pure, total,
 * deterministic classification of every name and every byte, so that a domain
 * is a domain, a handle is a handle, and a look-alike is named as a look-alike.
 *
 * ── WHY THIS IS A READING AND NOT A NEW EVENT KIND ──────────────────────────
 *
 * A domain registry needs exactly one property: one owner per name, for all
 * time, decided by who was first. The baptism already IS that — the reducer
 * refuses a name taken in ANY universal-keyboard variation, and no owner can
 * rename. So `tom.kray` becomes a domain the moment somebody baptizes a star
 * with it, and it can never be taken from them.
 *
 * Adding a `domain` event kind would therefore buy nothing and cost everything:
 * a journal-format fork, a second registry to keep consistent with the first,
 * and a new surface to attack. Instead this module is a pure function of a
 * string. Anyone re-derives every classification from the journal alone, on any
 * machine, in any decade, with no node to ask — which is the only way a library
 * survives ten thousand years.
 *
 * ── THE THREE NAMESPACES ────────────────────────────────────────────────────
 *
 *   domain   tom.kray, 1.kray, sirius.btc      ASCII LDH, EXACTLY label.tld
 *   handle   @kray, @dog                        ASCII letter-digit-hyphen only
 *   name     Sirius, 日本語, ₭ Prime            all of Unicode, freely
 *
 * The two ADDRESSABLE namespaces are deliberately restricted to ASCII
 * letter-digit-hyphen — the same repertoire DNS chose, for the same reason. An
 * identifier is typed, spoken, copied and trusted by strangers; if `pаy.kray`
 * (Cyrillic а) could be registered, the namespace is only as strong as its
 * users' eyesight. Restricting the repertoire removes the entire confusable
 * class BY CONSTRUCTION rather than policing it with a lookup table that must
 * be revised as Unicode grows. Star names stay fully Unicode, because a name is
 * art and is never resolved as an address.
 *
 * A name that LOOKS like an identifier but breaks the grammar (`pаy.kray`,
 * `tom .kray`) is not forbidden — forbidding it would forbid `Mr. Smith` and
 * `3.14` too. It is simply NOT IN the addressable namespace, and it is returned
 * with `lookalike: true` so every surface can say so out loud. Resolution only
 * ever matches a true `domain` or `handle`, so the address space stays clean
 * while expression stays free.
 */

// ── SEPARATOR IDENTITY (the Universal-Keyboard Law, applied to separators) ────
// The Law says a name's identity is its universal-keyboard form: no variation of
// the same letter may coexist. A separator is a keyboard character too, and the
// dot has three siblings that NFKC does NOT fold — a Japanese keyboard's 。, the
// halfwidth ｡, and the presentation-form ﹫ for @. IDNA (UTS #46) maps exactly
// these to their ASCII forms, and so do we: `tom。kray` IS `tom.kray`, one
// identity, first writer owns it. Not a courtesy — the Law, completed.
const SEPARATOR_FOLD: Record<string, string> = {
  '。': '.', // 。 IDEOGRAPHIC FULL STOP
  '｡': '.', // ｡ HALFWIDTH IDEOGRAPHIC FULL STOP
  '․': '.', // ․ ONE DOT LEADER
  '﹒': '.', // ﹒ SMALL FULL STOP
  '﹫': '@', // ﹫ SMALL COMMERCIAL AT
}
const SEPARATOR_RE = new RegExp(`[${Object.keys(SEPARATOR_FOLD).join('')}]`, 'g')

/** Fold every keyboard variant of `.` and `@` to its ASCII form. Pure, total. */
export function foldSeparators(s: string): string {
  return s.replace(SEPARATOR_RE, (c) => SEPARATOR_FOLD[c])
}

// ── THE IDENTIFIER GRAMMAR ───────────────────────────────────────────────────
// One label: ASCII letter/digit/hyphen, 1..63 bytes, never starting or ending
// with a hyphen (the DNS rule — a leading hyphen breaks command lines and a
// trailing one breaks joins). A domain is EXACTLY two labels — `label.tld` — and
// the TLD must contain a letter, so `3.14` is never mistaken for an address.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const HAS_LETTER = /[a-z]/
// Whitespace, in every form a keyboard can produce it. Stripped only to ASK
// whether a name is IMITATING an identifier — never to decide its identity.
const ANY_SPACE = /[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+/g

/** The longest legal name. Generous for art, far under any storage concern. */
export const MAX_NAME_BYTES = 253

export type NameKind = 'domain' | 'handle' | 'name'

export interface NameReading {
  /** which namespace this name lives in */
  kind: NameKind
  /** the universal-keyboard identity — what uniqueness is decided on */
  canonical: string
  /** domain only: the labels left of the TLD, e.g. `tom` in `tom.kray` */
  label?: string
  /** domain only: the rightmost label, e.g. `kray` — the namespace it joins */
  tld?: string
  /** handle only: the name without its `@` */
  handle?: string
  /** true when the name imitates an identifier but is NOT in that namespace */
  lookalike: boolean
  /** present when `lookalike` — exactly which rule it failed, for the UI to say */
  lookalikeReason?: 'non-ascii' | 'bad-label' | 'bad-tld' | 'empty-label' | 'too-long' | 'whitespace' | 'too-many-labels'
  /** WHAT it imitates, when that can be named exactly: `tom .kray` resembles
   *  `tom.kray`. Naming the target is what lets a reader see the trick instead of
   *  being told, vaguely, that something is off. */
  resembles?: string
}

/**
 * READ A NAME. Total: every string gets a reading, none throws.
 * `canonical` must already be the canonical form (see starmap.canonicalName);
 * pass a raw name and it is canonicalised here the same way.
 */
export function readName(name: string): NameReading {
  // A baptism is a PLAIN name — one spelled-out word (see isValidName in star-lore). There are no
  // domains or handles to distinguish and nothing to imitate: a name is a name, unique forever.
  const c = foldSeparators(name).normalize('NFKC').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
  return { kind: 'name', canonical: c, lookalike: false }
}

/**
 * THE SKELETON — strip the decorations an impersonator hides behind, and see what
 * is left. `tom .kray`, `tom.kray.`, `.tom.kray`, `tom..kray` and `-tom.kray` all
 * skeletonise to `tom.kray`.
 *
 * This is NOT identity: those names are genuinely different names, and the
 * skeleton never decides who owns what. It answers one question — WHAT IS THIS
 * IMITATING — so the answer can be shown to a reader and, when the imitated name
 * already has an owner, refused outright.
 *
 * Deliberately absent: confusable letters. Which ASCII letter does Cyrillic а
 * "really" mean? Answering that needs the very lookup table this design avoids,
 * so a non-ASCII name is reported as non-ASCII and NO target is invented for it.
 * Saying less is better than guessing.
 */
function skeletonOf(c: string): string {
  const at = c.startsWith('@')
  let body = (at ? c.replace(/^@+/, '') : c)
    .replace(ANY_SPACE, '')      // `tom .kray`
    .replace(/\.{2,}/g, '.')     // `tom..kray`
    .replace(/^\.+|\.+$/g, '')   // `.tom.kray.`
  body = body.split('.').map((l) => l.replace(/^-+|-+$/g, '')).join('.') // `-tom.kray`
  return at ? '@' + body : body
}

/** The grammar itself. `probe` = also ask what this name imitates. */
function read(c: string, probe: boolean): NameReading {
  const isHandleShape = c.startsWith('@')
  const hasDot = c.includes('.')
  if (!isHandleShape && !hasDot) return { kind: 'name', canonical: c, lookalike: false }

  const fail = (reason: NonNullable<NameReading['lookalikeReason']>): NameReading => {
    // name the target whenever the skeleton IS a real identifier. `non-ascii`
    // never yields one, because its skeleton is still non-ASCII.
    let resembles: string | undefined
    if (probe) {
      const sk = skeletonOf(c)
      if (sk !== c) { const inner = read(sk, false); if (inner.kind !== 'name') resembles = inner.canonical }
    }
    return { kind: 'name', canonical: c, lookalike: true, lookalikeReason: reason, ...(resembles ? { resembles } : {}) }
  }

  // ── WHITESPACE INSIDE AN IDENTIFIER SHAPE ─────────────────────────────────
  // `tom .kray` is not a domain, and it is not innocent prose either: strip the
  // space and it IS `tom.kray`. Silence here is the whole margin an attacker
  // needs, so the name is marked as a look-alike AND told what it imitates.
  // `Mr. Smith` gets the same treatment for the same honest reason — it does
  // resemble `mr.smith` — and nothing is forbidden by saying so.
  if (/\s/.test(c)) {
    if (!probe) return { kind: 'name', canonical: c, lookalike: false }
    const r = fail('whitespace')
    // prose that imitates nothing is just prose — `John Smith` is not a look-alike
    return r.resembles ? r : { kind: 'name', canonical: c, lookalike: false }
  }

  if (c.length > MAX_NAME_BYTES) return fail('too-long')

  if (isHandleShape) {
    const h = c.slice(1)
    if (!h) return fail('empty-label')
    if (!/^[\x20-\x7e]*$/.test(h)) return fail('non-ascii')
    if (!LABEL.test(h)) return fail('bad-label')
    return { kind: 'handle', canonical: c, handle: h, lookalike: false }
  }

  if (!/^[\x20-\x7e]*$/.test(c)) return fail('non-ascii')
  const parts = c.split('.')
  if (parts.some((p) => p.length === 0)) return fail('empty-label')
  if (!parts.every((p) => LABEL.test(p))) return fail('bad-label')
  // ── EXACTLY TWO LABELS — THE NAMESPACE IS FLAT ────────────────────────────
  // `evil.tom.kray` reads as if it belonged to whoever owns `tom.kray`. In DNS
  // that impression is enforced: nobody registers `a.b.com` without owning
  // `b.com`. A flat registry cannot enforce it, so allowing three labels would
  // hand every domain owner a permanent impersonation problem they can neither
  // see nor stop.
  //
  // The fix is not a hierarchy rule — that would add ownership checks, ordering
  // subtleties and a new class of dispute to consensus forever. It is to remove
  // the shape: a domain is EXACTLY `label.tld`, as every flat Bitcoin name
  // system settled on. Subdomains cannot be spoofed because they do not exist.
  // `evil.tom.kray` is then a plain name that resembles nothing registrable, and
  // is marked as the imitation it is.
  if (parts.length !== 2) {
    // the skeleton is unchanged here, so name the registrable tail it shadows:
    // `evil.tom.kray` shadows `tom.kray`, the domain a reader will think owns it
    const tail = parts.slice(-2).join('.')
    const t = read(tail, false)
    return { kind: 'name', canonical: c, lookalike: true, lookalikeReason: 'too-many-labels', ...(t.kind === 'domain' ? { resembles: t.canonical } : {}) }
  }
  const tld = parts[1]
  if (!HAS_LETTER.test(tld)) return fail('bad-tld')
  return { kind: 'domain', canonical: c, label: parts[0], tld, lookalike: false }
}

/** The namespace a name joins — `kray` for `tom.kray`, null for other kinds. */
export function tldOf(name: string): string | null {
  const r = readName(name)
  return r.kind === 'domain' ? r.tld! : null
}

// ── CONTENT CATEGORIES ───────────────────────────────────────────────────────
// A shelf in the library. Derived from the content type the author SIGNED, so
// the shelf is part of the sealed act and cannot be re-shelved later by anyone,
// operator included. Unknown types shelve as `file` — never dropped, never
// guessed: an unrecognised work is still a work (axiom A6).
export type Category =
  | 'image' | 'vector' | 'video' | 'audio' | 'code' | 'markup'
  | 'document' | 'data' | 'text' | 'model' | 'font' | 'archive' | 'file'

export interface CategorySpec {
  id: Category
  /** shown on chips and shelves */
  label: string
  /** one glyph — the shelf's mark, stable forever */
  glyph: string
}

/** The shelves, in reading order. Stable ids: a UI may key off them safely. */
export const CATEGORIES: readonly CategorySpec[] = [
  { id: 'image', label: 'Image', glyph: '▣' },
  { id: 'vector', label: 'Vector', glyph: '◈' },
  { id: 'video', label: 'Video', glyph: '▶' },
  { id: 'audio', label: 'Audio', glyph: '♪' },
  { id: 'code', label: 'Code', glyph: '⌘' },
  { id: 'markup', label: 'Markup', glyph: '❰' },
  { id: 'document', label: 'Document', glyph: '▤' },
  { id: 'data', label: 'Data', glyph: '⛁' },
  { id: 'text', label: 'Text', glyph: '¶' },
  { id: 'model', label: '3D', glyph: '◉' },
  { id: 'font', label: 'Font', glyph: 'A' },
  { id: 'archive', label: 'Archive', glyph: '▦' },
  { id: 'file', label: 'File', glyph: '◇' },
] as const

const CODE_TYPES = new Set([
  'application/javascript', 'text/javascript', 'application/typescript', 'text/typescript',
  'application/x-python-code', 'text/x-python', 'text/x-c', 'text/x-c++', 'text/x-rust',
  'text/x-go', 'text/x-java', 'text/x-sh', 'application/x-sh', 'text/x-lua',
  'application/wasm', 'text/x-solidity', 'application/x-ruby', 'text/x-sql',
])
const DATA_TYPES = new Set([
  'application/json', 'application/ld+json', 'text/csv', 'application/x-ndjson',
  'application/cbor', 'application/toml', 'text/yaml', 'application/yaml', 'text/tab-separated-values',
])
const MARKUP_TYPES = new Set(['text/html', 'text/css', 'application/xml', 'text/xml', 'image/svg+xml'])
const DOC_TYPES = new Set(['application/pdf', 'application/epub+zip', 'application/rtf', 'application/msword'])
const ARCHIVE_TYPES = new Set(['application/zip', 'application/gzip', 'application/x-tar', 'application/x-7z-compressed'])
const MODEL_TYPES = new Set(['model/gltf+json', 'model/gltf-binary', 'model/obj', 'model/stl', 'application/sla'])

/**
 * SHELVE A WORK. Pure and total — every content type gets exactly one shelf.
 * SVG is its own shelf (`vector`) rather than `image`: it is executable markup
 * that merely looks like a picture, and the difference decides how it is
 * rendered. Calling it "an image" is precisely the mistake that gets a gallery
 * exploited.
 */
export function categoryOf(contentType: string | null | undefined): Category {
  const t = (contentType ?? '').trim().toLowerCase().split(';')[0]
  if (!t) return 'file'
  if (t === 'image/svg+xml') return 'vector'
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('font/') || t === 'application/font-woff' || t === 'application/vnd.ms-fontobject') return 'font'
  if (t.startsWith('model/') || MODEL_TYPES.has(t)) return 'model'
  if (CODE_TYPES.has(t)) return 'code'
  if (DATA_TYPES.has(t)) return 'data'
  if (MARKUP_TYPES.has(t)) return 'markup'
  if (DOC_TYPES.has(t)) return 'document'
  if (ARCHIVE_TYPES.has(t)) return 'archive'
  if (t === 'text/markdown' || t === 'text/plain' || t.startsWith('text/')) return 'text'
  return 'file'
}

/** The shelf's spec, for chips and legends. Always resolves. */
export function categorySpec(id: Category): CategorySpec {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]
}

/**
 * Does a text work's body READ as an identifier? A text inscription whose bytes
 * are exactly `tom.kray` is a MENTION of that domain, never a registration —
 * the registry is the baptism, and nothing else. Surfaces use this to link a
 * mention to its true holder, and must always label it as a mention.
 */
export function mentionsIdentifier(body: string): NameReading | null {
  const t = body.trim()
  if (!t || t.length > MAX_NAME_BYTES || /\s/.test(t)) return null
  const r = readName(t)
  return r.kind === 'name' ? null : r
}
