import { createFileRoute, notFound } from '@tanstack/react-router'
import { Download } from 'lucide-react'

import { BookCover } from '#/components/book-cover'
import { Button } from '#/components/ui/button'
import { getBook } from '#/lib/book-functions'

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

function languageName(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

function Book() {
  const book = Route.useLoaderData()
  const details = [
    ['Publisher', book.publisher],
    ['Published', book.publishedDate],
    ['ISBN', book.isbn],
    ['Language', book.language && languageName(book.language)],
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
        <div className="mt-6">
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
