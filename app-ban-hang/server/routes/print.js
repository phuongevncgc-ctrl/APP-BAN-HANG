// Máy in qua IP: cài đặt, in thử, in hoá đơn / tem.
import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { notFound, bad } from '../util.js';
import { sendRaw, readImage, escposImage, tsplImages, readPrinters } from '../printer.js';

export default function printRoutes(db) {
  const r = Router();
  const load = () => {
    try {
      return JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'printers'").get()?.value || '[]');
    } catch {
      return [];
    }
  };

  r.get('/printers', (_req, res) => res.json(load()));

  r.put('/printers', requireOwner, (req, res) => {
    const list = readPrinters(req.body);
    db.prepare("INSERT INTO settings (key, value) VALUES ('printers', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(list));
    res.json(list);
  });

  // Kiểm tra kết nối tới máy in (chưa cần lưu)
  r.post('/printers/check', requireOwner, async (req, res) => {
    const ip = String(req.body.ip ?? '').trim();
    if (!ip) throw bad('Chưa nhập địa chỉ IP');
    const started = Date.now();
    await sendRaw(ip, Number(req.body.port) || 9100, null, 4000);
    res.json({ ok: true, ms: Date.now() - started });
  });

  // In: { printer_id, images: [{width, height, data}], copies }
  r.post('/print', async (req, res) => {
    const p = load().find((x) => x.id === req.body.printer_id);
    if (!p) throw notFound('Chưa cài máy in này. Vào Cài đặt → Máy in.');
    const images = (Array.isArray(req.body.images) ? req.body.images : []).map(readImage);
    if (!images.length) throw bad('Không có gì để in');
    const copies = Math.min(Math.max(Number(req.body.copies) || 1, 1), 10);
    const all = Array.from({ length: copies }, () => images).flat();
    const data = p.type === 'label'
      ? tsplImages(all, {
        widthMm: p.columns * p.label_w + (p.columns - 1) * p.col_gap, heightMm: p.label_h, gapMm: p.gap, invert: p.invert, density: p.density,
      })
      : escposImage(all);
    await sendRaw(p.ip, p.port, data);
    res.json({ ok: true, bytes: data.length });
  });

  return r;
}
