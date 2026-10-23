import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui.jsx';

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.frequency.value = 1800;
    o.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 120);
  } catch {
    /* không có âm thanh cũng được */
  }
}

// Quét mã vạch bằng camera. continuous: quét liên tục (bán hàng), không thì đóng sau lần đầu.
export default function Scanner({ onCode, onClose, continuous = false }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!window.isSecureContext) {
      setError('Điện thoại chỉ cho dùng camera khi mở app bằng địa chỉ https. Xem hướng dẫn trong phần Cài đặt.');
      return undefined;
    }
    let controls;
    let stopped = false;
    let lastCode = '';
    let lastAt = 0;
    import('@zxing/browser')
      .then(({ BrowserMultiFormatReader }) => {
        if (stopped) return undefined;
        const reader = new BrowserMultiFormatReader();
        return reader.decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1280 } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const code = result.getText();
            const now = Date.now();
            if (code === lastCode && now - lastAt < 2000) return;
            lastCode = code;
            lastAt = now;
            beep();
            setLast(code);
            cb.current(code);
            if (!continuous) {
              controls?.stop();
              closeRef.current();
            }
          },
        );
      })
      .then((c) => {
        controls = c;
        if (stopped) c?.stop();
      })
      .catch((err) => setError(err?.name === 'NotAllowedError' ? 'Chưa cho phép dùng camera. Hãy bấm "Cho phép" khi điện thoại hỏi.' : `Không mở được camera: ${err?.message ?? err}`));
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [continuous]);

  return (
    <Modal title="Quét mã vạch" onClose={onClose}>
      {error ? (
        <div className="empty error">{error}</div>
      ) : (
        <>
          <div className="scanner">
            <video ref={videoRef} muted playsInline />
            <div className="scanner-line" />
          </div>
          <p className="muted center">{last ? `Vừa quét: ${last}` : 'Đưa mã vạch vào giữa khung'}</p>
        </>
      )}
      <button className="btn btn-block" onClick={onClose}>Xong</button>
    </Modal>
  );
}
