import { useEffect, useMemo, useRef, useState } from 'react';
import { money, num } from '../format.js';
import { Modal, QtyInput, useAction } from './ui.jsx';
import { useSettings, go } from '../App.jsx';
import { loadPrinters, renderLabels, sendToPrinter, toImage } from '../printing.js';

// Từ một hàng (có ĐVT quy đổi) tạo các dòng tem: ĐVT gốc + từng ĐVT có mã vạch / mã riêng.
export function labelItemsFromProduct(p, qty = 1) {
  const rows = [{ key: `${p.id}:0`, name: p.name, unit: p.units?.length ? p.unit : '', code: p.code, barcode: p.barcode, price: p.sell_price ?? p.price, qty }];
  for (const u of p.units ?? []) {
    if (!u.code && !u.barcode) continue;
    rows.push({ key: `${p.id}:${u.id}`, name: p.name, unit: u.name, code: u.code || p.code, barcode: u.barcode, price: u.price, qty: 0 });
  }
  return rows;
}

function Preview({ canvases }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    for (const c of canvases.slice(0, 3)) {
      c.className = 'label-preview';
      el.appendChild(c);
    }
  }, [canvases]);
  return <div ref={ref} className="label-previews" />;
}

// Hộp thoại in tem: chọn số tem cho từng dòng, chọn máy in tem, xem trước.
export default function LabelDialog({ items: initial, onClose }) {
  const settings = useSettings();
  const [items, setItems] = useState(initial);
  const [printers, setPrinters] = useState(null);
  const [printerId, setPrinterId] = useState('');
  const [run, busy] = useAction();
  useEffect(() => {
    loadPrinters(true).then((list) => {
      const labels = list.filter((p) => p.type === 'label');
      setPrinters(labels);
      if (labels[0]) setPrinterId(labels[0].id);
    });
  }, []);
  const printer = printers?.find((p) => p.id === printerId);
  const total = items.reduce((s, x) => s + Math.max(0, Math.round(x.qty)), 0);
  const canvases = useMemo(() => {
    if (!printer) return [];
    const first = items.find((x) => x.qty > 0);
    return first ? renderLabels([{ ...first, qty: printer.columns }], printer, settings) : [];
  }, [items, printer, settings]);
  const print = async () => {
    const images = renderLabels(items, printer, settings).map((c) => toImage(c));
    if (await run(() => sendToPrinter(printer, images), `Đã gửi in ${total} tem`)) onClose();
  };
  return (
    <Modal title="🏷️ In tem mã vạch" onClose={onClose} wide
      footer={printer && <button className="btn btn-primary btn-lg btn-block" disabled={busy || !total} onClick={print}>In {num(total)} tem</button>}>
      {printers && !printers.length && (
        <div className="warn">
          Chưa cài máy in tem. Vào <a href="#/cai-dat" onClick={() => { onClose(); go('cai-dat'); }}>Cài đặt → Máy in</a> để thêm máy in tem bằng địa chỉ IP.
        </div>
      )}
      {printers?.length > 1 && (
        <select className="input" value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
          {printers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.ip})</option>)}
        </select>
      )}
      <div className="list">
        {items.map((x, i) => (
          <div key={x.key ?? i} className="list-item">
            <span className="grow"><b>{x.name}</b>{x.unit && <> - <b className="unit">{x.unit}</b></>}
              <small className="muted block">{x.barcode || x.code} · {money(x.price)}</small></span>
            <span style={{ width: 90 }}><QtyInput value={x.qty} onChange={(qty) => setItems(items.map((y, j) => (j === i ? { ...y, qty } : y)))} /></span>
          </div>
        ))}
      </div>
      {printer && <><small className="muted">Xem trước ({printer.columns} tem mỗi hàng, {printer.label_w}×{printer.label_h} mm):</small><Preview canvases={canvases} /></>}
    </Modal>
  );
}
