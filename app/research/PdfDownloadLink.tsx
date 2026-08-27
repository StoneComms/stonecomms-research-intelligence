type PdfDownloadLinkProps = {
  url?: string
}

export default function PdfDownloadLink({url}: PdfDownloadLinkProps) {
  if (!url) return null

  return (
    <a
      className="pdf-download"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open downloadable publication PDF"
    >
      <svg
        aria-hidden="true"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 15h8" />
        <path d="M8 18h5" />
      </svg>
      Download PDF
    </a>
  )
}
