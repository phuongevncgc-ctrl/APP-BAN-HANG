import { useState } from 'react';
import { get, post, put, del } from '../api.js';
import { money, vnd, dateTime, dateOnly, METHOD_NAMES } from '../format.js';
import { Field, Loading, Modal, MoneyInput, useAction, useLoad, useDebounced, confirmAsk } from '../components/ui.jsx';
import { useUser, isOwner, go } from '../App.jsx';

function CustomerForm({ customer, priceLists, onClose, onSaved }) {
  const [f, setF] = useState(customer ?? { name: '', phone: '', address: '', tax_code: '', note: '', price_list_id: '' });
  const [run, busy] = useAction();
  const save = async () => {
    const body = { ...f, price_list_id: f.price_list_id || null };
    const r = await run(() => (customer ? put(`/customers/${customer.id}`, body) : post('/customers', body)), 'Đã lưu khách hàng');
    if (r) onSaved(customer?.id ?? r.id);
  };
  return (
    <Modal title={customer ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={onClose}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={save}>Lưu</button>}>
      <Field label="Tên khách"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="Số điện thoại"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Mã số thuế"><input className="input" value={f.tax_code ?? ''} onChange={(e) => setF({ ...f, tax_code: e.target.value })} /></Field>
      </div>
      <Field label="Địa chỉ"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Bảng giá" hint="Khi bán cho khách này sẽ tự lấy giá theo bảng giá">
        <select className="input" value={f.price_list_id ?? ''} onChange={(e) => setF({ ...f, price_list_id: e.target.value })}>
          <option value="">Giá bán lẻ</option>
          {priceLists.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
        </select>
      </Field>
      <Field label="Ghi chú"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}

function PayDebt({ customer, onClose, onDone }) {
  const [amount, setAmount] = useState(Math.max(customer.debt, 0));
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const submit = async () => {
    if (await run(() => post(`/customers/${customer.id}/pay`, { amount, discount, method, note }), 'Đã thu nợ')) onDone();
  };
  return (
    <Modal title={`Thu nợ: ${customer.name}`} onClose={onClose}
      footer={<button className="btn btn-success btn-lg btn-block" disabled={busy || !(amount + discount)} onClick={submit}>Thu {vnd(amount)}</button>}>
      <div className="sumbox"><div className="row-between big"><span>Đang nợ</span><b className="neg">{money(customer.debt)}</b></div></div>
      <Field label="Số tiền thu"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
      <Field label="Chiết khấu (bớt cho khách)"><MoneyInput value={discount} onChange={setDiscount} /></Field>
      <div className="seg">
        {['cash', 'transfer'].map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_NAMES[m]}</button>)}
      </div>
      <input className="input" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row-between"><span>Còn nợ sau khi thu</span><b>{money(customer.debt - amount - discount)}</b></div>
    </Modal>
  );
}

function CustomerDetail({ id, priceLists, onClose, onChanged }) {
  const owner = isOwner(useUser());
  const state = useLoad(() => get(`/customers/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [run] = useAction();
  const reload = () => {
    state.reload();
    onChanged();
  };
  return (
    <Modal title="Khách hàng" onClose={onClose} wide>
      <Loading state={state}>
        {(c) => (
          <>
            <h3>{c.name}</h3>
            <div className="muted">{c.code}{c.phone && ` · ☎ ${c.phone}`}{c.address && ` · ${c.address}`}{c.tax_code && ` · MST ${c.tax_code}`}</div>
            {c.price_list_name && <div>Bảng giá: <b>{c.price_list_name}</b></div>}
            <div className="cards">
              <div className="card stat"><small>Đang nợ</small><b className={c.debt > 0 ? 'neg' : ''}>{money(c.debt)}</b></div>
              <div className="card stat"><small>Nợ lâu nhất</small><b>{c.debt > 0 ? `${c.max_debt_age} ngày` : '—'}</b></div>
              <div className="card stat"><small>Tổng mua</small><b>{money(c.total_bought - c.total_returned)}</b></div>
            </div>
            <div className="row gap wrap">
              {c.debt > 0 && <button className="btn btn-success grow" onClick={() => setPaying(true)}>💰 Thu nợ</button>}
              <button className="btn grow" onClick={() => setEditing(true)}>✎ Sửa</button>
              {owner && <button className="btn btn-danger" onClick={async () => { if (confirmAsk('Xoá khách này?') && (await run(() => del(`/customers/${id}`), 'Đã xoá'))) { onChanged(); onClose(); } }}>Xoá</button>}
            </div>
            {c.debt_invoices.length > 0 && (
              <>
                <h4>Hoá đơn còn nợ</h4>
                <div className="list">
                  {c.debt_invoices.map((d) => (
                    <a key={d.id} className="list-item" href={`#/hoa-don/${d.id}`}>
                      <span className="grow"><b>{d.code}</b><small className="muted block">{dateOnly(d.created_at)} · {d.age_days} ngày</small></span>
                      <b className="neg">{money(d.owing)}</b>
                    </a>
                  ))}
                </div>
              </>
            )}
            <h4>Lịch sử mua hàng</h4>
            <div className="list">
              {c.invoices.length === 0 && <div className="empty">Chưa mua lần nào</div>}
              {c.invoices.map((inv) => (
                <a key={inv.id} className={`list-item ${inv.status === 'cancelled' ? 'faded' : ''}`} href={`#/hoa-don/${inv.id}`}>
                  <span className="grow"><b>{inv.code}</b><small className="muted block">{dateTime(inv.created_at)}</small></span>
                  <span className="r"><b>{money(inv.total)}</b>{inv.debt > 0 && <small className="neg block">Nợ {money(inv.debt)}</small>}</span>
                </a>
              ))}
            </div>
            {c.debt_payments.length > 0 && (
              <>
                <h4>Lịch sử trả nợ</h4>
                <div className="list">
                  {c.debt_payments.map((p, i) => (
                    <div key={i} className="list-item">
                      <span className="grow">{dateTime(p.created_at)} · {METHOD_NAMES[p.method]}{p.note && ` · ${p.note}`}</span>
                      <span className="r"><b className="pos">{money(p.amount)}</b>{p.discount > 0 && <small className="muted block">CK {money(p.discount)}</small>}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {editing && <CustomerForm customer={c} priceLists={priceLists} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
            {paying && <PayDebt customer={c} onClose={() => setPaying(false)} onDone={() => { setPaying(false); reload(); }} />}
          </>
        )}
      </Loading>
    </Modal>
  );
}

export default function Customers({ route }) {
  const [q, setQ] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const list = useLoad(() => get(`/customers?q=${encodeURIComponent(dq)}&debt=${debtOnly ? 1 : 0}`), [dq, debtOnly]);
  const pls = useLoad(() => get('/price-lists'), []);
  const openId = route[1] ? Number(route[1]) : null;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Khách hàng</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Thêm khách</button>
      </div>
      <input className="input" placeholder="🔍 Tên, số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip ${!debtOnly ? 'chip-on' : ''}`} onClick={() => setDebtOnly(false)}>Tất cả</button>
        <button className={`chip ${debtOnly ? 'chip-on' : ''}`} onClick={() => setDebtOnly(true)}>Đang nợ</button>
      </div>
      <Loading state={list}>
        {(rows) => (
          <>
            {debtOnly && <div className="summary-line">Tổng khách nợ: <b className="neg">{vnd(rows.reduce((s, c) => s + Math.max(c.debt, 0), 0))}</b></div>}
            <div className="list">
              {rows.length === 0 && <div className="empty">Không có khách hàng</div>}
              {rows.map((c) => (
                <button key={c.id} className="list-item" onClick={() => go(`khach-hang/${c.id}`)}>
                  <span className="grow">
                    <b>{c.name}</b>
                    <small className="muted block">{c.phone || c.code}{c.price_list_name ? ` · ${c.price_list_name}` : ''}</small>
                  </span>
                  {c.debt !== 0 && <b className={c.debt > 0 ? 'neg' : 'pos'}>{money(c.debt)}</b>}
                </button>
              ))}
            </div>
          </>
        )}
      </Loading>
      {adding && <CustomerForm priceLists={pls.data ?? []} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); list.reload(); go(`khach-hang/${id}`); }} />}
      {openId && <CustomerDetail id={openId} priceLists={pls.data ?? []} onClose={() => go('khach-hang')} onChanged={list.reload} />}
    </div>
  );
}
