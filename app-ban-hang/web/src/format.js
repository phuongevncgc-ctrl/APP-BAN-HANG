export const money = (n) => Math.round(Number(n) || 0).toLocaleString('vi-VN');
export const vnd = (n) => `${money(n)}đ`;

export function num(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString('vi-VN') : v.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

// "2026-10-23 14:05:00" -> "14:05 23/10/2026"
export function dateTime(s) {
  if (!s) return '';
  const [d, t = ''] = s.split(' ');
  const [y, m, dd] = d.split('-');
  return `${t.slice(0, 5)} ${dd}/${m}/${y}`.trim();
}

export function dateOnly(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export const isoDay = (d) => d.toLocaleDateString('sv');

export function rangePreset(key) {
  const now = new Date();
  const d = (y, m, day) => isoDay(new Date(y, m, day));
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'yesterday': {
      const t = d(y, m, now.getDate() - 1);
      return [t, t];
    }
    case '7days':
      return [d(y, m, now.getDate() - 6), isoDay(now)];
    case 'month':
      return [d(y, m, 1), isoDay(now)];
    case 'lastmonth':
      return [d(y, m - 1, 1), d(y, m, 0)];
    case 'year':
      return [d(y, 0, 1), isoDay(now)];
    default:
      return [isoDay(now), isoDay(now)];
  }
}

export const PRESETS = [
  ['today', 'Hôm nay'],
  ['yesterday', 'Hôm qua'],
  ['7days', '7 ngày'],
  ['month', 'Tháng này'],
  ['lastmonth', 'Tháng trước'],
  ['year', 'Năm nay'],
];

export const METHOD_NAMES = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', debt: 'Trừ vào nợ' };

// Bỏ dấu để so khớp tìm kiếm ở máy khách
export const fold = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

// Đọc số tiền thành chữ: 1250000 -> "Một triệu hai trăm năm mươi nghìn đồng"
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriple(n, full) {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out = [];
  if (full || h > 0) out.push(DIGITS[h], 'trăm');
  if (t > 1) {
    out.push(DIGITS[t], 'mươi');
    if (u === 1) out.push('mốt');
    else if (u === 5) out.push('lăm');
    else if (u === 4) out.push('tư');
    else if (u > 0) out.push(DIGITS[u]);
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]);
  } else if (u > 0) {
    if (full || h > 0) out.push('lẻ');
    out.push(DIGITS[u]);
  }
  return out;
}
export function moneyToWords(amount) {
  let n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Không đồng';
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    words.push(...readTriple(groups[i], i < groups.length - 1), units[i]);
  }
  const s = words.filter(Boolean).join(' ') + ' đồng';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Tên hàng kèm đơn vị: "Ống Hoa Sen 60 - Cây"
export const nameUnit = (name, unit) => (unit ? `${name} - ${unit}` : name);
