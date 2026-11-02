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

// The cover image, or a tinted block with the title for books without one
// (or whose image fails to load).
export function BookCover({ title, authors, coverUrl, className }: Props) {
  const [failed, setFailed] = useState<string | null>(null)
  const base = cn(
    'aspect-[2/3] w-full overflow-hidden rounded-md shadow-sm ring-1 ring-black/5',
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
      className={cn(
        base,
        '@container flex flex-col justify-between p-3 text-left',
      )}
      style={{
        backgroundColor: `oklch(0.9 0.05 ${h})`,
        color: `oklch(0.32 0.07 ${h})`,
      }}
    >
      <span className="line-clamp-5 text-sm leading-snug font-semibold text-balance @[12rem]:text-xl">
        {title}
      </span>
      {authors[0] && (
        <span className="line-clamp-2 text-xs opacity-80 @[12rem]:text-sm">
          {authors[0]}
        </span>
      )}
    </div>
  )
}
