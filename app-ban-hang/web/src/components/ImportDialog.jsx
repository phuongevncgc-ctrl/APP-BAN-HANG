import { useState } from 'react';
import { getToken } from '../api.js';
import { money, num } from '../format.js';
import { Modal, useToast } from './ui.jsx';

const KIND_NAMES = { excel: 'hàng', json: 'hàng', customers: 'khách', suppliers: 'nhà cung cấp' };

function Summary({ r }) {
  const what = KIND_NAMES[r.kind] ?? 'dòng';
  return (
    <div className="sumbox">
      <div className="row-between"><span>Thêm mới</span><b>{num(r.created)} {what}</b></div>
      <div className="row-between"><span>Có thay đổi</span><b>{num(r.updated)} {what}</b></div>
      {r.unchanged > 0 && <div className="row-between"><span>Giữ nguyên</span><span>{num(r.unchanged)} {what}</span></div>}
      {r.units > 0 && <div className="row-between"><span>Đơn vị quy đổi</span><span>{num(r.units)}</span></div>}
      {r.merged > 0 && <div>Gom {r.merged} hàng tách sai vào đúng mặt hàng gốc.</div>}
      {r.customers !== undefined && <div>Thêm {r.customers} khách hàng, {r.suppliers} nhà cung cấp.</div>}
      {r.images > 0 && !r.dryRun && <div className="muted small">Đang tải {r.images} ảnh hàng hoá từ KiotViet về (chạy nền vài phút).</div>}
    </div>
  );
}

function Details({ r }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      {r.changes?.length > 0 && (
        <>
          <button className="btn btn-block" onClick={() => setOpen(open === 'c' ? null : 'c')}>📝 {r.changes.length}{r.changes.length >= 300 ? '+' : ''} thay đổi giá / tồn / nợ — {open === 'c' ? 'Ẩn' : 'Xem'}</button>
          {open === 'c' && (
            <div className="list small">
              {r.changes.map((c, i) => (
                <div key={i} className="list-item">
                  <span className="grow">{c.code} {c.name}<small className="muted block">{c.what}</small></span>
                  <span className="r"><s className="muted">{c.what === 'Tồn kho' ? num(c.from) : money(c.from)}</s> → <b>{c.what === 'Tồn kho' ? num(c.to) : money(c.to)}</b></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {r.errors?.length > 0 && (
        <>
          <button className="btn btn-block" onClick={() => setOpen(open === 'e' ? null : 'e')}>⚠️ {r.errors.length} dòng bị bỏ qua — {open === 'e' ? 'Ẩn' : 'Xem'}</button>
          {open === 'e' && (
            <div className="list small">
              {r.errors.map((e, i) => <div key={i} className="list-item">Dòng {e.row ?? '?'} {e.code}: {e.reason}</div>)}
            </div>
          )}
        </>
      )}
    </>
  );
}

// Nhập file: chọn file → xem trước sẽ thay đổi gì → đồng ý mới ghi vào app.
export default function ImportDialog({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [updateStock, setUpdateStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const toast = useToast();
  const send = async (dry) => {
    setBusy(true);
    try {
      const res = await fetch(`api/products/import?update_stock=${updateStock ? 1 : 0}${dry ? '&dry=1' : ''}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (dry) setPreview(data);
      else {
        setResult(data);
        onDone();
      }
    } catch (err) {
      toast(err.message || 'Nhập file lỗi', 'error');
    } finally {
      setBusy(false);
    }
  };
  if (result) {
    return (
      <Modal title="Nhập file" onClose={onClose} footer={<button className="btn btn-primary btn-lg btn-block" onClick={onClose}>Xong</button>}>
        <div className="big pos">✅ Nhập xong</div>
        <Summary r={result} />
        <Details r={result} />
      </Modal>
    );
  }
  if (preview) {
    return (
      <Modal title="Xem trước khi nhập" onClose={onClose}
        footer={(
          <div className="row gap">
            <button className="btn" onClick={() => setPreview(null)}>← Chọn lại</button>
            <button className="btn btn-primary btn-lg grow" disabled={busy} onClick={() => send(false)}>{busy ? 'Đang nhập…' : 'Đồng ý nhập'}</button>
          </div>
        )}>
        <p>File <b>{file.name}</b> có {num(preview.total)} dòng. Nếu đồng ý, app sẽ:</p>
        <Summary r={preview} />
        <Details r={preview} />
        <p className="muted small">Cột nào không có trong file hoặc để trống thì app giữ nguyên dữ liệu cũ.</p>
      </Modal>
    );
  }
  return (
    <Modal title="Nhập dữ liệu từ file" onClose={onClose}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={!file || busy} onClick={() => send(true)}>{busy ? 'Đang đọc file…' : 'Xem trước'}</button>}>
      <p>Chọn file Excel (.xlsx) xuất từ <b>KiotViet</b>:</p>
      <ul>
        <li><b>Hàng hoá → Xuất file</b>: thêm hàng mới, cập nhật tên, giá, mã vạch, nhóm, ĐVT quy đổi, ảnh. Cột trùng tên bảng giá trong app (vd "Giá sỉ") thì cập nhật luôn bảng giá.</li>
        <li><b>Khách hàng → Xuất file</b> hoặc <b>Nhà cung cấp → Xuất file</b>: thêm khách / NCC kèm số nợ.</li>
      </ul>
      <p className="muted small">Hoặc file <b>db.json</b> của app bán hàng cũ. Nhập lại nhiều lần không bị trùng.</p>
      <input type="file" className="input" accept=".xlsx,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <label className="check"><input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} /> <span>Lấy <b>số tồn kho</b> (hàng) / <b>số nợ</b> (khách, NCC) theo file cho dữ liệu đã có</span></label>
      <p className="muted small">Khi chạy song song với KiotViet, nên tick ô này để số tồn và nợ giống KiotViet.</p>
    </Modal>
  );
}
