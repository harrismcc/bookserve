import { useState } from 'react'
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { Download, RotateCcw, SearchCheck } from 'lucide-react'

import { BookCover } from '#/components/book-cover'
import { MatchDialog } from '#/components/match-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { getBook } from '#/lib/book-functions'
import { revertMatch } from '#/lib/match-functions'
import { languageName } from '#/lib/utils'

export const Route = createFileRoute('/_app/books/$bookId')({
  loader: async ({ params }) => {
    const book = await getBook({ data: params.bookId })
    if (!book) throw notFound()
    return book
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `${loaderData.title} · Bookserve` }] : [],
  }),
  component: Book,
})

function Book() {
  const book = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const details = [
    ['Publisher', book.publisher],
    ['Published', book.publishedDate],
    ['ISBN', book.isbn],
    ['Language', book.language && languageName(book.language)],
    ['Pages', book.pageCount && String(book.pageCount)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:grid-cols-[14rem_1fr] md:grid-cols-[16rem_1fr]">
      <BookCover {...book} className="mx-auto max-w-56 sm:max-w-none" />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-balance">{book.title}</h1>
        {book.authors.length > 0 && (
          <p className="mt-1 text-lg text-muted-foreground">
            {book.authors.join(', ')}
          </p>
        )}
        {book.series && (
          <p className="mt-2 text-sm">
            {book.series}
            {book.seriesIndex != null && ` #${book.seriesIndex}`}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {book.missing ? (
            <Button disabled>File missing</Button>
          ) : (
            <Button asChild>
              <a href={`/api/books/${book.id}/download`} download>
                <Download />
                Download
              </a>
            </Button>
          )}
          {user.role === 'admin' && <AdminActions book={book} />}
        </div>
        {book.description && (
          <p className="mt-8 max-w-prose text-sm leading-relaxed whitespace-pre-line">
            {book.description}
          </p>
        )}
        {details.length > 0 && (
          <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </main>
  )
}

function AdminActions({
  book,
}: {
  book: ReturnType<typeof Route.useLoaderData>
}) {
  const router = useRouter()
  const [matching, setMatching] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function revert(event: React.MouseEvent) {
    // Keep the dialog open until the request finishes so errors show inline.
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await revertMatch({ data: book.id })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setMatching(true)}>
        <SearchCheck />
        Match
      </Button>
      <MatchDialog book={book} open={matching} onOpenChange={setMatching} />
      {book.matched && (
        <AlertDialog onOpenChange={() => setError('')}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost">
              <RotateCcw />
              Revert to file metadata
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revert to file metadata?</AlertDialogTitle>
            </AlertDialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={revert} disabled={pending}>
                Revert
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
