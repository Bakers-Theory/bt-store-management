import type { Payslip } from "@/lib/payslip";

/**
 * A payslip — a per-employee statement, not a table. Shares the `.report-doc`
 * print styles with reports and adds the payslip-specific blocks: the figure
 * breakdown, the amount in words, and signature lines.
 */
export function PayslipDocument({
  slip,
  generatedAt,
}: {
  slip: Payslip;
  generatedAt: string;
}) {
  return (
    <div className="report-doc">
      <div className="r-head">
        <div>
          <div className="r-shop">{slip.shop}</div>
          {slip.shopMeta && <div className="r-sub">{slip.shopMeta}</div>}
        </div>
        <div className="r-title">
          <strong>{slip.title}</strong>
          <div className="r-sub">{slip.period}</div>
          <div className="r-sub">Generated {generatedAt}</div>
        </div>
      </div>

      <div className="r-slip-name">{slip.employeeName}</div>

      <div className="r-summary">
        {slip.facts.map((f) => (
          <div key={f.label}>
            <span>{f.label}</span>
            <b>{f.value}</b>
          </div>
        ))}
      </div>

      <table className="r-slip-lines">
        <tbody>
          {slip.lines.map((l) => (
            <tr key={l.label} className={l.strong ? "r-slip-net" : undefined}>
              <td>{l.label}</td>
              <td className="r-num">
                {l.minus ? `(${l.value})` : l.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="r-slip-words">
        <span>Net pay in words</span>
        <b>{slip.netInWords}</b>
      </div>

      <div className="r-slip-status">{slip.statusLine}</div>

      <div className="r-slip-sign">
        <div>
          <div className="r-slip-rule" />
          Employer signature
        </div>
        <div>
          <div className="r-slip-rule" />
          Employee signature
        </div>
      </div>

      {slip.note && <div className="r-note">{slip.note}</div>}
    </div>
  );
}
