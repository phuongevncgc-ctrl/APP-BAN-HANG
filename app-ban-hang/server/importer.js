// Nhập dữ liệu từ Excel KiotViet (hàng hoá, khách hàng, nhà cung cấp) hoặc từ file db.json của app bán hàng cũ.
// Nguyên tắc cập nhật: cột nào không có hoặc để trống trong file thì giữ nguyên dữ liệu đang có trong app.
import ExcelJS from 'exceljs';
import { nextCode, fold } from './db.js';
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
// Giá trị có trong file thì trả về, ô trống / không có cột thì undefined (giữ nguyên dữ liệu cũ)
const optNum = (row, keys) => {
  const v = pick(row, keys);
  return text(v) === '' ? undefined : number(v);
};
const optText = (row, keys) => {
  const v = text(pick(row, keys));
  return v === '' ? undefined : v;
};
const yes = (row, keys) => {
  const v = text(pick(row, keys));
  return v === '' ? undefined : v !== '0' && !/^(không|khong|false|no)$/i.test(v);
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

const HEADER_KEYS = ['Mã hàng', 'ma_hang', 'Mã khách hàng', 'Mã nhà cung cấp', 'Mã NCC'];

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw bad('File Excel không có trang tính nào');
  // Dòng tiêu đề thường là dòng 1, nhưng có file có thêm dòng tên báo cáo phía trên
  let headerRow = 1;
  for (let n = 1; n <= Math.min(10, ws.rowCount); n++) {
    const vals = [];
    ws.getRow(n).eachCell((c) => vals.push(text(cellValue(c.value))));
    if (vals.some((v) => HEADER_KEYS.includes(v))) {
      headerRow = n;
      break;
    }
  }
  const headers = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = text(cellValue(cell.value));
  });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const obj = { _row: n };
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (headers[col]) obj[headers[col]] = cellValue(cell.value);
    });
    rows.push(obj);
  });
  return { rows, headers: headers.filter(Boolean) };
}

// Chuyển dòng Excel KiotViet thành danh sách hàng, gom đơn vị quy đổi vào hàng gốc.
// Ví dụ: BMO2719 (Mét) và BMO2719C (Cây, quy đổi 4, Mã ĐVT cơ bản = BMO2719) -> 1 hàng có 2 đơn vị.
// priceLists: [{id, name}] — cột nào trùng tên bảng giá trong app thì lấy làm giá theo bảng giá đó.
export function groupKiotVietRows(rows, priceLists = [], headers = []) {
  const groups = new Map();
  const errors = [];
  const listCols = priceLists
    .map((pl) => ({ id: pl.id, col: headers.find((h) => fold(h) === fold(pl.name)) }))
    .filter((x) => x.col);
  const listPrices = (r) => {
    const out = {};
    for (const { id, col } of listCols) {
      const v = optNum(r, [col]);
      if (v !== undefined && v > 0) out[id] = v;
    }
    return out;
  };
  for (const r of rows) {
    const code = text(pick(r, ['Mã hàng', 'ma_hang'])).toUpperCase();
    const name = text(pick(r, ['Tên hàng', 'ten_hang']));
    if (!code) {
      if (name) errors.push({ row: r._row, code, reason: 'Thiếu mã hàng' });
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
        price: optNum(r, ['Giá bán', 'gia_ban', 'Bảng giá chung']),
        code,
        barcode: optText(r, ['Mã vạch', 'ma_vach']),
        direct_sale: yes(r, ['Được bán trực tiếp']),
        prices: listPrices(r),
      });
    } else {
      const group = optText(r, ['Nhóm hàng(3 Cấp)', 'Nhóm hàng', 'nhom_hang']);
      const kind = text(pick(r, ['Loại hàng']));
      const image = text(pick(r, ['Hình ảnh (url1,url2...)', 'Hình ảnh'])).split(/[,\s]+/).find((u) => /^https?:\/\//i.test(u));
      g.base = {
        row: r._row,
        code,
        name: name || undefined,
        unit: optText(r, ['ĐVT', 'Đơn vị tính']),
        barcode: optText(r, ['Mã vạch', 'ma_vach']),
        category: group === undefined ? undefined : group.split('>>').pop().trim(),
        cost: optNum(r, ['Giá vốn', 'gia_von']),
        price: optNum(r, ['Giá bán', 'gia_ban', 'Bảng giá chung']),
        stock: optNum(r, ['Tồn kho', 'ton_kho']),
        min_stock: optNum(r, ['Tồn nhỏ nhất', 'ton_nho_nhat']),
        active: yes(r, ['Đang kinh doanh']),
        track_stock: kind ? !/dịch vụ/i.test(kind) : undefined,
        image_url: image,
        prices: listPrices(r),
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
        barcode: text(p.barcode) || undefined,
        category: text(p.group) || undefined,
        cost: number(p.cost),
        price: number(p.price),
        stock: number(p.stock),
        min_stock: number(p.minStock),
        active: true,
        track_stock: true,
        prices: {},
      },
      units: (p.units ?? [])
        .filter((u) => !u.isBase && number(u.factor) !== 1 && fold(u.name) !== fold(baseUnit))
        .map((u) => ({
          name: text(u.name), factor: number(u.factor) || 1, price: number(u.price),
          code: text(u.code).toUpperCase(), barcode: text(u.barcode) || undefined, direct_sale: u.directSale !== false, prices: {},
        })),
    };
  });
}

function setListPrices(db, productId, unitId, prices) {
  for (const [listId, price] of Object.entries(prices ?? {})) {
    db.prepare(`INSERT INTO price_list_items (price_list_id, product_id, unit_id, price) VALUES (?, ?, ?, ?)
      ON CONFLICT (price_list_id, product_id, unit_id) DO UPDATE SET price = excluded.price`).run(Number(listId), productId, unitId, Math.round(price));
  }
}

function saveGroups(db, groups, { updateStock }) {
  const result = { created: 0, updated: 0, unchanged: 0, units: 0, merged: 0, skipped: 0, errors: [], changes: [], images: [] };
  const findProduct = db.prepare('SELECT * FROM products WHERE code = ?');
  const findUnitByCode = db.prepare('SELECT u.*, p.code AS product_code, p.name AS product_name FROM product_units u JOIN products p ON p.id = u.product_id WHERE u.code = ?');
  const categoryId = (name) => {
    if (!name) return null;
    const c = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    return c ? c.id : Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid);
  };
  const change = (p, what, from, to) => {
    if (result.changes.length < 300) result.changes.push({ code: p.code, name: p.name, what, from, to });
  };

  for (const g of groups) {
    let p = findProduct.get(g.code);
    if (p?.is_combo) {
      result.errors.push({ row: g.base?.row ?? g.units[0]?.row, code: g.code, reason: 'Mã này đang là combo trong app, bỏ qua' });
      result.skipped++;
      continue;
    }
    // File không có cột "Mã ĐVT Cơ bản" (vd file bảng giá): mã này là mã ĐVT quy đổi đã có trong app thì cập nhật đơn vị đó.
    if (!p && g.base && !g.units.length) {
      const u = findUnitByCode.get(g.code);
      if (u) {
        const b = g.base;
        if (b.price !== undefined && Math.round(b.price) !== u.price) {
          db.prepare('UPDATE product_units SET price = ? WHERE id = ?').run(Math.round(b.price), u.id);
          change({ code: g.code, name: `${u.product_name} (${u.name})` }, 'Giá bán', u.price, Math.round(b.price));
        }
        if (b.barcode !== undefined) db.prepare('UPDATE product_units SET barcode = ? WHERE id = ?').run(b.barcode, u.id);
        setListPrices(db, u.product_id, u.id, b.prices);
        result.units++;
        continue;
      }
    }
    if (g.base) {
      const b = g.base;
      if (p) {
        // Chỉ cập nhật cột có trong file
        const set = {};
        if (b.name !== undefined && b.name !== p.name) Object.assign(set, { name: b.name, search: fold(b.name) });
        if (b.unit !== undefined && b.unit !== p.unit) set.unit = b.unit;
        if (b.barcode !== undefined && b.barcode !== p.barcode) set.barcode = b.barcode;
        if (b.category !== undefined) {
          const cid = categoryId(b.category);
          if (cid !== p.category_id) set.category_id = cid;
        }
        if (b.cost !== undefined && Math.round(b.cost) !== Math.round(p.cost)) set.cost = Math.round(b.cost);
        if (b.price !== undefined && Math.round(b.price) !== p.price) {
          set.price = Math.round(b.price);
          change(p, 'Giá bán', p.price, set.price);
        }
        if (b.min_stock !== undefined && b.min_stock !== p.min_stock) set.min_stock = b.min_stock;
        if (b.track_stock !== undefined && (b.track_stock ? 1 : 0) !== p.track_stock) set.track_stock = b.track_stock ? 1 : 0;
        if (b.active !== undefined && (b.active ? 1 : 0) !== p.active) set.active = b.active ? 1 : 0;
        const keys = Object.keys(set);
        if (keys.length) db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), p.id);
        const tracked = set.track_stock ?? p.track_stock;
        let stockChanged = false;
        if (updateStock && b.stock !== undefined && tracked && Math.abs(p.stock - b.stock) > 1e-9) {
          moveStock(db, p.id, b.stock - p.stock, 'adjust', null);
          change(p, 'Tồn kho', p.stock, b.stock);
          stockChanged = true;
        }
        setListPrices(db, p.id, 0, b.prices);
        if (keys.length || stockChanged) result.updated++;
        else result.unchanged++;
      } else {
        if (!b.name) {
          result.errors.push({ row: b.row, code: b.code, reason: 'Thiếu tên hàng' });
          result.skipped++;
          continue;
        }
        const track = b.track_stock === undefined ? 1 : b.track_stock ? 1 : 0;
        const id = Number(db.prepare(`INSERT INTO products (name, search, barcode, category_id, unit, cost, price, min_stock,
          track_stock, active, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          b.name, fold(b.name), b.barcode ?? null, categoryId(b.category), b.unit ?? 'Cái', Math.round(b.cost ?? 0), Math.round(b.price ?? 0),
          b.min_stock ?? 0, track, b.active === false ? 0 : 1, b.code,
        ).lastInsertRowid);
        if (b.stock && track) moveStock(db, id, b.stock, 'init', null);
        setListPrices(db, id, 0, b.prices);
        result.created++;
      }
      p = findProduct.get(g.code);
      if (b.image_url && !p.image) result.images.push({ id: p.id, url: b.image_url });
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
      const existing = db.prepare('SELECT * FROM product_units WHERE product_id = ? AND name = ? COLLATE NOCASE').get(p.id, u.name);
      let unitId;
      if (existing) {
        const price = u.price === undefined ? existing.price : Math.round(u.price);
        if (price !== existing.price) change({ code: u.code || p.code, name: `${p.name} (${u.name})` }, 'Giá bán', existing.price, price);
        db.prepare('UPDATE product_units SET factor=?, price=?, code=?, barcode=?, direct_sale=? WHERE id=?').run(
          u.factor, price, u.code || existing.code, u.barcode === undefined ? existing.barcode : u.barcode,
          u.direct_sale === undefined ? existing.direct_sale : u.direct_sale ? 1 : 0, existing.id,
        );
        unitId = existing.id;
      } else {
        unitId = Number(db.prepare('INSERT INTO product_units (factor, price, code, barcode, direct_sale, product_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(u.factor, Math.round(u.price ?? 0), u.code || null, u.barcode ?? null, u.direct_sale === false ? 0 : 1, p.id, u.name).lastInsertRowid);
      }
      setListPrices(db, p.id, unitId, u.prices);
      result.units++;
    }
  }
  return result;
}

// ---------- Khách hàng / nhà cung cấp từ Excel KiotViet ----------
function saveCustomers(db, rows, { updateDebt }) {
  const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [], changes: [] };
  for (const r of rows) {
    const code = text(pick(r, ['Mã khách hàng'])).toUpperCase();
    const name = text(pick(r, ['Tên khách hàng']));
    if (!code && !name) continue;
    if (!name) {
      result.errors.push({ row: r._row, code, reason: 'Thiếu tên khách' });
      result.skipped++;
      continue;
    }
    const phone = text(pick(r, ['Điện thoại', 'Số điện thoại'])).replace(/\s/g, '');
    const address = [text(pick(r, ['Địa chỉ'])), text(pick(r, ['Phường/Xã'])), text(pick(r, ['Khu vực', 'Quận/Huyện']))].filter(Boolean).join(', ');
    const tax = text(pick(r, ['Mã số thuế']));
    const debt = optNum(r, ['Nợ cần thu hiện tại', 'Nợ hiện tại', 'Công nợ', 'Nợ cần thu']);
    const found = (code && db.prepare('SELECT * FROM customers WHERE code = ?').get(code))
      || (phone && db.prepare('SELECT * FROM customers WHERE phone = ? AND active = 1').get(phone));
    if (found) {
      db.prepare(`UPDATE customers SET name = ?, search = ?, phone = COALESCE(NULLIF(?, ''), phone), address = COALESCE(NULLIF(?, ''), address),
        tax_code = COALESCE(NULLIF(?, ''), tax_code) WHERE id = ?`).run(name, fold(name), phone, address, tax, found.id);
      if (updateDebt && debt !== undefined && Math.round(debt) !== found.debt) {
        db.prepare('UPDATE customers SET debt = ? WHERE id = ?').run(Math.round(debt), found.id);
        if (result.changes.length < 300) result.changes.push({ code: found.code, name, what: 'Công nợ', from: found.debt, to: Math.round(debt) });
        result.updated++;
      } else result.unchanged++;
    } else {
      db.prepare('INSERT INTO customers (code, name, search, phone, address, tax_code, debt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(code || nextCode(db, 'customers', 'KH'), name, fold(name), phone, address, tax, Math.round(debt ?? 0));
      result.created++;
    }
  }
  return result;
}

function saveSuppliers(db, rows, { updateDebt }) {
  const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [], changes: [] };
  for (const r of rows) {
    const name = text(pick(r, ['Tên nhà cung cấp', 'Tên NCC']));
    if (!name) continue;
    const phone = text(pick(r, ['Điện thoại', 'Số điện thoại'])).replace(/\s/g, '');
    const address = text(pick(r, ['Địa chỉ']));
    const debt = optNum(r, ['Nợ cần trả hiện tại', 'Nợ hiện tại', 'Công nợ', 'Nợ cần trả']);
    const found = db.prepare('SELECT * FROM suppliers WHERE name = ?').get(name);
    if (found) {
      db.prepare("UPDATE suppliers SET phone = COALESCE(NULLIF(?, ''), phone), address = COALESCE(NULLIF(?, ''), address) WHERE id = ?").run(phone, address, found.id);
      if (updateDebt && debt !== undefined && Math.round(debt) !== found.debt) {
        db.prepare('UPDATE suppliers SET debt = ? WHERE id = ?').run(Math.round(debt), found.id);
        if (result.changes.length < 300) result.changes.push({ code: '', name, what: 'Công nợ', from: found.debt, to: Math.round(debt) });
        result.updated++;
      } else result.unchanged++;
    } else {
      db.prepare('INSERT INTO suppliers (name, phone, address, debt) VALUES (?, ?, ?, ?)').run(name, phone, address, Math.round(debt ?? 0));
      result.created++;
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

// Chạy trong giao dịch; xem trước (dryRun) thì huỷ hết thay đổi sau khi tính xong.
function run(db, dryRun, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
    return { ...result, dryRun };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// updateStock: cập nhật tồn kho (hàng) hoặc công nợ (khách, NCC) theo file cho dữ liệu đã có.
export async function importProducts(db, buffer, { updateStock = true, dryRun = false } = {}) {
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx là file nén, bắt đầu bằng "PK"
  if (isZip) {
    let sheet;
    try {
      sheet = await readXlsx(buffer);
    } catch (err) {
      throw bad(`Không đọc được file Excel: ${err.message}`);
    }
    const { rows, headers } = sheet;
    if (headers.includes('Mã khách hàng') || headers.includes('Tên khách hàng')) {
      return { kind: 'customers', total: rows.length, ...run(db, dryRun, () => saveCustomers(db, rows, { updateDebt: updateStock })) };
    }
    if (headers.includes('Tên nhà cung cấp') || headers.includes('Mã nhà cung cấp')) {
      return { kind: 'suppliers', total: rows.length, ...run(db, dryRun, () => saveSuppliers(db, rows, { updateDebt: updateStock })) };
    }
    if (!headers.includes('Mã hàng') && !headers.includes('ma_hang')) {
      throw bad('Không thấy cột "Mã hàng". Hãy xuất file từ KiotViet: Hàng hoá → Xuất file (hoặc Khách hàng / Nhà cung cấp → Xuất file).');
    }
    const priceLists = db.prepare('SELECT id, name FROM price_lists').all();
    const { groups, errors } = groupKiotVietRows(rows, priceLists, headers);
    const result = run(db, dryRun, () => saveGroups(db, groups, { updateStock }));
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
  return run(db, dryRun, () => {
    const result = saveGroups(db, groupOldAppProducts(data.products).filter((g) => g.code), { updateStock });
    return { kind: 'json', total: data.products.length, ...result, ...saveOldAppPartners(db, data) };
  });
}
