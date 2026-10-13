import type { Metadata } from 'next'
import { Syne, DM_Mono } from 'next/font/google'
import './globals.css'

const syne = Syne({ subsets: ['latin'], variable: '--font-syne' })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['300', '400', '500'], variable: '--font-dm-mono' })

export const metadata: Metadata = {
  title: 'Idea Engine',
  description: 'Autonomous entrepreneurial idea pipeline',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${dmMono.variable} h-full`}>
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
