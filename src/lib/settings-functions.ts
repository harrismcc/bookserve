import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { publicOrigin } from '#/lib/opds-feed'
import { getSetting, setSetting } from '#/lib/settings'
import { requireAdmin } from '#/lib/user-functions'

export const getOpdsSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return {
      enabled: getSetting('opdsEnabled'),
      url: `${publicOrigin(getRequest())}/opds`,
    }
  },
)

export const setOpdsEnabled = createServerFn({ method: 'POST' })
  .validator((enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid value')
    return enabled
  })
  .handler(async ({ data }) => {
    await requireAdmin()
    setSetting('opdsEnabled', data)
  })
