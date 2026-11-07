import { useEffect, useRef, useState, type ReactNode } from 'react'
import { compact, money } from './format'

export const COLORS = {
  cash: '#0e5a52',
  mpesa: '#f2a33a',
  credit: '#6b7f99',
  profit: '#1f7a4a',
  alert: '#c23b32',
  neutral: '#0e5a52'
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export interface Part {
  name: string
  value: number
  color: string
}
export interface BarDatum {
  label: string // x-axis text
  full: string // text for the readout
  parts: Part[]
}

/** Vertical bars, optionally stacked. Tap or hover a bar to read its exact numbers underneath. */
export function BarChart({ data, height = 190, label }: { data: BarDatum[]; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [sel, setSel] = useState<number | null>(null)
  const padL = 40
  const padB = 22
  const padT = 8
  const innerH = height - padB - padT
  const totals = data.map((d) => d.parts.reduce((t, p) => t + p.value, 0))
  const max = Math.max(1, ...totals)
  const nice = niceMax(max)
  const innerW = Math.max(0, w - padL - 4)
  const step = data.length ? innerW / data.length : 0
  const barW = Math.max(2, Math.min(34, step * 0.7))
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 46))))
  const ticks = [0, nice / 2, nice]
  const shown = sel !== null ? data[sel] : null

  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label}>
          {ticks.map((t) => {
            const y = padT + innerH - (t / nice) * innerH
            return (
              <g key={t}>
                <line x1={padL} x2={w} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
                <text x={padL - 6} y={y + 4} textAnchor="end" className="ax">{compact(t)}</text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const x = padL + step * i + (step - barW) / 2
            let y = padT + innerH
            return (
              <g key={i} onPointerEnter={() => setSel(i)} onClick={() => setSel(i === sel ? null : i)} style={{ cursor: 'pointer' }}>
                <rect x={padL + step * i} y={padT} width={step} height={innerH} fill="transparent" />
                {d.parts.map((p, j) => {
                  const h = (Math.max(0, p.value) / nice) * innerH
                  y -= h
                  return h > 0 ? (
                    <rect key={j} x={x} y={y} width={barW} height={h} fill={p.color} opacity={sel === null || sel === i ? 1 : 0.45} rx={Math.min(3, barW / 3)} />
                  ) : null
                })}
                {i % every === 0 && (
                  <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="ax">{d.label}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      <p className="readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{shown.full}</strong>
            {shown.parts.filter((p) => p.value !== 0).map((p) => (
              <span key={p.name}><i style={{ background: p.color }} />{p.name} {money(p.value)}</span>
            ))}
            {shown.parts.every((p) => p.value === 0) && <span>Nothing</span>}
          </>
        ) : (
          <span className="muted">Tap a bar to see the numbers.</span>
        )}
      </p>
    </div>
  )
}

function niceMax(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / pow
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return n * pow
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.name}><i style={{ background: i.color }} />{i.name}</li>
      ))}
    </ul>
  )
}

/** Horizontal bars with the value written at the end of each one. */
export function HBars({
  rows,
  color = COLORS.neutral,
  format = money,
  empty = 'Nothing to show yet.'
}: {
  rows: { label: string; value: number; note?: string; color?: string }[]
  color?: string
  format?: (n: number) => string
  empty?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <p className="muted">{empty}</p>
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="hbar-top">
            <span className="hbar-label">{r.label}</span>
            <span className="strong">{format(r.value)}{r.note ? <span className="muted"> · {r.note}</span> : null}</span>
          </div>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? color }} /></div>
        </li>
      ))}
    </ul>
  )
}

/** One bar split into parts, with a legend that carries the numbers. */
export function SplitBar({ parts }: { parts: Part[] }) {
  const total = parts.reduce((t, p) => t + p.value, 0)
  if (total <= 0) return <p className="muted">No sales in this period.</p>
  return (
    <div>
      <div className="split" role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.name} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="split-legend">
        {parts.map((p) => (
          <li key={p.name}>
            <i style={{ background: p.color }} />
            <span>{p.name}</span>
            <span className="strong">{money(p.value)}</span>
            <span className="muted">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {sub && <p className="muted card-sub">{sub}</p>}
      {children}
    </section>
  )
}

export interface ProfitDatum {
  label: string
  full: string
  value: number
}

/** Profit over time, as bars or as a line. A loss goes below the zero line and turns red. */
export function ProfitChart({ data, mode, height = 200, label }: { data: ProfitDatum[]; mode: 'bars' | 'line'; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [sel, setSel] = useState<number | null>(null)
  const padL = 40
  const padB = 22
  const padT = 8
  const innerH = height - padB - padT
  const vals = data.map((d) => d.value)
  const maxV = Math.max(0, ...vals)
  const minV = Math.min(0, ...vals)
  const top = maxV > 0 ? niceMax(maxV) : minV < 0 ? 0 : 1
  const bottom = minV < 0 ? -niceMax(-minV) : 0
  const range = top - bottom
  const y = (v: number) => padT + ((top - v) / range) * innerH
  const innerW = Math.max(0, w - padL - 4)
  const step = data.length ? innerW / data.length : 0
  const barW = Math.max(2, Math.min(34, step * 0.7))
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 46))))
  const ticks = [...new Set([top, 0, bottom])]
  const cx = (i: number) => padL + step * i + step / 2
  const shown = sel !== null ? data[sel] : null
  const colorOf = (v: number) => (v < 0 ? COLORS.alert : COLORS.profit)

  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--ink-soft, #6b6b6b)' : 'var(--line)'} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="ax">{compact(t)}</text>
            </g>
          ))}
          {mode === 'line' && data.length > 1 && (
            <polyline fill="none" stroke={COLORS.profit} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={data.map((d, i) => `${cx(i)},${y(d.value)}`).join(' ')} />
          )}
          {data.map((d, i) => (
            <g key={i} onPointerEnter={() => setSel(i)} onClick={() => setSel(i === sel ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={padL + step * i} y={padT} width={step} height={innerH} fill="transparent" />
              {mode === 'bars' ? (
                d.value !== 0 && (
                  <rect
                    x={cx(i) - barW / 2}
                    y={Math.min(y(0), y(d.value))}
                    width={barW}
                    height={Math.max(1, Math.abs(y(d.value) - y(0)))}
                    fill={colorOf(d.value)}
                    opacity={sel === null || sel === i ? 1 : 0.45}
                    rx={Math.min(3, barW / 3)}
                  />
                )
              ) : (
                <circle cx={cx(i)} cy={y(d.value)} r={sel === i ? 5 : 3.5} fill={colorOf(d.value)} stroke="var(--paper, #fff)" strokeWidth="1.5" />
              )}
              {i % every === 0 && <text x={cx(i)} y={height - 6} textAnchor="middle" className="ax">{d.label}</text>}
            </g>
          ))}
        </svg>
      )}
      <p className="readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{shown.full}</strong>
            <span><i style={{ background: colorOf(shown.value) }} />{shown.value < 0 ? 'Loss' : 'Profit'} {money(Math.abs(shown.value))}</span>
          </>
        ) : (
          <span className="muted">Tap a {mode === 'bars' ? 'bar' : 'point'} to see the numbers. Red below the line means a loss.</span>
        )}
      </p>
    </div>
  )
}
