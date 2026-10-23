import { useEffect, useRef, useState } from 'react';
import { get, post, imageUrl } from '../api.js';
import { money, num, vnd } from '../format.js';
import { Field, Modal, useAction, useDebounced, useToast } from './ui.jsx';
import Scanner from './Scanner.jsx';

// Ô tìm hàng: gõ tên/mã, quét bằng camera, hoặc máy quét mã vạch (gõ mã + Enter).
export function ProductSearch({ priceListId, onPick, showCost = false, autoFocus = true, continuousScan = true }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(false);
  const dq = useDebounced(q, 200);
  const toast = useToast();
  const inputRef = useRef(null);

  useEffect(() => {
    if (!dq.trim()) {
      setResults([]);
      return;
    }
    let alive = true;
    get(`/products?q=${encodeURIComponent(dq)}&limit=40${priceListId ? `&price_list=${priceListId}` : ''}`)
      .then((rows) => alive && setResults(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [dq, priceListId]);

  const pick = (p, unitId) => {
    onPick(p, unitId ?? null);
    setQ('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const byCode = async (code) => {
    try {
      const p = await get(`/products/lookup?code=${encodeURIComponent(code)}${priceListId ? `&price_list=${priceListId}` : ''}`);
      onPick(p, p.unit_id);
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  };

  const onKey = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = q.trim();
    if (!code) return;
    const exact = results.find((p) => p.barcode === code || p.code === code.toUpperCase());
    if (exact) return pick(exact);
    if (results.length === 1) return pick(results[0]);
    if (await byCode(code)) {
      setQ('');
      setResults([]);
    }
  };

  return (
    <div className="psearch">
      <div className="row gap">
        <input
          ref={inputRef}
          className="input grow"
          placeholder="🔍 Tìm hàng: tên, mã hoặc quét mã vạch"
          value={q}
          autoFocus={autoFocus && window.innerWidth > 800}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        <button className="btn btn-scan" onClick={() => setScan(true)} title="Quét mã vạch">📷</button>
      </div>
      {open && results.length > 0 && (
        <div className="psearch-results">
          {results.map((p) => (
            <div key={p.id} className="psearch-item">
              <button className="psearch-main" onClick={() => pick(p)}>
                {p.image ? <img src={imageUrl(p.image)} alt="" /> : <span className="thumb">📦</span>}
                <span className="grow">
                  {p.is_combo ? <span className="badge badge-blue">Combo</span> : null} <b>{p.name}</b> - <b className="unit">{p.unit}</b>
                  <small className="muted block">
                    {p.code} · {p.is_combo ? 'Ráp được' : 'Tồn'}: <span className={p.stock <= 0 && (p.track_stock || p.is_combo) ? 'neg' : ''}>{num(p.stock)}</span>
                    {showCost && p.cost !== undefined && ` · Vốn: ${money(p.cost)}`}
                  </small>
                </span>
                <b className="price">{money(showCost ? p.last_cost || p.cost : p.sell_price)}</b>
              </button>
              {p.units.filter((u) => showCost || u.direct_sale).map((u) => (
                <button key={u.id} className="psearch-unit" onClick={() => pick(p, u.id)}>
                  + {u.name} <small>({num(u.factor)} {p.unit})</small> <b>{money(showCost ? (p.last_cost || p.cost) * u.factor : u.sell_price)}</b>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {scan && <Scanner continuous={continuousScan} onCode={byCode} onClose={() => setScan(false)} />}
    </div>
  );
}

// Chọn khách hàng, hoặc thêm khách mới ngay tại chỗ.
export function CustomerPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', address: '' });
  const dq = useDebounced(q);
  const [run, busy] = useAction();
  useEffect(() => {
    get(`/customers?q=${encodeURIComponent(dq)}`).then(setRows).catch(() => {});
  }, [dq]);
  const save = async () => {
    const c = await run(() => post('/customers', f), 'Đã thêm khách');
    if (c) onPick(c);
  };
  return (
    <Modal title={adding ? 'Thêm khách mới' : 'Chọn khách hàng'} onClose={onClose}>
      {adding ? (
        <>
          <Field label="Tên khách"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Số điện thoại"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Địa chỉ"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <div className="row gap">
            <button className="btn grow" onClick={() => setAdding(false)}>Quay lại</button>
            <button className="btn btn-primary grow" disabled={busy} onClick={save}>Lưu và chọn</button>
          </div>
        </>
      ) : (
        <>
          <div className="row gap">
            <input className="input grow" autoFocus placeholder="Tên hoặc số điện thoại" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Thêm</button>
          </div>
          <div className="list">
            <button className="list-item" onClick={() => onPick(null)}>
              <span className="grow"><b>Khách lẻ</b></span>
            </button>
            {rows.map((c) => (
              <button key={c.id} className="list-item" onClick={() => onPick(c)}>
                <span className="grow">
                  <b>{c.name}</b>
                  <small className="muted block">{c.phone}{c.price_list_name ? ` · ${c.price_list_name}` : ''}</small>
                </span>
                {c.debt !== 0 && <span className={c.debt > 0 ? 'neg' : 'pos'}>Nợ {vnd(c.debt)}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// Danh sách đơn vị bán của một hàng: đơn vị gốc + đơn vị quy đổi
export function unitOptions(p, forPurchase = false) {
  return [
    { unit_id: null, name: p.unit, factor: 1, price: p.sell_price ?? p.price },
    ...(p.units ?? []).filter((u) => forPurchase || u.direct_sale).map((u) => ({ unit_id: u.id, name: u.name, factor: u.factor, price: u.sell_price ?? u.price })),
  ];
}
