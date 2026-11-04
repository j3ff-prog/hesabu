/** One group of five: four strokes and a slash. `n` is how many strokes to show (1 to 5). */
function Gate({ n }: { n: number }) {
  const xs = [6, 14, 22, 30]
  return (
    <svg className="gate" width="40" height="30" viewBox="0 0 40 30" aria-hidden="true">
      {xs.slice(0, Math.min(n, 4)).map((x) => (
        <line key={x} x1={x} y1="3" x2={x} y2="27" className="gate-stroke" />
      ))}
      {n >= 5 && <line x1="1" y1="22" x2="37" y2="8" className="gate-slash" />}
    </svg>
  )
}

/** Counts in fives, the way shopkeepers already tally. */
export function Tally({ count, max = 40 }: { count: number; max?: number }) {
  const full = Math.floor(count / 5)
  const rest = count % 5
  const shown = Math.min(full, max)
  const hidden = Math.max(0, count - shown * 5 - rest)
  return (
    <div className="tally" role="img" aria-label={`${count} sales`}>
      {Array.from({ length: shown }, (_, i) => (
        <Gate key={i} n={5} />
      ))}
      {rest > 0 && hidden === 0 && <Gate n={rest} />}
      {hidden > 0 && <span className="tally-more">+{hidden}</span>}
    </div>
  )
}

/** Small animated tally that draws itself, used when a sale is saved. */
export function TallyDraw() {
  return (
    <svg className="tally-draw" width="28" height="22" viewBox="0 0 40 30" aria-hidden="true">
      {[6, 14, 22, 30].map((x, i) => (
        <line key={x} x1={x} y1="3" x2={x} y2="27" style={{ animationDelay: `${i * 70}ms` }} />
      ))}
      <line x1="1" y1="22" x2="37" y2="8" className="slash" style={{ animationDelay: '300ms' }} />
    </svg>
  )
}
