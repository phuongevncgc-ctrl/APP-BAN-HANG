// Vẽ hoá đơn K80/K58 và tem mã vạch thành ảnh đen trắng, gửi máy chủ in thẳng ra máy in qua IP.
import { get, post } from './api.js';
import { money, num, dateTime, METHOD_NAMES, moneyToWords } from './format.js';

const DOT = 8; // máy in nhiệt 203 dpi = 8 điểm / mm
const FONT = 'Arial, "Helvetica Neue", Roboto, sans-serif';

// ---------- Mã vạch Code 128 ----------
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 '
  + '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 '
  + '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 '
  + '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 '
  + '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 '
  + '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 '
  + '311141 411131 211412 211214 211232 2331112').split(' ');

// Trả về dãy độ rộng vạch/khoảng trắng (đơn vị module), bắt đầu bằng vạch đen.
export function code128(text) {
  const s = String(text).replace(/[^\x20-\x7e]/g, '?');
  const codes = [];
  const digits = /^\d+$/.test(s) && s.length >= 4;
  if (digits) {
    codes.push(105); // Start C
    const even = s.length - (s.length % 2);
    for (let i = 0; i < even; i += 2) codes.push(Number(s.slice(i, i + 2)));
    if (even < s.length) codes.push(100, s.charCodeAt(even) - 32); // chuyển sang B cho số lẻ cuối
  } else {
    codes.push(104); // Start B
    for (const ch of s) codes.push(ch.charCodeAt(0) - 32);
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.flatMap((c) => C128[c].split('').map(Number));
}

function drawBarcode(ctx, value, x, y, maxW, h) {
  const widths = code128(value);
  const modules = widths.reduce((a, b) => a + b, 0) + 20; // 10 module trắng mỗi bên
  const m = Math.max(1, Math.floor(maxW / modules));
  let cx = x + Math.floor((maxW - (modules - 20) * m) / 2);
  widths.forEach((w, i) => {
    if (i % 2 === 0) ctx.fillRect(cx, y, w * m, h);
    cx += w * m;
  });
}

// ---------- Vẽ chữ ----------
function setFont(ctx, size, bold) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
}

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxW || !line) {
        line = test;
        // Từ quá dài: cắt theo ký tự
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Vẽ từ trên xuống, tự tăng chiều cao.
class Painter {
  constructor(width, base) {
    this.w = width;
    this.base = base;
    this.y = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = 6000;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, width, 6000);
    this.ctx.fillStyle = '#000';
    this.ctx.textBaseline = 'top';
  }

  text(str, { size = 1, bold = false, align = 'left', x = 0, w = this.w } = {}) {
    const px = Math.round(this.base * size);
    setFont(this.ctx, px, bold);
    for (const line of wrap(this.ctx, str, w)) {
      const lw = this.ctx.measureText(line).width;
      const lx = align === 'center' ? x + (w - lw) / 2 : align === 'right' ? x + w - lw : x;
      this.ctx.fillText(line, lx, this.y);
      this.y += Math.round(px * 1.25);
    }
  }

  // Một hàng nhiều cột: [{text, w (tỉ lệ), align, bold}]
  row(cols, { size = 1, bold = false } = {}) {
    const px = Math.round(this.base * size);
    let x = 0;
    let maxH = 0;
    const startY = this.y;
    for (const c of cols) {
      const w = Math.round(c.w * this.w);
      this.y = startY;
      this.text(c.text, { size, bold: c.bold ?? bold, align: c.align ?? 'left', x, w: w - 4 });
      maxH = Math.max(maxH, this.y - startY);
      x += w;
    }
    this.y = startY + Math.max(maxH, Math.round(px * 1.25));
  }

  hr(dashed = true) {
    this.y += 4;
    const { ctx } = this;
    if (dashed) for (let x = 0; x < this.w; x += 12) ctx.fillRect(x, this.y, 7, 2);
    else ctx.fillRect(0, this.y, this.w, 2);
    this.y += 8;
  }

  gap(px) {
    this.y += px;
  }

  image() {
    return toImage(this.canvas, Math.min(this.y + 8, this.canvas.height));
  }
}

// Ảnh canvas -> dữ liệu bit (1 = đen) gửi cho máy chủ
export function toImage(canvas, height = canvas.height) {
  const width = Math.ceil(canvas.width / 8) * 8;
  const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, height).data;
  const bytesPerRow = width / 8;
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const lum = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
      if (px[i + 3] > 128 && lum < 140) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  let bin = '';
  for (let i = 0; i < bits.length; i += 0x8000) bin += String.fromCharCode(...bits.subarray(i, i + 0x8000));
  return { width, height, data: btoa(bin) };
}

// ---------- Hoá đơn khổ 80 / 58 ----------
export function renderReceipt(inv, settings, type = 'k80') {
  const width = type === 'k58' ? 384 : 576;
  const p = new Painter(width, type === 'k58' ? 20 : 24);
  p.text(settings.shop_name, { size: 1.35, bold: true, align: 'center' });
  if (settings.shop_address) p.text(settings.shop_address, { size: 0.9, align: 'center' });
  if (settings.shop_phone) p.text(`ĐT: ${settings.shop_phone}`, { size: 0.9, align: 'center' });
  p.gap(8);
  p.text('PHIẾU BÁN HÀNG', { size: 1.2, bold: true, align: 'center' });
  p.text(`${inv.code} · ${dateTime(inv.created_at)}`, { size: 0.9, align: 'center' });
  p.gap(4);
  p.text(`Khách: ${inv.customer_name || 'Khách lẻ'}${inv.customer_phone ? ` - ${inv.customer_phone}` : ''}`);
  if (inv.customer_address) p.text(`Đ/c: ${inv.customer_address}`, { size: 0.9 });
  if (inv.user_name) p.text(`Thu ngân: ${inv.user_name}`, { size: 0.9 });
  p.hr();
  const cols = [0.34, 0.14, 0.22, 0.30];
  p.row([
    { text: 'Đơn giá', w: cols[0] }, { text: 'SL', w: cols[1], align: 'right' },
    { text: 'Giảm', w: cols[2], align: 'right' }, { text: 'T.Tiền', w: cols[3], align: 'right' },
  ], { size: 0.9, bold: true });
  p.hr();
  inv.items.forEach((it, i) => {
    p.text(`${i + 1}. ${it.name}${it.unit ? ` (${it.unit})` : ''}`, { bold: true });
    p.row([
      { text: money(it.price), w: cols[0] }, { text: num(it.qty), w: cols[1], align: 'right' },
      { text: it.discount > 0 ? money(it.discount * it.qty) : '', w: cols[2], align: 'right' },
      { text: money(it.total), w: cols[3], align: 'right' },
    ]);
    p.gap(4);
  });
  p.hr();
  const line = (label, value, opts = {}) => p.row([{ text: label, w: 0.55 }, { text: value, w: 0.45, align: 'right' }], opts);
  line('Tổng tiền hàng', money(inv.subtotal));
  if (inv.discount > 0) line('Giảm giá HĐ', `-${money(inv.discount)}`);
  line('TỔNG CỘNG', money(inv.total), { size: 1.25, bold: true });
  const pays = (inv.payments ?? []).filter((x) => x.amount > 0);
  for (const x of pays) line(METHOD_NAMES[x.method], money(x.amount + (x.method === 'cash' ? inv.change_amount : 0)));
  if (inv.change_amount > 0) line('Tiền thối', money(inv.change_amount));
  const remaining = inv.total - inv.paid;
  if (remaining > 0) line('Còn nợ', money(remaining), { bold: true, size: 1.1 });
  p.gap(4);
  p.text(`(${moneyToWords(inv.total)})`, { size: 0.85, align: 'right' });
  if (inv.status === 'cancelled') p.text('ĐÃ HUỶ', { size: 1.4, bold: true, align: 'center' });
  if (settings.receipt_footer) {
    p.hr();
    p.text(settings.receipt_footer, { align: 'center' });
  }
  return p.image();
}

// ---------- Tem mã vạch ----------
// items: [{name, code, barcode, price, unit, qty}] -> danh sách ảnh, mỗi ảnh là một hàng tem
export function renderLabels(items, printer, settings) {
  const lw = printer.label_w * DOT;
  const lh = printer.label_h * DOT;
  const gap = printer.col_gap * DOT;
  const cols = printer.columns;
  const width = Math.ceil((cols * lw + (cols - 1) * gap) / 8) * 8;
  const flat = items.flatMap((it) => Array.from({ length: Math.max(0, Math.round(it.qty)) }, () => it));
  const rows = [];
  for (let i = 0; i < flat.length; i += cols) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = lh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, lh);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    flat.slice(i, i + cols).forEach((it, c) => drawLabel(ctx, it, c * (lw + gap), lw, lh, printer, settings));
    rows.push(canvas);
  }
  return rows;
}

function drawLabel(ctx, it, x0, w, h, printer, settings) {
  const pad = Math.round(1.2 * DOT);
  const innerW = w - pad * 2;
  const x = x0 + pad;
  let y = Math.round(0.8 * DOT);
  const small = Math.max(14, Math.round(h / 11));
  const center = (text, size, bold) => {
    setFont(ctx, size, bold);
    const tw = ctx.measureText(text).width;
    ctx.fillText(text, x + Math.max(0, (innerW - tw) / 2), y);
    y += Math.round(size * 1.15);
  };
  if (printer.show_shop && settings.shop_name) center(fitText(ctx, settings.shop_name, innerW, small, false), small, false);
  const nameSize = Math.max(16, Math.round(h / 9));
  setFont(ctx, nameSize, true);
  const nameLines = wrap(ctx, `${it.name}${it.unit ? ` (${it.unit})` : ''}`, innerW).slice(0, 2);
  for (const l of nameLines) center(l, nameSize, true);
  const priceSize = Math.max(18, Math.round(h / 7.5));
  const bottom = h - Math.round(0.6 * DOT) - (printer.show_price ? Math.round(priceSize * 1.15) : 0) - Math.round(small * 1.1);
  const value = it.barcode || it.code;
  const barH = bottom - y - 2;
  if (value && barH > 16) drawBarcode(ctx, value, x, y + 2, innerW, barH);
  y = bottom;
  center(value ?? '', small, false);
  if (printer.show_price) center(`${money(it.price)}đ`, priceSize, true);
}

function fitText(ctx, text, maxW, size, bold) {
  setFont(ctx, size, bold);
  let t = text;
  while (t.length > 3 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t;
}

// ---------- Gửi in ----------
let cache = null;
export async function loadPrinters(force = false) {
  if (!cache || force) cache = await get('/printers').catch(() => []);
  return cache;
}
export const setPrintersCache = (list) => {
  cache = list;
};

export function sendToPrinter(printer, images, copies = 1) {
  return post('/print', { printer_id: printer.id, images, copies });
}

// In hoá đơn ra máy in IP đầu tiên. Trả về false nếu chưa cài máy in (để in bằng trình duyệt).
export async function printReceiptIp(inv, settings) {
  const printer = (await loadPrinters()).find((p) => p.type === 'k80' || p.type === 'k58');
  if (!printer) return false;
  await sendToPrinter(printer, [renderReceipt(inv, settings, printer.type)]);
  return printer;
}

// ---------- Phiếu tổng kết (chốt ca) khổ K80 ----------
// lines: [[nhãn, giá trị, đậm?] | 'hr' | 'tiêu đề nhóm']
export function renderSummary(settings, title, sub, lines, type = 'k80') {
  const p = new Painter(type === 'k58' ? 384 : 576, type === 'k58' ? 20 : 24);
  p.text(settings.shop_name, { size: 1.2, bold: true, align: 'center' });
  p.text(title, { size: 1.2, bold: true, align: 'center' });
  if (sub) p.text(sub, { size: 0.9, align: 'center' });
  p.hr();
  for (const l of lines) {
    if (l === 'hr') p.hr();
    else if (typeof l === 'string') p.text(l, { bold: true });
    else p.row([{ text: l[0], w: 0.6 }, { text: l[1], w: 0.4, align: 'right' }], { bold: !!l[2] });
  }
  p.hr();
  p.text(`In lúc ${new Date().toLocaleString('vi-VN')}`, { size: 0.8, align: 'center' });
  return p.image();
}

export async function printSummaryIp(settings, title, sub, lines) {
  const printer = (await loadPrinters()).find((p) => p.type === 'k80' || p.type === 'k58');
  if (!printer) return false;
  await sendToPrinter(printer, [renderSummary(settings, title, sub, lines, printer.type)]);
  return printer;
}
