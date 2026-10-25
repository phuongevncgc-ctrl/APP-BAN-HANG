// Gửi báo cáo cuối ngày (doanh thu, lợi nhuận, chi phí...) về điện thoại qua Home Assistant.
// Chạy dạng add-on: dùng SUPERVISOR_TOKEN có sẵn. Chạy Docker riêng: đặt HA_URL + HA_TOKEN.
import { report } from './routes/admin.js';

const vnd = (n) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

function haTarget() {
  if (process.env.SUPERVISOR_TOKEN) return { url: 'http://supervisor/core/api', token: process.env.SUPERVISOR_TOKEN };
  if (process.env.HA_URL && process.env.HA_TOKEN) return { url: `${process.env.HA_URL.replace(/\/+$/, '')}/api`, token: process.env.HA_TOKEN };
  return null;
}

async function haCall(method, path, body) {
  const ha = haTarget();
  if (!ha) throw new Error('Không kết nối được Home Assistant (chỉ dùng được khi chạy dạng add-on)');
  const res = await fetch(ha.url + path, {
    method,
    headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Home Assistant báo lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Danh sách dịch vụ thông báo trong HA, vd "mobile_app_iphone_cua_chu"
export async function notifyServices() {
  const all = await haCall('GET', '/services');
  const notify = all.find((d) => d.domain === 'notify');
  return Object.keys(notify?.services ?? {}).filter((s) => s !== 'send_message').sort();
}

export function readNotify(db) {
  try {
    return { enabled: false, services: [], time: '21:00', ...JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'notify'").get()?.value || '{}') };
  } catch {
    return { enabled: false, services: [], time: '21:00' };
  }
}

export function saveNotify(db, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(value));
}

// Nội dung tin nhắn báo cáo một ngày
export function dailyMessage(db, date) {
  const r = report(db, date, date);
  const debtIn = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments
    WHERE kind = 'debt_in' AND date(created_at) = ?`).get(date).s;
  const lines = [
    `Doanh thu: ${vnd(r.revenue)} (${r.sales.count} hoá đơn${r.returns.count ? `, trả hàng ${vnd(r.returns.total)}` : ''})`,
    `Lợi nhuận gộp: ${vnd(r.profit)}`,
    `Chi phí: ${vnd(r.expenses)}${r.otherIncome ? ` · Thu khác: ${vnd(r.otherIncome)}` : ''}`,
    `Lãi ròng: ${vnd(r.netProfit)}`,
    `Tiền thu: mặt ${vnd(r.cashflow.cash)} · CK ${vnd(r.cashflow.transfer)}${r.cashflow.card ? ` · thẻ ${vnd(r.cashflow.card)}` : ''}`,
    `Khách nợ thêm: ${vnd(r.sales.debt)} · Thu nợ: ${vnd(debtIn)}`,
    `Tổng khách đang nợ: ${vnd(r.customerDebt)}`,
  ];
  if (r.lowStock) lines.push(`Hàng sắp hết / hết: ${r.lowStock} mặt hàng`);
  const [y, m, d] = date.split('-');
  return { title: `PSell báo cáo ngày ${d}/${m}/${y}`, message: lines.join('\n') };
}

export async function sendDaily(db, date, services = readNotify(db).services) {
  if (!services.length) throw new Error('Chưa chọn điện thoại nhận thông báo');
  const msg = dailyMessage(db, date);
  for (const s of services) await haCall('POST', `/services/notify/${encodeURIComponent(s)}`, msg);
  return msg;
}

// Gọi mỗi phút: tới giờ hẹn thì gửi báo cáo hôm nay (mỗi ngày một lần)
export async function notifyTick(db, now = new Date()) {
  const cfg = readNotify(db);
  if (!cfg.enabled || !cfg.services.length) return false;
  const today = now.toLocaleDateString('sv');
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (cfg.last_sent === today || hhmm < cfg.time) return false;
  saveNotify(db, { ...cfg, last_sent: today });
  try {
    await sendDaily(db, today, cfg.services);
    console.log('Đã gửi báo cáo cuối ngày qua Home Assistant');
  } catch (err) {
    console.error('Gửi báo cáo cuối ngày lỗi:', err.message);
  }
  return true;
}
