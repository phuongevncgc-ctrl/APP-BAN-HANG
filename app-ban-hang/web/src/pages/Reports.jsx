import { useState } from 'react';
import { get } from '../api.js';
import { money, num, dateOnly, isoDay, METHOD_NAMES } from '../format.js';
import { DateRange, Loading, useLoad } from '../components/ui.jsx';
import { go } from '../App.jsx';

function Stat({ label, value, tone, sub, onClick }) {
  return (
    <button className={`card stat ${onClick ? 'clickable' : ''}`} onClick={onClick} disabled={!onClick}>
      <small>{label}</small>
      <b className={tone}>{value}</b>
      {sub && <small className="muted">{sub}</small>}
    </button>
  );
}

function DayBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  if (rows.length < 2) return null;
  return (
    <div className="card">
      <h4>Doanh thu theo ngày</h4>
      <div className="bars">
        {rows.map((r) => (
          <div key={r.day} className="bar-row">
            <span className="bar-label">{dateOnly(r.day).slice(0, 5)}</span>
            <div className="bar-track">
              <div className="bar" style={{ width: `${Math.max(0, (r.revenue / max) * 100)}%` }} />
              <div className="bar bar-profit" style={{ width: `${Math.max(0, (r.profit / max) * 100)}%` }} />
            </div>
            <span className="bar-value">{money(r.revenue)}</span>
          </div>
        ))}
      </div>
      <div className="legend"><span className="dot" /> Doanh thu <span className="dot dot-profit" /> Lợi nhuận</div>
    </div>
  );
}

export default function Reports() {
  const today = isoDay(new Date());
  const [range, setRange] = useState([today, today]);
  const state = useLoad(() => get(`/reports/summary?from=${range[0]}&to=${range[1]}`), [range[0], range[1]]);
  return (
    <div className="page">
      <div className="page-head"><h1>Báo cáo</h1></div>
      <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
      <Loading state={state}>
        {(r) => (
          <>
            <div className="cards">
              <Stat label="Doanh thu" value={money(r.revenue)} sub={`${r.sales.count} hoá đơn`} onClick={() => go('hoa-don')} />
              <Stat label="Lợi nhuận" value={money(r.profit)} tone={r.profit < 0 ? 'neg' : 'pos'} sub={r.revenue ? `${Math.round((r.profit / r.revenue) * 100)}% doanh thu` : ''} />
              <Stat label="Trả hàng" value={money(r.returns.total)} sub={`${r.returns.count} phiếu`} />
              <Stat label="Giảm giá HĐ" value={money(r.sales.discount)} />
              {(r.expenses > 0 || r.otherIncome > 0) && <Stat label="Chi phí (sổ quỹ)" value={money(r.expenses)} sub={r.otherIncome ? `Thu khác ${money(r.otherIncome)}` : ''} onClick={() => go('thu-chi')} />}
              {(r.expenses > 0 || r.otherIncome > 0) && <Stat label="Lãi sau chi phí" value={money(r.netProfit)} tone={r.netProfit < 0 ? 'neg' : 'pos'} />}
            </div>
            <h4>Tiền thu chi trong kỳ</h4>
            <div className="cards">
              <Stat label="Tiền mặt" value={money(r.cashflow.cash)} tone={r.cashflow.cash < 0 ? 'neg' : ''} />
              <Stat label="Chuyển khoản" value={money(r.cashflow.transfer)} tone={r.cashflow.transfer < 0 ? 'neg' : ''} />
              {r.cashflow.card !== 0 && <Stat label="Thẻ" value={money(r.cashflow.card)} />}
              <Stat label="Bán chịu trong kỳ" value={money(r.sales.debt)} tone="neg" />
            </div>
            <p className="muted small">Tiền thu chi đã gồm: tiền bán hàng, thu nợ, hoàn tiền trả hàng, tiền trả nhà cung cấp và phiếu thu chi.</p>
            <h4>Tổng quan cửa hàng</h4>
            <div className="cards">
              <Stat label="Khách đang nợ" value={money(r.customerDebt)} tone="neg" onClick={() => go('khach-hang')} />
              <Stat label="Nợ nhà cung cấp" value={money(r.supplierDebt)} onClick={() => go('nhap-hang')} />
              <Stat label="Giá trị tồn kho" value={money(r.stockValue)} />
              <Stat label="Hàng sắp hết" value={num(r.lowStock)} tone={r.lowStock ? 'neg' : ''} onClick={() => go('hang-hoa')} />
            </div>
            <DayBars rows={r.byDay} />
            {r.topProducts.length > 0 && (
              <div className="card">
                <h4>Hàng bán chạy</h4>
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>Hàng hoá</th><th className="r">SL</th><th className="r">Doanh thu</th><th className="r">Lãi</th></tr></thead>
                    <tbody>
                      {r.topProducts.map((p) => (
                        <tr key={p.product_id}>
                          <td>{p.name}</td>
                          <td className="r">{num(p.qty)} {p.unit}</td>
                          <td className="r">{money(p.revenue)}</td>
                          <td className={`r ${p.profit < 0 ? 'neg' : ''}`}>{money(p.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {r.byUser.length > 1 && (
              <div className="card">
                <h4>Theo nhân viên</h4>
                {r.byUser.map((u) => <div key={u.name} className="row-between"><span>{u.name} ({u.count} HĐ)</span><b>{money(u.total)}</b></div>)}
              </div>
            )}
            {r.methods.length > 0 && (
              <details className="card">
                <summary>Chi tiết dòng tiền</summary>
                {r.methods.map((m, i) => (
                  <div key={i} className="row-between">
                    <span>{{ sale: 'Bán hàng', return: 'Hoàn tiền trả hàng', debt_in: 'Thu nợ khách', purchase: 'Trả tiền nhập hàng', debt_out: 'Trả nợ NCC', supplier_return: 'NCC hoàn tiền' }[m.kind]} · {METHOD_NAMES[m.method]}</span>
                    <b className={m.amount < 0 ? 'neg' : ''}>{money(m.amount)}</b>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </Loading>
    </div>
  );
}
