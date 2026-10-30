import { useEffect, useState } from 'react';
import { get, post, put, del, downloadUrl } from '../api.js';
import Ledger from '../components/Ledger.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import { money, num, vnd, dateTime, dateOnly, METHOD_NAMES } from '../format.js';
import { Field, Loading, Modal, MoneyInput, useAction, useLoad, useDebounced, confirmAsk } from '../components/ui.jsx';
import { useUser, isOwner, go, useSettings } from '../App.jsx';
import { vietQrImage, bankName, shareText } from '../vietqr.js';

// Tin nhắn nhắc nợ gửi khách qua Zalo: tổng nợ, các hoá đơn còn nợ, số tài khoản + mã QR đúng số tiền
function remindDebt(c, settings) {
  const lines = [
    `Kính gửi ${c.name},`,
    `${settings.shop_name || 'Cửa hàng'} xin thông báo số tiền còn nợ đến ngày ${new Date().toLocaleDateString('vi-VN')}: ${vnd(c.debt)}.`,
  ];
  if (c.debt_invoices.length) {
    lines.push('', 'Chi tiết:');
    for (const d of c.debt_invoices.slice(-15)) lines.push(`- ${d.code} ngày ${dateOnly(d.created_at)}: ${vnd(d.owing)}`);
  }
  let qr = null;
  if (settings.bank_bin && settings.bank_account) {
    lines.push('', `Chuyển khoản: ${bankName(settings.bank_bin)} ${settings.bank_account}${settings.bank_holder ? ` - ${settings.bank_holder}` : ''}`);
    qr = vietQrImage({ bin: settings.bank_bin, account: settings.bank_account, amount: c.debt, info: `${c.code || ''} tra no`.trim() });
  }
  if (settings.shop_phone) lines.push(`Liên hệ: ${settings.shop_phone}`);
  lines.push('', 'Xin cảm ơn quý khách!');
  return shareText(lines.join('\n'), qr);
}

function CustomerForm({ customer, priceLists, onClose, onSaved }) {
  const owner = isOwner(useUser());
  const [f, setF] = useState(customer ?? { name: '', phone: '', address: '', tax_code: '', note: '', price_list_id: '', debt_limit: 0 });
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
      {owner && (
        <Field label="Hạn mức nợ" hint="Nợ vượt số này thì nhân viên không bán ghi nợ được nữa. Để 0 là không giới hạn.">
          <MoneyInput value={f.debt_limit ?? 0} onChange={(v) => setF({ ...f, debt_limit: v })} />
        </Field>
      )}
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
  const over = amount + discount > customer.debt;
  const submit = async () => {
    if (await run(() => post(`/customers/${customer.id}/pay`, { amount, discount, method, note }), 'Đã thu nợ')) onDone();
  };
  return (
    <Modal title={`Thu nợ: ${customer.name}`} onClose={onClose}
      footer={<button className="btn btn-success btn-lg btn-block" disabled={busy || !(amount + discount) || over} onClick={submit}>Thu {vnd(amount)}</button>}>
      <div className="sumbox"><div className="row-between big"><span>Đang nợ</span><b className="neg">{money(customer.debt)}</b></div></div>
      <Field label="Số tiền thu"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
      <Field label="Chiết khấu (bớt cho khách)"><MoneyInput value={discount} onChange={setDiscount} /></Field>
      <div className="seg">
        {['cash', 'transfer'].map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_NAMES[m]}</button>)}
      </div>
      <input className="input" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      {over && <div className="warn">⚠️ Số thu + chiết khấu lớn hơn số khách đang nợ ({money(customer.debt)}).</div>}
      <div className="row-between"><span>Còn nợ sau khi thu</span><b>{money(customer.debt - amount - discount)}</b></div>
    </Modal>
  );
}

function CustomerDetail({ id, priceLists, onClose, onChanged }) {
  const owner = isOwner(useUser());
  const settings = useSettings();
  const state = useLoad(() => get(`/customers/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [tab, setTab] = useState('history');
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
              {c.debt_limit > 0 && <div className="card stat"><small>Hạn mức nợ</small><b className={c.debt > c.debt_limit ? 'neg' : ''}>{money(c.debt_limit)}</b></div>}
              <div className="card stat"><small>Nợ lâu nhất</small><b>{c.debt > 0 && c.debt_invoices.length ? `${c.max_debt_age} ngày` : '—'}</b></div>
              <div className="card stat"><small>Tổng mua</small><b>{money(c.total_bought - c.total_returned)}</b></div>
            </div>
            <div className="row gap wrap">
              {c.debt > 0 && <button className="btn btn-success grow" onClick={() => setPaying(true)}>💰 Thu nợ</button>}
              {c.debt > 0 && <button className="btn grow" onClick={() => remindDebt(c, settings)}>📤 Nhắc nợ</button>}
              <button className="btn grow" onClick={() => setEditing(true)}>✎ Sửa</button>
              {owner && <button className="btn btn-danger" onClick={async () => { if (confirmAsk('Xoá khách này?') && (await run(() => del(`/customers/${id}`), 'Đã xoá'))) { onChanged(); onClose(); } }}>Xoá</button>}
            </div>
            <div className="seg">
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Lịch sử mua</button>
              <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>📒 Sổ công nợ</button>
            </div>
            {tab === 'ledger' && <Ledger kind="customer" id={c.id} />}
            {tab === 'history' && <>
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
            </>}
            {editing && <CustomerForm customer={c} priceLists={priceLists} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
            {paying && <PayDebt customer={c} onClose={() => setPaying(false)} onDone={() => { setPaying(false); reload(); }} />}
          </>
        )}
      </Loading>
    </Modal>
  );
}

const PAGE = 300;

export default function Customers({ route }) {
  const owner = isOwner(useUser());
  const [q, setQ] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [dq, debtOnly]);
  const list = useLoad(() => get(`/customers?q=${encodeURIComponent(dq)}&debt=${debtOnly ? 1 : 0}&sort=${debtOnly ? 'debt' : ''}&limit=${limit}`), [dq, debtOnly, limit]);
  const stats = useLoad(() => get('/customers/stats'), [list.data]);
  const pls = useLoad(() => get('/price-lists'), []);
  const openId = route[1] ? Number(route[1]) : null;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Khách hàng</h1>
        <div className="row gap">
          {owner && <button className="btn" onClick={() => setImporting(true)}>📥 Nhập file</button>}
          {owner && <a className="btn" href={downloadUrl(`/export/customers.xlsx${debtOnly ? '?debt=1' : ''}`)} download title="Xuất Excel công nợ">📤 Excel</a>}
          <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Thêm khách</button>
        </div>
      </div>
      <input className="input" placeholder="🔍 Tên, số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip ${!debtOnly ? 'chip-on' : ''}`} onClick={() => setDebtOnly(false)}>Tất cả</button>
        <button className={`chip ${debtOnly ? 'chip-on' : ''}`} onClick={() => setDebtOnly(true)}>Đang nợ (nhiều nhất trước)</button>
      </div>
      <Loading state={list}>
        {(rows) => (
          <>
            {stats.data && (
              <div className="summary-line">{num(stats.data.total)} khách · {num(stats.data.owing)} khách đang nợ, tổng nợ: <b className="neg">{vnd(stats.data.debt_total)}</b></div>
            )}
            <div className="list">
              {rows.length === 0 && <div className="empty">Không có khách hàng</div>}
              {rows.map((c) => (
                <button key={c.id} className="list-item" onClick={() => go(`khach-hang/${c.id}`)}>
                  <span className="grow">
                    <b>{c.name}</b>
                    <small className="muted block">{c.phone || c.code}{c.price_list_name ? ` · ${c.price_list_name}` : ''}{c.debt > 0 && c.last_buy ? ` · mua lần cuối ${dateOnly(c.last_buy)}` : ''}</small>
                  </span>
                  {c.debt !== 0 && <b className={c.debt > 0 ? 'neg' : 'pos'}>{money(c.debt)}</b>}
                </button>
              ))}
              {rows.length >= limit && (
                <button className="btn btn-block" disabled={list.loading} onClick={() => setLimit(limit + PAGE)}>
                  {list.loading ? 'Đang tải…' : `Đang hiện ${num(rows.length)} khách · Xem thêm ${PAGE}`}
                </button>
              )}
            </div>
          </>
        )}
      </Loading>
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={list.reload} />}
      {adding && <CustomerForm priceLists={pls.data ?? []} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); list.reload(); go(`khach-hang/${id}`); }} />}
      {openId && <CustomerDetail id={openId} priceLists={pls.data ?? []} onClose={() => go('khach-hang')} onChanged={list.reload} />}
    </div>
  );
}
