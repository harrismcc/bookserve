import { cn } from '#/lib/utils'

// A book's blurb set like book prose: serif, with indented paragraphs.
export function BookDescription({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const paragraphs = text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return (
    <div
      className={cn(
        'max-w-prose font-serif text-base leading-relaxed text-pretty hyphens-auto',
        className,
      )}
    >
      {paragraphs.map((p, i) => (
        <p key={i} className="not-first:indent-6">
          {p}
        </p>
      ))}
    </div>
  )
}
