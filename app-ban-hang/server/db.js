// Cơ sở dữ liệu SQLite (dùng node:sqlite có sẵn trong Node, không cần cài thêm).
// Mọi số tiền lưu bằng số nguyên VND.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = [
  // v1
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    barcode TEXT,
    name TEXT NOT NULL,
    search TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit TEXT NOT NULL DEFAULT '',
    cost INTEGER NOT NULL DEFAULT 0, -- giá vốn bình quân 1 đơn vị gốc
    last_cost INTEGER NOT NULL DEFAULT 0, -- giá nhập lần cuối
    price INTEGER NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    track_stock INTEGER NOT NULL DEFAULT 1,
    image TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX products_barcode ON products(barcode);

  -- Đơn vị quy đổi. Đơn vị gốc nằm ngay trong products (unit, price), hệ số 1.
  CREATE TABLE product_units (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    factor REAL NOT NULL CHECK (factor > 0),
    price INTEGER NOT NULL DEFAULT 0,
    code TEXT UNIQUE COLLATE NOCASE,
    barcode TEXT,
    direct_sale INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX product_units_product ON product_units(product_id);
  CREATE INDEX product_units_barcode ON product_units(barcode);

  CREATE TABLE price_lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE price_list_items (
    price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_id INTEGER NOT NULL DEFAULT 0, -- 0 = đơn vị gốc
    price INTEGER NOT NULL,
    PRIMARY KEY (price_list_id, product_id, unit_id)
  );

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    search TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_code TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
    debt INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    debt INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    user_id INTEGER REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    price_list_id INTEGER REFERENCES price_lists(id),
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    change_amount INTEGER NOT NULL DEFAULT 0,
    debt INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','cancelled'))
  );
  CREATE INDEX invoices_created ON invoices(created_at);

  CREATE TABLE invoice_items (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    unit_id INTEGER, -- NULL = đơn vị gốc
    unit TEXT NOT NULL DEFAULT '',
    factor REAL NOT NULL DEFAULT 1, -- 1 đơn vị bán = factor đơn vị gốc
    qty REAL NOT NULL,
    price INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    cost INTEGER NOT NULL DEFAULT 0, -- giá vốn của 1 đơn vị bán
    total INTEGER NOT NULL,
    returned_qty REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX invoice_items_invoice ON invoice_items(invoice_id);

  CREATE TABLE returns (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    invoice_id INTEGER REFERENCES invoices(id),
    customer_id INTEGER REFERENCES customers(id),
    user_id INTEGER REFERENCES users(id),
    total INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX returns_created ON returns(created_at);

  CREATE TABLE return_items (
    id INTEGER PRIMARY KEY,
    return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    invoice_item_id INTEGER REFERENCES invoice_items(id),
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    factor REAL NOT NULL DEFAULT 1,
    qty REAL NOT NULL,
    price INTEGER NOT NULL,
    cost INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL
  );

  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    supplier_id INTEGER REFERENCES suppliers(id),
    user_id INTEGER REFERENCES users(id),
    total INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE purchase_items (
    id INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    unit_id INTEGER,
    unit TEXT NOT NULL DEFAULT '',
    factor REAL NOT NULL DEFAULT 1,
    qty REAL NOT NULL,
    cost INTEGER NOT NULL, -- giá nhập 1 đơn vị (đã trừ chiết khấu)
    total INTEGER NOT NULL
  );

  -- Trả hàng cho nhà cung cấp
  CREATE TABLE supplier_returns (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    supplier_id INTEGER REFERENCES suppliers(id),
    user_id INTEGER REFERENCES users(id),
    total INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE supplier_return_items (
    id INTEGER PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    unit_id INTEGER,
    unit TEXT NOT NULL DEFAULT '',
    factor REAL NOT NULL DEFAULT 1,
    qty REAL NOT NULL,
    cost INTEGER NOT NULL,
    total INTEGER NOT NULL
  );

  -- Đơn lưu tạm, dùng chung giữa các máy
  CREATE TABLE drafts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Mọi khoản tiền vào (+) / ra (-) của cửa hàng
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    kind TEXT NOT NULL CHECK (kind IN ('sale','return','debt_in','purchase','debt_out','supplier_return')),
    ref_id INTEGER,
    customer_id INTEGER REFERENCES customers(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','card')),
    amount INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0, -- chiết khấu khi thu/trả nợ
    user_id INTEGER REFERENCES users(id),
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX payments_created ON payments(created_at);

  -- Lịch sử thay đổi tồn kho
  CREATE TABLE stock_moves (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty REAL NOT NULL,
    kind TEXT NOT NULL,
    ref_id INTEGER,
    stock_after REAL NOT NULL
  );
  CREATE INDEX stock_moves_product ON stock_moves(product_id);

  INSERT INTO price_lists (id, name) VALUES (1, 'Giá sỉ');
  INSERT INTO settings (key, value) VALUES
    ('shop_name', 'Cửa hàng của tôi'),
    ('shop_address', ''),
    ('shop_phone', ''),
    ('receipt_footer', 'Cảm ơn quý khách, hẹn gặp lại!'),
    ('receipt_width', '80'),
    ('allow_negative_stock', '1'),
    ('bank_bin', ''),
    ('bank_account', ''),
    ('bank_holder', '');
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < SCHEMA.length; v++) {
    tx(db, () => {
      db.exec(SCHEMA[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

// Chạy fn trong một giao dịch; lỗi thì hoàn tác toàn bộ.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Mã tự tăng: HD000001, SP000001...
export function nextCode(db, table, prefix) {
  const row = db
    .prepare(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY length(code) DESC, code DESC LIMIT 1`)
    .get(`${prefix}%`);
  const n = row ? parseInt(row.code.slice(prefix.length), 10) || 0 : 0;
  return prefix + String(n + 1).padStart(6, '0');
}

// Bỏ dấu tiếng Việt để tìm kiếm "nuoc mam" ra "Nước mắm".
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}
