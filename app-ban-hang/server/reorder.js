// Gợi ý hàng cần nhập (theo ĐVT gốc): bán bình quân mỗi ngày trong `days` ngày gần đây,
// đủ bán `cover` ngày tới, cộng thêm tồn nhỏ nhất để không bị hết hàng giữa chừng.
// Cần nhập = (bán/ngày × cover) + tồn nhỏ nhất − tồn hiện tại.
export function reorderSuggest(db, { days = 30, cover = 14, supplierId = null } = {}) {
  const rows = db.prepare(`
    SELECT p.id, p.stock, p.min_stock,
      COALESCE((SELECT -SUM(m.qty) FROM stock_moves m WHERE m.product_id = p.id
        AND m.kind IN ('sale','cancel','return') AND m.created_at >= datetime('now','localtime', ?)), 0) AS sold,
      (SELECT pu.supplier_id FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
        WHERE pi.product_id = p.id ORDER BY pu.id DESC LIMIT 1) AS supplier_id
    FROM products p
    WHERE p.active = 1 AND p.track_stock = 1 AND p.is_combo = 0`).all(`-${days} days`);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const out = [];
  for (const r of rows) {
    if (supplierId && r.supplier_id !== supplierId) continue;
    const sold = Math.max(r3(r.sold), 0);
    const target = Math.ceil((sold / days) * cover - 1e-9) + r.min_stock;
    const need = Math.ceil(r3(target - r.stock) - 1e-9);
    if (need > 0) out.push({ id: r.id, sold, need, last_supplier_id: r.supplier_id ?? null });
  }
  return out.sort((a, b) => b.need - a.need);
}
