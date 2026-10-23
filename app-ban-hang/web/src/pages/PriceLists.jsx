import { useState } from 'react';
import { get, post, put, del } from '../api.js';
import { money } from '../format.js';
import { Field, Loading, Modal, MoneyInput, useAction, useLoad, useDebounced, confirmAsk } from '../components/ui.jsx';

function PriceListEditor({ list, onClose, onChanged }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const items = useLoad(() => get(`/price-lists/${list.id}/items?q=${encodeURIComponent(dq)}`), [list.id, dq]);
  const [changes, setChanges] = useState({});
  const [name, setName] = useState(list.name);
  const [run, busy] = useAction();
  const key = (r) => `${r.product_id}:${r.unit_id}`;
  const save = async () => {
    const payload = Object.entries(changes).map(([k, price]) => {
      const [product_id, unit_id] = k.split(':').map(Number);
      return { product_id, unit_id, price: price || null };
    });
    const ok = await run(async () => {
      if (name !== list.name) await put(`/price-lists/${list.id}`, { name });
      await put(`/price-lists/${list.id}/items`, { items: payload });
      return true;
    }, 'Đã lưu bảng giá');
    if (ok) {
      setChanges({});
      onChanged();
      onClose();
    }
  };
  const remove = async () => {
    if (!confirmAsk(`Xoá bảng giá "${list.name}"?`)) return;
    if (await run(() => del(`/price-lists/${list.id}`), 'Đã xoá')) {
      onChanged();
      onClose();
    }
  };
  return (
    <Modal title={`Bảng giá: ${list.name}`} onClose={onClose} wide
      footer={<div className="row gap">
        <button className="btn btn-danger" onClick={remove}>Xoá bảng giá</button>
        <button className="btn btn-primary btn-lg grow" disabled={busy} onClick={save}>Lưu {Object.keys(changes).length ? `(${Object.keys(changes).length} thay đổi)` : ''}</button>
      </div>}>
      <Field label="Tên bảng giá"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <input className="input" placeholder="🔍 Tìm hàng" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="muted small">Ô bỏ trống nghĩa là bán theo giá bán lẻ.</p>
      <Loading state={items}>
        {(rows) => (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Hàng hoá</th><th className="r">Giá vốn</th><th className="r">Giá lẻ</th><th>Giá trong bảng</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const v = changes[key(r)] ?? r.price ?? 0;
                  return (
                    <tr key={key(r)}>
                      <td>{r.name} - <b>{r.unit}</b><small className="muted block">{r.code}</small></td>
                      <td className="r muted">{money(r.cost)}</td>
                      <td className="r">{money(r.base_price)}</td>
                      <td>
                        <MoneyInput placeholder="—" value={v} onChange={(p) => setChanges({ ...changes, [key(r)]: p })} />
                        {v > 0 && r.cost > 0 && v < r.cost && <small className="neg">Dưới giá vốn</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Loading>
    </Modal>
  );
}

export default function PriceLists() {
  const lists = useLoad(() => get('/price-lists'), []);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', percent: 0 });
  const [run, busy] = useAction();
  const create = async () => {
    const r = await run(() => post('/price-lists', f), 'Đã tạo bảng giá');
    if (r) {
      setAdding(false);
      setF({ name: '', percent: 0 });
      lists.reload();
    }
  };
  return (
    <>
      <p className="muted">Bảng giá dùng cho khách sỉ, khách quen, thợ… Gán bảng giá cho khách thì khi bán sẽ tự lấy đúng giá.</p>
      <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Tạo bảng giá</button>
      <Loading state={lists}>
        {(rows) => (
          <div className="list">
            {rows.map((pl) => (
              <button key={pl.id} className="list-item" onClick={() => setEditing(pl)}>
                <span className="grow"><b>{pl.name}</b><small className="muted block">{pl.count} dòng giá</small></span>
                <span>Sửa ›</span>
              </button>
            ))}
          </div>
        )}
      </Loading>
      {adding && (
        <Modal title="Tạo bảng giá" onClose={() => setAdding(false)}
          footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={create}>Tạo</button>}>
          <Field label="Tên bảng giá"><input className="input" autoFocus placeholder="vd: Giá sỉ, Giá thợ" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Tạo nhanh theo giá lẻ (%)" hint="vd: -5 nghĩa là rẻ hơn giá lẻ 5%. Để 0 thì tự nhập từng giá.">
            <input className="input" type="number" step="any" value={f.percent} onChange={(e) => setF({ ...f, percent: Number(e.target.value) })} />
          </Field>
        </Modal>
      )}
      {editing && <PriceListEditor list={editing} onClose={() => setEditing(null)} onChanged={lists.reload} />}
    </>
  );
}
