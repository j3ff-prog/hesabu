import { useState } from 'react'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { getTextSize, setTextSize, TEXT_SIZES, type TextSize } from './textsize'

/** Pick how big the writing is. Closes as soon as one is chosen so the change can be seen. */
export function TextSizeSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [now] = useState<TextSize>(getTextSize)
  return (
    <Sheet title="Text size" onClose={onClose}>
      <p className="hint spaced">Choose the size that is easiest for you to read.</p>
      <div role="radiogroup" aria-label="Text size">
        {TEXT_SIZES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={now === t.id}
            className="size-choice"
            onClick={() => {
              setTextSize(t.id)
              toast.show({ text: `Text size: ${t.label}` })
              onClose()
            }}
          >
            <span style={{ fontSize: 18 * t.scale }}>{t.label}</span>
            <span className="aa" style={{ fontSize: 26 * t.scale }}>Aa</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
