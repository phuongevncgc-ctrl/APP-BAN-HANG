import { useState } from 'react';
import { BANKS } from '../vietqr.js';
import { get, post, put, setToken, getToken, downloadUrl } from '../api.js';
import { money, vnd } from '../format.js';
import { Field, Loading, Modal, useAction, useLoad, confirmAsk } from '../components/ui.jsx';
import { useSettings, useUser, isOwner } from '../App.jsx';
import { ReceiptBody, usePrint } from '../components/Receipt.jsx';
import { renderReceipt, renderLabels, toImage, sendToPrinter, setPrintersCache } from '../printing.js';

const PRINTER_TYPES = [['k80', 'Hoá đơn K80'], ['k58', 'Hoá đơn K58'], ['label', 'Tem mã vạch']];
const SAMPLE_INV = {
  code: 'HD000123', created_at: new Date().toLocaleString('sv'), customer_name: 'Anh Ba', user_name: 'Thu ngân', subtotal: 230000, discount: 10000, total: 220000, paid: 220000, change_amount: 30000,
  items: [{ id: 1, name: 'Ống Hoa Sen 60', unit: 'Cây', qty: 2, price: 90000, discount: 5000, total: 170000 }, { id: 2, name: 'Keo dán ống', unit: 'Tuýp', qty: 2, price: 30000, discount: 0, total: 60000 }],
  payments: [{ method: 'cash', amount: 220000 }],
};
const SAMPLE_LABEL = { name: 'Ống nhựa Bình Minh 21mm', unit: 'Cây', code: 'BMO2719C', barcode: '8934567890123', price: 56000 };

function PrinterForm({ printer, onClose, onSave }) {
  const settings = useSettings();
  const [f, setF] = useState(printer);
  const [run, busy] = useAction();
  const set = (patch) => setF({ ...f, ...patch });
  const check = () => run(() => post('/printers/check', { ip: f.ip, port: f.port }), `Kết nối được máy in ${f.ip}`);
  const testPrint = async () => {
    // Lưu trước để máy chủ biết máy in này, rồi in thử
    const saved = await onSave(f, false);
    if (!saved) return;
    const p = saved.find((x) => x.id === f.id) ?? saved[saved.length - 1];
    const images = p.type === 'label'
      ? renderLabels([{ ...SAMPLE_LABEL, qty: p.columns }], p, settings).map((c) => toImage(c))
      : [renderReceipt(SAMPLE_INV, settings, p.type)];
    await run(() => sendToPrinter(p, images), 'Đã gửi trang in thử');
  };
  return (
    <Modal title={printer.ip ? 'Sửa máy in' : 'Thêm máy in'} onClose={onClose}
      footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => onSave(f, true)}>Lưu máy in</button>}>
      <Field label="Tên gọi"><input className="input" value={f.name} placeholder="vd: Máy in quầy, Máy in tem" onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Loại máy in">
        <div className="seg">{PRINTER_TYPES.map(([k, l]) => <button key={k} className={f.type === k ? 'on' : ''} onClick={() => set({ type: k })}>{l}</button>)}</div>
      </Field>
      <div className="grid2">
        <Field label="Địa chỉ IP" hint="In trang cấu hình của máy in để xem IP"><input className="input" inputMode="decimal" placeholder="192.168.1.100" value={f.ip} onChange={(e) => set({ ip: e.target.value.trim() })} /></Field>
        <Field label="Cổng"><input className="input" inputMode="numeric" value={f.port} onChange={(e) => set({ port: Number(e.target.value) || '' })} /></Field>
      </div>
      {f.type === 'label' && (
        <div className="sumbox">
          <b>Khổ tem</b>
          <div className="grid2">
            <Field label="Rộng 1 tem (mm)"><input className="input" inputMode="decimal" value={f.label_w} onChange={(e) => set({ label_w: Number(e.target.value) || '' })} /></Field>
            <Field label="Cao 1 tem (mm)"><input className="input" inputMode="decimal" value={f.label_h} onChange={(e) => set({ label_h: Number(e.target.value) || '' })} /></Field>
            <Field label="Số tem 1 hàng">
              <div className="seg">{[1, 2, 3].map((n) => <button key={n} className={f.columns === n ? 'on' : ''} onClick={() => set({ columns: n })}>{n} tem</button>)}</div>
            </Field>
            <Field label="Khe giữa 2 tem (mm)"><input className="input" inputMode="decimal" value={f.col_gap} onChange={(e) => set({ col_gap: Number(e.target.value) })} /></Field>
            <Field label="Khe giữa 2 hàng (mm)"><input className="input" inputMode="decimal" value={f.gap} onChange={(e) => set({ gap: Number(e.target.value) })} /></Field>
            <Field label="Độ đậm (1-15)"><input className="input" inputMode="numeric" value={f.density} onChange={(e) => set({ density: Number(e.target.value) })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={f.show_shop} onChange={(e) => set({ show_shop: e.target.checked })} /> In tên cửa hàng trên tem</label>
          <label className="check"><input type="checkbox" checked={f.show_price} onChange={(e) => set({ show_price: e.target.checked })} /> In giá bán trên tem</label>
          <label className="check"><input type="checkbox" checked={!f.invert} onChange={(e) => set({ invert: !e.target.checked })} /> Đảo màu (bật nếu tem in ra bị đen nền, chữ trắng)</label>
          <small className="muted">Cuộn tem 2 con thường là 35×22 mm hoặc 50×30 mm, khe 2 mm. Đo tem thật rồi điền.</small>
        </div>
      )}
      <div className="row gap">
        <button className="btn grow" disabled={busy || !f.ip} onClick={check}>🔌 Kiểm tra kết nối</button>
        <button className="btn grow" disabled={busy || !f.ip} onClick={testPrint}>🖨️ In thử</button>
      </div>
    </Modal>
  );
}

function Printers() {
  const list = useLoad(() => get('/printers'), []);
  const [edit, setEdit] = useState(null);
  const [run] = useAction();
  const save = async (p, close) => {
    const rows = list.data ?? [];
    const next = rows.some((x) => x.id === p.id) ? rows.map((x) => (x.id === p.id ? p : x)) : [...rows, p];
    const saved = await run(() => put('/printers', next), close ? 'Đã lưu máy in' : null);
    if (saved) {
      setPrintersCache(saved);
      list.reload();
      if (close) setEdit(null);
    }
    return saved;
  };
  const remove = async (p) => {
    if (!window.confirm(`Xoá máy in "${p.name}"?`)) return;
    const saved = await run(() => put('/printers', list.data.filter((x) => x.id !== p.id)), 'Đã xoá');
    if (saved) {
      setPrintersCache(saved);
      list.reload();
    }
  };
  const blank = { id: `p${Date.now().toString(36)}`, name: '', ip: '', port: 9100, type: 'k80', label_w: 35, label_h: 22, columns: 2, col_gap: 2, gap: 2, density: 8, invert: true, show_shop: true, show_price: true };
  return (
    <div className="card">
      <div className="row-between"><h3>🖨️ Máy in qua mạng (IP)</h3><button className="btn btn-sm" onClick={() => setEdit(blank)}>+ Thêm</button></div>
      <Loading state={list}>
        {(rows) => (
          <div className="list">
            {rows.length === 0 && <div className="empty">Chưa có máy in. Không cài thì app in bằng hộp thoại in của trình duyệt.</div>}
            {rows.map((p) => (
              <div key={p.id} className="list-item">
                <button className="grow text-left" onClick={() => setEdit({ ...blank, ...p })}>
                  <b>{p.name}</b>
                  <small className="muted block">{PRINTER_TYPES.find(([k]) => k === p.type)?.[1]} · {p.ip}:{p.port}{p.type === 'label' ? ` · ${p.columns} tem ${p.label_w}×${p.label_h}mm` : ''}</small>
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>Xoá</button>
              </div>
            ))}
          </div>
        )}
      </Loading>
      <p className="muted small">Máy in phải cắm dây mạng hoặc wifi <b>cùng mạng với máy Home Assistant</b>. Hoá đơn A4 thì bấm "In A4" ở hoá đơn và chọn máy in A4 trong hộp thoại in.</p>
      {edit && <PrinterForm printer={edit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

// Mã BIN ngân hàng cho VietQR

function ShopSettings({ reloadSettings }) {
  const settings = useSettings();
  const [f, setF] = useState(settings);
  const [run, busy] = useAction();
  const [print, portal] = usePrint();
  const save = async () => {
    if (await run(() => put('/settings', f), 'Đã lưu cài đặt')) reloadSettings();
  };
  return (
    <div className="card">
      <h3>Thông tin cửa hàng</h3>
      <Field label="Tên cửa hàng"><input className="input" value={f.shop_name} onChange={(e) => setF({ ...f, shop_name: e.target.value })} /></Field>
      <Field label="Địa chỉ"><input className="input" value={f.shop_address} onChange={(e) => setF({ ...f, shop_address: e.target.value })} /></Field>
      <Field label="Số điện thoại"><input className="input" value={f.shop_phone} onChange={(e) => setF({ ...f, shop_phone: e.target.value })} /></Field>
      <Field label="Lời cảm ơn cuối hoá đơn"><input className="input" value={f.receipt_footer} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} /></Field>
      <Field label="Khổ giấy in">
        <div className="seg">
          {['80', '58'].map((w) => <button key={w} className={f.receipt_width === w ? 'on' : ''} onClick={() => setF({ ...f, receipt_width: w })}>{w}mm</button>)}
        </div>
      </Field>
      <label className="check"><input type="checkbox" checked={f.allow_negative_stock !== '0'} onChange={(e) => setF({ ...f, allow_negative_stock: e.target.checked ? '1' : '0' })} /> Cho bán khi hết hàng (âm kho)</label>
      <h3>Tài khoản nhận chuyển khoản (hiện mã QR)</h3>
      <Field label="Ngân hàng">
        <select className="input" value={f.bank_bin} onChange={(e) => setF({ ...f, bank_bin: e.target.value })}>
          <option value="">-- Chọn ngân hàng --</option>
          {BANKS.map(([bin, name]) => <option key={bin} value={bin}>{name}</option>)}
        </select>
      </Field>
      <Field label="Số tài khoản"><input className="input" inputMode="numeric" value={f.bank_account} onChange={(e) => setF({ ...f, bank_account: e.target.value.trim() })} /></Field>
      <Field label="Tên chủ tài khoản"><input className="input" value={f.bank_holder} onChange={(e) => setF({ ...f, bank_holder: e.target.value.toUpperCase() })} /></Field>
      <div className="row gap">
        <button className="btn" onClick={() => print(<ReceiptBody inv={SAMPLE_INV} settings={f} />)}>🖨️ In thử</button>
        <button className="btn btn-primary grow" disabled={busy} onClick={save}>Lưu cài đặt</button>
      </div>
      {portal}
    </div>
  );
}

function Users() {
  const me = useUser();
  const users = useLoad(() => get('/users'), []);
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const save = async () => {
    const r = await run(() => (edit.id ? put(`/users/${edit.id}`, edit) : post('/users', edit)), 'Đã lưu');
    if (r) {
      setEdit(null);
      users.reload();
    }
  };
  return (
    <div className="card">
      <div className="row-between"><h3>Nhân viên</h3><button className="btn btn-sm" onClick={() => setEdit({ username: '', name: '', password: '', role: 'staff', active: true })}>+ Thêm</button></div>
      <Loading state={users}>
        {(rows) => (
          <div className="list">
            {rows.map((u) => (
              <button key={u.id} className={`list-item ${u.active ? '' : 'faded'}`} onClick={() => setEdit({ ...u, active: !!u.active, password: '' })}>
                <span className="grow"><b>{u.name}</b> <small className="muted">({u.username})</small>{u.id === me.id && <small> · bạn</small>}</span>
                <span className="badge">{u.role === 'owner' ? 'Chủ' : 'Nhân viên'}</span>
              </button>
            ))}
          </div>
        )}
      </Loading>
      <p className="muted small">Nhân viên được bán hàng, trả hàng, thêm khách, thu nợ, nhập hàng. Không xem được giá vốn, lợi nhuận và không sửa giá hàng.</p>
      {edit && (
        <Modal title={edit.id ? 'Sửa nhân viên' : 'Thêm nhân viên'} onClose={() => setEdit(null)}
          footer={<button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={save}>Lưu</button>}>
          <Field label="Tên"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Tên đăng nhập"><input className="input" autoCapitalize="none" disabled={!!edit.id} value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
          <Field label={edit.id ? 'Mật khẩu mới (bỏ trống nếu không đổi, ít nhất 12 ký tự)' : 'Mật khẩu (ít nhất 12 ký tự)'}><input className="input" type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          <Field label="Quyền">
            <div className="seg">
              <button className={edit.role === 'staff' ? 'on' : ''} onClick={() => setEdit({ ...edit, role: 'staff' })}>Nhân viên</button>
              <button className={edit.role === 'owner' ? 'on' : ''} onClick={() => setEdit({ ...edit, role: 'owner' })}>Chủ</button>
            </div>
          </Field>
          {edit.id && <label className="check"><input type="checkbox" checked={!edit.active} onChange={(e) => setEdit({ ...edit, active: !e.target.checked })} /> Khoá tài khoản (nghỉ làm)</label>}
        </Modal>
      )}
    </div>
  );
}

const RESTORE_WARN = 'Khôi phục sẽ thay TOÀN BỘ dữ liệu hiện tại (hàng hoá, hoá đơn, công nợ...) bằng bản sao lưu này.\n'
  + 'Dữ liệu hiện tại sẽ được tự sao lưu trước khi khôi phục.\n\nChú chắc chắn muốn khôi phục?';

function Backups() {
  const list = useLoad(() => get('/backups'), []);
  const [run, busy] = useAction();
  const done = () => setTimeout(() => window.location.reload(), 800);
  const restoreFrom = async (name) => {
    if (!confirmAsk(`${RESTORE_WARN}\n\nBản: ${label(name)}`)) return;
    if (await run(() => post(`/backups/${name}/restore`), 'Đã khôi phục dữ liệu')) done();
  };
  const upload = async (file) => {
    if (!file || !confirmAsk(`${RESTORE_WARN}\n\nFile: ${file.name}`)) return;
    const ok = await run(async () => {
      const res = await fetch('api/backups/restore', {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
      return data;
    }, 'Đã khôi phục dữ liệu');
    if (ok) done();
  };
  const label = (name) => name.replace('banhang-', '').replace('.db', '').replace(/^(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-?(\d\d)?.*$/, '$3/$2/$1 $4:$5:$6');
  return (
    <div className="card">
      <div className="row-between">
        <h3>💾 Sao lưu dữ liệu</h3>
        <button className="btn btn-sm" disabled={busy} onClick={async () => (await run(() => post('/backups'), 'Đã sao lưu')) && list.reload()}>Sao lưu ngay</button>
      </div>
      <p className="muted small">Máy tự sao lưu mỗi ngày lúc 23:30 và giữ 30 bản gần nhất. Nên tải một bản về máy khác hoặc USB mỗi tuần.
        Bản sao lưu của Home Assistant cũng chứa dữ liệu PSell.</p>
      <Loading state={list}>
        {(rows) => (
          <div className="list">
            {rows.length === 0 && <div className="empty">Chưa có bản sao lưu</div>}
            {rows.slice(0, 10).map((b) => (
              <div key={b.name} className="list-item">
                <span className="grow">{label(b.name)}<small className="muted block">{Math.round(b.size / 1024)} KB</small></span>
                <a className="btn btn-sm" href={downloadUrl(`/backups/${b.name}`)} download>Tải về</a>
                <button className="btn btn-sm" disabled={busy} onClick={() => restoreFrom(b.name)}>Khôi phục</button>
              </div>
            ))}
          </div>
        )}
      </Loading>
      <label className="btn btn-block">
        📂 Khôi phục từ file .db trong máy
        <input type="file" accept=".db" hidden disabled={busy} onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}

function Notify() {
  const state = useLoad(() => get('/notify'), []);
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  const cfg = f ?? state.data;
  const toggle = (s) => setF({ ...cfg, services: cfg.services.includes(s) ? cfg.services.filter((x) => x !== s) : [...cfg.services, s] });
  return (
    <div className="card">
      <h3>📲 Báo cáo cuối ngày về điện thoại</h3>
      <p className="muted small">Mỗi ngày tới giờ hẹn, PSell gửi doanh thu, lợi nhuận, chi phí, tiền thu, công nợ và hàng sắp hết
        về điện thoại qua ứng dụng Home Assistant (Companion app).</p>
      <Loading state={state}>
        {() => (
          <>
            {state.data.error && <div className="warn">{state.data.error}</div>}
            {!state.data.error && state.data.available.length === 0 && (
              <div className="warn">Chưa thấy điện thoại nào. Cài ứng dụng Home Assistant trên điện thoại và đăng nhập vào nhà mình trước.</div>
            )}
            {state.data.available.length > 0 && (
              <>
                <Field label="Gửi tới">
                  <div className="list">
                    {state.data.available.map((s) => (
                      <label key={s} className="list-item">
                        <input type="checkbox" checked={cfg.services.includes(s)} onChange={() => toggle(s)} />
                        <span className="grow">{s.replace(/^mobile_app_/, '📱 ').replaceAll('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="row gap">
                  <Field label="Giờ gửi"><input className="input" type="time" value={cfg.time} onChange={(e) => setF({ ...cfg, time: e.target.value })} /></Field>
                  <label className="row gap grow"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setF({ ...cfg, enabled: e.target.checked })} /> Tự gửi mỗi ngày</label>
                </div>
                <div className="row gap">
                  <button className="btn grow" disabled={busy || !cfg.services.length} onClick={() => run(() => post('/notify/test', { services: cfg.services }), 'Đã gửi báo cáo hôm nay, chú xem điện thoại')}>Gửi thử ngay</button>
                  <button className="btn btn-primary grow" disabled={busy || !f} onClick={async () => (await run(() => put('/notify', cfg), 'Đã lưu')) && (setF(null), state.reload())}>Lưu</button>
                </div>
              </>
            )}
          </>
        )}
      </Loading>
    </div>
  );
}

function Account({ reloadSettings }) {
  const user = useUser();
  const [f, setF] = useState({ old_password: '', password: '' });
  const [run, busy] = useAction();
  const today = useLoad(() => (isOwner(user) ? Promise.resolve(null) : get('/reports/today')), []);
  const logout = async () => {
    await post('/logout').catch(() => {});
    setToken(null);
    reloadSettings();
  };
  return (
    <div className="card">
      <h3>Tài khoản: {user.name}</h3>
      {today.data && (
        <div className="sumbox">
          <b>Hôm nay</b>
          <div className="row-between"><span>Số hoá đơn</span><b>{today.data.sales.count}</b></div>
          <div className="row-between"><span>Doanh thu</span><b>{vnd(today.data.revenue)}</b></div>
          <div className="row-between"><span>Tiền mặt</span><b>{money(today.data.cashflow.cash)}</b></div>
          <div className="row-between"><span>Chuyển khoản</span><b>{money(today.data.cashflow.transfer)}</b></div>
        </div>
      )}
      <Field label="Mật khẩu cũ"><input className="input" type="password" value={f.old_password} onChange={(e) => setF({ ...f, old_password: e.target.value })} /></Field>
      <Field label="Mật khẩu mới (ít nhất 12 ký tự)"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <div className="row gap">
        <button className="btn grow" disabled={busy || !f.password} onClick={async () => (await run(() => put('/me/password', f), 'Đã đổi mật khẩu')) && setF({ old_password: '', password: '' })}>Đổi mật khẩu</button>
        <button className="btn btn-danger" onClick={logout}>Đăng xuất</button>
      </div>
    </div>
  );
}

function HttpsHelp() {
  if (window.isSecureContext) return null;
  return (
    <div className="card warn-card">
      <h3>📷 Muốn quét mã vạch bằng camera điện thoại?</h3>
      <p>Điện thoại chỉ cho mở camera khi app chạy bằng địa chỉ <b>https://</b>. Cách dễ nhất: mở app qua Home Assistant (thanh bên trái → PSell) bằng địa chỉ https của Home Assistant. Máy quét mã vạch cắm USB / Bluetooth thì dùng được ngay, không cần https.</p>
    </div>
  );
}

export default function Settings({ reloadSettings }) {
  const owner = isOwner(useUser());
  return (
    <div className="page">
      <div className="page-head"><h1>Cài đặt</h1></div>
      <HttpsHelp />
      {owner && <ShopSettings reloadSettings={reloadSettings} />}
      {owner && <Printers />}
      {owner && <Users />}
      {owner && <Notify />}
      {owner && <Backups />}
      <Account reloadSettings={reloadSettings} />
    </div>
  );
}
