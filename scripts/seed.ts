// Seeds a local dev install: a few accounts and a library of generated EPUBs.
// Run with `pnpm db:seed`. Safe to rerun: existing users and files are left alone.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'

import { db } from '#/db'
import { marketSources, user } from '#/db/schema'
import { auth, syntheticEmail } from '#/lib/auth'
import { config } from '#/lib/config'
import { scanLibrary } from '#/lib/scanner'

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed with NODE_ENV=production')
}

const PASSWORD = 'password'
const USERS = [
  { username: 'admin', role: 'admin' },
  { username: 'reader', role: 'user' },
] as const

type SeedBook = {
  title: string
  authors: string[]
  description?: string
  publisher?: string
  date?: string
  isbn?: string
  series?: [name: string, index: number]
  // RGB cover color; no cover when omitted.
  cover?: [number, number, number]
}

// Public-domain titles, so metadata matching finds real results.
const BOOKS: SeedBook[] = [
  {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    description:
      '<p>It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>',
    publisher: 'T. Egerton',
    date: '1813-01-28',
    isbn: '9780141439518',
    cover: [176, 74, 90],
  },
  {
    title: 'Emma',
    authors: ['Jane Austen'],
    date: '1815-12-23',
    cover: [88, 132, 176],
  },
  {
    title: 'A Study in Scarlet',
    authors: ['Arthur Conan Doyle'],
    description: 'The first appearance of Sherlock Holmes and Dr. Watson.',
    date: '1887',
    series: ['Sherlock Holmes', 1],
    cover: [150, 30, 40],
  },
  {
    title: 'The Sign of the Four',
    authors: ['Arthur Conan Doyle'],
    date: '1890',
    series: ['Sherlock Holmes', 2],
    cover: [60, 60, 70],
  },
  {
    title: 'The Hound of the Baskervilles',
    authors: ['Arthur Conan Doyle'],
    date: '1902',
    series: ['Sherlock Holmes', 5],
    cover: [40, 90, 60],
  },
  {
    title: 'Frankenstein',
    authors: ['Mary Shelley'],
    description:
      'Victor Frankenstein creates a living being and is undone by it.',
    publisher: 'Lackington, Hughes, Harding, Mavor & Jones',
    date: '1818-01-01',
    cover: [30, 50, 40],
  },
  {
    title: 'Moby-Dick',
    authors: ['Herman Melville'],
    description: 'Call me Ishmael.',
    date: '1851-10-18',
    isbn: '9780142437247',
    cover: [20, 70, 120],
  },
  {
    title: 'The Adventures of Tom Sawyer',
    authors: ['Mark Twain'],
    date: '1876',
    cover: [200, 150, 60],
  },
  {
    title: 'The Communist Manifesto',
    authors: ['Karl Marx', 'Friedrich Engels'],
    date: '1848-02-21',
    cover: [190, 30, 30],
  },
  {
    title: 'The Time Machine',
    authors: ['H. G. Wells'],
    date: '1895',
  },
  { title: 'Meditations', authors: ['Marcus Aurelius'] },
]

async function seedUsers() {
  for (const { username, role } of USERS) {
    const exists = db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username))
      .get()
    if (exists) {
      console.log(`[seed] User ${username} exists, skipping`)
      continue
    }
    await auth.api.createUser({
      body: {
        email: syntheticEmail(username),
        password: PASSWORD,
        name: username,
        role,
        data: { username },
      },
    })
    console.log(`[seed] Created ${role} ${username} / ${PASSWORD}`)
  }
}

function seedLibrary() {
  for (const book of BOOKS) {
    const file = path.join(
      config.libraryDir,
      book.authors[0],
      book.title,
      `${book.title}.epub`,
    )
    if (fs.existsSync(file)) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, epub(book))
    console.log(`[seed] Wrote ${path.relative(config.libraryDir, file)}`)
  }
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function epub(book: SeedBook) {
  const meta = [
    `<dc:identifier id="uid">urn:uuid:${crypto.randomUUID()}</dc:identifier>`,
    `<dc:title>${xml(book.title)}</dc:title>`,
    ...book.authors.map((a) => `<dc:creator>${xml(a)}</dc:creator>`),
    '<dc:language>en</dc:language>',
    book.description &&
      `<dc:description>${xml(book.description)}</dc:description>`,
    book.publisher && `<dc:publisher>${xml(book.publisher)}</dc:publisher>`,
    book.date && `<dc:date>${book.date}</dc:date>`,
    book.isbn && `<dc:identifier>urn:isbn:${book.isbn}</dc:identifier>`,
    book.series &&
      `<meta name="calibre:series" content="${xml(book.series[0])}"/>` +
        `<meta name="calibre:series_index" content="${book.series[1]}"/>`,
    `<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>`,
  ].filter(Boolean)
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${meta.join('\n    ')}
  </metadata>
  <manifest>
    <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${book.cover ? '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>' : ''}
  </manifest>
  <spine><itemref idref="text"/></spine>
</package>`
  const page = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${xml(book.title)}</title></head><body>${body}</body></html>`

  return zipSync({
    // Must be the first entry, uncompressed.
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(
      page(
        '<nav epub:type="toc"><ol><li><a href="text.xhtml">Start</a></li></ol></nav>',
      ),
    ),
    'OEBPS/text.xhtml': strToU8(
      page(
        `<h1>${xml(book.title)}</h1><p>Seed data for local development.</p>`,
      ),
    ),
    ...(book.cover ? { 'OEBPS/cover.png': png(400, 600, book.cover) } : {}),
  })
}

// A solid-color RGB PNG.
function png(width: number, height: number, [r, g, b]: number[]) {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length)
    body.copy(out, 4)
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

// A Z-Library Market source, when ZLIBRARY_EMAIL and ZLIBRARY_PASSWORD are set.
function seedMarket() {
  const email = process.env.ZLIBRARY_EMAIL
  const password = process.env.ZLIBRARY_PASSWORD
  if (!email || !password) return
  const exists = db
    .select({ id: marketSources.id })
    .from(marketSources)
    .where(eq(marketSources.integration, 'z-library'))
    .get()
  if (exists) {
    console.log('[seed] Z-Library source exists, skipping')
    return
  }
  db.insert(marketSources)
    .values({
      integration: 'z-library',
      name: 'Z-Library',
      settings: {
        url: process.env.ZLIBRARY_URL || 'https://z-lib.gd',
        email,
        password,
      },
    })
    .run()
  console.log('[seed] Added Z-Library Market source')
}

await seedUsers()
seedMarket()
seedLibrary()
await scanLibrary()
