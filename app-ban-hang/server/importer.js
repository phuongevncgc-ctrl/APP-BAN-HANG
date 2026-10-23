// Nhập hàng hoá từ Excel KiotViet hoặc từ file db.json của app bán hàng cũ.
import ExcelJS from 'exceljs';
import { tx, nextCode, fold } from './db.js';
import { moveStock } from './routes/sales.js';
import { bad } from './util.js';

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const number = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(text(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const pick = (row, keys) => {
  for (const k of keys) if (text(row[k]) !== '') return row[k];
  return '';
};

// Giá trị ô Excel có thể là công thức, chữ định dạng, liên kết...
function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if ('result' in v) return v.result ?? '';
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return v.text;
  return '';
}

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw bad('File Excel không có trang tính nào');
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = text(cellValue(cell.value));
  });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = { _row: n };
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (headers[col]) obj[headers[col]] = cellValue(cell.value);
    });
    rows.push(obj);
  });
  return rows;
}

// Chuyển dòng Excel KiotViet thành danh sách hàng, gom đơn vị quy đổi vào hàng gốc.
// Ví dụ: BMO2719 (Mét) và BMO2719C (Cây, quy đổi 4, Mã ĐVT cơ bản = BMO2719) -> 1 hàng có 2 đơn vị.
export function groupKiotVietRows(rows) {
  const groups = new Map();
  const errors = [];
  for (const r of rows) {
    const code = text(pick(r, ['Mã hàng', 'ma_hang'])).toUpperCase();
    const name = text(pick(r, ['Tên hàng', 'ten_hang']));
    if (!code || !name) {
      errors.push({ row: r._row, code, reason: !code ? 'Thiếu mã hàng' : 'Thiếu tên hàng' });
      continue;
    }
    if (/combo/i.test(text(pick(r, ['Loại hàng'])))) {
      errors.push({ row: r._row, code, reason: 'Combo: tạo combo trong app, không nhập từ file' });
      continue;
    }
    const factor = number(pick(r, ['Quy đổi', 'quy_doi'])) || 1;
    let baseRef = text(pick(r, ['Mã ĐVT Cơ bản', 'ma_dvt_co_ban'])).toUpperCase();
    if (!baseRef && factor !== 1) baseRef = text(pick(r, ['Mã HH Liên quan', 'ma_hh_lien_quan'])).toUpperCase();
    const isUnit = baseRef && baseRef !== code;
    const baseCode = isUnit ? baseRef : code;
    if (!groups.has(baseCode)) groups.set(baseCode, { code: baseCode, base: null, units: [] });
    const g = groups.get(baseCode);
    if (isUnit) {
      g.units.push({
        row: r._row,
        name: text(pick(r, ['ĐVT', 'Đơn vị tính'])) || 'ĐVT',
        factor,
        price: number(pick(r, ['Giá bán', 'gia_ban'])),
        code,
        barcode: text(pick(r, ['Mã vạch', 'ma_vach'])),
        direct_sale: text(pick(r, ['Được bán trực tiếp'])) !== '0',
      });
    } else {
      const group = text(pick(r, ['Nhóm hàng(3 Cấp)', 'Nhóm hàng', 'nhom_hang']));
      g.base = {
        row: r._row,
        code,
        name,
        unit: text(pick(r, ['ĐVT', 'Đơn vị tính'])) || 'Cái',
        barcode: text(pick(r, ['Mã vạch', 'ma_vach'])),
        category: group.split('>>').pop().trim(),
        cost: number(pick(r, ['Giá vốn', 'gia_von'])),
        price: number(pick(r, ['Giá bán', 'gia_ban'])),
        stock: number(pick(r, ['Tồn kho', 'ton_kho'])),
        min_stock: number(pick(r, ['Tồn nhỏ nhất', 'ton_nho_nhat'])),
        active: text(pick(r, ['Đang kinh doanh'])) !== '0',
        track_stock: !/dịch vụ/i.test(text(pick(r, ['Loại hàng']))),
      };
    }
  }
  return { groups: [...groups.values()], errors };
}

// Chuyển dữ liệu từ db.json của app cũ sang cùng dạng.
function groupOldAppProducts(products) {
  return (products ?? []).map((p) => {
    const baseUnit = text(p.baseUnit || p.unit) || 'Cái';
    return {
      code: text(p.code).toUpperCase(),
      base: {
        code: text(p.code).toUpperCase(),
        name: text(p.name),
        unit: baseUnit,
        barcode: text(p.barcode),
        category: text(p.group),
        cost: number(p.cost),
        price: number(p.price),
        stock: number(p.stock),
        min_stock: number(p.minStock),
        active: true,
        track_stock: true,
      },
      units: (p.units ?? [])
        .filter((u) => !u.isBase && number(u.factor) !== 1 && fold(u.name) !== fold(baseUnit))
        .map((u) => ({
          name: text(u.name), factor: number(u.factor) || 1, price: number(u.price),
          code: text(u.code).toUpperCase(), barcode: text(u.barcode), direct_sale: u.directSale !== false,
        })),
    };
  });
}

function saveGroups(db, groups, { updateStock }) {
  const result = { created: 0, updated: 0, units: 0, merged: 0, skipped: 0, errors: [] };
  const findProduct = db.prepare('SELECT * FROM products WHERE code = ?');
  const categoryId = (name) => {
    if (!name) return null;
    const c = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    return c ? c.id : Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid);
  };

  for (const g of groups) {
    let p = findProduct.get(g.code);
    if (p?.is_combo) {
      result.errors.push({ row: g.base?.row ?? g.units[0]?.row, code: g.code, reason: 'Mã này đang là combo trong app, bỏ qua' });
      result.skipped++;
      continue;
    }
    if (g.base) {
      const b = g.base;
      if (!b.name) {
        result.errors.push({ row: b.row, code: b.code, reason: 'Thiếu tên hàng' });
        continue;
      }
      const fields = [b.name, fold(b.name), b.barcode || null, categoryId(b.category), b.unit, Math.round(b.cost), Math.round(b.price),
        b.min_stock, b.track_stock ? 1 : 0, b.active ? 1 : 0];
      if (p) {
        db.prepare(`UPDATE products SET name=?, search=?, barcode=?, category_id=?, unit=?, cost=?, price=?, min_stock=?,
          track_stock=?, active=? WHERE id=?`).run(...fields, p.id);
        if (updateStock && b.track_stock && p.stock !== b.stock) moveStock(db, p.id, b.stock - p.stock, 'adjust', null);
        result.updated++;
      } else {
        const id = Number(db.prepare(`INSERT INTO products (name, search, barcode, category_id, unit, cost, price, min_stock,
          track_stock, active, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...fields, b.code).lastInsertRowid);
        if (b.stock && b.track_stock) moveStock(db, id, b.stock, 'init', null);
        result.created++;
      }
      p = findProduct.get(g.code);
    }
    if (!p) {
      for (const u of g.units) result.errors.push({ row: u.row, code: u.code, reason: `Không có hàng gốc mã ${g.code}` });
      result.skipped += g.units.length;
      continue;
    }
    for (const u of g.units) {
      // Lần nhập trước (hoặc app khác) đã tạo đơn vị này thành hàng riêng: gỡ ra để gom vào hàng gốc.
      if (u.code) {
        const dup = findProduct.get(u.code);
        if (dup && dup.id !== p.id) {
          const used = db.prepare('SELECT 1 FROM invoice_items WHERE product_id = ? UNION SELECT 1 FROM purchase_items WHERE product_id = ?').get(dup.id, dup.id);
          if (used) db.prepare("UPDATE products SET active = 0, code = code || '-CU' WHERE id = ?").run(dup.id);
          else db.prepare('DELETE FROM products WHERE id = ?').run(dup.id);
          result.merged++;
        }
        db.prepare('UPDATE product_units SET code = NULL WHERE code = ? AND product_id != ?').run(u.code, p.id);
      }
      const existing = db.prepare('SELECT id FROM product_units WHERE product_id = ? AND name = ? COLLATE NOCASE').get(p.id, u.name);
      const fields = [u.factor, Math.round(u.price), u.code || null, u.barcode || null, u.direct_sale ? 1 : 0];
      if (existing) db.prepare('UPDATE product_units SET factor=?, price=?, code=?, barcode=?, direct_sale=? WHERE id=?').run(...fields, existing.id);
      else db.prepare('INSERT INTO product_units (factor, price, code, barcode, direct_sale, product_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...fields, p.id, u.name);
      result.units++;
    }
  }
  return result;
}

function saveOldAppPartners(db, data) {
  let customers = 0;
  let suppliers = 0;
  for (const c of data.customers ?? []) {
    const name = text(c.name);
    if (!name || c.id === 'khach-than-thiet' || fold(name) === 'kh than thiet') continue;
    const phone = text(c.phone);
    const exists = phone
      ? db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(phone)
      : db.prepare('SELECT 1 FROM customers WHERE name = ? AND phone = ?').get(name, '');
    if (exists) continue;
    db.prepare(`INSERT INTO customers (code, name, search, phone, address, tax_code, debt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(nextCode(db, 'customers', 'KH'), name, fold(name), phone, text(c.address), text(c.taxCode), Math.round(number(c.debt)));
    customers++;
  }
  for (const s of data.suppliers ?? []) {
    const name = text(s.name);
    if (!name || db.prepare('SELECT 1 FROM suppliers WHERE name = ?').get(name)) continue;
    db.prepare('INSERT INTO suppliers (name, phone, address, debt) VALUES (?, ?, ?, ?)')
      .run(name, text(s.phone), text(s.address), Math.round(number(s.debt)));
    suppliers++;
  }
  return { customers, suppliers };
}

export async function importProducts(db, buffer, { updateStock = true } = {}) {
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx là file nén, bắt đầu bằng "PK"
  if (isZip) {
    let rows;
    try {
      rows = await readXlsx(buffer);
    } catch (err) {
      throw bad(`Không đọc được file Excel: ${err.message}`);
    }
    const { groups, errors } = groupKiotVietRows(rows);
    const result = tx(db, () => saveGroups(db, groups, { updateStock }));
    result.errors = [...errors, ...result.errors];
    result.skipped += errors.length;
    return { kind: 'excel', total: rows.length, ...result };
  }
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw bad('File không đúng. Hãy chọn file Excel (.xlsx) xuất từ KiotViet hoặc file db.json của app cũ.');
  }
  if (!Array.isArray(data.products)) throw bad('File db.json không có danh sách hàng hoá');
  return tx(db, () => {
    const result = saveGroups(db, groupOldAppProducts(data.products).filter((g) => g.code), { updateStock });
    return { kind: 'json', total: data.products.length, ...result, ...saveOldAppPartners(db, data) };
  });
}
