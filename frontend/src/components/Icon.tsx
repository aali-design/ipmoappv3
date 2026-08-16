import type { SVGProps } from 'react'

export type IconName =
  | 'dashboard'
  | 'users'
  | 'calendar'
  | 'book'
  | 'currency'
  | 'megaphone'
  | 'list'
  | 'home'
  | 'check'
  | 'chart'
  | 'file'
  | 'logout'
  | 'chevron'
  | 'search'
  | 'close'
  | 'plus'
  | 'print'
  | 'settings'
  | 'clock'
  | 'alert'

const paths: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0M17 11a4 4 0 1 0 0-8m-1 8a6 6 0 0 1 5 6',
  calendar: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4',
  book: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  currency: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  megaphone: 'M3 11l14-6v14L3 13v-2zM7 13v6a2 2 0 0 0 2 2h1',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  home: 'M3 11l9-8 9 8M5 9v12h14V9',
  check: 'M4 12l5 5L20 6',
  chart: 'M3 3v18h18M7 15v3M12 10v8M17 6v12',
  file: 'M6 2h8l4 4v16H6zM14 2v4h4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevron: 'M6 9l6 6 6-6',
  search: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM21 21l-4.3-4.3',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 3',
  alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
}

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  )
}
