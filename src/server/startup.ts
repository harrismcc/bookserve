import { definePlugin } from 'nitro'

// Importing auth initializes everything at boot instead of on the first request:
// data/library dirs, the SQLite DB and its migrations (src/db), and the auth secret.
import '#/lib/auth'

export default definePlugin(() => {})
