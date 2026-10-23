// Xuất file Excel: hàng hoá (nhập lại được), công nợ khách / nhà cung cấp, hoá đơn.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { requireOwner } from '../auth.js';
import { day } from '../util.js';
import { customerLedger, supplierLedger } from '../ledger.js';
import { getSettings } from './admin.js';

const METHOD = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };
const MONEY = '#,##0;[Red]-#,##0';
const QTY = '#,##0.###;[Red]-#,##0.###';

// Thêm một trang tính: cột [{header, key, width, money, qty}], dòng là object.
function addSheet(wb, name, columns, rows, { title, info = [], totals } = {}) {
  const ws = wb.addWorksheet(name);
  let start = 1;
  if (title) {
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    info.forEach((line, i) => (ws.getCell(2 + i, 1).value = line));
    start = 3 + info.length;
  }
  const header = ws.getRow(start);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width ?? 14;
    if (c.money) ws.getColumn(i + 1).numFmt = MONEY;
    if (c.qty) ws.getColumn(i + 1).numFmt = QTY;
  });
  for (const r of rows) ws.addRow(columns.map((c) => r[c.key] ?? null));
  if (totals) {
    const row = ws.addRow(columns.map((c, i) => (i === 0 ? 'Tổng cộng' : totals[c.key] ?? null)));
    row.font = { bold: true };
  }
  ws.views = [{ state: 'frozen', ySplit: start }];
  if (rows.length) ws.autoFilter = { from: { row: start, column: 1 }, to: { row: start, column: columns.length } };
  return ws;
}

async function send(res, wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(Buffer.from(buf));
}

const stamp = () => new Date().toLocaleDateString('sv').replaceAll('-', '');
const book = () => Object.assign(new ExcelJS.Workbook(), { creator: 'App bán hàng' });

const LEDGER_COLUMNS = [
  { header: 'Thời gian', key: 'created_at', width: 18 },
  { header: 'Chứng từ', key: 'code', width: 12 },
  { header: 'Loại', key: 'type', width: 22 },
  { header: 'Giá trị', key: 'amount', money: true },
  { header: 'Đã thanh toán', key: 'paid', money: true },
  { header: 'Chiết khấu', key: 'discount', money: true },
  { header: 'Nợ tăng', key: 'increase', money: true },
  { header: 'Nợ giảm', key: 'decrease', money: true },
  { header: 'Còn nợ', key: 'balance', money: true },
  { header: 'Hình thức', key: 'method_name', width: 13 },
  { header: 'Ghi chú', key: 'note', width: 30 },
];

function ledgerRows(l) {
  return [
    { created_at: '', code: '', type: 'Nợ đầu kỳ', balance: l.opening },
    ...l.rows.map((r) => ({
      ...r,
      increase: r.change > 0 ? r.change : null,
      decrease: r.change < 0 ? -r.change : null,
      discount: r.discount || null,
      method_name: METHOD[r.method] ?? '',
    })),
  ];
}

function rangeText(from, to) {
  if (!from && !to) return 'Toàn bộ thời gian';
  return `Từ ${from || '...'} đến ${to || '...'}`;
}

export default function exportRoutes(db) {
  const r = Router();

  // ---------- Hàng hoá: cột giống KiotViet, nhập lại vào app được ----------
  r.get('/export/products.xlsx', requireOwner, async (_req, res) => {
    const lists = db.prepare('SELECT id, name FROM price_lists ORDER BY id').all();
    const priceOf = new Map(db.prepare('SELECT price_list_id, product_id, unit_id, price FROM price_list_items').all()
      .map((x) => [`${x.price_list_id}:${x.product_id}:${x.unit_id}`, x.price]));
    const products = db.prepare(`SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.code`).all();
    const units = db.prepare('SELECT * FROM product_units ORDER BY product_id, id').all();
    const comboParts = db.prepare(`SELECT ci.combo_id, ci.qty, p.code, p.name, p.cost, p.stock FROM combo_items ci
      JOIN products p ON p.id = ci.item_id`).all();
    const columns = [
      { header: 'Loại hàng', key: 'kind', width: 12 },
      { header: 'Nhóm hàng(3 Cấp)', key: 'category', width: 18 },
      { header: 'Mã hàng', key: 'code', width: 14 },
      { header: 'Mã vạch', key: 'barcode', width: 15 },
      { header: 'Tên hàng', key: 'name', width: 36 },
      { header: 'Giá vốn', key: 'cost', money: true },
      { header: 'Giá bán', key: 'price', money: true },
      ...lists.map((l) => ({ header: l.name, key: `pl${l.id}`, money: true })),
      { header: 'Tồn kho', key: 'stock', qty: true, width: 10 },
      { header: 'Tồn nhỏ nhất', key: 'min_stock', qty: true, width: 10 },
      { header: 'Giá trị tồn', key: 'stock_value', money: true },
      { header: 'ĐVT', key: 'unit', width: 9 },
      { header: 'Mã ĐVT Cơ bản', key: 'base_code', width: 14 },
      { header: 'Quy đổi', key: 'factor', qty: true, width: 8 },
      { header: 'Đang kinh doanh', key: 'active', width: 9 },
      { header: 'Được bán trực tiếp', key: 'direct', width: 9 },
      { header: 'Thành phần combo', key: 'parts', width: 40 },
    ];
    const rows = [];
    for (const p of products) {
      const parts = comboParts.filter((x) => x.combo_id === p.id);
      const cost = p.is_combo ? Math.round(parts.reduce((s, x) => s + x.cost * x.qty, 0)) : Math.round(p.cost);
      const stock = p.is_combo
        ? (parts.length ? Math.max(0, Math.min(...parts.map((x) => Math.floor(x.stock / x.qty)))) : 0)
        : p.track_stock ? p.stock : null;
      const base = {
        kind: p.is_combo ? 'Combo' : p.track_stock ? 'Hàng hóa' : 'Dịch vụ', category: p.category ?? '',
        active: p.active ? 1 : 0, direct: 1,
      };
      const prices = Object.fromEntries(lists.map((l) => [`pl${l.id}`, priceOf.get(`${l.id}:${p.id}:0`) ?? null]));
      rows.push({
        ...base, ...prices, code: p.code, barcode: p.barcode, name: p.name, cost, price: p.price, stock,
        min_stock: p.min_stock || null, stock_value: p.track_stock && p.stock > 0 ? Math.round(p.stock * p.cost) : null,
        unit: p.unit, base_code: '', factor: 1,
        parts: parts.map((x) => `${x.qty} x ${x.code} ${x.name}`).join('; '),
      });
      units.filter((u) => u.product_id === p.id).forEach((u, i) => {
        rows.push({
          ...base,
          ...Object.fromEntries(lists.map((l) => [`pl${l.id}`, priceOf.get(`${l.id}:${p.id}:${u.id}`) ?? null])),
          code: u.code || `${p.code}-${i + 1}`, barcode: u.barcode ?? '', name: p.name,
          cost: Math.round(cost * u.factor), price: u.price,
          stock: stock === null ? null : Math.floor((stock / u.factor) * 1000) / 1000,
          unit: u.name, base_code: p.code, factor: u.factor, direct: u.direct_sale ? 1 : 0,
        });
      });
    }
    const wb = book();
    addSheet(wb, 'Hàng hoá', columns, rows);
    await send(res, wb, `HangHoa_${stamp()}.xlsx`);
  });

  // ---------- Công nợ khách hàng: tổng hợp + chi tiết từng khách có phát sinh ----------
  r.get('/export/customers.xlsx', requireOwner, async (req, res) => {
    const from = req.query.from ? day(req.query.from) : '';
    const to = req.query.to ? day(req.query.to) : '';
    const onlyDebt = req.query.debt === '1';
    const customers = db.prepare(`SELECT id FROM customers WHERE active = 1 ${onlyDebt ? 'AND debt != 0' : ''} ORDER BY name COLLATE NOCASE`).all();
    const ledgers = customers.map((c) => customerLedger(db, c.id, from, to));
    const summary = ledgers.map((l) => ({
      code: l.partner.code, name: l.partner.name, phone: l.partner.phone, address: l.partner.address, tax_code: l.partner.tax_code,
      opening: l.opening, amount: l.totals.amount, paid: l.totals.paid, discount: l.totals.discount || null, closing: l.closing,
    }));
    const wb = book();
    const sum = (k) => summary.reduce((s, x) => s + (x[k] ?? 0), 0);
    addSheet(wb, 'Tổng hợp công nợ', [
      { header: 'Mã KH', key: 'code', width: 10 },
      { header: 'Tên khách', key: 'name', width: 26 },
      { header: 'Điện thoại', key: 'phone', width: 13 },
      { header: 'Địa chỉ', key: 'address', width: 30 },
      { header: 'Mã số thuế', key: 'tax_code', width: 13 },
      { header: 'Nợ đầu kỳ', key: 'opening', money: true },
      { header: 'Tiền hàng (trừ trả)', key: 'amount', money: true },
      { header: 'Đã thanh toán', key: 'paid', money: true },
      { header: 'Chiết khấu', key: 'discount', money: true },
      { header: 'Nợ cuối kỳ', key: 'closing', money: true },
    ], summary, {
      title: `CÔNG NỢ KHÁCH HÀNG - ${getSettings(db).shop_name}`, info: [rangeText(from, to)],
      totals: { opening: sum('opening'), amount: sum('amount'), paid: sum('paid'), discount: sum('discount'), closing: sum('closing') },
    });
    const detail = [];
    for (const l of ledgers) {
      if (!l.rows.length && !l.opening) continue;
      for (const row of ledgerRows(l)) detail.push({ customer: `${l.partner.code} - ${l.partner.name}`, ...row });
    }
    addSheet(wb, 'Chi tiết công nợ', [{ header: 'Khách hàng', key: 'customer', width: 26 }, ...LEDGER_COLUMNS], detail, {
      title: 'SỔ CHI TIẾT CÔNG NỢ KHÁCH HÀNG', info: [rangeText(from, to)],
    });
    await send(res, wb, `CongNoKhachHang_${stamp()}.xlsx`);
  });

  // Sổ công nợ một khách (nhân viên cũng xuất được để gửi khách)
  r.get('/export/customers/:id/ledger.xlsx', async (req, res) => {
    const from = req.query.from ? day(req.query.from) : '';
    const to = req.query.to ? day(req.query.to) : '';
    const l = customerLedger(db, Number(req.params.id), from, to);
    const s = getSettings(db);
    const wb = book();
    addSheet(wb, 'Công nợ', LEDGER_COLUMNS, ledgerRows(l), {
      title: `SỔ CÔNG NỢ: ${l.partner.name}`,
      info: [`${l.partner.code}${l.partner.phone ? ` · ${l.partner.phone}` : ''}${l.partner.address ? ` · ${l.partner.address}` : ''}`,
        `${rangeText(from, to)} · Nợ cuối kỳ: ${l.closing.toLocaleString('vi-VN')} đ`, `${s.shop_name} ${s.shop_phone}`],
      totals: { amount: l.totals.amount, paid: l.totals.paid, discount: l.totals.discount, increase: l.totals.increase, decrease: l.totals.decrease, balance: l.closing },
    });
    await send(res, wb, `CongNo_${l.partner.code}_${stamp()}.xlsx`);
  });

  // ---------- Công nợ nhà cung cấp ----------
  r.get('/export/suppliers.xlsx', requireOwner, async (req, res) => {
    const from = req.query.from ? day(req.query.from) : '';
    const to = req.query.to ? day(req.query.to) : '';
    const ledgers = db.prepare('SELECT id FROM suppliers WHERE active = 1 ORDER BY name COLLATE NOCASE').all()
      .map((x) => supplierLedger(db, x.id, from, to));
    const summary = ledgers.map((l) => ({
      name: l.partner.name, phone: l.partner.phone, address: l.partner.address,
      opening: l.opening, amount: l.totals.amount, paid: l.totals.paid, closing: l.closing,
    }));
    const sum = (k) => summary.reduce((s, x) => s + (x[k] ?? 0), 0);
    const wb = book();
    addSheet(wb, 'Tổng hợp nợ NCC', [
      { header: 'Nhà cung cấp', key: 'name', width: 28 },
      { header: 'Điện thoại', key: 'phone', width: 13 },
      { header: 'Địa chỉ', key: 'address', width: 30 },
      { header: 'Nợ đầu kỳ', key: 'opening', money: true },
      { header: 'Tiền hàng (trừ trả)', key: 'amount', money: true },
      { header: 'Đã thanh toán', key: 'paid', money: true },
      { header: 'Nợ cuối kỳ', key: 'closing', money: true },
    ], summary, {
      title: `CÔNG NỢ NHÀ CUNG CẤP - ${getSettings(db).shop_name}`, info: [rangeText(from, to)],
      totals: { opening: sum('opening'), amount: sum('amount'), paid: sum('paid'), closing: sum('closing') },
    });
    const detail = [];
    for (const l of ledgers) {
      if (!l.rows.length && !l.opening) continue;
      for (const row of ledgerRows(l)) detail.push({ supplier: l.partner.name, ...row });
    }
    addSheet(wb, 'Chi tiết nợ NCC', [{ header: 'Nhà cung cấp', key: 'supplier', width: 26 }, ...LEDGER_COLUMNS], detail, {
      title: 'SỔ CHI TIẾT CÔNG NỢ NHÀ CUNG CẤP', info: [rangeText(from, to)],
    });
    await send(res, wb, `CongNoNCC_${stamp()}.xlsx`);
  });

  r.get('/export/suppliers/:id/ledger.xlsx', requireOwner, async (req, res) => {
    const from = req.query.from ? day(req.query.from) : '';
    const to = req.query.to ? day(req.query.to) : '';
    const l = supplierLedger(db, Number(req.params.id), from, to);
    const wb = book();
    addSheet(wb, 'Công nợ', LEDGER_COLUMNS, ledgerRows(l), {
      title: `SỔ CÔNG NỢ NHÀ CUNG CẤP: ${l.partner.name}`,
      info: [`${l.partner.phone}${l.partner.address ? ` · ${l.partner.address}` : ''}`, `${rangeText(from, to)} · Nợ cuối kỳ: ${l.closing.toLocaleString('vi-VN')} đ`],
      totals: { amount: l.totals.amount, paid: l.totals.paid, increase: l.totals.increase, decrease: l.totals.decrease, balance: l.closing },
    });
    await send(res, wb, `CongNoNCC_${l.partner.id}_${stamp()}.xlsx`);
  });

  // ---------- Hoá đơn trong khoảng ngày: danh sách + chi tiết từng món ----------
  r.get('/export/invoices.xlsx', requireOwner, async (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    const from = day(req.query.from, today);
    const to = day(req.query.to, today);
    const invoices = db.prepare(`SELECT i.*, c.code AS customer_code, c.name AS customer_name, u.name AS user_name,
        (SELECT COALESCE(SUM(total),0) FROM returns r WHERE r.invoice_id = i.id) AS returned
      FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = i.user_id
      WHERE date(i.created_at) BETWEEN ? AND ? ORDER BY i.id`).all(from, to);
    const pays = db.prepare(`SELECT ref_id, method, SUM(amount) AS amount FROM payments
      WHERE kind = 'sale' AND ref_id IN (SELECT id FROM invoices WHERE date(created_at) BETWEEN ? AND ?) GROUP BY ref_id, method`).all(from, to);
    const rows = invoices.map((i) => {
      const my = Object.fromEntries(pays.filter((p) => p.ref_id === i.id).map((p) => [p.method, p.amount]));
      return {
        ...i, status_name: i.status === 'done' ? 'Hoàn thành' : 'Đã huỷ', customer: i.customer_name ?? 'Khách lẻ',
        cash: my.cash || null, transfer: my.transfer || null, card: my.card || null, returned: i.returned || null, debt: i.debt || null,
      };
    });
    const done = rows.filter((x) => x.status === 'done');
    const sum = (k) => done.reduce((s, x) => s + (x[k] ?? 0), 0);
    const wb = book();
    addSheet(wb, 'Hoá đơn', [
      { header: 'Mã HĐ', key: 'code', width: 11 },
      { header: 'Thời gian', key: 'created_at', width: 18 },
      { header: 'Mã KH', key: 'customer_code', width: 9 },
      { header: 'Khách hàng', key: 'customer', width: 24 },
      { header: 'Tổng tiền hàng', key: 'subtotal', money: true },
      { header: 'Giảm giá HĐ', key: 'discount', money: true },
      { header: 'Khách cần trả', key: 'total', money: true },
      { header: 'Tiền mặt', key: 'cash', money: true },
      { header: 'Chuyển khoản', key: 'transfer', money: true },
      { header: 'Thẻ', key: 'card', money: true },
      { header: 'Ghi nợ', key: 'debt', money: true },
      { header: 'Đã trả hàng', key: 'returned', money: true },
      { header: 'Trạng thái', key: 'status_name', width: 11 },
      { header: 'Người bán', key: 'user_name', width: 14 },
      { header: 'Ghi chú', key: 'note', width: 24 },
    ], rows, {
      title: 'DANH SÁCH HOÁ ĐƠN', info: [`Từ ${from} đến ${to} (tổng cộng không tính hoá đơn đã huỷ)`],
      totals: { subtotal: sum('subtotal'), discount: sum('discount'), total: sum('total'), cash: sum('cash'), transfer: sum('transfer'), card: sum('card'), debt: sum('debt'), returned: sum('returned') },
    });
    const items = db.prepare(`SELECT i.code AS invoice_code, i.created_at, c.name AS customer, it.name, it.unit, it.qty, it.price, it.discount,
        it.total, it.returned_qty, p.code
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN products p ON p.id = it.product_id
      WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ? ORDER BY i.id, it.id`).all(from, to);
    addSheet(wb, 'Chi tiết hàng bán', [
      { header: 'Mã HĐ', key: 'invoice_code', width: 11 },
      { header: 'Thời gian', key: 'created_at', width: 18 },
      { header: 'Khách hàng', key: 'customer', width: 22 },
      { header: 'Mã hàng', key: 'code', width: 12 },
      { header: 'Tên hàng', key: 'name', width: 32 },
      { header: 'ĐVT', key: 'unit', width: 8 },
      { header: 'Số lượng', key: 'qty', qty: true, width: 9 },
      { header: 'Đơn giá', key: 'price', money: true },
      { header: 'Giảm/1', key: 'discount', money: true },
      { header: 'Thành tiền', key: 'total', money: true },
      { header: 'SL đã trả', key: 'returned_qty', qty: true, width: 9 },
    ], items.map((x) => ({ ...x, customer: x.customer ?? 'Khách lẻ', discount: x.discount || null, returned_qty: x.returned_qty || null })));
    await send(res, wb, `HoaDon_${from}_${to}.xlsx`);
  });

  return r;
}
