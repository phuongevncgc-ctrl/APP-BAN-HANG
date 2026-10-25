# Nhật ký thay đổi

## 1.0.0-beta.9

- **Chữ nhỏ lại** cho cả app (vừa mắt hơn, thấy được nhiều hơn).
- **Giỏ hàng gọn:** mỗi món 2 dòng — tên + ĐVT; giá · số lượng · thành tiền trên cùng một dòng. Nút +/− nhỏ lại.
- **Đang gõ trên điện thoại thì ẩn thanh menu dưới** (Bán hàng, Hoá đơn, Hàng hoá...) cho rộng chỗ; gõ xong tự hiện lại.

## 1.0.0-beta.8

- **Danh sách tìm hàng gọn như KiotViet:** mỗi hàng 2 dòng (tên + ĐVT, mã + tồn, giá bên phải), đơn vị quy đổi là nút nhỏ ngay dưới, bỏ ô ảnh trống. Màn hình điện thoại thấy được khoảng gấp 3 số hàng so với trước, danh sách không còn bị thanh "Thanh toán" che.
- Trang Hàng hoá cũng gọn hơn, nút Nhập / Excel / Thêm nhỏ lại.
- Sửa lỗi máy quét mã vạch + Enter không chọn đúng hàng khi mã hàng là chữ thường (mã từ KiotViet).

## 1.0.0-beta.7

- Sửa lỗi **"Failed to fetch" khi bấm "Đồng ý nhập"** trên điện thoại Android: điện thoại không cho đọc file lần thứ hai (lần xem trước đã đọc rồi). Giờ app đọc file một lần ngay khi chọn và dùng lại cho cả xem trước lẫn nhập.
- Mất mạng giữa chừng thì báo rõ ràng; bấm nhập lại không bị trùng hàng.

## 1.0.0-beta.6

- **Quên mật khẩu chủ cửa hàng:** vào Home Assistant → add-on PSell → tab Cấu hình, điền "Đặt lại mật khẩu chủ cửa hàng", Lưu rồi Khởi động lại. Tên đăng nhập hiện ở tab Nhật ký. Dữ liệu giữ nguyên.

## 1.0.0-beta.5

Thử với file Khách hàng (1.356 khách) và Nhà cung cấp (78 NCC) thật của cửa hàng: nhập đủ, không lỗi, tổng nợ khớp file.

- **Sửa lỗi gộp nhầm nhà cung cấp trùng tên.** KiotViet có 2 NCC cùng tên "Bảo Bình" khác mã. Trước đây app so theo tên nên gộp làm một, mất một NCC. Giờ NCC có **mã** riêng như KiotViet, nhập lại so theo mã. NCC tạo trong app tự có mã NCC000001...
- Sửa lỗi có thể gộp nhầm 2 khách dùng chung số điện thoại: có mã khách thì chỉ so theo mã.
- Giữ nguyên chữ hoa / thường của mã khách, mã NCC như KiotViet.
- Nhập thêm mã số thuế (cột "MST (xuất HĐ)"), ghi chú, khu vực giao hàng.

## 1.0.0-beta.4

Thử với file hàng hoá KiotViet thật của cửa hàng (8.302 dòng): nhập đủ 7.422 hàng, 585 đơn vị quy đổi, 295 combo, không dòng nào lỗi, tổng tồn kho khớp file.

- **Sửa lỗi không đọc được file xuất từ KiotViet** (file KiotViet ghi Excel theo kiểu riêng). Trước đây nhập file thật sẽ báo lỗi.
- **Nhập combo từ KiotViet** ("Combo - đóng gói") kèm các món bên trong theo cột "Hàng thành phần". Món bên trong là mã đơn vị quy đổi (vd 1 Bì = 50 cái) thì tự quy về đơn vị gốc.
- Giữ nguyên **chữ hoa / thường của mã hàng** như trong KiotViet (trước đây đổi hết thành chữ hoa). Tìm và quét mã vẫn không phân biệt hoa thường.
- Hàng không có đơn vị tính trong KiotViet thì để trống, không tự ghi "Cái".

## 1.0.0-beta.3

- **Mã QR chuyển khoản tạo ngay trong máy** theo chuẩn VietQR (NAPAS), không cần Internet. Mất mạng VNPT / Viettel mà điện thoại vẫn bắt wifi nhà thì vẫn bán, vẫn hiện QR. Dưới mã QR có tên và số tài khoản để khách đối chiếu.

## 1.0.0-beta.2

Chạy tốt với kho 20.000 mặt hàng và 1.500 khách (đã thử: tìm hàng dưới 0,02 giây, nhập file 20.000 hàng khoảng 3 giây).

- **Báo cáo cuối ngày về điện thoại** qua ứng dụng Home Assistant: doanh thu, lợi nhuận gộp, chi phí, lãi ròng, tiền mặt / chuyển khoản, khách nợ thêm, thu nợ, hàng sắp hết. Chọn điện thoại và giờ gửi trong Cài đặt, có nút "Gửi thử ngay".
- **Khôi phục dữ liệu** ngay trong app: chọn bản sao lưu trong máy hoặc tải file .db lên. App tự sao lưu dữ liệu hiện tại trước khi khôi phục, file hỏng thì báo lỗi và không đổi gì.
- Sửa **tổng nợ khách** và **tổng tiền hoá đơn** bị tính thiếu khi danh sách dài (trước chỉ cộng 300 khách / 500 hoá đơn đầu). Giờ máy chủ cộng toàn bộ.
- Danh sách hàng hoá, khách hàng, hoá đơn, bảng giá có nút **Xem thêm**, xem được hết 20.000 hàng.
- **Mã vạch có chữ** quét / tìm không phân biệt hoa thường (mã hàng vốn đã không phân biệt).
- Xuất Excel nhanh hơn 4-5 lần (20.000 hàng: 12 giây xuống 2,4 giây).
- Thêm chỉ mục dữ liệu cho công nợ, trả hàng, nhập hàng, thẻ kho để chạy nhanh khi dữ liệu nhiều năm.

## 1.0.0-beta.1

Bản thử nghiệm 1.0 (chú Phương viết, bác kiểm tra và bổ sung). Dữ liệu giữ nguyên.

- **Công nợ ngay lúc bán**: chọn khách khi thanh toán sẽ thấy nợ trước hoá đơn, nợ phát sinh và tổng nợ dự kiến sau bán. Số nợ cũ được lấy lại từ máy chủ mỗi lần mở, nên giỏ hàng để từ hôm trước vẫn đúng.
- **Mật khẩu mới ít nhất 12 ký tự** (cài đặt lần đầu, thêm nhân viên, đổi mật khẩu). Mật khẩu đang dùng vẫn đăng nhập bình thường.
- Nhập KiotViet: hệ số quy đổi bằng 0 hoặc âm thì báo lỗi đúng dòng, không tự đổi thành 1.
- Lỗi máy chủ không còn hiện chi tiết kỹ thuật lên màn hình (vẫn ghi trong nhật ký add-on).

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
