import type { Metadata } from 'next'
import { Rajdhani, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// One statement face, used for headings only. Body and data stay in plain,
// highly legible faces so the styling never costs readability.
const rajdhani = Rajdhani({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-rajdhani' })
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'Idea Engine',
  description: 'Autonomous entrepreneurial idea pipeline',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${rajdhani.variable} ${plex.variable} ${jetbrains.variable} h-full`}>
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
