import type {Metadata} from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'StoneComms Research & Intelligence',
  description: 'Independent, decision-useful research and intelligence for Africa’s climate economy.'
}

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>
    <header className="site-header shell">
      <Link className="brand" href="/" aria-label="StoneComms Research and Intelligence">
        <div className="wordmark">STONE<span>COMMS</span></div>
        <div className="brand-note">Research &amp;<br/>Intelligence</div>
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/research">Research</Link>
        <Link href="/#method">Method</Link>
        <Link href="/#commission">Commission</Link>
        <Link href="/#about">About</Link>
      </nav>
      <a className="header-cta" href="mailto:lee@stonecomms.com">Talk to the team <span aria-hidden="true">↗</span></a>
    </header>
    {children}
    <footer>
      <div className="shell footer-grid">
        <div><div className="brand brand-footer" aria-label="StoneComms Research and Intelligence"><div className="wordmark">STONE<span>COMMS</span></div></div><p>Independent research and intelligence.</p></div>
        <p>Stroud, UK · Africa-centred.</p>
        <div className="footer-links"><a href="mailto:lee@stonecomms.com">Contact ↗</a><Link href="/#method">Research standard ↑</Link></div>
      </div>
      <div className="shell copyright"><span>© 2026 StoneComms Ltd</span><span>Evidence, clearly seen.</span></div>
    </footer>
  </body></html>
}
