import { useState } from 'react';
import { get, downloadUrl } from '../api.js';
import { money, num, dateOnly, isoDay, METHOD_NAMES } from '../format.js';
import { DateRange, Loading, useLoad, useDebounced } from '../components/ui.jsx';
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

// So với kỳ trước: ▲ 12% / ▼ 5%
function change(cur, prev, label) {
  if (!prev) return cur ? `${label}: chưa có` : '';
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% so với ${label}`;
}

function HourBars({ rows }) {
  if (!rows.length) return null;
  const from = Math.min(7, ...rows.map((r) => r.hour));
  const to = Math.max(20, ...rows.map((r) => r.hour));
  const byHour = Object.fromEntries(rows.map((r) => [r.hour, r]));
  const max = Math.max(1, ...rows.map((r) => r.total));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const best = rows.reduce((a, b) => (b.total > a.total ? b : a));
  return (
    <div className="card">
      <h4>Bán theo giờ <small className="muted">· đông nhất {best.hour}h–{best.hour + 1}h</small></h4>
      <div className="hour-bars">
        {hours.map((h) => (
          <div key={h} className="hour-col" title={`${h}h: ${byHour[h]?.count ?? 0} hoá đơn, ${money(byHour[h]?.total ?? 0)}`}>
            <div className="hour-bar" style={{ height: `${((byHour[h]?.total ?? 0) / max) * 100}%` }} />
            <small>{h}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// Gợi ý nhập hàng theo tốc độ bán, và hàng tồn lâu không bán (vốn nằm kho)
function GoodsAdvice() {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState('reorder');
  const state = useLoad(() => get(`/reports/products?days=${days}`), [days]);
  return (
    <>
      <div className="chips">
        {[30, 60, 90].map((d) => <button key={d} className={`chip ${days === d ? 'chip-on' : ''}`} onClick={() => setDays(d)}>{d} ngày qua</button>)}
      </div>
      <Loading state={state}>
        {(r) => (
          <>
            <div className="seg">
              <button className={tab === 'reorder' ? 'on' : ''} onClick={() => setTab('reorder')}>Cần nhập thêm ({num(r.reorderCount)})</button>
              <button className={tab === 'slow' ? 'on' : ''} onClick={() => setTab('slow')}>Bán chậm ({num(r.slowCount)})</button>
            </div>
            {tab === 'reorder' ? (
              <>
                <p className="muted small">Hàng dưới tồn tối thiểu, hoặc theo tốc độ bán {days} ngày qua chỉ còn đủ bán dưới 7 ngày. "Nên nhập" là đủ bán thêm khoảng 30 ngày.</p>
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>Hàng hoá</th><th className="r">Tồn</th><th className="r">Bán/ngày</th><th className="r">Đủ bán</th><th className="r">Nên nhập</th></tr></thead>
                    <tbody>
                      {r.reorder.length === 0 && <tr><td colSpan={5} className="empty">Chưa có hàng nào cần nhập</td></tr>}
                      {r.reorder.map((x) => (
                        <tr key={x.id}>
                          <td>{x.name}<small className="muted block">{x.code}{x.unit && ` · ${x.unit}`}{x.min_stock > 0 && ` · tối thiểu ${num(x.min_stock)}`}</small></td>
                          <td className={`r ${x.stock <= 0 ? 'neg' : ''}`}>{num(x.stock)}</td>
                          <td className="r">{x.per_day ? num(x.per_day) : '—'}</td>
                          <td className={`r ${x.cover_days !== null && x.cover_days < 3 ? 'neg' : ''}`}>{x.cover_days === null ? '—' : `${x.cover_days} ngày`}</td>
                          <td className="r"><b>{num(x.suggest)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <p className="muted small">Hàng còn tồn nhưng {days} ngày qua không bán được cái nào. Tổng vốn đang nằm kho: <b>{money(r.slowValue)}</b>.
                  {r.tooNew > 0 && ` Có ${num(r.tooNew)} hàng mới thêm chưa đủ ${days} ngày nên chưa xét.`}</p>
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>Hàng hoá</th><th className="r">Tồn</th><th className="r">Vốn</th><th className="r">Bán lần cuối</th></tr></thead>
                    <tbody>
                      {r.slow.length === 0 && <tr><td colSpan={4} className="empty">Không có hàng bán chậm</td></tr>}
                      {r.slow.map((x) => (
                        <tr key={x.id}>
                          <td>{x.name}<small className="muted block">{x.code}{x.unit && ` · ${x.unit}`}</small></td>
                          <td className="r">{num(x.stock)}</td>
                          <td className="r">{money(x.value)}</td>
                          <td className="r">{x.last_sale ? dateOnly(x.last_sale) : 'Chưa bán'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {(tab === 'reorder' ? r.reorderCount : r.slowCount) > 500 && <p className="muted small">Hiện 500 hàng đầu.</p>}
          </>
        )}
      </Loading>
    </>
  );
}

// Xuất nhập tồn theo kỳ, số lượng theo ĐVT gốc
function StockReport({ range }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const qs = `from=${range[0]}&to=${range[1]}&q=${encodeURIComponent(dq)}`;
  const state = useLoad(() => get(`/reports/stock?${qs}`), [qs]);
  const cell = (v) => (v ? num(v) : '');
  return (
    <>
      <div className="row gap">
        <input className="input grow" placeholder="🔍 Tìm hàng" value={q} onChange={(e) => setQ(e.target.value)} />
        <a className="btn" href={downloadUrl(`/export/stock.xlsx?${qs}`)} download>📤 Excel</a>
      </div>
      <Loading state={state}>
        {(r) => (
          <>
            <div className="cards">
              <Stat label="Tồn đầu kỳ" value={num(r.totals.opening)} />
              <Stat label="Nhập" value={num(r.totals.purchase)} />
              <Stat label="Bán ra" value={num(r.totals.sold)} />
              <Stat label="Tồn cuối kỳ" value={num(r.totals.closing)} sub={`Giá trị ${money(r.totals.value)}`} />
            </div>
            <div className="table-scroll">
              <table className="table stock-table">
                <thead><tr><th>Hàng hoá</th><th className="r">Đầu kỳ</th><th className="r">Nhập</th><th className="r">Bán</th><th className="r">Khách trả</th><th className="r">Trả NCC</th><th className="r">Cân bằng</th><th className="r">Cuối kỳ</th></tr></thead>
                <tbody>
                  {r.rows.length === 0 && <tr><td colSpan={8} className="empty">Không có hàng</td></tr>}
                  {r.rows.slice(0, 500).map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}<small className="muted block">{x.code} · {x.unit}</small></td>
                      <td className="r">{num(x.opening)}</td><td className="r">{cell(x.purchase)}</td><td className="r">{cell(x.sold)}</td>
                      <td className="r">{cell(x.returned)}</td><td className="r">{cell(x.supplier_return)}</td><td className="r">{cell(x.adjust)}</td>
                      <td className={`r ${x.closing < 0 ? 'neg' : ''}`}><b>{num(x.closing)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.rows.length > 500 && <p className="muted small">Màn hình hiện 500 hàng đầu, bấm Excel để xem đủ {r.rows.length} hàng.</p>}
          </>
        )}
      </Loading>
    </>
  );
}

export default function Reports() {
  const today = isoDay(new Date());
  const [range, setRange] = useState([today, today]);
  const [tab, setTab] = useState('summary');
  const state = useLoad(() => (tab === 'summary' ? get(`/reports/summary?from=${range[0]}&to=${range[1]}`) : Promise.resolve(null)), [range[0], range[1], tab]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Báo cáo</h1>
        <div className="seg">
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Tổng quan</button>
          <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>Xuất nhập tồn</button>
          <button className={tab === 'goods' ? 'on' : ''} onClick={() => setTab('goods')}>Gợi ý nhập hàng</button>
        </div>
      </div>
      {tab !== 'goods' && <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />}
      {tab === 'stock' && <StockReport range={range} />}
      {tab === 'goods' && <GoodsAdvice />}
      {tab === 'summary' && <Loading state={state}>
        {(r) => {
          const prevLabel = r.from === r.to ? 'hôm trước' : 'kỳ trước';
          return (
          <>
            <div className="cards">
              <Stat label="Doanh thu" value={money(r.revenue)} sub={<>{r.sales.count} hoá đơn<br />{change(r.revenue, r.previous.revenue, prevLabel)}</>} onClick={() => go('hoa-don')} />
              <Stat label="Lợi nhuận" value={money(r.profit)} tone={r.profit < 0 ? 'neg' : 'pos'} sub={<>{r.revenue ? `${Math.round((r.profit / r.revenue) * 100)}% doanh thu` : ''}<br />{change(r.profit, r.previous.profit, prevLabel)}</>} />
              <Stat label="Trả hàng" value={money(r.returns.total)} sub={`${r.returns.count} phiếu`} />
              <Stat label="Giảm giá HĐ" value={money(r.sales.discount)} />
              {(r.expenses > 0 || r.otherIncome > 0) && <Stat label="Chi phí (sổ quỹ)" value={money(r.expenses)} sub={r.otherIncome ? `Thu khác ${money(r.otherIncome)}` : ''} onClick={() => go('thu-chi')} />}
              {r.debtDiscount > 0 && <Stat label="Chiết khấu thu nợ" value={money(r.debtDiscount)} tone="neg" />}
              {(r.expenses > 0 || r.otherIncome > 0 || r.debtDiscount > 0) && <Stat label="Lãi sau chi phí" value={money(r.netProfit)} tone={r.netProfit < 0 ? 'neg' : 'pos'} />}
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
              {r.customerCredit > 0 && <Stat label="Tiền giữ của khách" value={money(r.customerCredit)} onClick={() => go('khach-hang')} />}
              <Stat label="Nợ nhà cung cấp" value={money(r.supplierDebt)} onClick={() => go('nhap-hang')} />
              {r.supplierCredit > 0 && <Stat label="NCC còn nợ lại mình" value={money(r.supplierCredit)} onClick={() => go('nhap-hang')} />}
              <Stat label="Giá trị tồn kho" value={money(r.stockValue)} />
              <Stat label="Hàng sắp hết" value={num(r.lowStock)} tone={r.lowStock ? 'neg' : ''} onClick={() => go('hang-hoa')} />
            </div>
            <DayBars rows={r.byDay} />
            <HourBars rows={r.byHour} />
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
            {r.topCustomers.length > 0 && (
              <div className="card">
                <h4>Khách mua nhiều</h4>
                {r.topCustomers.map((c) => (
                  <a key={c.id} className="row-between" href={`#/khach-hang/${c.id}`}>
                    <span>{c.name} <small className="muted">({c.count} HĐ{c.debt > 0 ? `, nợ ${money(c.debt)}` : ''})</small></span><b>{money(c.total)}</b>
                  </a>
                ))}
              </div>
            )}
            {r.byCategory.length > 1 && (
              <div className="card">
                <h4>Theo nhóm hàng</h4>
                {r.byCategory.map((c) => (
                  <div key={c.name} className="row-between"><span>{c.name}</span><span><b>{money(c.revenue)}</b> <small className={c.profit < 0 ? 'neg' : 'muted'}>lãi {money(c.profit)}</small></span></div>
                ))}
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
          );
        }}
      </Loading>}
    </div>
  );
}
