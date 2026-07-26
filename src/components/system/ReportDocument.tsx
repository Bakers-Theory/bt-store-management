import { padTotals } from "@/lib/report";
import type { PrintReport } from "@/lib/report";

/**
 * The printed report itself — an A4 document, not a rendering of any screen.
 * Styled entirely by the `.report-doc` rules in the `@media print` block, so it
 * carries no Tailwind: those utilities are tuned for screen and would fight the
 * paper layout.
 */
export function ReportDocument({ report, generatedAt }: { report: PrintReport; generatedAt: string }) {
  return (
    <div className="report-doc">
      <div className="r-head">
        <div>
          <div className="r-shop">{report.shop}</div>
          {report.shopMeta && <div className="r-sub">{report.shopMeta}</div>}
        </div>
        <div className="r-title">
          <strong>{report.title}</strong>
          <div className="r-sub">{report.period}</div>
          <div className="r-sub">{report.scope}</div>
          <div className="r-sub">Generated {generatedAt}</div>
        </div>
      </div>

      {report.summary.length > 0 && (
        <div className="r-summary">
          {report.summary.map((s) => (
            <div key={s.label}>
              <span>{s.label}</span>
              <b>{s.value}</b>
            </div>
          ))}
        </div>
      )}

      {report.tables.map((t, ti) => (
        <div key={t.heading ?? ti}>
          {t.heading && <h3>{t.heading}</h3>}
          {t.rows.length === 0 ? (
            <div className="r-empty">{t.empty ?? "Nothing to show."}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  {t.columns.map((c) => (
                    <th key={c.label} className={c.num ? "r-num" : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className={t.columns[ci]?.num ? "r-num" : undefined}>
                        {cell === "" ? "—" : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {t.totals && (
                <tfoot>
                  <tr>
                    {padTotals(t.totals, t.columns.length).map((cell, ci) => (
                      <td key={ci} className={t.columns[ci]?.num ? "r-num" : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      ))}

      {report.note && <div className="r-note">{report.note}</div>}
    </div>
  );
}
