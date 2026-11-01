import path from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'], quiet: true })

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    // Same location as src/lib/config.ts; the app applies migrations itself on startup.
    url: path.resolve(process.env.BOOKSERVE_DATA_DIR || 'data', 'bookserve.db'),
  },
})
