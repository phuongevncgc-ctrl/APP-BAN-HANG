import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, del } from '../api.js';
import { money, num, vnd, moneyToWords, dateTime, dateOnly } from '../format.js';
import { Modal, MoneyInput, QtyInput, Field, useAction, useToast, confirmAsk } from '../components/ui.jsx';
import { ProductSearch, CustomerPicker, unitOptions } from '../components/Pickers.jsx';
import { ReceiptActions, InvoiceA4, useReceiptPrint, vietQrUrl } from '../components/Receipt.jsx';
import { useSettings, useUser, isOwner } from '../App.jsx';

const STORE_KEY = 'banhang_carts';
let seq = Date.now();
const newKey = () => `psell-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2)}`;

const emptyCart = () => ({
  key: newKey(), lines: [], customer: null, priceListId: null,
  discMode: 'vnd', discValue: 0, payMode: 'cash', cash: null, transfer: null, card: 0, note: '', draftId: null,
});

export const lineDiscount = (l) => (l.discMode === 'pct' ? Math.round((l.price * Math.min(l.discValue, 100)) / 100) : Math.min(l.discValue || 0, l.price));
export const lineTotal = (l) => Math.round(l.qty * (l.price - lineDiscount(l)));

function totals(cart) {
  const subtotal = cart.lines.reduce((s, l) => s + lineTotal(l), 0);
  const discount = Math.min(subtotal, cart.discMode === 'pct' ? Math.round((subtotal * Math.min(cart.discValue, 100)) / 100) : cart.discValue || 0);
  const total = subtotal - discount;
  let payments;
  switch (cart.payMode) {
    case 'transfer':
      payments = [{ method: 'transfer', amount: cart.transfer ?? total }];
      break;
    case 'mixed':
      payments = [{ method: 'cash', amount: cart.cash ?? 0 }, { method: 'transfer', amount: cart.transfer ?? 0 }, { method: 'card', amount: cart.card ?? 0 }];
      break;
    case 'debt':
      payments = [{ method: 'cash', amount: cart.cash ?? 0 }];
      break;
    default:
      payments = [{ method: 'cash', amount: cart.cash ?? total }];
  }
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  return { subtotal, discount, total, payments, paid, change: Math.max(0, paid - total), debt: Math.max(0, total - paid), qty: cart.lines.reduce((s, l) => s + l.qty, 0) };
}

function loadCarts() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(c) && c.length) return c;
  } catch {
    /* bỏ qua */
  }
  return [emptyCart()];
}

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* máy không hỗ trợ đọc */
  }
}

// ---------- Sửa một dòng hàng ----------
function LineEditor({ line, owner, onSave, onRemove, onClose }) {
  const [l, setL] = useState(line);
  const disc = lineDiscount(l);
  const after = l.price - disc;
  const lowPrice = owner && l.cost > 0 && after < l.cost;
  const changeUnit = (unitId) => {
    const o = l.options.find((x) => String(x.unit_id) === unitId) ?? l.options[0];
    const cost = l.cost / l.factor;
    setL({ ...l, unit_id: o.unit_id, unit: o.name, factor: o.factor, listPrice: o.price, price: o.price, cost: Math.round(cost * o.factor) });
  };
  return (
    <Modal
      title={l.name}
      onClose={onClose}
      footer={
        <div className="row gap">
          <button className="btn btn-danger" onClick={onRemove}>🗑 Xoá</button>
          <button className="btn btn-primary btn-lg grow" onClick={() => onSave(l)}>Áp dụng</button>
        </div>
      }
    >
      {l.options.length > 1 && (
        <Field label="Đơn vị tính">
          <div className="chips">
            {l.options.map((o) => (
              <button key={String(o.unit_id)} className={`chip ${o.unit_id === l.unit_id ? 'chip-on' : ''}`} onClick={() => changeUnit(String(o.unit_id))}>
                {o.name} {o.factor !== 1 && `(${num(o.factor)})`} · {money(o.price)}
              </button>
            ))}
          </div>
        </Field>
      )}
      <div className="grid2">
        <Field label="Số lượng">
          <QtyInput value={l.qty} onChange={(qty) => setL({ ...l, qty })} />
        </Field>
        <Field label="Giá bán" hint={l.price !== l.listPrice ? `Giá gốc: ${money(l.listPrice)}` : null}>
          <MoneyInput value={l.price} onChange={(price) => setL({ ...l, price })} />
        </Field>
      </div>
      <Field label="Giảm giá mỗi đơn vị">
        <div className="row gap">
          <div className="seg">
            <button className={l.discMode === 'vnd' ? 'on' : ''} onClick={() => setL({ ...l, discMode: 'vnd', discValue: 0 })}>Tiền</button>
            <button className={l.discMode === 'pct' ? 'on' : ''} onClick={() => setL({ ...l, discMode: 'pct', discValue: 0 })}>%</button>
          </div>
          {l.discMode === 'vnd' ? (
            <MoneyInput className="grow" value={l.discValue} onChange={(v) => setL({ ...l, discValue: v })} />
          ) : (
            <QtyInput className="grow" value={l.discValue} onChange={(v) => setL({ ...l, discValue: Math.min(v, 100) })} />
          )}
        </div>
      </Field>
      <div className="sumbox">
        <div className="row-between"><span>Giá sau giảm</span><b>{money(after)}</b></div>
        <div className="row-between big"><span>Thành tiền</span><b>{money(lineTotal(l))}</b></div>
        {owner && l.cost > 0 && <div className="row-between muted"><span>Giá vốn</span><span>{money(l.cost)}</span></div>}
      </div>
      {lowPrice && <div className="warn">⚠️ Giá bán đang thấp hơn giá vốn!</div>}
    </Modal>
  );
}

// ---------- Một dòng trong giỏ (vuốt trái để xoá) ----------
function CartLine({ index, line, owner, last, onQty, onOpen, onRemove, onUseLast }) {
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const disc = lineDiscount(line);
  return (
    <div className="cart-line-wrap">
      <button className="cart-line-del" onClick={onRemove}>Xoá</button>
      <div
        className="cart-line"
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: dx };
        }}
        onTouchMove={(e) => {
          if (!start.current) return;
          const mx = e.touches[0].clientX - start.current.x;
          if (Math.abs(mx) > Math.abs(e.touches[0].clientY - start.current.y)) setDx(Math.min(0, Math.max(-90, start.current.base + mx)));
        }}
        onTouchEnd={() => {
          setDx((d) => (d < -45 ? -90 : 0));
          start.current = null;
        }}
      >
        <div className="cart-line-top" onClick={() => (dx ? setDx(0) : onOpen())}>
          <span className="muted">{index + 1}.</span> <b>{line.name}</b> - <b className="unit">{line.unit}</b>
        </div>
        <div className="cart-line-row">
          <div className="cart-price" onClick={() => (dx ? setDx(0) : onOpen())}>
            {disc > 0 ? (
              <>
                <s className="muted">{money(line.price)}</s> <b>{money(line.price - disc)}</b>
                <span className="tag-disc">-{line.discMode === 'pct' ? `${num(line.discValue)}%` : money(disc)}</span>
              </>
            ) : (
              <span>{money(line.price)}</span>
            )}
            {owner && line.cost > 0 && line.price - disc < line.cost && <span className="tag-warn">dưới vốn</span>}
          </div>
          <div className="qty">
            <button onClick={() => onQty(Math.max(0, Math.round((line.qty - 1) * 1000) / 1000))}>−</button>
            <QtyInput className="qty-input" value={line.qty} onChange={onQty} />
            <button onClick={() => onQty(Math.round((line.qty + 1) * 1000) / 1000)}>+</button>
          </div>
          <div className="cart-line-total" onClick={() => onOpen()}>{money(lineTotal(line))}</div>
        </div>
        {last && last.price - last.discount !== line.price - disc && (
          <button className="last-price" onClick={onUseLast}>
            🕘 Lần trước bán {money(last.price - last.discount)} ({dateOnly(last.date)}) · <u>Dùng giá này</u>
          </button>
        )}
        {last && last.price - last.discount === line.price - disc && <div className="last-price muted">🕘 Đúng giá lần trước ({dateOnly(last.date)})</div>}
      </div>
    </div>
  );
}

// ---------- Thanh toán ----------
function Checkout({ cart, set, t, priceLists, onFinish, onDraft, onQuote, onPreview, busy, compact }) {
  const settings = useSettings();
  const [pickCustomer, setPickCustomer] = useState(false);
  const [discEdit, setDiscEdit] = useState(false);
  const qr = (cart.payMode === 'transfer' || (cart.payMode === 'mixed' && (cart.transfer ?? 0) > 0))
    ? vietQrUrl(settings, cart.payMode === 'transfer' ? cart.transfer ?? t.total : cart.transfer, 'Thanh toan hoa don')
    : null;
  const transferAmount = cart.payMode === 'transfer' ? cart.transfer ?? t.total : cart.transfer ?? 0;
  const quick = useMemo(() => {
    const xs = [t.total];
    for (const step of [10000, 50000, 100000, 200000, 500000]) {
      const v = Math.ceil(t.total / step) * step;
      if (v > t.total && !xs.includes(v)) xs.push(v);
    }
    return xs.slice(0, 5);
  }, [t.total]);
  // Giỏ hàng lưu trong máy có thể cũ: lấy lại số nợ hiện tại của khách từ máy chủ
  const customerId = cart.customer?.id;
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    get(`/customers/${customerId}/debt-preview?total=0&paid=0`).then((d) => {
      if (live && cart.customer?.id === customerId && d.old_debt !== cart.customer.debt) set({ customer: { ...cart.customer, debt: d.old_debt } });
    }).catch(() => {});
    return () => { live = false; };
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`checkout ${compact ? 'compact' : ''}`}>
      <button className="customer-btn" onClick={() => setPickCustomer(true)}>
        👤 {cart.customer ? (
          <span className="grow">
            <b>{cart.customer.name}</b> {cart.customer.phone}
            {cart.customer.debt > 0 && <small className="neg block">Đang nợ {vnd(cart.customer.debt)}</small>}
          </span>
        ) : <span className="grow">Khách lẻ <small className="muted">(bấm để chọn khách)</small></span>}
        {cart.customer && <span className="link" onClick={(e) => { e.stopPropagation(); set({ customer: null }); }}>✕</span>}
      </button>
      {priceLists.length > 0 && (
        <select className="input" value={cart.priceListId ?? ''} onChange={(e) => set({ priceListId: e.target.value ? Number(e.target.value) : null }, true)}>
          <option value="">Bảng giá: Giá bán lẻ</option>
          {priceLists.map((pl) => <option key={pl.id} value={pl.id}>Bảng giá: {pl.name}</option>)}
        </select>
      )}
      <div className="sumbox">
        <div className="row-between"><span>Tổng tiền hàng ({num(t.qty)})</span><b>{money(t.subtotal)}</b></div>
        <button className="row-between link-row" onClick={() => setDiscEdit(true)}>
          <span>Giảm giá HĐ {cart.discMode === 'pct' && cart.discValue > 0 ? `(${num(cart.discValue)}%)` : ''}</span>
          <b>{t.discount ? `-${money(t.discount)}` : '0 ✎'}</b>
        </button>
        <div className="row-between total"><span>KHÁCH CẦN TRẢ</span><b>{money(t.total)}</b></div>
      </div>

      <div className="seg seg-pay">
        {[['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ['mixed', 'Kết hợp'], ['debt', 'Ghi nợ']].map(([k, label]) => (
          <button key={k} className={cart.payMode === k ? 'on' : ''} onClick={() => set({ payMode: k, cash: null, transfer: null, card: 0 })}>{label}</button>
        ))}
      </div>

      {cart.payMode === 'cash' && (
        <>
          <Field label="Khách đưa">
            <MoneyInput value={cart.cash ?? t.total} onChange={(v) => set({ cash: v })} />
          </Field>
          <div className="chips">
            {quick.map((v) => <button key={v} className="chip" onClick={() => set({ cash: v })}>{money(v)}</button>)}
          </div>
        </>
      )}
      {cart.payMode === 'transfer' && (
        <Field label="Số tiền chuyển khoản">
          <MoneyInput value={cart.transfer ?? t.total} onChange={(v) => set({ transfer: v })} />
        </Field>
      )}
      {cart.payMode === 'mixed' && (
        <div className="grid2">
          <Field label="Tiền mặt"><MoneyInput value={cart.cash ?? 0} onChange={(v) => set({ cash: v })} /></Field>
          <Field label="Chuyển khoản">
            <div className="row">
              <MoneyInput className="grow" value={cart.transfer ?? 0} onChange={(v) => set({ transfer: v })} />
              <button className="btn btn-sm" title="Chuyển phần còn lại" onClick={() => set({ transfer: Math.max(0, t.total - (cart.cash ?? 0) - (cart.card ?? 0)) })}>Còn lại</button>
            </div>
          </Field>
          <Field label="Thẻ"><MoneyInput value={cart.card ?? 0} onChange={(v) => set({ card: v })} /></Field>
        </div>
      )}
      {cart.payMode === 'debt' && (
        <Field label="Khách trả trước (nếu có)">
          <MoneyInput value={cart.cash ?? 0} onChange={(v) => set({ cash: v })} />
        </Field>
      )}

      {qr && transferAmount > 0 && (
        <div className="qr">
          <div className="muted">QR CHUYỂN KHOẢN · {vnd(transferAmount)}</div>
          <img src={qr} alt="Mã QR chuyển khoản" />
          {settings.bank_holder && <div className="muted small">{settings.bank_holder} · {settings.bank_account}</div>}
          <button className="btn btn-sm" onClick={() => speak(`Đã nhận ${moneyToWords(transferAmount).replace(/^./, (c) => c.toLowerCase())}`)}>🔊 Đã nhận tiền - đọc to</button>
        </div>
      )}
      {cart.payMode === 'transfer' && !qr && (settings.bank_account ? null : <p className="muted small">Muốn hiện mã QR: vào Cài đặt, nhập tài khoản ngân hàng.</p>)}

      <div className="sumbox">
        <div className="row-between"><span>Khách trả</span><b>{money(t.paid)}</b></div>
        {t.change > 0 && <div className="row-between big pos"><span>Tiền thối lại</span><b>{money(t.change)}</b></div>}
        {t.debt > 0 && <div className="row-between big neg"><span>Còn nợ</span><b>{money(t.debt)}</b></div>}
      </div>
      {cart.customer && (() => {
        const oldDebt = Number(cart.customer.debt) || 0;
        const newDebt = t.debt;
        const projectedDebt = oldDebt + newDebt;
        return (
          <div className="sumbox debt-overview" aria-live="polite">
            <div className="row-between"><strong>📒 CÔNG NỢ KHÁCH HÀNG</strong><span className="muted">{cart.customer.name}</span></div>
            <div className="row-between"><span>Nợ trước hóa đơn</span><b>{money(oldDebt)}</b></div>
            <div className="row-between"><span>Phát sinh hóa đơn này</span><b className={newDebt > 0 ? 'neg' : 'pos'}>{money(newDebt)}</b></div>
            <div className="row-between big"><strong>Dự kiến tổng nợ sau bán</strong><b className={projectedDebt > 0 ? 'neg' : 'pos'}>{money(projectedDebt)}</b></div>
            <small className="muted">Số dư dự kiến. Chỉ ghi vào sổ khi hoàn tất hóa đơn thành công; tiền trả dư không tự trừ nợ cũ.</small>
          </div>
        );
      })()}
      {t.debt > 0 && !cart.customer && <div className="warn">Khách trả thiếu: hãy chọn khách để ghi nợ.</div>}

      <input className="input" placeholder="Ghi chú" value={cart.note} onChange={(e) => set({ note: e.target.value })} />

      <div className="row gap">
        <button className="btn grow" disabled={busy || !cart.lines.length} onClick={onPreview}>👁 Xem trước hóa đơn</button>
      </div>
      <div className="row gap">
        <button className="btn btn-lg" disabled={busy || !cart.lines.length} onClick={onDraft}>💾 Lưu tạm</button>
        <button className="btn btn-success btn-lg grow" disabled={busy || !cart.lines.length} onClick={() => onFinish(true)}>✅ Hoàn tất & In</button>
      </div>
      <div className="row gap">
        <button className="btn grow" disabled={busy || !cart.lines.length} onClick={() => onFinish(false)}>Hoàn tất, không in</button>
        <button className="btn" disabled={!cart.lines.length} onClick={onQuote} title="In báo giá, chưa bán, chưa trừ kho">📄 Báo giá</button>
      </div>

      {pickCustomer && (
        <CustomerPicker
          onClose={() => setPickCustomer(false)}
          onPick={(c) => {
            setPickCustomer(false);
            set({ customer: c, priceListId: c?.price_list_id ?? null }, (c?.price_list_id ?? null) !== cart.priceListId);
          }}
        />
      )}
      {discEdit && <InvoiceDiscount cart={cart} subtotal={t.subtotal} onClose={() => setDiscEdit(false)} onSave={(v) => { set(v); setDiscEdit(false); }} />}
    </div>
  );
}

function InvoiceDiscount({ cart, subtotal, onSave, onClose }) {
  const [mode, setMode] = useState(cart.discMode);
  const [value, setValue] = useState(cart.discValue);
  const amount = mode === 'pct' ? Math.round((subtotal * Math.min(value, 100)) / 100) : Math.min(value, subtotal);
  return (
    <Modal title="Giảm giá hoá đơn" onClose={onClose}
      footer={<div className="row gap">
        <button className="btn" onClick={() => onSave({ discMode: 'vnd', discValue: 0 })}>Bỏ giảm</button>
        <button className="btn btn-primary grow" onClick={() => onSave({ discMode: mode, discValue: value })}>Áp dụng</button>
      </div>}>
      <div className="row gap">
        <div className="seg">
          <button className={mode === 'vnd' ? 'on' : ''} onClick={() => { setMode('vnd'); setValue(0); }}>Tiền</button>
          <button className={mode === 'pct' ? 'on' : ''} onClick={() => { setMode('pct'); setValue(0); }}>%</button>
        </div>
        {mode === 'vnd' ? <MoneyInput className="grow" autoFocus value={value} onChange={setValue} />
          : <QtyInput className="grow" autoFocus value={value} onChange={(v) => setValue(Math.min(v, 100))} />}
      </div>
      <div className="sumbox">
        <div className="row-between"><span>Tổng tiền hàng</span><span>{money(subtotal)}</span></div>
        <div className="row-between"><span>Giảm</span><b>-{money(amount)}</b></div>
        <div className="row-between big"><span>Còn lại</span><b>{money(subtotal - amount)}</b></div>
      </div>
    </Modal>
  );
}

function Drafts({ onOpen, onClose }) {
  const [rows, setRows] = useState(null);
  const load = () => get('/drafts').then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <Modal title="Đơn lưu tạm" onClose={onClose}>
      {!rows ? <div className="empty">Đang tải…</div> : rows.length === 0 ? <div className="empty">Không có đơn tạm</div> : (
        <div className="list">
          {rows.map((d) => (
            <div key={d.id} className="list-item">
              <button className="grow text-left" onClick={() => onOpen(d)}>
                <b>{d.name || `Đơn tạm #${d.id}`}</b>
                <small className="muted block">{dateTime(d.updated_at)} · {d.data.lines?.length ?? 0} món · {d.user_name}</small>
              </button>
              <button className="btn btn-sm btn-danger" onClick={async () => { if (confirmAsk('Xoá đơn tạm này?')) { await del(`/drafts/${d.id}`); load(); } }}>Xoá</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Pos() {
  const user = useUser();
  const owner = isOwner(user);
  const settings = useSettings();
  const toast = useToast();
  const [carts, setCarts] = useState(loadCarts);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(null);
  const [mobilePay, setMobilePay] = useState(false);
  const [done, setDone] = useState(null);
  const [preview, setPreview] = useState(false);
  const [drafts, setDrafts] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [priceLists, setPriceLists] = useState([]);
  const [run, busy] = useAction();
  const [printReceipt, printPortal, printPage] = useReceiptPrint();
  // Báo giá A4 từ giỏ hàng: chỉ in, không lưu hoá đơn, không trừ kho
  const quote = () => {
    const c = cart.customer;
    printPage(<InvoiceA4 quote settings={settings} inv={{
      code: '', created_at: new Date().toLocaleString('sv'), customer_id: c?.id, customer_name: c?.name, customer_code: c?.code,
      customer_phone: c?.phone, customer_address: c?.address, user_name: user.name, subtotal: t.subtotal, discount: t.discount, total: t.total,
      items: cart.lines.filter((l) => l.qty > 0).map((l) => ({
        id: l.key, product_code: l.code, name: l.name, unit: l.unit, qty: l.qty, price: l.price, discount: lineDiscount(l), total: lineTotal(l),
      })),
    }} />);
  };

  const cart = carts[Math.min(active, carts.length - 1)];
  const t = totals(cart);
  const previewInvoice = () => ({
    code: 'CHƯA PHÁT HÀNH', created_at: new Date().toISOString(),
    customer_id: cart.customer?.id ?? null, customer_name: cart.customer?.name || 'Khách lẻ',
    customer_phone: cart.customer?.phone, customer_address: cart.customer?.address,
    customer_debt: (Number(cart.customer?.debt) || 0) + t.debt, user_name: user.name,
    subtotal: t.subtotal, discount: t.discount, total: t.total,
    paid: Math.min(t.paid, t.total), change_amount: t.change,
    payments: t.payments, items: cart.lines.filter(l => l.qty > 0).map(l => ({
      id: l.key, product_code: l.code, name: l.name, unit: l.unit,
      qty: l.qty, price: l.price, discount: lineDiscount(l), total: lineTotal(l),
    })),
  });
  // Giá đã bán cho khách này lần trước (theo hàng + đơn vị)
  const [lastPrices, setLastPrices] = useState({});
  const lastKey = cart.customer ? `${cart.customer.id}|${[...new Set(cart.lines.map((l) => l.product_id))].sort().join(',')}` : '';
  useEffect(() => {
    if (!lastKey) return setLastPrices({});
    const [cid, ids] = lastKey.split('|');
    let alive = true;
    get(`/customers/${cid}/last-prices?ids=${ids}`).then((r) => alive && setLastPrices(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [lastKey]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(carts));
    } catch {
      /* bỏ qua */
    }
  }, [carts]);
  useEffect(() => {
    get('/price-lists').then((x) => setPriceLists(x.filter((p) => p.active))).catch(() => {});
    get('/drafts').then((x) => setDraftCount(x.length)).catch(() => {});
  }, [done]);

  const update = (patch) => setCarts((cs) => cs.map((c) => (c.key === cart.key ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)));

  // Đổi bảng giá: lấy lại giá cho các dòng chưa sửa giá tay
  const reprice = async (priceListId) => {
    const lines = await Promise.all(cart.lines.map(async (l) => {
      try {
        const p = await get(`/products/lookup?code=${encodeURIComponent(l.code)}${priceListId ? `&price_list=${priceListId}` : ''}`);
        const opts = unitOptions(p);
        const o = opts.find((x) => x.unit_id === l.unit_id) ?? opts[0];
        return { ...l, options: opts, listPrice: o.price, price: l.price === l.listPrice ? o.price : l.price };
      } catch {
        return l;
      }
    }));
    update({ lines });
  };

  const setCheckout = (patch, needReprice) => {
    update(patch);
    if (needReprice) reprice(patch.priceListId);
  };

  const addProduct = (p, unitId) => {
    const opts = unitOptions(p);
    const o = opts.find((x) => x.unit_id === (unitId ?? null)) ?? opts[0];
    update((c) => {
      const found = c.lines.find((l) => l.product_id === p.id && l.unit_id === o.unit_id);
      if (found) return { lines: c.lines.map((l) => (l === found ? { ...l, qty: Math.round((l.qty + 1) * 1000) / 1000 } : l)) };
      return {
        lines: [...c.lines, {
          key: newKey(), product_id: p.id, code: p.code, name: p.name, unit_id: o.unit_id, unit: o.name, factor: o.factor,
          options: opts, qty: 1, listPrice: o.price, price: o.price, discMode: 'vnd', discValue: 0,
          cost: Math.round((p.cost ?? 0) * o.factor),
        }],
      };
    });
  };

  const setLine = (key, patch) => update((c) => ({ lines: c.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key) => update((c) => ({ lines: c.lines.filter((l) => l.key !== key) }));

  const closeCart = (key) => {
    const c = carts.find((x) => x.key === key);
    if (c.lines.length && !confirmAsk('Bỏ đơn này?')) return;
    const rest = carts.filter((x) => x.key !== key);
    setCarts(rest.length ? rest : [emptyCart()]);
    setActive(0);
  };

  const finish = async (autoPrint) => {
    if (t.debt > 0 && !cart.customer) return toast('Khách trả thiếu tiền. Hãy chọn khách để ghi nợ.', 'error');
    const inv = await run(() => post('/invoices', {
      customer_id: cart.customer?.id ?? null,
      price_list_id: cart.priceListId,
      items: cart.lines.filter((l) => l.qty > 0).map((l) => ({ product_id: l.product_id, unit_id: l.unit_id, qty: l.qty, price: l.price, discount: lineDiscount(l) })),
      discount: t.discount,
      payments: t.payments,
      note: cart.note,
      draft_id: cart.draftId,
      request_key: cart.key,
    }));
    if (!inv) return;
    setCarts((cs) => {
      const rest = cs.map((c) => (c.key === cart.key ? emptyCart() : c));
      return rest;
    });
    setMobilePay(false);
    setDone(inv);
    if (autoPrint) printReceipt(inv);
  };

  const saveDraft = async () => {
    const name = cart.customer?.name ?? `Đơn ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    const { key, ...data } = cart;
    const r = await run(() => post('/drafts', { id: cart.draftId, name, data }), 'Đã lưu tạm');
    if (!r) return;
    setCarts((cs) => {
      const rest = cs.filter((c) => c.key !== key);
      return rest.length ? rest : [emptyCart()];
    });
    setActive(0);
    setMobilePay(false);
    setDraftCount((n) => n + (cart.draftId ? 0 : 1));
  };

  const openDraft = (d) => {
    const c = { ...emptyCart(), ...d.data, key: newKey(), draftId: d.id };
    setCarts((cs) => {
      const empty = cs.findIndex((x) => !x.lines.length);
      const next = empty >= 0 ? cs.map((x, i) => (i === empty ? c : x)) : [...cs, c];
      setActive(empty >= 0 ? empty : next.length - 1);
      return next;
    });
    setDrafts(false);
  };

  return (
    <div className="pos-page">
      <div className="pos-left">
        <div className="tabs">
          {carts.map((c, i) => (
            <div key={c.key} className={`tab ${c.key === cart.key ? 'tab-on' : ''}`}>
              <button onClick={() => setActive(i)}>{c.customer?.name ?? `Đơn ${i + 1}`}{c.lines.length ? ` (${c.lines.length})` : ''}</button>
              {carts.length > 1 && <button className="tab-x" onClick={() => closeCart(c.key)}>×</button>}
            </div>
          ))}
          <button className="tab tab-add" onClick={() => { setCarts([...carts, emptyCart()]); setActive(carts.length); }}>＋</button>
          <button className="tab tab-drafts" onClick={() => setDrafts(true)}>📋 Đơn tạm{draftCount ? ` (${draftCount})` : ''}</button>
        </div>
        <ProductSearch priceListId={cart.priceListId} onPick={addProduct} />
        <div className="cart">
          {cart.lines.length === 0 && <div className="empty">Chưa có hàng. Gõ tên hàng hoặc bấm 📷 để quét mã.</div>}
          {cart.lines.map((l, i) => (
            <CartLine
              key={l.key}
              index={i}
              line={l}
              owner={owner}
              last={lastPrices[`${l.product_id}:${l.unit_id ?? 0}`]}
              onUseLast={() => {
                const lp = lastPrices[`${l.product_id}:${l.unit_id ?? 0}`];
                setLine(l.key, { price: lp.price, discMode: 'vnd', discValue: lp.discount });
              }}
              onQty={(qty) => (qty <= 0 ? removeLine(l.key) : setLine(l.key, { qty }))}
              onOpen={() => setEditing(l)}
              onRemove={() => removeLine(l.key)}
            />
          ))}
          {cart.lines.length > 0 && <button className="btn btn-sm clear-btn" onClick={() => confirmAsk('Xoá hết hàng trong đơn?') && update(emptyCart())}>Xoá hết</button>}
        </div>
      </div>

      <div className="pos-right">
        <Checkout cart={cart} set={setCheckout} t={t} priceLists={priceLists} onFinish={finish} onDraft={saveDraft} onQuote={quote} onPreview={() => setPreview(true)} busy={busy} />
      </div>

      <div className="pos-bar">
        <div className="grow">
          <small className="muted">{num(t.qty)} món</small>
          <div className="pos-bar-total">{money(t.total)}</div>
        </div>
        <button className="btn btn-success btn-lg" disabled={!cart.lines.length} onClick={() => setMobilePay(true)}>Thanh toán</button>
      </div>

      {mobilePay && (
        <Modal title="Thanh toán" onClose={() => setMobilePay(false)}>
          <Checkout cart={cart} set={setCheckout} t={t} priceLists={priceLists} onFinish={finish} onDraft={saveDraft} onQuote={quote} onPreview={() => setPreview(true)} busy={busy} compact />
        </Modal>
      )}
      {editing && (
        <LineEditor
          line={editing}
          owner={owner}
          onClose={() => setEditing(null)}
          onRemove={() => { removeLine(editing.key); setEditing(null); }}
          onSave={(l) => {
            const { key, ...patch } = l;
            setLine(key, patch);
            setEditing(null);
          }}
        />
      )}
      {drafts && <Drafts onOpen={openDraft} onClose={() => setDrafts(false)} />}
      {preview && (
        <Modal title="Xem trước hóa đơn · CHƯA GHI SỔ" onClose={() => setPreview(false)}
          footer={<div className="row gap"><button className="btn grow" onClick={() => setPreview(false)}>Quay lại chỉnh sửa</button><button className="btn btn-success grow" disabled={busy} onClick={() => { setPreview(false); finish(false); }}>Xác nhận thanh toán</button></div>}>
          <p className="muted">Đây là bản xem trước, chưa có số hóa đơn thật, chưa trừ kho hay ghi công nợ. Chỉ in bản chính thức sau khi thanh toán thành công.</p>
          <div className="psell-preview"><InvoiceA4 inv={previewInvoice()} settings={settings} /></div>
        </Modal>
      )}
      {done && (
        <Modal title={`Đã bán xong ${done.code}`} onClose={() => setDone(null)}>
          <div className="done-box">
            <div className="done-total">{vnd(done.total)}</div>
            {done.change_amount > 0 && <div className="big pos">Thối lại: {vnd(done.change_amount)}</div>}
            {done.debt > 0 && <div className="big neg">Ghi nợ: {vnd(done.debt)}</div>}
          </div>
          <ReceiptActions inv={done} onDone={() => setDone(null)} />
        </Modal>
      )}
      {printPortal}
    </div>
  );
}
