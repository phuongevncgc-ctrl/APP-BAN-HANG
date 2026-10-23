import { useEffect, useState } from 'react';
import { get, post, put, del, imageUrl, getToken } from '../api.js';
import { money, num, dateTime } from '../format.js';
import { Field, Loading, Modal, MoneyInput, QtyInput, useAction, useLoad, useDebounced, resizeImage, confirmAsk, useToast } from '../components/ui.jsx';
import Scanner from '../components/Scanner.jsx';
import { useUser, isOwner, go } from '../App.jsx';
import PriceLists from './PriceLists.jsx';

const FILTERS = [['', 'Tất cả'], ['in', 'Còn hàng'], ['out', 'Hết hàng'], ['neg', 'Âm kho'], ['low', 'Tồn thấp']];
const MOVE_NAMES = { sale: 'Bán hàng', cancel: 'Huỷ HĐ', return: 'Khách trả', purchase: 'Nhập hàng', supplier_return: 'Trả NCC', adjust: 'Cân bằng kho', init: 'Tồn đầu' };

function UnitsEditor({ f, setF, owner }) {
  const units = f.units ?? [];
  const setUnit = (i, patch) => setF({ ...f, units: units.map((u, j) => (j === i ? { ...u, ...patch } : u)) });
  return (
    <>
      <div className="unit-card unit-base">
        <div className="row-between"><b>ĐVT gốc</b><small className="muted">Hệ số 1</small></div>
        <div className="grid2">
          <Field label="Tên đơn vị"><input className="input" disabled={!owner} value={f.unit} placeholder="vd: Mét, Cái, Chai" onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          <Field label="Giá bán"><MoneyInput disabled={!owner} value={f.price} onChange={(price) => setF({ ...f, price })} /></Field>
        </div>
      </div>
      {units.map((u, i) => (
        <div key={u.id ?? `n${i}`} className="unit-card">
          <div className="row-between">
            <b>ĐVT quy đổi</b>
            {owner && <button className="btn btn-sm btn-danger" onClick={() => setF({ ...f, units: units.filter((_, j) => j !== i) })}>Xoá</button>}
          </div>
          <div className="grid2">
            <Field label="Tên đơn vị"><input className="input" disabled={!owner} value={u.name} placeholder="vd: Cây, Thùng" onChange={(e) => setUnit(i, { name: e.target.value })} /></Field>
            <Field label={`Bằng bao nhiêu ${f.unit || 'ĐVT gốc'}?`}>
              <QtyInput disabled={!owner} value={u.factor} onChange={(factor) => setUnit(i, { factor })} />
            </Field>
            <Field label="Giá bán" hint={f.price && u.factor ? `Theo ĐVT gốc: ${money(f.price * u.factor)}` : null}>
              <MoneyInput disabled={!owner} value={u.price} onChange={(price) => setUnit(i, { price })} />
            </Field>
            <Field label="Mã hàng (tuỳ chọn)"><input className="input" disabled={!owner} value={u.code ?? ''} onChange={(e) => setUnit(i, { code: e.target.value })} /></Field>
            <Field label="Mã vạch"><input className="input" disabled={!owner} value={u.barcode ?? ''} onChange={(e) => setUnit(i, { barcode: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" disabled={!owner} checked={u.direct_sale !== 0 && u.direct_sale !== false} onChange={(e) => setUnit(i, { direct_sale: e.target.checked })} /> Bán trực tiếp</label>
          </div>
        </div>
      ))}
      {owner && (
        <button className="btn btn-block" onClick={() => setF({ ...f, units: [...units, { name: '', factor: 1, price: 0, code: '', barcode: '', direct_sale: true }] })}>
          + Thêm đơn vị quy đổi
        </button>
      )}
      <p className="muted small">Ví dụ: ĐVT gốc là <b>Mét</b>, thêm <b>Cây</b> bằng 4 Mét. Bán 1 Cây thì kho tự trừ 4 Mét.</p>
    </>
  );
}

function ProductForm({ id, categories, priceLists, onClose, onSaved, reloadCategories }) {
  const owner = isOwner(useUser());
  const [tab, setTab] = useState('info');
  const [f, setF] = useState(id ? null : { name: '', code: '', barcode: '', unit: '', category_id: '', cost: 0, price: 0, stock: 0, min_stock: 0, track_stock: 1, active: 1, units: [], prices: {} });
  const [scan, setScan] = useState(false);
  const [stockEdit, setStockEdit] = useState(null);
  const [run, busy] = useAction();

  const load = () => get(`/products/${id}`).then((p) => setF({ ...p, category_id: p.category_id ?? '', image_data: null }));
  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!f) return <Modal title="Hàng hoá" onClose={onClose}><div className="empty">Đang tải…</div></Modal>;

  // Khoá giá theo đơn vị: đơn vị cũ dùng id, đơn vị mới dùng new0, new1...
  const unitKeys = [{ key: '0', name: f.unit || 'ĐVT gốc' }];
  let n = 0;
  for (const u of f.units) unitKeys.push({ key: u.id ? String(u.id) : `new${n++}`, name: u.name || '?' });

  const save = async () => {
    const body = { ...f, category_id: f.category_id || null };
    const r = await run(() => (id ? put(`/products/${id}`, body) : post('/products', body)), 'Đã lưu hàng hoá');
    if (r) onSaved(r.id);
  };
  const remove = async () => {
    if (!confirmAsk(`Xoá "${f.name}"? Nếu hàng đã từng bán thì sẽ chỉ ẩn đi.`)) return;
    if (await run(() => del(`/products/${id}`), 'Đã xoá')) onSaved(null);
  };
  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    if (file) setF({ ...f, image_data: await resizeImage(file), remove_image: false });
  };
  const addCategory = async () => {
    const name = window.prompt('Tên nhóm hàng mới');
    if (!name) return;
    const r = await run(() => post('/categories', { name }));
    if (r) {
      await reloadCategories();
      setF({ ...f, category_id: r.id });
    }
  };
  const adjustStock = async () => {
    if (await run(() => post(`/products/${id}/stock`, { stock: stockEdit }), 'Đã cân bằng kho')) {
      setStockEdit(null);
      load();
      onSaved(id, true);
    }
  };
  const img = f.image_data ?? (f.remove_image ? null : imageUrl(f.image));

  return (
    <Modal
      title={id ? f.name : 'Thêm hàng hoá'}
      onClose={onClose}
      wide
      footer={owner && (
        <div className="row gap">
          {id && <button className="btn btn-danger" onClick={remove}>Xoá</button>}
          <button className="btn btn-primary btn-lg grow" disabled={busy} onClick={save}>Lưu hàng</button>
        </div>
      )}
    >
      {id && (
        <div className="stock-head">
          <div>Tồn kho: <b className={f.stock < 0 ? 'neg' : ''}>{num(f.stock)} {f.unit}</b>
            {f.units.map((u) => <small key={u.id} className="muted"> · {num(Math.floor((f.stock / u.factor) * 100) / 100)} {u.name}</small>)}
          </div>
          {owner && f.cost !== undefined && <div className="muted">Giá vốn: {money(f.cost)} · Nhập cuối: {money(f.last_cost)}</div>}
          {owner && <button className="btn btn-sm" onClick={() => setStockEdit(f.stock)}>⚖️ Cân bằng kho</button>}
        </div>
      )}
      <div className="seg">
        <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>Thông tin</button>
        <button className={tab === 'units' ? 'on' : ''} onClick={() => setTab('units')}>Đơn vị tính ({1 + f.units.length})</button>
        {id && <button className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>Thẻ kho</button>}
      </div>

      {tab === 'info' && (
        <>
          <div className="row gap top">
            <label className="img-pick">
              {img ? <img src={img} alt="" /> : <span>📷<br />Ảnh</span>}
              {owner && <input type="file" accept="image/*" capture="environment" onChange={pickImage} hidden />}
            </label>
            <div className="grow">
              <Field label="Tên hàng"><input className="input" disabled={!owner} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            </div>
          </div>
          <div className="grid2">
            <Field label="Mã hàng" hint={!id ? 'Bỏ trống để tự tạo' : null}><input className="input" disabled={!owner} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="Mã vạch">
              <div className="row">
                <input className="input grow" disabled={!owner} value={f.barcode ?? ''} onChange={(e) => setF({ ...f, barcode: e.target.value })} />
                {owner && <button className="btn" onClick={() => setScan(true)}>📷</button>}
              </div>
            </Field>
            <Field label="ĐVT gốc"><input className="input" disabled={!owner} value={f.unit} placeholder="Cái, Mét, Chai..." onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <Field label="Nhóm hàng">
              <div className="row">
                <select className="input grow" disabled={!owner} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
                  <option value="">-- Chưa chọn --</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {owner && <button className="btn" onClick={addCategory}>+</button>}
              </div>
            </Field>
            {owner && <Field label="Giá vốn"><MoneyInput value={f.cost} onChange={(cost) => setF({ ...f, cost })} /></Field>}
            <Field label="Giá bán"><MoneyInput disabled={!owner} value={f.price} onChange={(price) => setF({ ...f, price })} /></Field>
            {!id && <Field label="Tồn kho ban đầu"><QtyInput value={f.stock} onChange={(stock) => setF({ ...f, stock })} /></Field>}
            <Field label="Tồn tối thiểu" hint="Báo khi hàng sắp hết"><QtyInput disabled={!owner} value={f.min_stock} onChange={(min_stock) => setF({ ...f, min_stock })} /></Field>
          </div>
          {owner && f.cost > 0 && f.price > 0 && f.price < f.cost && <div className="warn">⚠️ Giá bán thấp hơn giá vốn</div>}
          <label className="check"><input type="checkbox" disabled={!owner} checked={!f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked ? 0 : 1 })} /> Không theo dõi tồn kho (dịch vụ, công lắp đặt…)</label>
          {id && <label className="check"><input type="checkbox" disabled={!owner} checked={!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 0 : 1 })} /> Ngừng kinh doanh</label>}
          {priceLists.length > 0 && (
            <div className="sumbox">
              <b>Giá theo bảng giá</b> <small className="muted">(bỏ trống = dùng giá bán)</small>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>ĐVT</th>{priceLists.map((pl) => <th key={pl.id}>{pl.name}</th>)}</tr></thead>
                  <tbody>
                    {unitKeys.map((u) => (
                      <tr key={u.key}>
                        <td>{u.name}</td>
                        {priceLists.map((pl) => {
                          const k = `${pl.id}:${u.key}`;
                          return (
                            <td key={pl.id}>
                              <MoneyInput disabled={!owner} placeholder="—" value={f.prices[k] ?? 0} onChange={(v) => setF({ ...f, prices: { ...f.prices, [k]: v || null } })} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'units' && <UnitsEditor f={f} setF={setF} owner={owner} />}

      {tab === 'moves' && (
        <div className="list">
          {(f.moves ?? []).length === 0 && <div className="empty">Chưa có lịch sử nhập xuất</div>}
          {(f.moves ?? []).map((m, i) => (
            <div key={i} className="list-item">
              <span className="grow">
                <b>{MOVE_NAMES[m.kind] ?? m.kind}</b>{' '}
                {m.ref_code && (m.kind === 'sale' || m.kind === 'cancel'
                  ? <a href={`#/hoa-don/${m.ref_id}`} onClick={onClose}>{m.ref_code}</a>
                  : <span className="muted">{m.ref_code}</span>)}
                <small className="muted block">{dateTime(m.created_at)}{m.partner ? ` · ${m.partner}` : ''}</small>
              </span>
              <span className="r">
                <b className={m.qty < 0 ? 'neg' : 'pos'}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</b>
                <small className="muted block">Tồn: {num(m.stock_after)}</small>
              </span>
            </div>
          ))}
        </div>
      )}

      {scan && <Scanner onCode={(code) => setF((x) => ({ ...x, barcode: code }))} onClose={() => setScan(false)} />}
      {stockEdit !== null && (
        <Modal title="Cân bằng kho" onClose={() => setStockEdit(null)}
          footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={adjustStock}>Cập nhật tồn kho</button>}>
          <p>Đếm thực tế trong kho còn bao nhiêu <b>{f.unit}</b>?</p>
          <QtyInput autoFocus value={stockEdit} onChange={setStockEdit} />
          <p className="muted">Trên máy đang ghi: {num(f.stock)} {f.unit}. Chênh lệch: {num(stockEdit - f.stock)}</p>
        </Modal>
      )}
    </Modal>
  );
}

function ImportDialog({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [updateStock, setUpdateStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`api/products/import?update_stock=${updateStock ? 1 : 0}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      onDone();
    } catch (err) {
      toast(err.message || 'Nhập file lỗi', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Nhập hàng hoá từ file" onClose={onClose}>
      {!result ? (
        <>
          <p>Chọn một trong hai loại file:</p>
          <ul>
            <li><b>File Excel (.xlsx)</b> xuất từ KiotViet: Hàng hoá → Xuất file. Các ĐVT quy đổi sẽ tự gom vào đúng mặt hàng.</li>
            <li><b>File db.json</b> của app bán hàng cũ (trong thư mục <i>data</i>): chuyển cả hàng hoá, khách hàng, công nợ, nhà cung cấp.</li>
          </ul>
          <input type="file" className="input" accept=".xlsx,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <label className="check"><input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} /> Cập nhật số tồn kho theo file (với hàng đã có)</label>
          <button className="btn btn-primary btn-lg btn-block" disabled={!file || busy} onClick={submit}>{busy ? 'Đang nhập…' : 'Bắt đầu nhập'}</button>
        </>
      ) : (
        <>
          <div className="done-box">
            <div className="big pos">✅ Nhập xong</div>
            <div>Thêm mới <b>{result.created}</b> hàng, cập nhật <b>{result.updated}</b> hàng, <b>{result.units}</b> đơn vị quy đổi.</div>
            {result.merged > 0 && <div>Đã gom {result.merged} hàng tách sai vào đúng mặt hàng gốc.</div>}
            {result.customers !== undefined && <div>Thêm {result.customers} khách hàng, {result.suppliers} nhà cung cấp.</div>}
          </div>
          {result.errors.length > 0 && (
            <>
              <button className="btn btn-block" onClick={() => setShowErrors(!showErrors)}>⚠️ {result.errors.length} dòng bị bỏ qua — {showErrors ? 'Ẩn' : 'Xem'}</button>
              {showErrors && (
                <div className="list small">
                  {result.errors.map((e, i) => <div key={i} className="list-item">Dòng {e.row ?? '?'} {e.code}: {e.reason}</div>)}
                </div>
              )}
            </>
          )}
          <button className="btn btn-primary btn-block" onClick={onClose}>Xong</button>
        </>
      )}
    </Modal>
  );
}

export default function Products({ route }) {
  const owner = isOwner(useUser());
  const [tab, setTab] = useState('products');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [showCost, setShowCost] = useState(false);
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const list = useLoad(() => get(`/products?q=${encodeURIComponent(dq)}&stock=${filter}&category=${category}&limit=500`), [dq, filter, category]);
  const stats = useLoad(() => get('/products/stats'), []);
  const cats = useLoad(() => get('/categories'), []);
  const pls = useLoad(() => get('/price-lists'), []);
  const openId = route[1] === 'moi' ? 'new' : route[1] ? Number(route[1]) : null;

  const refresh = () => {
    list.reload();
    stats.reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Hàng hoá</h1>
        <div className="seg">
          <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>Hàng hoá</button>
          {owner && <button className={tab === 'prices' ? 'on' : ''} onClick={() => setTab('prices')}>Bảng giá</button>}
        </div>
      </div>
      {tab === 'prices' ? <PriceLists /> : (
        <>
          <div className="sticky-tools">
            <div className="row gap wrap">
              {stats.data && <span className="badge badge-blue">{num(stats.data.total)} hàng hoá · tồn {num(stats.data.total_stock)}</span>}
              <span className="grow" />
              {owner && <button className="btn" onClick={() => setImporting(true)}>📥 Nhập file</button>}
              {owner && <button className="btn btn-primary" onClick={() => go('hang-hoa/moi')}>+ Thêm</button>}
            </div>
            <input className="input" placeholder="🔍 Tên, mã hàng, mã vạch" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chips">
              {FILTERS.map(([k, label]) => {
                const count = stats.data && { in: stats.data.in_stock, out: stats.data.out_stock, neg: stats.data.neg_stock, low: stats.data.low_stock }[k];
                return <button key={k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{label}{count ? ` (${count})` : ''}</button>;
              })}
            </div>
            <div className="row gap">
              <select className="input grow" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Tất cả nhóm hàng</option>
                {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
              </select>
              {owner && (
                <div className="seg">
                  <button className={!showCost ? 'on' : ''} onClick={() => setShowCost(false)}>Giá bán</button>
                  <button className={showCost ? 'on' : ''} onClick={() => setShowCost(true)}>Giá vốn</button>
                </div>
              )}
            </div>
          </div>
          <Loading state={list}>
            {(rows) => (
              <div className="list">
                {rows.length === 0 && <div className="empty">Không có hàng hoá</div>}
                {rows.map((p) => (
                  <button key={p.id} className={`list-item product-row ${p.active ? '' : 'faded'}`} onClick={() => go(`hang-hoa/${p.id}`)}>
                    {p.image ? <img src={imageUrl(p.image)} alt="" /> : <span className="thumb">📦</span>}
                    <span className="grow">
                      <b>{p.name}</b> ({p.unit}){p.units.length > 0 && <small className="muted"> +{p.units.map((u) => u.name).join(', ')}</small>}
                      <small className="muted block">{p.code}</small>
                    </span>
                    <span className="r">
                      <span className={p.track_stock && p.stock < 0 ? 'neg' : p.track_stock && p.stock <= p.min_stock ? 'warn-text' : ''}>
                        {p.track_stock ? `SL: ${num(p.stock)}` : 'Dịch vụ'}
                      </span>
                      <b className="block">{money(showCost ? p.cost : p.price)}</b>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Loading>
        </>
      )}
      {openId && (
        <ProductForm
          id={openId === 'new' ? null : openId}
          categories={cats.data ?? []}
          priceLists={pls.data ?? []}
          reloadCategories={cats.reload}
          onClose={() => go('hang-hoa')}
          onSaved={(id, stay) => {
            refresh();
            if (!stay) go('hang-hoa');
          }}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => { refresh(); cats.reload(); }} />}
    </div>
  );
}
