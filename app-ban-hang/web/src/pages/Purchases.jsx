import { useState } from 'react';
import { get, post, put } from '../api.js';
import { money, num, vnd, dateTime, isoDay, METHOD_NAMES } from '../format.js';
import { DateRange, Field, Loading, Modal, MoneyInput, QtyInput, useAction, useLoad, useToast } from '../components/ui.jsx';
import { ProductSearch, unitOptions } from '../components/Pickers.jsx';
import { useUser, isOwner } from '../App.jsx';

function SupplierForm({ supplier, onClose, onSaved }) {
  const [f, setF] = useState(supplier ?? { name: '', phone: '', address: '' });
  const [run, busy] = useAction();
  const save = async () => {
    const r = await run(() => (supplier ? put(`/suppliers/${supplier.id}`, f) : post('/suppliers', f)), 'Đã lưu nhà cung cấp');
    if (r) onSaved(supplier ? { ...supplier, ...f } : r);
  };
  return (
    <Modal title={supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={onClose}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={save}>Lưu</button>}>
      <Field label="Tên nhà cung cấp"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Số điện thoại"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Địa chỉ"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
    </Modal>
  );
}

const lineNet = (l) => Math.round((l.cost * (100 - (l.ck || 0))) / 100);

// Phiếu nhập hàng hoặc phiếu trả hàng cho NCC (mode = 'return')
function StockForm({ mode, suppliers, onClose, onSaved, reloadSuppliers }) {
  const isReturn = mode === 'return';
  const [lines, setLines] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [paid, setPaid] = useState(null);
  const [method, setMethod] = useState(isReturn ? 'debt' : 'cash');
  const [note, setNote] = useState('');
  const [addSup, setAddSup] = useState(false);
  const [run, busy] = useAction();
  const toast = useToast();
  const total = lines.reduce((s, l) => s + Math.round(l.qty * lineNet(l)), 0);

  const add = (p, unitId) => {
    const opts = unitOptions(p, true);
    const o = opts.find((x) => x.unit_id === (unitId ?? null)) ?? opts[0];
    const baseCost = p.last_cost || p.cost || 0;
    setLines((ls) => {
      const found = ls.find((l) => l.product_id === p.id && l.unit_id === o.unit_id);
      if (found) return ls.map((l) => (l === found ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: Math.random(), product_id: p.id, name: p.name, price: p.price, baseCost, opts, unit_id: o.unit_id, unit: o.name, factor: o.factor, qty: 1, cost: Math.round(baseCost * o.factor), ck: 0 }];
    });
  };
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    const items = lines.map((l) => ({ product_id: l.product_id, unit_id: l.unit_id, qty: l.qty, cost: lineNet(l) }));
    const body = isReturn
      ? { supplier_id: supplierId || null, items, refund_method: method, note }
      : { supplier_id: supplierId || null, items, paid: paid ?? total, method, note };
    const r = await run(() => post(isReturn ? '/supplier-returns' : '/purchases', body), isReturn ? 'Đã trả hàng cho NCC' : 'Đã nhập hàng');
    if (r) {
      for (const w of r.warnings ?? []) toast(`⚠️ ${w}`, 'error');
      onSaved();
    }
  };

  return (
    <Modal title={isReturn ? 'Trả hàng cho nhà cung cấp' : 'Phiếu nhập hàng'} onClose={onClose} wide
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy || !lines.length} onClick={save}>
        {isReturn ? `Trả hàng · ${vnd(total)}` : `Hoàn tất nhập · ${vnd(total)}`}
      </button>}>
      <Field label="Nhà cung cấp">
        <div className="row">
          <select className="input grow" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">-- Chọn nhà cung cấp --</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.debt ? ` (nợ ${money(s.debt)})` : ''}</option>)}
          </select>
          <button className="btn" onClick={() => setAddSup(true)}>+</button>
        </div>
      </Field>
      <ProductSearch onPick={add} showCost continuousScan />
      <div className="list">
        {lines.length === 0 && <div className="empty">Tìm hoặc quét hàng để thêm vào phiếu</div>}
        {lines.map((l) => {
          const net = lineNet(l);
          return (
            <div key={l.key} className="stock-line">
              <div className="row-between">
                <b>{l.name}</b>
                <button className="btn-icon" onClick={() => setLines(lines.filter((x) => x !== l))}>✕</button>
              </div>
              <div className="grid4">
                <Field label="ĐVT">
                  <select className="input" value={String(l.unit_id)} onChange={(e) => {
                    const o = l.opts.find((x) => String(x.unit_id) === e.target.value);
                    setLine(l.key, { unit_id: o.unit_id, unit: o.name, factor: o.factor, cost: Math.round(l.baseCost * o.factor) });
                  }}>
                    {l.opts.map((o) => <option key={String(o.unit_id)} value={String(o.unit_id)}>{o.name}</option>)}
                  </select>
                </Field>
                <Field label="Số lượng"><QtyInput value={l.qty} onChange={(qty) => setLine(l.key, { qty })} /></Field>
                <Field label={isReturn ? 'Giá trả' : 'Giá nhập'}><MoneyInput value={l.cost} onChange={(cost) => setLine(l.key, { cost })} /></Field>
                {!isReturn && <Field label="CK %"><QtyInput value={l.ck} onChange={(ck) => setLine(l.key, { ck: Math.min(ck, 100) })} /></Field>}
              </div>
              <div className="row-between">
                <small className="muted">{l.ck ? `Giá sau CK: ${money(net)}` : ''}</small>
                <span>Thành tiền: <b>{money(Math.round(l.qty * net))}</b></span>
              </div>
              {!isReturn && l.price * l.factor < net && <div className="warn">⚠️ Giá bán ({money(l.price * l.factor)}) đang thấp hơn giá nhập</div>}
            </div>
          );
        })}
      </div>
      <div className="sumbox">
        <div className="row-between total"><span>Tổng tiền</span><b>{money(total)}</b></div>
        {isReturn ? (
          <div className="seg">
            {[['debt', 'Trừ vào nợ NCC'], ['cash', 'Nhận tiền mặt'], ['transfer', 'Nhận chuyển khoản']].map(([k, label]) => (
              <button key={k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{label}</button>
            ))}
          </div>
        ) : (
          <>
            <Field label="Đã trả NCC"><MoneyInput value={paid ?? total} onChange={setPaid} /></Field>
            <div className="seg">
              {['cash', 'transfer'].map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_NAMES[m]}</button>)}
            </div>
            {(paid ?? total) < total && <div className="row-between neg"><span>Còn nợ NCC</span><b>{money(total - (paid ?? total))}</b></div>}
          </>
        )}
      </div>
      <input className="input" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      {addSup && <SupplierForm onClose={() => setAddSup(false)} onSaved={(s) => { setAddSup(false); reloadSuppliers(); setSupplierId(String(s.id)); }} />}
    </Modal>
  );
}

function PurchaseDetail({ id, onClose }) {
  const state = useLoad(() => get(`/purchases/${id}`), [id]);
  return (
    <Modal title="Phiếu nhập" onClose={onClose} wide>
      <Loading state={state}>
        {(p) => (
          <>
            <h3>{p.code}</h3>
            <div className="muted">{dateTime(p.created_at)} · {p.supplier_name ?? 'Không có NCC'}</div>
            <table className="table">
              <thead><tr><th>Hàng hoá</th><th className="r">SL</th><th className="r">Giá nhập</th><th className="r">Thành tiền</th></tr></thead>
              <tbody>
                {p.items.map((it) => (
                  <tr key={it.id}><td>{it.name} - <b>{it.unit}</b></td><td className="r">{num(it.qty)}</td><td className="r">{money(it.cost)}</td><td className="r">{money(it.total)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="sumbox">
              <div className="row-between total"><span>Tổng</span><b>{money(p.total)}</b></div>
              <div className="row-between"><span>Đã trả</span><span>{money(p.paid)}</span></div>
              {p.total > p.paid && <div className="row-between neg"><span>Còn nợ</span><b>{money(p.total - p.paid)}</b></div>}
              {p.note && <div className="muted">Ghi chú: {p.note}</div>}
            </div>
          </>
        )}
      </Loading>
    </Modal>
  );
}

function PaySupplier({ supplier, onClose, onDone }) {
  const [amount, setAmount] = useState(Math.max(supplier.debt, 0));
  const [method, setMethod] = useState('cash');
  const [run, busy] = useAction();
  return (
    <Modal title={`Trả nợ: ${supplier.name}`} onClose={onClose}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy || !amount}
        onClick={async () => (await run(() => post(`/suppliers/${supplier.id}/pay`, { amount, method }), 'Đã trả nợ')) && onDone()}>Trả {vnd(amount)}</button>}>
      <div className="row-between big"><span>Đang nợ NCC</span><b className="neg">{money(supplier.debt)}</b></div>
      <Field label="Số tiền trả"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
      <div className="seg">
        {['cash', 'transfer'].map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_NAMES[m]}</button>)}
      </div>
    </Modal>
  );
}

export default function Purchases() {
  const owner = isOwner(useUser());
  const today = isoDay(new Date());
  const [tab, setTab] = useState('purchases');
  const [range, setRange] = useState([today, today]);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editSup, setEditSup] = useState(null);
  const [paySup, setPaySup] = useState(null);
  const suppliers = useLoad(() => get('/suppliers'), []);
  const purchases = useLoad(() => get(`/purchases?from=${range[0]}&to=${range[1]}`), [range[0], range[1]]);
  const sreturns = useLoad(() => get(`/supplier-returns?from=${range[0]}&to=${range[1]}`), [range[0], range[1]]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Nhập hàng</h1>
        <div className="row gap wrap">
          <button className="btn" onClick={() => setForm('return')}>↩️ Trả NCC</button>
          <button className="btn btn-primary" onClick={() => setForm('purchase')}>+ Nhập hàng</button>
        </div>
      </div>
      <div className="seg">
        <button className={tab === 'purchases' ? 'on' : ''} onClick={() => setTab('purchases')}>Phiếu nhập</button>
        <button className={tab === 'returns' ? 'on' : ''} onClick={() => setTab('returns')}>Trả NCC</button>
        <button className={tab === 'suppliers' ? 'on' : ''} onClick={() => setTab('suppliers')}>Nhà cung cấp</button>
      </div>
      {tab !== 'suppliers' && <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />}
      {tab === 'purchases' && (
        <Loading state={purchases}>
          {(rows) => (
            <div className="list">
              {rows.length === 0 && <div className="empty">Chưa có phiếu nhập</div>}
              {rows.map((p) => (
                <button key={p.id} className="list-item" onClick={() => setDetail(p.id)}>
                  <span className="grow"><b>{p.code}</b><small className="muted block">{dateTime(p.created_at)} · {p.supplier_name ?? 'Không có NCC'}</small></span>
                  <span className="r"><b>{money(p.total)}</b>{p.total > p.paid && <small className="neg block">Nợ {money(p.total - p.paid)}</small>}</span>
                </button>
              ))}
            </div>
          )}
        </Loading>
      )}
      {tab === 'returns' && (
        <Loading state={sreturns}>
          {(rows) => (
            <div className="list">
              {rows.length === 0 && <div className="empty">Chưa có phiếu trả NCC</div>}
              {rows.map((r) => (
                <div key={r.id} className="list-item">
                  <span className="grow"><b>{r.code}</b><small className="muted block">{dateTime(r.created_at)} · {r.supplier_name}</small></span>
                  <b>{money(r.total)}</b>
                </div>
              ))}
            </div>
          )}
        </Loading>
      )}
      {tab === 'suppliers' && (
        <>
          <button className="btn" onClick={() => setEditSup({})}>+ Thêm nhà cung cấp</button>
          <Loading state={suppliers}>
            {(rows) => (
              <div className="list">
                {rows.map((s) => (
                  <div key={s.id} className="list-item">
                    <button className="grow text-left" onClick={() => owner && setEditSup(s)}>
                      <b>{s.name}</b><small className="muted block">{s.phone} {s.address}</small>
                    </button>
                    {s.debt !== 0 && <b className="neg">{money(s.debt)}</b>}
                    {owner && s.debt > 0 && <button className="btn btn-sm" onClick={() => setPaySup(s)}>Trả nợ</button>}
                  </div>
                ))}
              </div>
            )}
          </Loading>
        </>
      )}
      {form && (
        <StockForm mode={form} suppliers={suppliers.data ?? []} reloadSuppliers={suppliers.reload} onClose={() => setForm(null)}
          onSaved={() => { setForm(null); purchases.reload(); sreturns.reload(); suppliers.reload(); }} />
      )}
      {detail && <PurchaseDetail id={detail} onClose={() => setDetail(null)} />}
      {editSup && <SupplierForm supplier={editSup.id ? editSup : null} onClose={() => setEditSup(null)} onSaved={() => { setEditSup(null); suppliers.reload(); }} />}
      {paySup && <PaySupplier supplier={paySup} onClose={() => setPaySup(null)} onDone={() => { setPaySup(null); suppliers.reload(); }} />}
    </div>
  );
}
