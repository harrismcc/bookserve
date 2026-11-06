import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, Search } from 'lucide-react'

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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#/components/ui/item'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Spinner } from '#/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
  // Interleaved, so each provider's best matches are near the top.
  const lists = entries.map(([, r]) =>
    r.status === 'done' ? r.candidates : [],
  )
  const candidates = Array.from(
    { length: Math.max(0, ...lists.map((l) => l.length)) },
    (_, i) => lists.flatMap((l) => (i < l.length ? [l[i]] : [])),
  ).flat()
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
            {pending ? <Spinner /> : <Search />}
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
                <Spinner className="size-4" />
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
                <Item
                  asChild
                  size="sm"
                  className="w-full flex-nowrap p-2 text-left hover:bg-accent"
                >
                  <button type="button" onClick={() => setPicked(c)}>
                    <ItemMedia>
                      <Thumb url={c.thumbnailUrl} className="w-10" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="line-clamp-1 block text-base">
                        {c.title}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-1">
                        {c.authors.join(', ')}
                      </ItemDescription>
                      <ItemDescription className="text-xs">
                        {[
                          c.publishedDate?.slice(0, 4),
                          providerName(c.provider),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </ItemDescription>
                    </ItemContent>
                  </button>
                </Item>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Thumb({ url, className }: { url: string | null; className?: string }) {
  const base = cn('aspect-[2/3] shrink-0 rounded-cover bg-muted', className)
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
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="pr-4">Field</TableHead>
              <TableHead className="w-[40%] pr-4">Current</TableHead>
              <TableHead className="w-[40%]">New</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.key}
                className="align-top hover:bg-transparent"
              >
                <TableCell>
                  <Checkbox
                    id={`match-${row.key}`}
                    checked={row.on}
                    disabled={!row.available}
                    onCheckedChange={(value) =>
                      setChecked({ ...checked, [row.key]: value === true })
                    }
                  />
                </TableCell>
                <TableCell className="whitespace-normal pr-4">
                  <Label htmlFor={`match-${row.key}`} className="font-normal">
                    {row.label}
                  </Label>
                </TableCell>
                {row.key === 'cover' ? (
                  <>
                    <TableCell className="whitespace-normal pr-4">
                      <Thumb url={row.current || null} className="w-16" />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Thumb url={row.next || null} className="w-16" />
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="whitespace-normal pr-4 text-muted-foreground">
                      <Value text={row.current} />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {row.waiting ? (
                        <Spinner className="size-4 text-muted-foreground" />
                      ) : (
                        <Value text={row.next} />
                      )}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-2">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            onClick={apply}
            disabled={pending || loading || !rows.some((r) => r.on)}
          >
            {pending && <Spinner />}
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
