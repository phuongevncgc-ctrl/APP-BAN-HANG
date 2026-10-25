# Nhật ký thay đổi

## 0.3.1

- **Gợi ý hàng cần nhập**: trong phiếu nhập bấm "📋 Gợi ý hàng cần nhập", app tính sẵn món nào sắp hết và nên nhập bao nhiêu (theo sức bán 30 ngày gần đây, đủ bán 14 ngày tới, cộng tồn nhỏ nhất). Đã trừ hàng khách trả và hoá đơn huỷ. Lọc được theo nhà cung cấp lần trước nhập. Sửa số lượng, bỏ chọn món không cần rồi bấm thêm vào phiếu.

## 0.3.0

- **Báo cáo xuất nhập tồn** theo kỳ: tồn đầu, nhập, bán, khách trả, trả NCC, kiểm kho, tồn cuối, giá trị tồn. Xuất Excel.
- **Giá bán lần trước**: chọn khách khi bán, mỗi món hiện giá đã bán cho khách đó lần gần nhất, bấm "Dùng giá này" là áp luôn.
- **Báo giá A4**: in bảng báo giá từ giỏ hàng cho khách / thợ, chưa bán, chưa trừ kho.

## 0.2.3

- Đổi tên app thành **PSell**. Dữ liệu giữ nguyên, cập nhật như bình thường.

## 0.2.2

- Nhập file KiotViet an toàn hơn: **xem trước** thêm / sửa gì (giá cũ → giá mới, tồn cũ → tồn mới) rồi mới đồng ý nhập.
- Cột nào không có hoặc để trống trong file thì **giữ nguyên** dữ liệu trong app (trước đây có thể bị ghi về 0).
- Nhập lại file giống hệt thì báo "giữ nguyên", không đổi gì.
- Cột trùng tên bảng giá (vd "Giá sỉ") thì cập nhật bảng giá. File chỉ có mã ĐVT quy đổi (vd file bảng giá) cập nhật đúng đơn vị, không tạo hàng mới.
- Nhập **khách hàng** và **nhà cung cấp** từ file KiotViet, kèm số nợ.
- Tự tải ảnh hàng hoá từ link ảnh KiotViet.

## 0.2.1

- Trả hàng: khách còn nợ thì mặc định "Trừ vào nợ", cảnh báo nếu chọn hoàn tiền mặt. Số tiền hoàn hiện trên nút tính giống hệt máy chủ.
- Thêm bài kiểm tra đối chiếu sổ sách sau 300 nghiệp vụ ngẫu nhiên (kho, công nợ, sổ quỹ, báo cáo).

## 0.2.0

- **Combo hàng hoá**: ghép nhiều món thành một combo. Bán combo thì kho trừ từng món bên trong, trả hàng / huỷ hoá đơn cộng lại đúng công thức lúc bán. Tồn combo tự tính theo số bộ ráp được.
- **Xuất Excel**: danh sách hàng hoá (có ĐVT quy đổi, bảng giá, nhập lại vào app được), công nợ khách hàng và nhà cung cấp (tổng hợp + sổ chi tiết: nợ đầu kỳ, tiền hàng, đã thanh toán, chiết khấu, trả hàng, còn nợ), danh sách hoá đơn và chi tiết hàng bán.
- **Sổ công nợ** trong từng khách / nhà cung cấp, in biên bản đối chiếu công nợ khổ A4.
- **Máy in qua IP** (cùng mạng với Home Assistant): hoá đơn K80 / K58, tem mã vạch 1–3 tem một hàng (cuộn 2 tem), in thử, kiểm tra kết nối. Không có máy in IP thì in bằng trình duyệt như cũ.
- **Hoá đơn A4** có mã hàng, khách hàng, tổng nợ, chỗ ký.
- **Thu chi (sổ quỹ)**: phiếu thu, phiếu chi, tồn quỹ tiền mặt / chuyển khoản theo ngày. Báo cáo có "Lãi sau chi phí".
- **Chốt ca**: tổng kết tiền trong ngày, in ra máy in hoá đơn.
- **Kiểm kho nhiều món**: quét từng món, nhập số đếm, lưu là cân lại tồn kho, giữ lịch sử lệch kho.

## 0.1.0

- Bản đầu tiên: bán hàng, đơn vị quy đổi, bảng giá, giảm giá từng món, tách thanh toán, trả hàng, công nợ, nhập hàng, báo cáo, sao lưu.
