import { useState } from 'react';
import { get, post, put, setToken, downloadUrl } from '../api.js';
import { money, vnd } from '../format.js';
import { Field, Loading, Modal, useAction, useLoad } from '../components/ui.jsx';
import { useSettings, useUser, isOwner } from '../App.jsx';
import { ReceiptBody, usePrint } from '../components/Receipt.jsx';

// Mã BIN ngân hàng cho VietQR
const BANKS = [
  ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'], ['970407', 'Techcombank'],
  ['970422', 'MB Bank'], ['970416', 'ACB'], ['970432', 'VPBank'], ['970403', 'Sacombank'], ['970423', 'TPBank'],
  ['970441', 'VIB'], ['970443', 'SHB'], ['970437', 'HDBank'], ['970426', 'MSB'], ['970448', 'OCB'], ['970440', 'SeABank'],
  ['970449', 'LPBank'], ['970431', 'Eximbank'], ['970428', 'Nam A Bank'], ['970409', 'Bac A Bank'],
];

function ShopSettings({ reloadSettings }) {
  const settings = useSettings();
  const [f, setF] = useState(settings);
  const [run, busy] = useAction();
  const [print, portal] = usePrint();
  const save = async () => {
    if (await run(() => put('/settings', f), 'Đã lưu cài đặt')) reloadSettings();
  };
  const sample = {
    code: 'HD000123', created_at: new Date().toLocaleString('sv'), customer_name: 'Anh Ba', user_name: 'Thu ngân', subtotal: 230000, discount: 10000, total: 220000, paid: 220000, change_amount: 30000,
    items: [{ id: 1, name: 'Ống Hoa Sen 60', unit: 'Cây', qty: 2, price: 90000, discount: 5000, total: 170000 }, { id: 2, name: 'Keo dán ống', unit: 'Tuýp', qty: 2, price: 30000, discount: 0, total: 60000 }],
    payments: [{ method: 'cash', amount: 220000 }],
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
        <button className="btn" onClick={() => print(<ReceiptBody inv={sample} settings={f} />)}>🖨️ In thử</button>
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
          <Field label={edit.id ? 'Mật khẩu mới (bỏ trống nếu không đổi)' : 'Mật khẩu'}><input className="input" type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
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

function Backups() {
  const list = useLoad(() => get('/backups'), []);
  const [run, busy] = useAction();
  return (
    <div className="card">
      <div className="row-between">
        <h3>Sao lưu dữ liệu</h3>
        <button className="btn btn-sm" disabled={busy} onClick={async () => (await run(() => post('/backups'), 'Đã sao lưu')) && list.reload()}>Sao lưu ngay</button>
      </div>
      <p className="muted small">Máy tự sao lưu mỗi ngày lúc 23:30 và giữ 30 bản gần nhất. Nên tải một bản về máy khác hoặc USB mỗi tuần.</p>
      <Loading state={list}>
        {(rows) => (
          <div className="list">
            {rows.slice(0, 10).map((b) => (
              <a key={b.name} className="list-item" href={downloadUrl(`/backups/${b.name}`)} download>
                <span className="grow">{b.name.replace('banhang-', '').replace('.db', '')}</span>
                <small className="muted">{Math.round(b.size / 1024)} KB · Tải về</small>
              </a>
            ))}
          </div>
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
      <Field label="Mật khẩu mới"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
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
      <p>Điện thoại chỉ cho mở camera khi app chạy bằng địa chỉ <b>https://</b>. Cách dễ nhất: mở app qua Home Assistant (thanh bên trái → Bán hàng) bằng địa chỉ https của Home Assistant. Máy quét mã vạch cắm USB / Bluetooth thì dùng được ngay, không cần https.</p>
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
      {owner && <Users />}
      {owner && <Backups />}
      <Account reloadSettings={reloadSettings} />
    </div>
  );
}
