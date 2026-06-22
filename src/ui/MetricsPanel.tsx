import type { MetricRow } from './castViewModel'

/** Derived wand metrics as a stat grid (reuses the wand-panel stat-row styling).
 *  Approximate rows carry a small ≈ marker explained by the panel's footnote. */
export function MetricsPanel({ metrics }: { metrics: MetricRow[] }) {
  return (
    <div className="metrics-grid">
      {metrics.map((r) => (
        <div className="stat-row" key={r.key}>
          <span className="stat-label">{r.label}</span>
          <span className="stat-value">
            {r.value}
            {r.approximate && (
              <span className="metric-approx" title="approximate — see note">
                {' '}
                ≈
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
