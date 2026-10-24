// Báo cáo xuất nhập tồn theo kỳ (theo ĐVT gốc), tính ngược từ tồn hiện tại và thẻ kho.
export function stockReport(db, from, to, { q = '', category = null } = {}) {
  const rows = db.prepare(`
    SELECT p.id, p.code, p.name, p.unit, p.stock, p.cost, c.name AS category,
      COALESCE(SUM(CASE WHEN date(m.created_at) > ? THEN m.qty END), 0) AS after,
      COALESCE(SUM(CASE WHEN date(m.created_at) BETWEEN ? AND ? AND m.kind = 'purchase' THEN m.qty END), 0) AS purchase,
      COALESCE(SUM(CASE WHEN date(m.created_at) BETWEEN ? AND ? AND m.kind IN ('sale','cancel') THEN -m.qty END), 0) AS sold,
      COALESCE(SUM(CASE WHEN date(m.created_at) BETWEEN ? AND ? AND m.kind = 'return' THEN m.qty END), 0) AS returned,
      COALESCE(SUM(CASE WHEN date(m.created_at) BETWEEN ? AND ? AND m.kind = 'supplier_return' THEN -m.qty END), 0) AS supplier_return,
      COALESCE(SUM(CASE WHEN date(m.created_at) BETWEEN ? AND ? AND m.kind IN ('adjust','count','init') THEN m.qty END), 0) AS adjust
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_moves m ON m.product_id = p.id
    WHERE p.track_stock = 1 AND p.is_combo = 0
      AND (? = '' OR p.search LIKE '%' || ? || '%' OR p.code LIKE '%' || ? || '%')
      AND (? IS NULL OR p.category_id = ?)
    GROUP BY p.id ORDER BY p.code`).all(to, from, to, from, to, from, to, from, to, from, to, q, q, q, category, category);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const out = rows.map((r) => {
    const closing = r3(r.stock - r.after);
    const moved = r.purchase - r.sold + r.returned - r.supplier_return + r.adjust;
    return {
      id: r.id, code: r.code, name: r.name, unit: r.unit, category: r.category,
      opening: r3(closing - moved), purchase: r3(r.purchase), sold: r3(r.sold), returned: r3(r.returned),
      supplier_return: r3(r.supplier_return), adjust: r3(r.adjust), closing,
      value: Math.round(Math.max(closing, 0) * r.cost),
    };
  });
  const sum = (k) => r3(out.reduce((s, x) => s + x[k], 0));
  return {
    from, to, rows: out,
    totals: { opening: sum('opening'), purchase: sum('purchase'), sold: sum('sold'), returned: sum('returned'), supplier_return: sum('supplier_return'), adjust: sum('adjust'), closing: sum('closing'), value: sum('value') },
  };
}
