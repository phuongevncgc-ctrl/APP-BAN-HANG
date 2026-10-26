# PSell 1.0.0-rc.2

**PSell** là phần mềm bán hàng cho cửa hàng nhỏ, chạy ngay trên máy Home Assistant trong nhà. Mở được trên điện thoại Android, iPhone và máy tính, chữ to, nút to, dễ bấm. Dữ liệu nằm trong nhà, không mất tiền thuê bao. Bản này là RC2 để chạy thử có kiểm soát, chưa phải bản Stable.

## Có những gì

- **Bán hàng**: tìm hàng theo tên (gõ không dấu cũng được), mã hàng, quét mã vạch bằng camera hoặc máy quét. Mở nhiều đơn cùng lúc, lưu đơn tạm.
- **Đơn vị quy đổi**: mỗi hàng có ĐVT gốc (vd Mét) và các ĐVT quy đổi (Cây = 4 Mét, Cuộn = 100 Mét), mỗi đơn vị có giá, mã hàng, mã vạch riêng. Bán theo Cây thì kho tự trừ 4 Mét.
- **Giảm giá từng món** (theo tiền hoặc %) và **giảm giá cả hoá đơn**. Cảnh báo khi bán thấp hơn giá vốn.
- **Tách thanh toán**: tiền mặt, chuyển khoản, thẻ, kết hợp nhiều cách, ghi nợ. Tự tính tiền thối. Hiện mã QR chuyển khoản (VietQR) và nút đọc to "Đã nhận tiền".
- **Bảng giá**: giá sỉ, giá thợ… gán cho từng khách, bán tự lấy đúng giá.
- **Trả hàng**: khách trả một phần hay cả hoá đơn, hoàn tiền mặt, chuyển khoản hoặc trừ vào nợ. Trả hàng cho nhà cung cấp.
- **Combo hàng hoá**: ghép nhiều món thành một bộ, bán combo thì kho trừ từng món bên trong.
- **Hoá đơn in** khổ 80mm, 58mm hoặc A4 (có số tiền bằng chữ). Gửi hoá đơn qua Zalo.
- **Máy in qua IP**: máy in hoá đơn K80 và máy in tem mã vạch (cuộn 2 tem) cắm mạng cùng nhà với Home Assistant, in thẳng không cần cài driver.
- **Thu chi, chốt ca, kiểm kho**: phiếu thu / chi, sổ quỹ, in phiếu chốt ca cuối ngày, phiếu kiểm kho nhiều món.
- **Xuất Excel**: hàng hoá, hoá đơn, công nợ khách hàng và nhà cung cấp (tổng hợp + sổ chi tiết), in biên bản đối chiếu công nợ.
- **Khách hàng & công nợ**: lịch sử mua, hoá đơn còn nợ, nợ lâu nhất bao nhiêu ngày, thu nợ có chiết khấu.
- **Nhập hàng**: phiếu nhập theo đơn vị bất kỳ, chiết khấu %, giá vốn bình quân, nợ nhà cung cấp.
- **Kho**: thẻ kho (lịch sử nhập xuất), cân bằng kho, lọc hàng còn / hết / âm kho / sắp hết.
- **Báo giá A4**, **giá bán lần trước** cho từng khách, **báo cáo xuất nhập tồn**.
- **Báo cáo**: doanh thu, lợi nhuận, tiền mặt, chuyển khoản, hàng bán chạy, theo nhân viên, theo ngày.
- **Nhân viên**: mỗi người một tài khoản. Nhân viên không xem được giá vốn, lợi nhuận.
- **Nhập dữ liệu**: file Excel xuất từ KiotViet (tự gom ĐVT quy đổi), hoặc file `db.json` của app bán hàng cũ.
- **Sao lưu tự động** mỗi ngày, giữ 30 bản, tải về được.

## Cài lên Home Assistant

1. Trong Home Assistant, vào **Cài đặt → Tiện ích bổ sung (Add-ons) → Cửa hàng tiện ích**.
2. Bấm dấu **⋮** góc trên bên phải → **Kho lưu trữ (Repositories)**, dán địa chỉ:
   `https://github.com/phuongevncgc-ctrl/APP-BAN-HANG` rồi bấm **Thêm**.
3. Tải lại trang, tìm **PSell** → **Cài đặt**. Lần đầu máy sẽ tự dựng app, mất khoảng 5–10 phút.
4. Bấm **Khởi động**, bật **Hiện trên thanh bên**.
5. Bấm **PSell** ở thanh bên trái, tạo tài khoản chủ cửa hàng.

> Kho GitHub cần để chế độ **Public** thì Home Assistant mới tải về được.

### Mở trên điện thoại trong cửa hàng

- Điện thoại bắt cùng wifi, mở trình duyệt vào `http://<địa-chỉ-IP-máy-Home-Assistant>:8099`.
- Bấm **Thêm vào màn hình chính** để dùng như app.
- **Quét mã vạch bằng camera** chỉ chạy khi mở bằng địa chỉ `https://` (luật của điện thoại). Cách dễ nhất là mở qua app Home Assistant (thanh bên → PSell) khi Home Assistant đã có https. Máy quét mã vạch USB / Bluetooth thì dùng được ngay.
- Muốn mở thẳng cổng 8099 bằng https: trong tab **Cấu hình** của add-on, bật `ssl` và điền tên file chứng chỉ trong thư mục `/ssl` của Home Assistant.

### Cài máy in qua IP

1. In trang cấu hình của máy in (thường giữ nút FEED khi bật máy) để xem địa chỉ IP, vd `192.168.1.100`. Máy in phải cùng mạng với máy Home Assistant.
2. Vào **Cài đặt → Máy in qua mạng (IP) → + Thêm**, chọn loại (Hoá đơn K80 / K58 / Tem mã vạch), nhập IP, bấm **Kiểm tra kết nối** rồi **In thử**.
3. Máy in tem: điền khổ 1 tem (vd 35×22 mm), số tem một hàng (cuộn 2 tem chọn 2). Nếu tem in ra bị đen nền thì bật **Đảo màu**.
4. In tem: mở hàng hoá → **🏷️ In tem**, hoặc mở phiếu nhập → **In tem cho hàng vừa nhập**.
5. Hoá đơn A4: mở hoá đơn → **📄 In A4**, chọn máy in A4 trong hộp thoại in.

> Máy in hoá đơn phải hiểu lệnh ESC/POS, máy in tem phải hiểu lệnh TSPL (Xprinter, TSC, HPRT, Gprinter… đều được), cổng 9100.

### Chuyển dữ liệu từ app cũ / KiotViet

Vào **Hàng hoá → Nhập file**:
- File **db.json** trong thư mục `data` của app bán hàng cũ: chuyển hàng hoá, ĐVT, khách hàng kèm công nợ, nhà cung cấp.
- File **Excel** xuất từ KiotViet (Hàng hoá → Xuất file): các dòng ĐVT quy đổi (vd `BMO2719C`, Mã ĐVT cơ bản `BMO2719`) được gom vào đúng mặt hàng gốc. Nhập lại nhiều lần không bị trùng.

## Chạy bằng Docker thường (không có Home Assistant)

```bash
docker compose up -d --build
```

Mở `http://ip-may:8099`. Dữ liệu nằm trong thư mục `data/`.

## Dành cho người lập trình

```bash
cd app-ban-hang
npm install
npm run dev    # máy chủ ở cổng 8099, giao diện ở cổng 5173
npm test       # kiểm tra tính tiền, tồn kho, công nợ, nhập file
```

- Máy chủ: Node.js 22 + Express, cơ sở dữ liệu SQLite (`node:sqlite` có sẵn trong Node), một file `banhang.db`.
- Giao diện: React + Vite, một trang dùng chung cho điện thoại và máy tính.
- Tiền lưu bằng số nguyên VND. Tồn kho luôn tính theo ĐVT gốc.

Ý tưởng tham khảo từ [ParkViet](https://github.com/compasify/parkviet), [OpenSourcePOS](https://github.com/opensourcepos/opensourcepos) và app bán hàng cũ của cửa hàng; mã nguồn viết mới hoàn toàn, không chép mã từ các dự án đó.

Giấy phép MIT.
