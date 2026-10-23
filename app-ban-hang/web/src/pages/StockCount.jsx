import { useState } from 'react';
import { get, post } from '../api.js';
import { money, num, dateTime } from '../format.js';
import { Field, Loading, Modal, QtyInput, useAction, useLoad, useToast } from '../components/ui.jsx';
import { ProductSearch } from '../components/Pickers.jsx';

// Phiếu kiểm kho: quét / tìm từng món, nhập số đếm thực tế, lưu là cân lại tồn kho.
function CountForm({ onClose, onSaved }) {
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const toast = useToast();
  const add = (p, unitId) => {
    if (p.is_combo || !p.track_stock) return toast(`"${p.name}" không theo dõi tồn kho`, 'error');
    const factor = unitId ? p.units.find((u) => u.id === unitId)?.factor ?? 1 : 1;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id);
      // Quét lại cùng món: cộng dồn số đếm
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, actual_qty: l.actual_qty + factor } : l));
      return [{ product_id: p.id, name: p.name, code: p.code, unit: p.unit, cost: p.cost ?? 0, system_qty: p.stock, actual_qty: factor }, ...ls];
    });
  };
  const set = (i, actual_qty) => setLines(lines.map((l, j) => (j === i ? { ...l, actual_qty } : l)));
  const diffValue = lines.reduce((s, l) => s + (l.actual_qty - l.system_qty) * l.cost, 0);
  const save = async () => {
    const r = await run(() => post('/stock-counts', { note, items: lines.map((l) => ({ product_id: l.product_id, actual_qty: l.actual_qty })) }), 'Đã cân bằng kho');
    if (r) onSaved(r.id);
  };
  return (
    <Modal title="📋 Phiếu kiểm kho" onClose={onClose} wide
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy || !lines.length} onClick={save}>Hoàn tất kiểm {lines.length} món</button>}>
      <ProductSearch onPick={add} showCost autoFocus={false} />
      <p className="muted small">Quét mã hoặc tìm từng món, gõ số đếm được (theo ĐVT gốc). Quét cùng món nhiều lần thì tự cộng thêm.</p>
      <div className="list">
        {lines.length === 0 && <div className="empty">Chưa có món nào</div>}
        {lines.map((l, i) => {
          const diff = Math.round((l.actual_qty - l.system_qty) * 1000) / 1000;
          return (
            <div key={l.product_id} className="list-item">
              <span className="grow"><b>{l.name}</b>
                <small className="muted block">{l.code} · Máy ghi: {num(l.system_qty)} {l.unit}
                  {diff !== 0 && <b className={diff < 0 ? 'neg' : 'pos'}> · Lệch {diff > 0 ? '+' : ''}{num(diff)}</b>}</small></span>
              <span style={{ width: 100 }}><QtyInput value={l.actual_qty} onChange={(q) => set(i, q)} /></span>
              <button className="btn btn-sm btn-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
            </div>
          );
        })}
      </div>
      {lines.length > 0 && <div className="row-between"><span>Giá trị lệch</span><b className={diffValue < 0 ? 'neg' : 'pos'}>{money(Math.round(diffValue))}</b></div>}
      <Field label="Ghi chú"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: Kiểm kho cuối tháng" /></Field>
    </Modal>
  );
}

function CountDetail({ id, onClose }) {
  const state = useLoad(() => get(`/stock-counts/${id}`), [id]);
  return (
    <Modal title="Phiếu kiểm kho" onClose={onClose} wide>
      <Loading state={state}>
        {(c) => (
          <>
            <h3>{c.code}</h3>
            <div className="muted">{dateTime(c.created_at)} · {c.user_name}{c.note ? ` · ${c.note}` : ''}</div>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Hàng hoá</th><th className="r">Máy ghi</th><th className="r">Thực tế</th><th className="r">Lệch</th><th className="r">Giá trị lệch</th></tr></thead>
                <tbody>
                  {c.items.map((it) => {
                    const d = it.actual_qty - it.system_qty;
                    return (
                      <tr key={it.id}>
                        <td>{it.name}<small className="muted block">{it.code} · {it.unit}</small></td>
                        <td className="r">{num(it.system_qty)}</td><td className="r">{num(it.actual_qty)}</td>
                        <td className={`r ${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}`}>{num(d)}</td>
                        <td className="r">{money(Math.round(d * it.cost))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loading>
    </Modal>
  );
}

export default function StockCount() {
  const list = useLoad(() => get('/stock-counts'), []);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  return (
    <>
      <button className="btn btn-primary btn-block" onClick={() => setCreating(true)}>+ Tạo phiếu kiểm kho</button>
      <Loading state={list}>
        {(rows) => (
          <div className="list">
            {rows.length === 0 && <div className="empty">Chưa kiểm kho lần nào</div>}
            {rows.map((c) => (
              <button key={c.id} className="list-item" onClick={() => setDetail(c.id)}>
                <span className="grow"><b>{c.code}</b><small className="muted block">{dateTime(c.created_at)} · {c.items} món{c.note ? ` · ${c.note}` : ''}</small></span>
                <b className={c.diff_value < 0 ? 'neg' : c.diff_value > 0 ? 'pos' : ''}>{money(c.diff_value ?? 0)}</b>
              </button>
            ))}
          </div>
        )}
      </Loading>
      {creating && <CountForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); list.reload(); setDetail(id); }} />}
      {detail && <CountDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
