// Hàng hoá, đơn vị quy đổi, nhóm hàng, bảng giá.
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { tx, nextCode, fold } from '../db.js';
import { requireOwner, isOwner } from '../auth.js';
import { moveStock } from './sales.js';
import { importProducts } from '../importer.js';
import { bad, notFound, money, str, idOrNull } from '../util.js';

function saveImage(imagesDir, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl ?? '');
  if (!m) throw bad('Ảnh không hợp lệ');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw bad('Ảnh quá lớn (tối đa 2MB)');
  fs.mkdirSync(imagesDir, { recursive: true });
  const name = `${crypto.randomBytes(8).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(imagesDir, name), buf);
  return name;
}

export function privateAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) address = mapped[1];
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(address)) {
    const x = address.toLowerCase();
    return x === '::1' || x === '::' || /^fe[89ab]/.test(x) || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff') || x.startsWith('::ffff:');
  }
  return true;
}

async function safeImageUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses.length || addresses.some((x) => privateAddress(x.address))) return null;
  } catch { return null; }
  return u.href;
}

// Tải ảnh hàng hoá từ link (ảnh KiotViet) về máy, chạy nền sau khi nhập file.
async function downloadImages(db, imagesDir, jobs) {
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const { id, url } = queue.shift();
      try {
        const safeUrl = await safeImageUrl(url);
        if (!safeUrl) continue;
        const res = await fetch(safeUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        const type = /image\/(jpeg|png|webp)/.exec(res.headers.get('content-type') ?? '')?.[1];
        if (!res.ok || !type) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 3 * 1024 * 1024) continue;
        fs.mkdirSync(imagesDir, { recursive: true });
        const name = `${crypto.randomBytes(8).toString('hex')}.${type === 'jpeg' ? 'jpg' : type}`;
        fs.writeFileSync(path.join(imagesDir, name), buf);
        const { changes } = db.prepare('UPDATE products SET image = ? WHERE id = ? AND image IS NULL').run(name, id);
        if (!changes) fs.rmSync(path.join(imagesDir, name), { force: true });
      } catch {
        // Mất mạng hoặc link hỏng: bỏ qua ảnh này
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

function removeImage(imagesDir, name) {
  if (name && /^[a-f0-9]+\.(jpg|png|webp)$/.test(name)) fs.rmSync(path.join(imagesDir, name), { force: true });
}

const STOCK_FILTERS = {
  in: 'p.stock > 0',
  out: 'p.track_stock = 1 AND p.stock = 0',
  neg: 'p.track_stock = 1 AND p.stock < 0',
  low: 'p.track_stock = 1 AND p.min_stock > 0 AND p.stock <= p.min_stock',
};

// Mã hàng / mã vạch không được trùng giữa các hàng và các đơn vị quy đổi.
function assertCodeFree(db, code, productId, label = 'Mã') {
  if (!code) return;
  const p = db.prepare('SELECT name FROM products WHERE (code = ? OR barcode = ? COLLATE NOCASE) AND id != ?').get(code, code, productId ?? 0);
  const u = db.prepare(`SELECT p.name FROM product_units u JOIN products p ON p.id = u.product_id
    WHERE (u.code = ? OR u.barcode = ? COLLATE NOCASE) AND u.product_id != ?`).get(code, code, productId ?? 0);
  const hit = p ?? u;
  if (hit) throw bad(`${label} "${code}" đã dùng cho "${hit.name}"`);
}

export default function catalogRoutes(db, { imagesDir }) {
  const r = Router();

  const productFields = (req) => `p.id, p.code, p.barcode, p.name, p.category_id, p.unit, p.price, p.stock, p.min_stock,
    p.track_stock, p.image, p.active, p.is_combo, c.name AS category_name${isOwner(req) ? ', p.cost, p.last_cost' : ''}`;

  // Gắn danh sách đơn vị quy đổi và giá theo bảng giá vào từng hàng.
  function attachUnits(rows, listId) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const units = db.prepare(`SELECT u.*, pli.price AS list_price FROM product_units u
      LEFT JOIN price_list_items pli ON pli.product_id = u.product_id AND pli.unit_id = u.id AND pli.price_list_id = ?
      WHERE u.product_id IN (${ids.map(() => '?').join(',')}) ORDER BY u.factor`).all(listId ?? 0, ...ids);
    const byProduct = new Map();
    for (const u of units) {
      u.sell_price = u.list_price ?? u.price;
      if (!byProduct.has(u.product_id)) byProduct.set(u.product_id, []);
      byProduct.get(u.product_id).push(u);
    }
    for (const row of rows) {
      row.sell_price = row.list_price ?? row.price;
      row.units = byProduct.get(row.id) ?? [];
    }
    attachCombos(rows);
    return rows;
  }

  // Combo: danh sách món bên trong, số combo ráp được từ tồn kho, giá vốn = tổng giá vốn các món.
  function attachCombos(rows) {
    const combos = rows.filter((r) => r.is_combo);
    if (!combos.length) return;
    const parts = db.prepare(`SELECT ci.combo_id, ci.item_id, ci.qty, p.name, p.code, p.unit, p.stock, p.cost, p.track_stock
      FROM combo_items ci JOIN products p ON p.id = ci.item_id
      WHERE ci.combo_id IN (${combos.map(() => '?').join(',')})`).all(...combos.map((c) => c.id));
    for (const c of combos) {
      const mine = parts.filter((x) => x.combo_id === c.id);
      const tracked = mine.filter((x) => x.track_stock);
      c.stock = tracked.length ? Math.max(0, Math.min(...tracked.map((x) => Math.floor((x.stock + 1e-9) / x.qty)))) : 0;
      if ('cost' in c) c.cost = Math.round(mine.reduce((s, x) => s + x.cost * x.qty, 0));
      const owner = 'cost' in c;
      c.combo_items = mine.map(({ item_id, qty, name, code, unit, stock, cost }) => ({ item_id, qty, name, code, unit, stock, ...(owner ? { cost } : {}) }));
    }
  }

  // ---------- Hàng hoá ----------
  r.get('/products', (req, res) => {
    const raw = str(req.query.q, 100);
    const q = fold(raw);
    const listId = idOrNull(req.query.price_list);
    const where = ['1=1'];
    const args = [];
    if (req.query.all !== '1') where.push('p.active = 1');
    if (q) {
      // Tìm theo từng chữ: "ong 60" ra "Ống Hoa Sen 60"
      const words = q.split(/\s+/).filter(Boolean);
      where.push(`((${words.map(() => 'p.search LIKE ?').join(' AND ')}) OR p.code LIKE ? OR p.barcode = ? COLLATE NOCASE
        OR p.id IN (SELECT product_id FROM product_units WHERE code LIKE ? OR barcode = ? COLLATE NOCASE))`);
      args.push(...words.map((w) => `%${w}%`), `%${raw}%`, raw, `%${raw}%`, raw);
    }
    if (idOrNull(req.query.category)) {
      where.push('p.category_id = ?');
      args.push(Number(req.query.category));
    }
    if (STOCK_FILTERS[req.query.stock]) where.push(STOCK_FILTERS[req.query.stock]);
    const rows = db.prepare(`SELECT ${productFields(req)}, pli.price AS list_price
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN price_list_items pli ON pli.product_id = p.id AND pli.unit_id = 0 AND pli.price_list_id = ?
      WHERE ${where.join(' AND ')}
      ORDER BY p.name COLLATE NOCASE LIMIT ${Math.min(Number(req.query.limit) || 300, 50000)}`).all(listId ?? 0, ...args);
    res.json(attachUnits(rows, listId));
  });

  r.get('/products/stats', (_req, res) => {
    res.json(db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN track_stock = 1 THEN stock END),0) AS total_stock,
        SUM(stock > 0) AS in_stock,
        SUM(track_stock = 1 AND stock = 0) AS out_stock,
        SUM(track_stock = 1 AND stock < 0) AS neg_stock,
        SUM(track_stock = 1 AND min_stock > 0 AND stock <= min_stock) AS low_stock
      FROM products WHERE active = 1 AND is_combo = 0`).get());
  });

  // Tìm đúng mã vạch / mã hàng (dùng khi quét). Trả về cả đơn vị nếu mã thuộc đơn vị quy đổi.
  r.get('/products/lookup', (req, res) => {
    const code = str(req.query.code, 100);
    const listId = idOrNull(req.query.price_list);
    let unitId = null;
    let pid = db.prepare('SELECT id FROM products WHERE active = 1 AND (barcode = ? COLLATE NOCASE OR code = ?) LIMIT 1').get(code, code)?.id;
    if (!pid) {
      const u = db.prepare(`SELECT u.id, u.product_id FROM product_units u JOIN products p ON p.id = u.product_id
        WHERE p.active = 1 AND (u.barcode = ? COLLATE NOCASE OR u.code = ?) LIMIT 1`).get(code, code);
      if (u) [pid, unitId] = [u.product_id, u.id];
    }
    if (!pid) throw notFound(`Không có hàng mã "${code}"`);
    const row = db.prepare(`SELECT ${productFields(req)}, pli.price AS list_price FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN price_list_items pli ON pli.product_id = p.id AND pli.unit_id = 0 AND pli.price_list_id = ?
      WHERE p.id = ?`).get(listId ?? 0, pid);
    attachUnits([row], listId);
    row.unit_id = unitId;
    res.json(row);
  });

  r.get('/products/:id', (req, res) => {
    const p = db.prepare(`SELECT ${productFields(req)} FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`)
      .get(Number(req.params.id));
    if (!p) throw notFound('Không tìm thấy hàng');
    attachUnits([p], null);
    p.prices = Object.fromEntries(
      db.prepare('SELECT price_list_id, unit_id, price FROM price_list_items WHERE product_id = ?').all(p.id)
        .map((x) => [`${x.price_list_id}:${x.unit_id}`, x.price]),
    );
    // Thẻ kho: lịch sử nhập xuất kèm mã chứng từ
    p.moves = db.prepare(`SELECT m.created_at, m.qty, m.kind, m.ref_id, m.stock_after,
        CASE m.kind
          WHEN 'sale' THEN (SELECT code FROM invoices WHERE id = m.ref_id)
          WHEN 'cancel' THEN (SELECT code FROM invoices WHERE id = m.ref_id)
          WHEN 'return' THEN (SELECT code FROM returns WHERE id = m.ref_id)
          WHEN 'purchase' THEN (SELECT code FROM purchases WHERE id = m.ref_id)
          WHEN 'supplier_return' THEN (SELECT code FROM supplier_returns WHERE id = m.ref_id)
          WHEN 'count' THEN (SELECT code FROM stock_counts WHERE id = m.ref_id)
        END AS ref_code,
        CASE m.kind
          WHEN 'sale' THEN (SELECT c.name FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = m.ref_id)
          WHEN 'purchase' THEN (SELECT s.name FROM purchases x LEFT JOIN suppliers s ON s.id = x.supplier_id WHERE x.id = m.ref_id)
        END AS partner
      FROM stock_moves m WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 100`).all(p.id);
    res.json(p);
  });

  function readProduct(body, existing) {
    const name = str(body.name, 200);
    if (!name) throw bad('Chưa nhập tên hàng');
    const code = str(body.code, 50).toUpperCase() || existing?.code || nextCode(db, 'products', 'SP');
    const barcode = str(body.barcode, 100) || null;
    assertCodeFree(db, code, existing?.id, 'Mã hàng');
    if (barcode && barcode !== code) assertCodeFree(db, barcode, existing?.id, 'Mã vạch');
    return {
      code, barcode, name,
      search: fold(name),
      category_id: idOrNull(body.category_id),
      unit: str(body.unit, 30),
      cost: money(body.cost ?? existing?.cost, 'Giá vốn'),
      price: money(body.price, 'Giá bán'),
      min_stock: Number(body.min_stock) || 0,
      track_stock: body.is_combo || body.track_stock === false || body.track_stock === 0 ? 0 : 1,
      active: body.active === false || body.active === 0 ? 0 : 1,
      is_combo: body.is_combo ? 1 : 0,
    };
  }

  // Lưu thành phần combo: [{item_id, qty}] (qty theo đơn vị gốc của món bên trong)
  function saveComboItems(comboId, f, items) {
    db.prepare('DELETE FROM combo_items WHERE combo_id = ?').run(comboId);
    if (!f.is_combo) return;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) throw bad('Combo phải có ít nhất 1 món bên trong');
    for (const it of list) {
      const itemId = idOrNull(it.item_id);
      const q = Number(it.qty);
      const item = db.prepare('SELECT name, is_combo FROM products WHERE id = ?').get(itemId);
      if (!item) throw bad('Có món trong combo không tồn tại');
      if (item.is_combo || itemId === comboId) throw bad(`Không cho combo nằm trong combo ("${item.name}")`);
      if (!(q > 0)) throw bad(`Số lượng "${item.name}" trong combo phải lớn hơn 0`);
      db.prepare(`INSERT INTO combo_items (combo_id, item_id, qty) VALUES (?, ?, ?)
        ON CONFLICT (combo_id, item_id) DO UPDATE SET qty = qty + excluded.qty`).run(comboId, itemId, q);
    }
  }

  // Lưu đơn vị quy đổi: thay toàn bộ danh sách bằng danh sách gửi lên.
  function saveUnits(productId, units, baseUnit) {
    if (!Array.isArray(units)) return;
    const keep = [];
    const names = new Set([fold(baseUnit)]);
    for (const u of units) {
      const name = str(u.name, 30);
      if (!name) throw bad('Có đơn vị quy đổi chưa nhập tên');
      if (names.has(fold(name))) throw bad(`Đơn vị "${name}" bị trùng`);
      names.add(fold(name));
      const factor = Number(u.factor);
      if (!(factor > 0)) throw bad(`Số lượng quy đổi của "${name}" phải lớn hơn 0`);
      const code = str(u.code, 50).toUpperCase() || null;
      const barcode = str(u.barcode, 100) || null;
      assertCodeFree(db, code, productId, 'Mã hàng');
      if (barcode && barcode !== code) assertCodeFree(db, barcode, productId, 'Mã vạch');
      const fields = [name, factor, money(u.price, 'Giá bán'), code, barcode, u.direct_sale === false || u.direct_sale === 0 ? 0 : 1];
      const id = idOrNull(u.id);
      if (id && db.prepare('SELECT 1 FROM product_units WHERE id = ? AND product_id = ?').get(id, productId)) {
        db.prepare('UPDATE product_units SET name=?, factor=?, price=?, code=?, barcode=?, direct_sale=? WHERE id=?').run(...fields, id);
        keep.push(id);
      } else {
        keep.push(Number(db.prepare(`INSERT INTO product_units (name, factor, price, code, barcode, direct_sale, product_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...fields, productId).lastInsertRowid));
      }
    }
    const old = db.prepare('SELECT id FROM product_units WHERE product_id = ?').all(productId).map((x) => x.id).filter((id) => !keep.includes(id));
    for (const id of old) {
      db.prepare('DELETE FROM product_units WHERE id = ?').run(id);
      db.prepare('DELETE FROM price_list_items WHERE product_id = ? AND unit_id = ?').run(productId, id);
    }
    return keep;
  }

  // prices: { "bảngGiá:đơnVị": giá } — đơnVị 0 là đơn vị gốc; đơn vị mới dùng "bảngGiá:new0", "new1"...
  function savePrices(productId, prices, newUnitIds = []) {
    if (!prices || typeof prices !== 'object') return;
    for (const [key, price] of Object.entries(prices)) {
      const [listPart, unitPart = '0'] = key.split(':');
      const listId = Number(listPart);
      const unitId = unitPart.startsWith('new') ? newUnitIds[Number(unitPart.slice(3))] : Number(unitPart);
      if (!listId || unitId === undefined || Number.isNaN(unitId)) continue;
      if (price === '' || price === null || price === undefined) {
        db.prepare('DELETE FROM price_list_items WHERE price_list_id = ? AND product_id = ? AND unit_id = ?').run(listId, productId, unitId);
      } else {
        db.prepare(`INSERT INTO price_list_items (price_list_id, product_id, unit_id, price) VALUES (?, ?, ?, ?)
          ON CONFLICT (price_list_id, product_id, unit_id) DO UPDATE SET price = excluded.price`).run(listId, productId, unitId, money(price));
      }
    }
  }

  r.post('/products', requireOwner, (req, res) => {
    const f = readProduct(req.body);
    const image = req.body.image_data ? saveImage(imagesDir, req.body.image_data) : null;
    const id = tx(db, () => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO products
        (code, barcode, name, search, category_id, unit, cost, price, min_stock, track_stock, active, image, is_combo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        f.code, f.barcode, f.name, f.search, f.category_id, f.unit, f.cost, f.price, f.min_stock, f.track_stock, f.active, image, f.is_combo,
      );
      const id = Number(lastInsertRowid);
      saveComboItems(id, f, req.body.combo_items);
      const stock = Number(req.body.stock) || 0;
      if (stock && f.track_stock) moveStock(db, id, stock, 'init', null);
      const unitIds = saveUnits(id, req.body.units, f.unit) ?? [];
      savePrices(id, req.body.prices, unitIds.slice());
      return id;
    });
    res.json({ id });
  });

  r.put('/products/:id', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw notFound('Không tìm thấy hàng');
    const f = readProduct(req.body, existing);
    let image = existing.image;
    if (req.body.image_data) image = saveImage(imagesDir, req.body.image_data);
    else if (req.body.remove_image) image = null;
    tx(db, () => {
      if (existing.is_combo !== f.is_combo && db.prepare('SELECT 1 FROM invoice_items WHERE product_id = ?').get(id)) {
        throw bad('Hàng đã bán rồi nên không đổi được giữa hàng thường và combo. Hãy tạo hàng mới.');
      }
      if (f.is_combo && existing.stock) throw bad('Hàng này đang có tồn kho, không chuyển thành combo được. Hãy tạo combo mới.');
      db.prepare(`UPDATE products SET code=?, barcode=?, name=?, search=?, category_id=?, unit=?, cost=?, price=?,
        min_stock=?, track_stock=?, active=?, image=?, is_combo=? WHERE id=?`).run(
        f.code, f.barcode, f.name, f.search, f.category_id, f.unit, f.cost, f.price, f.min_stock, f.track_stock, f.active, image, f.is_combo, id,
      );
      saveComboItems(id, f, req.body.combo_items);
      const unitIds = saveUnits(id, req.body.units, f.unit) ?? [];
      // Đơn vị mới được thêm sau các đơn vị cũ, theo thứ tự gửi lên
      const newIds = (req.body.units ?? []).map((u, i) => (idOrNull(u.id) ? null : unitIds[i])).filter((x) => x);
      savePrices(id, req.body.prices, newIds);
    });
    if (image !== existing.image) removeImage(imagesDir, existing.image);
    res.json({ id });
  });

  // Cân bằng kho: đặt lại số tồn thực tế (theo đơn vị gốc)
  r.post('/products/:id/stock', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(id);
    if (!p) throw notFound('Không tìm thấy hàng');
    const actual = Number(req.body.stock);
    if (!Number.isFinite(actual)) throw bad('Số tồn không hợp lệ');
    tx(db, () => moveStock(db, id, actual - p.stock, 'adjust', null));
    res.json({ ok: true });
  });

  r.delete('/products/:id', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    const used = db.prepare(`SELECT 1 FROM invoice_items WHERE product_id = ?
      UNION SELECT 1 FROM purchase_items WHERE product_id = ? LIMIT 1`).get(id, id);
    if (used) {
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      return res.json({ hidden: true });
    }
    const p = db.prepare('SELECT image FROM products WHERE id = ?').get(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    removeImage(imagesDir, p?.image);
    res.json({ deleted: true });
  });

  // Nhập hàng hoá từ file: Excel xuất từ KiotViet (.xlsx) hoặc db.json của app cũ.
  r.post('/products/import', requireOwner, express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
    if (!req.body?.length) throw bad('Chưa chọn file');
    const dryRun = req.query.dry === '1';
    const result = await importProducts(db, req.body, { updateStock: req.query.update_stock !== '0', dryRun });
    const images = result.images ?? [];
    if (!dryRun && images.length) downloadImages(db, imagesDir, images);
    res.json({ ...result, images: images.length });
  });

  // ---------- Nhóm hàng ----------
  r.get('/categories', (_req, res) => {
    res.json(db.prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count
      FROM categories c ORDER BY c.name COLLATE NOCASE`).all());
  });
  r.post('/categories', requireOwner, (req, res) => {
    const name = str(req.body.name, 100);
    if (!name) throw bad('Chưa nhập tên nhóm');
    if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) throw bad('Nhóm này đã có');
    res.json({ id: Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid) });
  });
  r.put('/categories/:id', requireOwner, (req, res) => {
    const name = str(req.body.name, 100);
    if (!name) throw bad('Chưa nhập tên nhóm');
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, Number(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/categories/:id', requireOwner, (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Bảng giá ----------
  r.get('/price-lists', (_req, res) => {
    res.json(db.prepare(`SELECT pl.id, pl.name, pl.active,
        (SELECT COUNT(*) FROM price_list_items i WHERE i.price_list_id = pl.id) AS count
      FROM price_lists pl ORDER BY pl.name COLLATE NOCASE`).all());
  });
  r.post('/price-lists', requireOwner, (req, res) => {
    const name = str(req.body.name, 100);
    if (!name) throw bad('Chưa nhập tên bảng giá');
    if (db.prepare('SELECT 1 FROM price_lists WHERE name = ?').get(name)) throw bad('Bảng giá này đã có');
    const id = tx(db, () => {
      const id = Number(db.prepare('INSERT INTO price_lists (name) VALUES (?)').run(name).lastInsertRowid);
      // Tạo nhanh: lấy theo giá bán lẻ cộng/trừ phần trăm, làm tròn trăm đồng
      const pct = Number(req.body.percent);
      if (Number.isFinite(pct) && pct !== 0) {
        db.prepare(`INSERT INTO price_list_items (price_list_id, product_id, unit_id, price)
          SELECT ?, id, 0, CAST(ROUND(price * (100 + ?) / 100.0 / 100) * 100 AS INTEGER) FROM products WHERE active = 1`).run(id, pct);
        db.prepare(`INSERT INTO price_list_items (price_list_id, product_id, unit_id, price)
          SELECT ?, u.product_id, u.id, CAST(ROUND(u.price * (100 + ?) / 100.0 / 100) * 100 AS INTEGER)
          FROM product_units u JOIN products p ON p.id = u.product_id WHERE p.active = 1`).run(id, pct);
      }
      return id;
    });
    res.json({ id });
  });
  r.put('/price-lists/:id', requireOwner, (req, res) => {
    const name = str(req.body.name, 100);
    if (!name) throw bad('Chưa nhập tên bảng giá');
    db.prepare('UPDATE price_lists SET name = ?, active = ? WHERE id = ?').run(name, req.body.active === false ? 0 : 1, Number(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/price-lists/:id', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    tx(db, () => {
      db.prepare('UPDATE customers SET price_list_id = NULL WHERE price_list_id = ?').run(id);
      db.prepare('UPDATE invoices SET price_list_id = NULL WHERE price_list_id = ?').run(id);
      db.prepare('DELETE FROM price_lists WHERE id = ?').run(id);
    });
    res.json({ ok: true });
  });
  // Toàn bộ dòng giá của một bảng giá: mỗi hàng và mỗi đơn vị một dòng.
  r.get('/price-lists/:id/items', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    const q = fold(req.query.q);
    res.json(db.prepare(`
      SELECT p.id AS product_id, 0 AS unit_id, p.code, p.name, p.unit, p.price AS base_price, p.cost, pli.price
      FROM products p LEFT JOIN price_list_items pli ON pli.product_id = p.id AND pli.unit_id = 0 AND pli.price_list_id = ?
      WHERE p.active = 1 AND (? = '' OR p.search LIKE ? OR p.code LIKE ?)
      UNION ALL
      SELECT p.id, u.id, COALESCE(u.code, p.code), p.name, u.name, u.price, CAST(p.cost * u.factor AS INTEGER), pli.price
      FROM product_units u JOIN products p ON p.id = u.product_id
      LEFT JOIN price_list_items pli ON pli.product_id = p.id AND pli.unit_id = u.id AND pli.price_list_id = ?
      WHERE p.active = 1 AND (? = '' OR p.search LIKE ? OR p.code LIKE ?)
      ORDER BY 4 COLLATE NOCASE, 2 LIMIT ${Math.min(Number(req.query.limit) || 300, 50000)}`).all(id, q, `%${q}%`, `%${q}%`, id, q, `%${q}%`, `%${q}%`));
  });
  r.put('/price-lists/:id/items', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM price_lists WHERE id = ?').get(id)) throw notFound('Không tìm thấy bảng giá');
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    tx(db, () => {
      for (const it of items) {
        const pid = idOrNull(it.product_id);
        if (!pid) continue;
        const unitId = idOrNull(it.unit_id) ?? 0;
        if (it.price === null || it.price === '') {
          db.prepare('DELETE FROM price_list_items WHERE price_list_id = ? AND product_id = ? AND unit_id = ?').run(id, pid, unitId);
        } else {
          db.prepare(`INSERT INTO price_list_items (price_list_id, product_id, unit_id, price) VALUES (?, ?, ?, ?)
            ON CONFLICT (price_list_id, product_id, unit_id) DO UPDATE SET price = excluded.price`).run(id, pid, unitId, money(it.price));
        }
      }
    });
    res.json({ ok: true });
  });

  return r;
}
