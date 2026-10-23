export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);

// Số tiền: số nguyên VND, không âm.
export function money(v, field = 'Số tiền') {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw bad(`${field} không hợp lệ`);
  return Math.round(n);
}

// Số lượng: cho phép số lẻ (vd 1.5 kg), làm tròn 3 chữ số.
export function qty(v, field = 'Số lượng') {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw bad(`${field} phải lớn hơn 0`);
  return Math.round(n * 1000) / 1000;
}

export function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

export function idOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const METHODS = ['cash', 'transfer', 'card'];

// Chuẩn hoá danh sách thanh toán [{method, amount}], bỏ dòng 0đ.
export function payments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => {
      if (!METHODS.includes(p?.method)) throw bad('Hình thức thanh toán không hợp lệ');
      return { method: p.method, amount: money(p.amount) };
    })
    .filter((p) => p.amount > 0);
}

// Ngày dạng YYYY-MM-DD
export function day(v, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : fallback;
}
