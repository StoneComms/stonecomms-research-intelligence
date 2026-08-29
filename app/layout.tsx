import type {Metadata} from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'StoneComms Research & Intelligence',
  description: 'Independent, decision-useful research and intelligence for Africa’s climate economy.'
}

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><head><style>{`
    .mobile-nav{display:none;position:relative}
    @media(max-width:800px){
      .site-header{grid-template-columns:1fr auto auto;gap:8px}
      .mobile-nav{display:block}
      .mobile-nav summary{list-style:none;cursor:pointer;border:1px solid #10252a;padding:10px 12px;font-size:12px;font-weight:800;line-height:1;background:#f7f8f4}
      .mobile-nav summary::-webkit-details-marker{display:none}
      .mobile-nav summary:focus-visible{outline:2px solid #176b66;outline-offset:2px}
      .mobile-nav-links{position:absolute;z-index:100;right:0;top:calc(100% + 10px);min-width:190px;background:#f7f8f4;border:1px solid #10252a;box-shadow:0 8px 24px rgba(16,37,42,.12);padding:6px}
      .mobile-nav-links a{display:block;text-decoration:none;font-size:13px;font-weight:700;padding:11px 12px;border-bottom:1px solid #cfd7d4}
      .mobile-nav-links a:last-child{border-bottom:0}
      .mobile-nav-links a:hover,.mobile-nav-links a:focus-visible{background:#e7ece8;outline:none}
      .header-cta{white-space:nowrap;padding:10px 12px}
    }
    @media(max-width:430px){
      .site-header{gap:6px}
      .mobile-nav summary{padding:10px;font-size:11px}
      .header-cta{padding:10px;font-size:11px}
    }
  `}</style></head><body>
    <header className="site-header shell">
      <Link className="brand" href="/" aria-label="StoneComms Research and Intelligence"><div className="wordmark">STONE<span>COMMS</span></div><div className="brand-note">Research &amp;<br/>Intelligence</div></Link>
      <nav aria-label="Primary navigation"><Link href="/research" aria-label="Research repository">Research</Link><Link href="/#method">Method</Link><Link href="/#commission">Commission</Link><Link href="/#about">About</Link></nav>
      <details className="mobile-nav">
        <summary aria-label="Open primary navigation">Menu</summary>
        <div className="mobile-nav-links" role="navigation" aria-label="Mobile primary navigation"><Link href="/research">Research</Link><Link href="/#method">Method</Link><Link href="/#commission">Commission</Link><Link href="/#about">About</Link></div>
      </details>
      <a className="header-cta" href="mailto:lee@stonecomms.com">Talk to the team <span aria-hidden="true">↗</span></a>
    </header>
    {children}
    <footer><div className="shell footer-grid"><div><div className="brand brand-footer" aria-label="StoneComms Research and Intelligence"><div className="wordmark">STONE<span>COMMS</span></div></div><p>Independent research and intelligence.</p></div><p>Stroud, UK · Africa-centred.</p><div className="footer-links"><a href="mailto:lee@stonecomms.com">Contact ↗</a><Link href="/#method">Research standard ↑</Link></div></div><div className="shell copyright"><span>© 2026 StoneComms Ltd</span><span>Evidence, clearly seen.</span></div></footer>
  </body></html>
}
