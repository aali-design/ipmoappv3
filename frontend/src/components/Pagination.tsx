interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pages: number[] = []
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <nav className="pagination" aria-label="Pagination">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
        &larr;
      </button>
      {start > 1 ? (
        <>
          <button onClick={() => onPage(1)}>1</button>
          {start > 2 ? <span className="muted">…</span> : null}
        </>
      ) : null}
      {pages.map((p) => (
        <button key={p} onClick={() => onPage(p)} className={p === page ? 'active' : ''} aria-current={p === page ? 'page' : undefined}>
          {p}
        </button>
      ))}
      {end < totalPages ? (
        <>
          {end < totalPages - 1 ? <span className="muted">…</span> : null}
          <button onClick={() => onPage(totalPages)}>{totalPages}</button>
        </>
      ) : null}
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">
        &rarr;
      </button>
      <span className="muted" style={{ marginLeft: 'var(--sch-space-2)' }}>
        {total.toLocaleString()} results
      </span>
    </nav>
  )
}
