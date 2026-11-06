import { useState } from 'react'

import { cn } from '#/lib/utils'

type Props = {
  title: string
  authors: string[]
  coverUrl: string | null
  className?: string
}

// A stable hue per title, so a placeholder keeps its color between visits.
function hue(text: string) {
  let h = 0
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) % 360
  return h
}

// The cover image, or a cloth-bound placeholder with the title for books
// without one (or whose image fails to load).
export function BookCover({ title, authors, coverUrl, className }: Props) {
  const [failed, setFailed] = useState<string | null>(null)
  const base = cn(
    'aspect-[2/3] w-full overflow-hidden rounded-cover shadow-sm ring-1 ring-black/5',
    className,
  )
  if (coverUrl && failed !== coverUrl) {
    return (
      <img
        src={coverUrl}
        alt={title}
        loading="lazy"
        onError={() => setFailed(coverUrl)}
        className={cn(base, 'bg-muted object-cover')}
      />
    )
  }
  const h = hue(title)
  return (
    <div
      className={cn(base, '@container p-[7%]')}
      style={{ backgroundColor: `oklch(0.4 0.06 ${h})` }}
    >
      <div
        className="flex h-full flex-col items-center justify-center gap-2 border p-[10%] text-center font-serif"
        style={{
          borderColor: 'oklch(0.8 0.08 85 / 0.6)',
          color: 'oklch(0.92 0.05 85)',
        }}
      >
        <span className="line-clamp-5 text-sm leading-snug font-semibold text-balance hyphens-auto @[12rem]:text-xl">
          {title}
        </span>
        {authors[0] && (
          <span className="line-clamp-2 text-xs opacity-75 @[12rem]:text-sm">
            {authors[0]}
          </span>
        )}
      </div>
    </div>
  )
}
