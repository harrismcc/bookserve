import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Search } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { getBook } from '#/lib/book-functions'
import {
  applyMatch,
  getMatchDetails,
  searchMetadata,
} from '#/lib/match-functions'
import { PROVIDERS, providerName } from '#/lib/metadata/providers'
import type {
  Candidate,
  MatchFields,
  ProviderId,
} from '#/lib/metadata/providers'
import { cn, languageName } from '#/lib/utils'

type Book = NonNullable<Awaited<ReturnType<typeof getBook>>>

type ProviderResult =
  | { status: 'pending' }
  | { status: 'error'; error: string }
  | { status: 'done'; candidates: Candidate[] }

const message = (err: unknown) =>
  err instanceof Error ? err.message : 'Request failed'

export function MatchDialog({
  book,
  open,
  onOpenChange,
}: {
  book: Book
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match</DialogTitle>
        </DialogHeader>
        {/* Mounted per open, so each open starts from the current metadata. */}
        <MatchFlow book={book} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function MatchFlow({ book, onDone }: { book: Book; onDone: () => void }) {
  const [query, setQuery] = useState({
    title: book.title,
    author: book.authors[0] ?? '',
    isbn: book.isbn ?? '',
  })
  const [provider, setProvider] = useState<'all' | ProviderId>('all')
  const [results, setResults] = useState<
    Partial<Record<ProviderId, ProviderResult>>
  >({})
  const [picked, setPicked] = useState<Candidate | null>(null)
  const searchId = useRef(0)

  // Each provider is its own request, so results show as each one answers.
  function search(event: React.FormEvent) {
    event.preventDefault()
    const id = ++searchId.current
    const ids = PROVIDERS.map((p) => p.id).filter(
      (p) => provider === 'all' || p === provider,
    )
    setResults(Object.fromEntries(ids.map((p) => [p, { status: 'pending' }])))
    for (const p of ids) {
      searchMetadata({ data: { provider: p, query } }).then(
        (candidates) => update(p, { status: 'done', candidates }),
        (err) => update(p, { status: 'error', error: message(err) }),
      )
    }
    function update(p: ProviderId, result: ProviderResult) {
      if (searchId.current !== id) return
      setResults((prev) => ({ ...prev, [p]: result }))
    }
  }

  if (picked) {
    return (
      <Compare
        book={book}
        candidate={picked}
        onBack={() => setPicked(null)}
        onDone={onDone}
      />
    )
  }

  const entries = Object.entries(results) as Array<[ProviderId, ProviderResult]>
  const candidates = entries.flatMap(([, r]) =>
    r.status === 'done' ? r.candidates : [],
  )
  const pending = entries.some(([, r]) => r.status === 'pending')

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
      <form onSubmit={search} className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="match-title">Title</Label>
          <Input
            id="match-title"
            value={query.title}
            onChange={(e) => setQuery({ ...query, title: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="match-author">Author</Label>
          <Input
            id="match-author"
            value={query.author}
            onChange={(e) => setQuery({ ...query, author: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="match-isbn">ISBN</Label>
          <Input
            id="match-isbn"
            value={query.isbn}
            onChange={(e) => setQuery({ ...query, isbn: e.target.value })}
          />
        </div>
        <div className="flex items-end gap-3 sm:col-span-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="match-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as typeof provider)}
            >
              <SelectTrigger id="match-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Search />}
            Search
          </Button>
        </div>
      </form>

      {entries.length > 0 && (
        <div className="-mx-6 min-h-0 overflow-y-auto border-t px-6 pt-3">
          {entries.map(([p, r]) =>
            r.status === 'error' ? (
              <p key={p} className="py-1 text-sm text-destructive">
                {providerName(p)}: {r.error}
              </p>
            ) : r.status === 'pending' ? (
              <p
                key={p}
                className="flex items-center gap-2 py-1 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                {providerName(p)}
              </p>
            ) : null,
          )}
          {!pending && candidates.length === 0 && (
            <p className="py-1 text-sm text-muted-foreground">No results</p>
          )}
          <ul className="grid gap-1 py-1" aria-label="Results">
            {candidates.map((c) => (
              <li key={`${c.provider}:${c.id}`}>
                <button
                  type="button"
                  onClick={() => setPicked(c)}
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <Thumb url={c.thumbnailUrl} className="w-10" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-medium">{c.title}</span>
                    <span className="line-clamp-1 text-sm text-muted-foreground">
                      {c.authors.join(', ')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[c.publishedDate?.slice(0, 4), providerName(c.provider)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Thumb({ url, className }: { url: string | null; className?: string }) {
  const base = cn('aspect-[2/3] shrink-0 rounded-sm bg-muted', className)
  return url ? (
    <img src={url} alt="" loading="lazy" className={cn(base, 'object-cover')} />
  ) : (
    <div className={base} />
  )
}

type FieldKey = keyof Omit<MatchFields, 'seriesIndex'> | 'cover'

// Fields in compare order. `show` turns a value into the text that is shown
// and compared (so "en" and "eng" both read "English" and count as equal).
const TEXT_FIELDS: Array<{
  key: Exclude<FieldKey, 'cover'>
  label: string
  show: (v: MatchFields) => string
}> = [
  { key: 'title', label: 'Title', show: (v) => v.title },
  { key: 'authors', label: 'Authors', show: (v) => v.authors.join(', ') },
  {
    key: 'description',
    label: 'Description',
    show: (v) => v.description ?? '',
  },
  { key: 'publisher', label: 'Publisher', show: (v) => v.publisher ?? '' },
  {
    key: 'publishedDate',
    label: 'Published',
    show: (v) => v.publishedDate ?? '',
  },
  { key: 'isbn', label: 'ISBN', show: (v) => v.isbn ?? '' },
  {
    key: 'language',
    label: 'Language',
    show: (v) => (v.language ? languageName(v.language) : ''),
  },
  {
    key: 'series',
    label: 'Series',
    show: (v) =>
      v.series
        ? `${v.series}${v.seriesIndex != null ? ` #${v.seriesIndex}` : ''}`
        : '',
  },
  {
    key: 'pageCount',
    label: 'Pages',
    show: (v) => (v.pageCount ? String(v.pageCount) : ''),
  },
]

function Compare({
  book,
  candidate: initial,
  onBack,
  onDone,
}: {
  book: Book
  candidate: Candidate
  onBack: () => void
  onDone: () => void
}) {
  const router = useRouter()
  const [candidate, setCandidate] = useState(initial)
  const [loading, setLoading] = useState(Boolean(initial.partial))
  const [checked, setChecked] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!initial.partial) return
    let active = true
    getMatchDetails({ data: { provider: initial.provider, id: initial.id } })
      .then(
        (details) => active && setCandidate((c) => ({ ...c, ...details })),
        (err) => active && setError(message(err)),
      )
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [initial])

  const rows = [
    {
      key: 'cover' as const,
      label: 'Cover',
      current: book.coverUrl ?? '',
      next: candidate.coverUrl ?? '',
    },
    ...TEXT_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      current: f.show(book),
      next: f.show(candidate),
    })),
  ].map((row) => {
    const waiting = loading && row.key === 'description'
    const available = !waiting && row.next !== ''
    return {
      ...row,
      waiting,
      available,
      // Default: apply what is new and different.
      on: available && (checked[row.key] ?? row.next !== row.current),
    }
  })

  async function apply() {
    const on = new Set(rows.filter((r) => r.on).map((r) => r.key))
    const fields: Partial<MatchFields> = {}
    for (const { key } of TEXT_FIELDS) {
      if (on.has(key)) Object.assign(fields, { [key]: candidate[key] })
    }
    if (on.has('series')) fields.seriesIndex = candidate.seriesIndex
    setPending(true)
    setError('')
    try {
      await applyMatch({
        data: {
          bookId: book.id,
          provider: candidate.provider,
          providerId: candidate.id,
          fields,
          coverUrl: on.has('cover') ? candidate.coverUrl : null,
        },
      })
      await router.invalidate()
      onDone()
    } catch (err) {
      setError(message(err))
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft />
          Results
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {providerName(candidate.provider)}
        </span>
      </div>
      <div className="-mx-6 min-h-0 overflow-y-auto border-y px-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="w-8 py-2" />
              <th className="py-2 pr-4 font-medium">Field</th>
              <th className="w-[40%] py-2 pr-4 font-medium">Current</th>
              <th className="w-[40%] py-2 font-medium">New</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t align-top">
                <td className="py-2">
                  <Checkbox
                    id={`match-${row.key}`}
                    checked={row.on}
                    disabled={!row.available}
                    onCheckedChange={(value) =>
                      setChecked({ ...checked, [row.key]: value === true })
                    }
                  />
                </td>
                <td className="py-2 pr-4">
                  <label htmlFor={`match-${row.key}`}>{row.label}</label>
                </td>
                {row.key === 'cover' ? (
                  <>
                    <td className="py-2 pr-4">
                      <Thumb url={row.current || null} className="w-16" />
                    </td>
                    <td className="py-2">
                      <Thumb url={row.next || null} className="w-16" />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 pr-4 text-muted-foreground">
                      <Value text={row.current} />
                    </td>
                    <td className="py-2">
                      {row.waiting ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Value text={row.next} />
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            onClick={apply}
            disabled={pending || loading || !rows.some((r) => r.on)}
          >
            {pending && <Loader2 className="animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </div>
    </div>
  )
}

function Value({ text }: { text: string }) {
  return text ? (
    <span className="line-clamp-4 break-words whitespace-pre-line">{text}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  )
}
