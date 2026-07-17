# Kế hoạch triển khai Meeting

## Nguyên tắc theo dõi

- Kiến trúc mặc định: LiveKit self-hosted, LiveKit Egress và MinIO private cho bản ghi.
- Chỉ chuyển một mục sang **Hoàn tất** khi người dùng xác nhận bằng tin nhắn “xong”.
- Một bước có thể được triển khai và kiểm thử trước khi được người dùng xác nhận hoàn tất.

## Tiến độ

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| 1 | Chốt kiến trúc, tạo file theo dõi và kiểm tra nền tảng hiện có | Đang triển khai | Bắt đầu 2026-07-17 |
| 2 | Cuộc gọi 1–1: dữ liệu/API, ringing, nhận/từ chối, lịch sử cuộc gọi | Đang kiểm thử | Dùng chung nền tảng LiveKit nhưng giới hạn 2 người |
| 3 | Cuộc gọi 1–1: audio/video, mute, camera, chọn thiết bị, reconnect | Đang triển khai | Web/Electron trước; cần domain, TLS, firewall UDP/TURN |
| 4 | Meeting: dữ liệu/API, participant, vai trò host/co-host, lịch họp và lobby | Chưa bắt đầu | Mở rộng từ room 1–1 sang nhiều người |
| 5 | Meeting UI web/Electron: tạo/lịch họp, mời, điều khiển host, screen share | Chưa bắt đầu | Grid/speaker layout và phân quyền host |
| 6 | Recording: LiveKit Egress, MP4/audio, MinIO private, quyền xem/tải/xóa | Chưa bắt đầu | Có cảnh báo/đồng ý ghi hình |
| 7 | Flutter và thông báo nền | Chưa bắt đầu | APNs/CallKit và FCM cho cuộc gọi/meeting khi app nền |
| 8 | Kiểm thử production, monitoring, backup, tài liệu vận hành | Chưa bắt đầu | Kiểm tra mạng NAT/VPN/TURN và tải đồng thời |

## Quyết định kỹ thuật

- Media SFU: LiveKit self-hosted.
- Signaling nghiệp vụ và phân quyền: NestJS + Socket.IO hiện có.
- Realtime media: WebRTC qua LiveKit; không chạy media qua Nginx.
- Cuộc gọi 1–1: một LiveKit room có đúng hai participant; có audio và video, ringing, nhận/từ chối, hủy/kết thúc và lịch sử cuộc gọi.
- Meeting: LiveKit room nhiều participant, có lịch họp, lobby, host/co-host, screen share và recording.
- Ghi hình/ghi âm: LiveKit Egress chạy riêng; output đưa vào MinIO bucket private `meeting-recordings`.
- Bản ghi chỉ truy cập qua API kiểm tra quyền và URL có hạn; không dùng bucket attachment public hiện tại.
- Không bật E2EE cho room có server-side recording, vì Egress cần đọc được media để tạo bản ghi.

## Điều kiện production cần chuẩn bị trước bước 3

- DNS và TLS cho endpoint LiveKit/TURN.
- Mở firewall UDP/TCP cho WebRTC/TURN theo cấu hình LiveKit.
- Xác định giới hạn người tham gia mỗi meeting, số meeting ghi đồng thời và retention cho bản ghi.
