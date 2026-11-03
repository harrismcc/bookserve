import path from 'node:path'

const dataDir = path.resolve(process.env.BOOKSERVE_DATA_DIR || 'data')

export const config = {
  dataDir,
  libraryDir: path.resolve(
    process.env.BOOKSERVE_LIBRARY_DIR || path.join(dataDir, 'library'),
  ),
  databasePath: path.join(dataDir, 'bookserve.db'),
  secretPath: path.join(dataDir, 'secret'),
  // Committed migrations; the server runs from the repo root (or /app in the image).
  migrationsDir: path.resolve('drizzle'),
  publicUrl: process.env.BOOKSERVE_URL || undefined,
  googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY || undefined,
  hardcoverToken:
    process.env.HARDCOVER_TOKEN?.replace(/^Bearer\s+/i, '') || undefined,
}
