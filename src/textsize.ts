/** How big the text is. Larger is easier to read for everyone, so Large is the default. */
export type TextSize = 'normal' | 'large' | 'xlarge'
export const TEXT_SIZES: { id: TextSize; label: string; scale: number }[] = [
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.12 },
  { id: 'xlarge', label: 'Extra large', scale: 1.28 }
]
const KEY = 'tallify.textsize'

export function getTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'normal' || v === 'large' || v === 'xlarge') return v
  } catch {
    /* ignore */
  }
  return 'large'
}

export function setTextSize(id: TextSize): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
  apply(id)
}

function apply(id: TextSize): void {
  const t = TEXT_SIZES.find((x) => x.id === id) ?? TEXT_SIZES[1]
  document.documentElement.style.setProperty('--ts', String(t.scale))
}

apply(getTextSize())
