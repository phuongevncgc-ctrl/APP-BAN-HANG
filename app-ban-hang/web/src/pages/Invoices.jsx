import { useEffect, useState } from 'react';
import { get, post, downloadUrl } from '../api.js';
import { money, num, vnd, dateTime, isoDay, METHOD_NAMES } from '../format.js';
import { DateRange, Loading, Modal, QtyInput, useAction, useLoad, useDebounced, confirmAsk, useToast } from '../components/ui.jsx';
import { ReceiptActions } from '../components/Receipt.jsx';
import { useUser, isOwner, go } from '../App.jsx';

function ReturnForm({ inv, onClose, onDone }) {
  const toast = useToast();
  const [qty, setQty] = useState({});
  // Khách còn nợ thì mặc định trừ vào nợ, tránh trả tiền mặt cho hàng khách chưa trả tiền
  const owes = inv.customer_id && inv.customer_debt > 0;
  const [method, setMethod] = useState(owes ? 'debt' : 'cash');
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const ratio = inv.subtotal > 0 ? inv.total / inv.subtotal : 1;
  const left = (it) => Math.round((it.qty - it.returned_qty) * 1000) / 1000;
  // Cách tính giống máy chủ: đơn giá sau giảm (đã chia giảm giá hoá đơn) làm tròn rồi nhân số lượng
  const estimate = inv.items.reduce((s, it) => s + Math.round((qty[it.id] || 0) * Math.round((it.price - it.discount) * ratio)), 0);
  const submit = async () => {
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ invoice_item_id: Number(id), qty: q }));
    const r = await run(() => post('/returns', { invoice_id: inv.id, items, refund_method: method, note }));
    if (r) toast(`Đã trả hàng ${r.code} · ${method === 'debt' ? 'Trừ nợ' : 'Hoàn'} ${vnd(r.total)}`);
    if (r) onDone(r);
  };
  return (
    <Modal title={`Trả hàng - ${inv.code}`} onClose={onClose}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy || !estimate} onClick={submit}>Trả hàng · Hoàn {vnd(estimate)}</button>}>
      <div className="list">
        {inv.items.map((it) => (
          <div key={it.id} className="list-item">
            <span className="grow">
              <b>{it.name}</b> - <b className="unit">{it.unit}</b>
              <small className="muted block">Đã mua {num(it.qty)}{it.returned_qty ? `, đã trả ${num(it.returned_qty)}` : ''} · {money(it.price - it.discount)}</small>
            </span>
            {left(it) > 0 ? (
              <div className="row gap">
                <QtyInput className="qty-input" value={qty[it.id] ?? 0} onChange={(v) => setQty({ ...qty, [it.id]: Math.min(v, left(it)) })} />
                <button className="btn btn-sm" onClick={() => setQty({ ...qty, [it.id]: left(it) })}>Hết</button>
              </div>
            ) : <span className="muted">Đã trả hết</span>}
          </div>
        ))}
      </div>
      <div className="seg">
        {[['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ...(inv.customer_id ? [['debt', 'Trừ vào nợ']] : [])].map(([k, l]) => (
          <button key={k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{l}</button>
        ))}
      </div>
      {owes && method !== 'debt' && <div className="warn">⚠️ Khách đang nợ {money(inv.customer_debt)}. Thường nên chọn "Trừ vào nợ".</div>}
      {method === 'debt' && estimate > (inv.customer_debt ?? 0) && <div className="muted small">Số trả lớn hơn số nợ: phần dư thành tiền cửa hàng còn giữ của khách (nợ âm), lần sau khách mua chọn "Ghi nợ" là tự trừ.</div>}
      <input className="input" placeholder="Lý do trả (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

export function InvoiceDetail({ id, onClose, onChanged }) {
  const user = useUser();
  const state = useLoad(() => get(`/invoices/${id}`), [id]);
  const [returning, setReturning] = useState(false);
  const [run, busy] = useAction();
  const cancel = async () => {
    if (!confirmAsk('Huỷ hoá đơn này? Hàng sẽ được cộng lại vào kho.')) return;
    if (await run(() => post(`/invoices/${id}/cancel`), 'Đã huỷ hoá đơn')) {
      state.reload();
      onChanged?.();
    }
  };
  return (
    <Modal title="Chi tiết hoá đơn" onClose={onClose} wide>
      <Loading state={state}>
        {(inv) => (
          <>
            <div className="row-between">
              <div>
                <h3>{inv.code} {inv.status === 'cancelled' && <span className="badge badge-red">Đã huỷ</span>}</h3>
                <div className="muted">{dateTime(inv.created_at)} · {inv.user_name}</div>
                <div>Khách: {inv.customer_id ? <a href={`#/khach-hang/${inv.customer_id}`} onClick={onClose}>{inv.customer_name}</a> : 'Khách lẻ'}</div>
                {inv.price_list_name && <div className="muted">Bảng giá: {inv.price_list_name}</div>}
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Hàng hoá</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Giảm</th><th className="r">Thành tiền</th></tr></thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name} - <b>{it.unit}</b>{it.returned_qty > 0 && <small className="neg block">Đã trả {num(it.returned_qty)}</small>}</td>
                    <td className="r">{num(it.qty)}</td>
                    <td className="r">{money(it.price)}</td>
                    <td className="r">{it.discount ? money(it.discount) : ''}</td>
                    <td className="r">{money(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sumbox">
              <div className="row-between"><span>Tổng tiền hàng</span><span>{money(inv.subtotal)}</span></div>
              {inv.discount > 0 && <div className="row-between"><span>Giảm giá HĐ</span><span>-{money(inv.discount)}</span></div>}
              <div className="row-between total"><span>Khách cần trả</span><b>{money(inv.total)}</b></div>
              {inv.payments.map((p, i) => (
                <div key={i} className="row-between muted"><span>{METHOD_NAMES[p.method]} {p.note && `(${p.note})`}</span><span>{money(p.amount)}</span></div>
              ))}
              {inv.change_amount > 0 && <div className="row-between muted"><span>Tiền thối</span><span>{money(inv.change_amount)}</span></div>}
              {inv.debt > 0 && <div className="row-between neg"><span>Ghi nợ</span><b>{money(inv.debt)}</b></div>}
              {inv.note && <div className="muted">Ghi chú: {inv.note}</div>}
            </div>
            {inv.returns.length > 0 && (
              <div className="sumbox">
                <b>Phiếu trả hàng</b>
                {inv.returns.map((r) => <div key={r.id} className="row-between"><span>{r.code} · {dateTime(r.created_at)}</span><span>{money(r.total)}</span></div>)}
              </div>
            )}
            <ReceiptActions inv={inv} />
            {inv.status === 'done' && (
              <div className="row gap mt">
                <button className="btn grow" onClick={() => setReturning(true)}>↩️ Trả hàng</button>
                {isOwner(user) && inv.returns.length === 0 && <button className="btn btn-danger" disabled={busy} onClick={cancel}>Huỷ hoá đơn</button>}
              </div>
            )}
            {returning && (
              <ReturnForm inv={inv} onClose={() => setReturning(false)} onDone={() => { setReturning(false); state.reload(); onChanged?.(); }} />
            )}
          </>
        )}
      </Loading>
    </Modal>
  );
}

export default function Invoices({ route }) {
  const user = useUser();
  const today = isoDay(new Date());
  const [tab, setTab] = useState('invoices');
  const [range, setRange] = useState([today, today]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const openId = route[1] ? Number(route[1]) : null;
  const [limit, setLimit] = useState(500);
  useEffect(() => setLimit(500), [range[0], range[1], dq]);
  const filter = `from=${range[0]}&to=${range[1]}&q=${encodeURIComponent(dq)}`;
  const invoices = useLoad(() => get(`/invoices?${filter}&limit=${limit}`), [filter, limit]);
  const summary = useLoad(() => get(`/invoices/summary?${filter}`), [filter, invoices.data]);
  const returns = useLoad(() => (tab === 'returns' ? get(`/returns?from=${range[0]}&to=${range[1]}`) : Promise.resolve([])), [tab, range[0], range[1]]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Hoá đơn</h1>
        <div className="seg">
          <button className={tab === 'invoices' ? 'on' : ''} onClick={() => setTab('invoices')}>Hoá đơn</button>
          <button className={tab === 'returns' ? 'on' : ''} onClick={() => setTab('returns')}>Trả hàng</button>
        </div>
      </div>
      <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
      {tab === 'invoices' ? (
        <>
          <div className="row gap">
            <input className="input grow" placeholder="🔍 Mã hoá đơn, tên hoặc SĐT khách" value={q} onChange={(e) => setQ(e.target.value)} />
            {isOwner(user) && <a className="btn" href={downloadUrl(`/export/invoices.xlsx?from=${range[0]}&to=${range[1]}`)} download>📤 Excel</a>}
          </div>
          <Loading state={invoices}>
            {(rows) => (
              <>
                {summary.data && (
                  <div className="summary-line">{num(summary.data.done)} hoá đơn · Tổng {vnd(summary.data.net)}</div>
                )}
                <div className="list">
                  {rows.length === 0 && <div className="empty">Không có hoá đơn</div>}
                  {rows.map((r) => (
                    <button key={r.id} className={`list-item ${r.status === 'cancelled' ? 'faded' : ''}`} onClick={() => go(`hoa-don/${r.id}`)}>
                      <span className="grow">
                        <b>{r.code}</b> {r.status === 'cancelled' && <span className="badge badge-red">Huỷ</span>}
                        {r.returned > 0 && <span className="badge">Có trả hàng</span>}
                        <small className="muted block">{dateTime(r.created_at)} · {r.customer_name ?? 'Khách lẻ'}</small>
                      </span>
                      <span className="r">
                        <b>{money(r.total)}</b>
                        {r.debt > 0 && <small className="neg block">Nợ {money(r.debt)}</small>}
                      </span>
                    </button>
                  ))}
                  {rows.length >= limit && (
                    <button className="btn btn-block" disabled={invoices.loading} onClick={() => setLimit(limit + 500)}>
                      {invoices.loading ? 'Đang tải…' : `Đang hiện ${num(rows.length)} hoá đơn · Xem thêm 500`}
                    </button>
                  )}
                </div>
              </>
            )}
          </Loading>
        </>
      ) : (
        <Loading state={returns}>
          {(rows) => (
            <div className="list">
              {rows.length === 0 && <div className="empty">Không có phiếu trả hàng</div>}
              {rows.map((r) => (
                <button key={r.id} className="list-item" onClick={() => r.invoice_id && go(`hoa-don/${r.invoice_id}`)}>
                  <span className="grow">
                    <b>{r.code}</b> <small className="muted">← {r.invoice_code}</small>
                    <small className="muted block">{dateTime(r.created_at)} · {r.customer_name ?? 'Khách lẻ'}</small>
                  </span>
                  <b>{money(r.total)}</b>
                </button>
              ))}
            </div>
          )}
        </Loading>
      )}
      {openId && <InvoiceDetail id={openId} onClose={() => go('hoa-don')} onChanged={() => { invoices.reload(); returns.reload(); }} />}
    </div>
  );
}
