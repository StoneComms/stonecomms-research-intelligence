import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'StoneComms Research & Intelligence',
  description: 'Independent research for Africa’s climate economy.'
}

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>
    <header className="site-header"><div className="wrap header-row">
      <Link href="/" className="brand">STONECOMMS <span>RESEARCH & INTELLIGENCE</span></Link>
      <nav className="nav"><Link href="/">Home</Link><Link href="/research">Research</Link></nav>
    </div></header>
    {children}
    <footer className="footer"><div className="wrap">Independent research for Africa’s climate economy · StoneComms Research & Intelligence</div></footer>
  </body></html>
}
