import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { bookFiles, books } from '#/db/schema'
import { sortKey } from '#/lib/books'
import { config } from '#/lib/config'
import { readEpub } from '#/lib/epub'
import type { EpubCover } from '#/lib/epub'

export type ScanResult = {
  added: number
  updated: number
  moved: number
  missing: number
  failed: number
  error?: string
}

type DiskFile = { rel: string; abs: string; size: number; mtimeMs: number }
type FileOutcome = 'unchanged' | 'added' | 'updated' | 'moved' | 'failed'

// Scans and imports run one at a time. The state lives on globalThis because the
// Nitro startup plugin and the SSR bundle each get their own copy of this module.
const state = ((
  globalThis as typeof globalThis & {
    bookserveScanner?: {
      tail: Promise<unknown>
      scan: Promise<ScanResult> | null
    }
  }
).bookserveScanner ??= { tail: Promise.resolve(), scan: null })

function serialize<T>(task: () => Promise<T>) {
  const run = state.tail.then(task)
  state.tail = run.catch(() => {})
  return run
}

// Full library scan. A call while a scan is running joins that scan.
export function scanLibrary() {
  state.scan ??= serialize(fullScan).finally(() => {
    state.scan = null
  })
  return state.scan
}

async function fullScan(): Promise<ScanResult> {
  const result: ScanResult = {
    added: 0,
    updated: 0,
    moved: 0,
    missing: 0,
    failed: 0,
  }
  const started = Date.now()
  const root = config.libraryDir

  // If the library itself is gone (e.g. an unmounted NAS share), touch nothing.
  try {
    await fsp.readdir(root)
  } catch (err) {
    result.error = `Library directory is not readable: ${root}`
    console.error(`[scan] ${result.error}`, err)
    return result
  }

  const { files, complete } = await walk(root)
  const onDisk = new Set(files.map((f) => f.rel))
  const seenBookIds = new Set<string>()

  for (const file of files) {
    try {
      const outcome = await importDiskFile(file, (rel) => onDisk.has(rel))
      if (outcome.bookId) seenBookIds.add(outcome.bookId)
      if (outcome.result !== 'unchanged') result[outcome.result]++
    } catch (err) {
      result.failed++
      console.error(`[scan] Failed to import ${file.rel}:`, err)
    }
    // Let requests through between files.
    await new Promise((resolve) => setImmediate(resolve))
  }

  // Books whose files all vanished are flagged, never deleted. Skip this if part
  // of the tree could not be read, so an I/O error doesn't hide books.
  if (complete) {
    const rows = db
      .select({ id: books.id, missing: books.missing })
      .from(books)
      .all()
    db.transaction((tx) => {
      for (const row of rows) {
        const missing = !seenBookIds.has(row.id)
        if (missing === row.missing) continue
        tx.update(books).set({ missing }).where(eq(books.id, row.id)).run()
        if (missing) result.missing++
      }
    })
  }

  console.log(
    `[scan] Done in ${Date.now() - started}ms: ${files.length} files, ` +
      `${result.added} added, ${result.updated} updated, ${result.moved} moved, ` +
      `${result.missing} newly missing, ${result.failed} failed`,
  )
  return result
}

// Recursively lists .epub files. Hidden entries (e.g. macOS ._ files) are skipped.
async function walk(root: string) {
  const files: DiskFile[] = []
  let complete = true
  const visit = async (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (err) {
      complete = false
      console.error(`[scan] Cannot read ${dir}:`, err)
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(abs)
      } else if (entry.isFile() && /\.epub$/i.test(entry.name)) {
        try {
          const stat = await fsp.stat(abs)
          files.push({
            rel: path.relative(root, abs).split(path.sep).join('/'),
            abs,
            size: stat.size,
            mtimeMs: Math.trunc(stat.mtimeMs),
          })
        } catch (err) {
          complete = false
          console.error(`[scan] Cannot stat ${abs}:`, err)
        }
      }
    }
  }
  await visit(root)
  return { files, complete }
}

// Reconciles one file on disk with the DB. `onDisk` tells whether a stored path
// still exists, to recognize a known file (by hash) that was moved here.
async function importDiskFile(
  file: DiskFile,
  onDisk: (rel: string) => boolean,
): Promise<{ result: FileOutcome; bookId?: string }> {
  const existing = db
    .select()
    .from(bookFiles)
    .where(eq(bookFiles.path, file.rel))
    .get()
  if (
    existing &&
    existing.size === file.size &&
    existing.mtimeMs === file.mtimeMs
  ) {
    return { result: 'unchanged', bookId: existing.bookId }
  }

  const data = await fsp.readFile(file.abs)
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  const stats = { size: file.size, mtimeMs: file.mtimeMs, hash }

  if (!existing) {
    const moved = db
      .select()
      .from(bookFiles)
      .where(eq(bookFiles.hash, hash))
      .all()
      .find((row) => !onDisk(row.path))
    if (moved) {
      db.transaction((tx) => {
        tx.update(bookFiles)
          .set({ path: file.rel, ...stats })
          .where(eq(bookFiles.id, moved.id))
          .run()
        tx.update(books)
          .set({ missing: false })
          .where(eq(books.id, moved.bookId))
          .run()
      })
      console.log(`[scan] Moved ${moved.path} -> ${file.rel}`)
      return { result: 'moved', bookId: moved.bookId }
    }
  }

  let parsed: ReturnType<typeof readEpub>
  try {
    parsed = readEpub(data)
  } catch (err) {
    console.warn(
      `[scan] Skipping unreadable EPUB ${file.rel}: ${err instanceof Error ? err.message : err}`,
    )
    return { result: 'failed', bookId: existing?.bookId }
  }
  const { metadata, cover } = parsed
  const title =
    metadata.title || path.basename(file.rel, path.extname(file.rel))
  const bookId = existing?.bookId ?? crypto.randomUUID()
  const coverPath = await writeCover(bookId, cover)
  const fields = {
    ...metadata,
    title,
    sortTitle: sortKey(title),
    coverPath,
    missing: false,
  }

  db.transaction((tx) => {
    if (existing) {
      tx.update(books).set(fields).where(eq(books.id, bookId)).run()
      tx.update(bookFiles).set(stats).where(eq(bookFiles.id, existing.id)).run()
    } else {
      tx.insert(books)
        .values({ id: bookId, ...fields })
        .run()
      tx.insert(bookFiles)
        .values({ bookId, path: file.rel, format: 'epub', ...stats })
        .run()
    }
  })
  console.log(`[scan] ${existing ? 'Updated' : 'Added'} ${file.rel}`)
  return { result: existing ? 'updated' : 'added', bookId }
}

// Writes the cover to <data>/covers/<bookId>.<ext>, replacing any previous one.
// Returns its path relative to the data dir.
async function writeCover(bookId: string, cover: EpubCover | null) {
  const dir = path.join(config.dataDir, 'covers')
  await fsp.mkdir(dir, { recursive: true })
  for (const name of await fsp.readdir(dir)) {
    if (name.startsWith(`${bookId}.`)) await fsp.rm(path.join(dir, name))
  }
  if (!cover) return null
  await fsp.writeFile(path.join(dir, `${bookId}.${cover.ext}`), cover.data)
  return `covers/${bookId}.${cover.ext}`
}

export class UploadError extends Error {}

// Streams an uploaded EPUB to a temp file in the data dir, reads its metadata,
// then places it at <library>/<Author>/<Title>/<name> (never overwriting) and
// imports it. This is the only place the app writes into the library.
export async function uploadBook(
  fileName: string,
  body: WebReadableStream<Uint8Array>,
) {
  const tmpDir = path.join(config.dataDir, 'tmp')
  await fsp.mkdir(tmpDir, { recursive: true })
  const tmp = path.join(tmpDir, `${crypto.randomUUID()}.epub`)
  try {
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(tmp))

    let metadata
    try {
      metadata = readEpub(await fsp.readFile(tmp)).metadata
    } catch {
      throw new UploadError(`${fileName} is not a valid EPUB`)
    }

    const base = path.basename(fileName, path.extname(fileName))
    const dir = path.join(
      config.libraryDir,
      safeSegment(metadata.authors[0] ?? '', 'Unknown Author'),
      safeSegment(metadata.title, safeSegment(base, 'Untitled')),
    )
    await fsp.mkdir(dir, { recursive: true })
    const dest = await placeFile(tmp, dir, safeSegment(base, 'book'))

    const stat = await fsp.stat(dest)
    const file: DiskFile = {
      rel: path.relative(config.libraryDir, dest).split(path.sep).join('/'),
      abs: dest,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
    }
    const outcome = await serialize(() =>
      importDiskFile(file, (rel) =>
        fs.existsSync(path.join(config.libraryDir, rel)),
      ),
    )
    if (!outcome.bookId) throw new UploadError(`${fileName} could not be read`)
    return { bookId: outcome.bookId, path: file.rel }
  } finally {
    await fsp.rm(tmp, { force: true })
  }
}

// Copies src into dir as <name>.epub, or "<name> (n).epub" if taken. Hard-links when
// possible (atomic, fails if the name exists); data and library are usually
// different volumes, so fall back to an exclusive copy.
async function placeFile(src: string, dir: string, name: string) {
  for (let n = 0; ; n++) {
    const dest = path.join(dir, n ? `${name} (${n}).epub` : `${name}.epub`)
    try {
      await fsp.link(src, dest)
      return dest
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
    }
    try {
      await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL)
      return dest
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      await fsp.rm(dest, { force: true })
      throw err
    }
  }
}

// One path segment from untrusted text: no separators, reserved or control
// characters, leading dots, or trailing dots/spaces (Windows/SMB shares).
function safeSegment(value: string, fallback: string) {
  const cleaned = value
    // oxlint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100)
    .trim()
  return cleaned || fallback
}
