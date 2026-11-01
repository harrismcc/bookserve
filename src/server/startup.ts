import { definePlugin } from 'nitro'

// Importing auth initializes everything at boot instead of on the first request:
// data/library dirs, the SQLite DB and its migrations (src/db), and the auth secret.
import '#/lib/auth'
import { scanLibrary } from '#/lib/scanner'

export default definePlugin(() => {
  // In the background: the server starts serving while the library is scanned.
  void scanLibrary()
})
