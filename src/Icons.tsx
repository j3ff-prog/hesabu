import type { ReactNode, SVGProps } from 'react'

function Svg({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const SellIcon = () => (
  <Svg>
    <path d="M5.5 8h13l-1.1 12H6.6L5.5 8Z" />
    <path d="M9 8V7a3 3 0 0 1 6 0v1" />
  </Svg>
)
export const StockIcon = () => (
  <Svg>
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
    <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" />
  </Svg>
)
export const TodayIcon = () => (
  <Svg>
    <path d="M5 20v-8M10 20V5M15 20v-11M20 20v-6" />
  </Svg>
)
export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const MinusIcon = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
)
export const CloseIcon = () => (
  <Svg>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)
export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
)
export const CreditIcon = () => (
  <Svg>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M9 8.5h6M9 12.5h6M9 16.5h3" />
  </Svg>
)
export const SettingsIcon = () => (
  <Svg>
    <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
)

export const ExpensesIcon = () => (
  <Svg>
    <path d="M4 7.5h16v11H4v-11Z" />
    <path d="M4 7.5 16.5 4l1 3.5" />
    <circle cx="15.5" cy="13" r="1.8" />
  </Svg>
)
export const ReportsIcon = () => (
  <Svg>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="m8 15 3.5-4 3 2.5L19 7.5" />
  </Svg>
)
export const DownloadIcon = () => (
  <Svg>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </Svg>
)
export const LockIcon = () => (
  <Svg>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)

/** The Hesabu mark: four tally strokes with the amber slash. */
export const Logo = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="logo-mark">
    <rect width="512" height="512" rx="116" fill="#0E5A52" />
    <g fill="#fff">
      <rect x="130" y="138" width="38" height="236" rx="19" />
      <rect x="202" y="138" width="38" height="236" rx="19" />
      <rect x="274" y="138" width="38" height="236" rx="19" />
      <rect x="346" y="138" width="38" height="236" rx="19" />
    </g>
    <path d="M98 336 L414 176" stroke="#0E5A52" strokeWidth="64" strokeLinecap="round" />
    <path d="M98 336 L414 176" stroke="#F2A33A" strokeWidth="38" strokeLinecap="round" />
  </svg>
)
