import { useState } from 'react'
import type { GradesResponse, SubjectGrade } from '../lib/types'
import { formatPercent } from '../lib/format'

export function GradesTrace({ grades }: { grades: GradesResponse }) {
  return (
    <div className="stack">
      <div className="grid grid-4" style={{ marginBottom: 'var(--sch-space-2)' }}>
        <div>
          <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Overall %</div>
          <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>{formatPercent(grades.overall_percentage)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>GPA</div>
          <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>{grades.overall_gpa ?? '\u2014'}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Class rank</div>
          <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>
            {grades.class_rank ? `${grades.class_rank} / ${grades.class_size ?? '\u2014'}` : '\u2014'}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--sch-font-size-xs)' }}>Letter</div>
          <div style={{ fontWeight: '600', fontSize: 'var(--sch-font-size-xl)' }}>{grades.letter ?? '\u2014'}</div>
        </div>
      </div>

      <div className="stack">
        {grades.subjects.map((s) => (
          <SubjectTrace key={s.subject_id} subject={s} />
        ))}
        {grades.subjects.length === 0 ? <p className="muted">No subjects graded for this term.</p> : null}
      </div>
    </div>
  )
}

function SubjectTrace({ subject }: { subject: SubjectGrade }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <button
        className="row-between"
        style={{ width: '100%', padding: 'var(--sch-space-4)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span style={{ fontWeight: '600' }}>
          {subject.subject_name} <span className="muted">({subject.subject_code})</span>
        </span>
        <span className="row" style={{ gap: 'var(--sch-space-5)' }}>
          <span className="muted" style={{ minWidth: '4rem', textAlign: 'right' }}>{formatPercent(subject.percentage)}</span>
          <span className="muted" style={{ minWidth: '2rem', textAlign: 'right' }}>{subject.letter ?? '\u2014'}</span>
          <span className="muted" style={{ minWidth: '2.5rem', textAlign: 'right' }}>{subject.gpa ?? '\u2014'}</span>
          <span className="muted">{open ? '\u25B2' : '\u25BC'}</span>
        </span>
      </button>
      {open ? (
        <div className="card-body" style={{ borderTop: '1px solid var(--sch-border-default)' }}>
          <div className="stack">
            {subject.trace.map((cat, i) => (
              <div key={i}>
                <div className="row-between" style={{ marginBottom: 'var(--sch-space-2)' }}>
                  <span style={{ fontWeight: '600' }}>{cat.name}</span>
                  <span className="muted">
                    weight {cat.weight_pct}%{cat.renormalized_weight_pct !== cat.weight_pct ? ` \u2192 renormalized ${cat.renormalized_weight_pct}%` : ''} &middot; category {formatPercent(cat.category_pct)}
                  </span>
                </div>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Assessment</th>
                        <th className="num">Score</th>
                        <th className="num">Max</th>
                        <th className="num">%</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.entries.map((e) => (
                        <tr key={e.assessment_id} className={e.is_dropped ? 'muted' : ''}>
                          <td>
                            {e.assessment_title}
                            {e.is_dropped ? <span className="muted"> (dropped)</span> : null}
                          </td>
                          <td className="num">{e.score ?? '\u2014'}</td>
                          <td className="num">{e.max_score}</td>
                          <td className="num">{formatPercent(e.percentage)}</td>
                          <td>
                            {e.is_excused ? 'Excused' : e.is_absent ? 'Absent' : e.is_dropped ? 'Dropped lowest' : 'Counted'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
