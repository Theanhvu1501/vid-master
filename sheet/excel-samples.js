// File Excel mẫu cho các chức năng cần nhập từ Excel/Google Sheet. Mẫu được dựng từ CHÍNH các
// tên cột mà app đọc (COLUMN_LABELS) nên không thể lệch với code.
//
// Lưu ý: thư viện xlsx bản miễn phí không ghi được màu ô, nên file mẫu chỉ có cột, độ rộng và dòng
// ví dụ. Màu theo nhóm chỉ áp dụng trực tiếp lên Google Sheet (nút "Tạo cột còn thiếu").
//
// Dữ liệu ví dụ cố tình là dữ liệu GIẢ không dùng được thật (@example.com, IP 203.0.113.x thuộc dải
// tài liệu, cờ bật/tắt để trống) để lỡ dùng nguyên mẫu cũng không tạo profile hay đăng nhập nhầm.

import fs from "fs";
import XLSX from "xlsx";
import { COLUMN_LABELS, COLUMN_GROUPS } from "./channel-sheet.js";
import { writeFullSheetSample } from "./full-template.js";

// kind: "xlsx" (nhiều tab, ghi bằng thư viện xlsx) hoặc "txt" (văn bản thuần, mỗi dòng một mục).
export const SAMPLE_FILES = {
  login: "mau-tai-khoan-dang-nhap.xlsx",
  channel: "mau-tao-channel.xlsx",
  changega: "mau-doi-ga.xlsx",
  sheet: "mau-tu-dong-hoa-sheet.xlsx",
  fullsheet: "mau-theo-doi-sheet-day-du.xlsx",
  urls: "urls.txt",
  chromakey: "chromaKey.txt",
};
const TEXT_KINDS = new Set(["urls", "chromakey"]);

// ---- mẫu văn bản: ĐÚNG định dạng mà download.js / render.js đọc ----
// urls.txt (download.js): tách theo dòng, bỏ dòng trống; KHÔNG hỗ trợ dòng ghi chú, nên mẫu chỉ có URL.
// chromaKey.txt (render.js): mỗi dòng một mã màu hex 6 ký tự không có dấu #; dòng bắt đầu bằng # là ghi chú.
const TEXT_SAMPLES = {
  urls: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=aqz-KE-bpKQ", ""].join("\n"),
  chromakey: [
    "# Mỗi dòng một mã màu hex 6 ký tự, KHÔNG có dấu #. Dòng bắt đầu bằng # là ghi chú.",
    "# Xoá hai màu ví dụ bên dưới rồi nhập màu phông thật của bạn.",
    "D4F9D7",
    "22BDD6",
    "",
  ].join("\n"),
};

const L = COLUMN_LABELS;

function loginSample() {
  return [
    {
      name: "Tài khoản",
      rows: [
        ["Profile ID hoặc tên profile", "Gmail", "Mật khẩu", "Mail khôi phục", "Mã 2FA (secret)"],
        ["PROFILE_ID_HOAC_TEN_1", "tai.khoan.1@example.com", "MatKhau_1", "mail.khoiphuc.1@example.com", "JBSWY3DPEHPK3PXP"],
        ["PROFILE_ID_HOAC_TEN_2", "tai.khoan.2@example.com", "MatKhau_2", "", ""],
      ],
      cols: [22, 30, 18, 32, 24],
    },
    {
      name: "Hướng dẫn",
      rows: [
        ["Cột", "Ý nghĩa", "Ghi chú"],
        ["A — Profile ID hoặc tên profile", "Khuyên dùng Profile ID (chuỗi dạng xxxxxxxx-xxxx-...) vì ID không bao giờ trùng. Có thể ghi tên profile", "Ghi tên thì tên đó phải là DUY NHẤT trong GPM; tên trùng sẽ bị bỏ qua để khỏi nhầm kênh"],
        ["B — Gmail", "Địa chỉ Gmail dùng để đăng nhập", ""],
        ["C — Mật khẩu", "Mật khẩu của Gmail", ""],
        ["D — Mail khôi phục", "Mail khôi phục, dùng khi Google hỏi xác minh", "Có thể để trống"],
        ["E — Mã 2FA", "Secret key của Google Authenticator (chuỗi chữ và số, KHÔNG phải mã 6 số)", "Có thể để trống"],
        ["", "", ""],
        ["Cách dùng", "Xoá 2 dòng ví dụ rồi nhập dữ liệu thật. Dòng 1 là tiêu đề, app tự bỏ qua.", ""],
        ["Ghép dòng", "App ghép mỗi dòng với profile theo cột A: ưu tiên Profile ID, sau đó mới tới tên. Profile không có dòng nào sẽ bị bỏ qua và ghi rõ ở log.", "Lấy Profile ID: bấm giữ chuột phải vào profile trong GPM, hoặc rê chuột lên tên profile ở danh sách bên trái của app"],
        ["Bảo mật", "File này chứa mật khẩu: đừng chia sẻ hay đưa lên nơi công khai.", ""],
      ],
      cols: [26, 70, 28],
    },
  ];
}

function channelSample() {
  return [
    {
      name: "Channel",
      rows: [
        ["Profile ID hoặc tên profile", "Tên kênh", "Mô tả kênh", "Mô tả video mặc định", "Tag (cách nhau dấu phẩy)", "Handle kênh"],
        ["PROFILE_ID_HOAC_TEN_1", "Tên kênh ví dụ 1", "Mô tả kênh ví dụ 1.", "Mô tả mặc định cho video của kênh 1.", "tag1, tag2, tag3", "@kenhvidu1"],
        ["PROFILE_ID_HOAC_TEN_2", "Tên kênh ví dụ 2", "Mô tả kênh ví dụ 2.", "", "", "@kenhvidu2"],
      ],
      cols: [22, 26, 34, 38, 28, 18],
    },
    {
      name: "Hướng dẫn",
      rows: [
        ["Cột", "Ý nghĩa", "Ghi chú"],
        ["A — Profile ID hoặc tên profile", "Khuyên dùng Profile ID (chuỗi dạng xxxxxxxx-xxxx-...) vì ID không bao giờ trùng. Có thể ghi tên profile", "Ghi tên thì tên đó phải là DUY NHẤT trong GPM; tên trùng sẽ bị bỏ qua để khỏi nhầm kênh"],
        ["B — Tên kênh", "Tên hiển thị của channel", "Bắt buộc, dòng trống tên kênh bị bỏ qua"],
        ["C — Mô tả kênh", "Phần giới thiệu của channel", "Có thể để trống"],
        ["D — Mô tả video mặc định", "Mô tả áp dụng mặc định khi tải video lên", "Có thể để trống"],
        ["E — Tag", "Từ khoá của kênh, cách nhau bằng dấu phẩy", "Có thể để trống"],
        ["F — Handle kênh", "Handle/đường dẫn tuỳ chỉnh của kênh, ví dụ @tenkenh", "Có thể để trống"],
        ["", "", ""],
        ["Cách dùng", "Xoá 2 dòng ví dụ rồi nhập dữ liệu thật. Dòng 1 là tiêu đề, app tự bỏ qua.", ""],
        ["Thứ tự cột", "Cùng thứ tự cột với script GPM 02.auto_create_channel.", ""],
      ],
      cols: [26, 70, 36],
    },
  ];
}

function changeGASample() {
  return [
    {
      name: "ĐổiGA",
      rows: [
        ["Profile ID hoặc tên profile", "Channel ID (UC...)", "Email GA đích", "Tên Brand Account đích"],
        ["PROFILE_ID_HOAC_TEN_1", "UCxxxxxxxxxxxxxxxxxxxxxx", "account.moi@example.com", "Tên Brand Account"],
        ["PROFILE_ID_HOAC_TEN_2", "", "", ""],
      ],
      cols: [22, 28, 32, 28],
    },
    {
      name: "Hướng dẫn",
      rows: [
        ["Cột", "Ý nghĩa", "Ghi chú"],
        ["A — Profile ID hoặc tên profile", "Khuyên dùng Profile ID (chuỗi dạng xxxxxxxx-xxxx-...) vì ID không bao giờ trùng", "Ghi tên thì tên đó phải là DUY NHẤT trong GPM"],
        ["B — Channel ID", "ID kênh YouTube cần chuyển (bắt đầu bằng UC...)", "Tuỳ chọn nếu profile chỉ có 1 kênh. Bắt buộc nếu account có nhiều kênh"],
        ["C — Email GA đích", "Email của Google Account / Brand Account đích", "Tuỳ chọn. Để trống = chọn thủ công trong browser"],
        ["D — Tên Brand Account đích", "Tên hiển thị của Brand Account đích", "Tuỳ chọn. Dùng để tìm nếu không có email"],
        ["", "", ""],
        ["Cách dùng", "Xoá 2 dòng ví dụ rồi nhập dữ liệu thật. Dòng 1 là tiêu đề, app tự bỏ qua.", ""],
        ["Quy trình đổi GA", "1. App mở browser với profile GPM đã đăng nhập\n2. Vào YouTube Studio > Settings > Channel > Move channel\n3. Bạn chọn Brand Account đích và xác nhận trong browser\n4. App chờ bạn hoàn thành (2FA, chọn account, xác nhận)", ""],
        ["Lưu ý quan trọng", "Quy trình CẦN THAO TÁC THỦ CÔNG trong browser (2FA, captcha, chọn account). Nên chạy từng profile một.", "Không nên chạy nhiều profile cùng lúc"],
      ],
      cols: [26, 78, 42],
    },
  ];
}

// Mẫu các cột tự động hoá của tab ⚙config (để dán vào Google Sheet hoặc File > Nhập).
// Dòng 1 là dải nhóm, dòng 2 là tên cột — đúng cấu trúc 2 dòng tiêu đề của ⚙config.
function sheetSample() {
  const BASE = "THÔNG TIN KÊNH";
  const cols = [
    { key: "sheetName", group: BASE, w: 18, ex: ["TEN_KENH_1", "TEN_KENH_2"] },
    { key: "proxy", group: BASE, w: 36, ex: ["socks5://203.0.113.10:1080:tenuser:matkhau", ""] },
    { key: "gpmProfileId", group: BASE, w: 18, ex: ["", ""] },
    { key: "autoProfile", w: 12, ex: ["", ""] },
    { key: "account", w: 52, ex: ["tai.khoan.1@example.com|MatKhau_1|mail.khoiphuc.1@example.com|JBSWY3DPEHPK3PXP", ""] },
    { key: "chromeVersion", w: 18, ex: ["129", ""] },
    { key: "profileProxy", w: 36, ex: ["", ""] },
    { key: "monetized", w: 12, ex: ["", ""] },
    { key: "autoChannel", w: 12, ex: ["", ""] },
    { key: "channelTitle", w: 22, ex: ["Tên kênh ví dụ 1", ""] },
    { key: "channelDesc", w: 30, ex: ["Mô tả kênh ví dụ.", ""] },
    { key: "videoDesc", w: 30, ex: ["Mô tả mặc định cho video.", ""] },
    { key: "videoTags", w: 20, ex: ["tag1, tag2", ""] },
    { key: "channelHandle", w: 16, ex: ["@kenhvidu1", ""] },
    { key: "autoStatus", w: 34, ex: ["", ""] },
  ];
  const groupLabel = (c) => c.group || COLUMN_GROUPS.find((g) => g.keys.includes(c.key))?.label || "";

  const band = cols.map(() => "");
  const merges = [];
  let i = 0;
  while (i < cols.length) {
    const label = groupLabel(cols[i]);
    let j = i;
    while (j + 1 < cols.length && groupLabel(cols[j + 1]) === label) j++;
    band[i] = label;
    if (j > i) merges.push(XLSX.utils.encode_range({ s: { r: 0, c: i }, e: { r: 0, c: j } }));
    i = j + 1;
  }

  return [
    {
      name: "⚙config",
      rows: [band, cols.map((c) => L[c.key]), cols.map((c) => c.ex[0]), cols.map((c) => c.ex[1])],
      cols: cols.map((c) => c.w),
      merges,
    },
    {
      name: "Hướng dẫn",
      rows: [
        ["HƯỚNG DẪN — TỰ ĐỘNG HOÁ THEO GOOGLE SHEET", "", ""],
        ["", "", ""],
        ["QUY TRÌNH", "", ""],
        ["Bước 1", "Thêm các cột trong tab ⚙config vào Google Sheet của bạn: dán từ file này, hoặc bấm \"Tạo cột còn thiếu\" trong khung Tự động hóa để app tự thêm đúng tên cột và tô màu.", ""],
        ["Bước 2", "Mỗi dòng là một kênh. Điền tên kênh, proxy, tài khoản đăng nhập (cột tk).", ""],
        ["Bước 3", "Ở kênh muốn làm việc gì thì ghi \"có\" vào cột tương ứng (Tạo profile và/hoặc Tạo channel). Ô trống = không làm.", ""],
        ["Bước 4", "Bấm \"Xem trước\" để kiểm tra app định làm gì với từng kênh, rồi bấm \"Chạy\".", ""],
        ["Bước 5", "Làm xong, app đổi ô \"có\" thành \"xong\" và ghi kết quả vào cột Trạng thái tự động hóa. Lỗi thì giữ nguyên ô \"có\" để chạy lại.", ""],
        ["", "", ""],
        ["CÁC CỘT", "Ý nghĩa", "Ghi chú"],
        [L.sheetName, "Tên kênh, đồng thời là tên profile GPM sẽ được tạo", "Không được trùng nhau"],
        [L.proxy, "Proxy gán cho profile: socks5://host:port:user:pass hoặc host:port:user:pass", "Để trống = không gán proxy. Mỗi kênh nên có proxy riêng"],
        [L.gpmProfileId, "App tự điền sau khi tạo profile", "Không cần nhập tay. Các chức năng khác ghép kênh với profile bằng cột này"],
        [L.autoProfile, "Điền \"có\" để tạo profile, gán proxy và đăng nhập cho kênh này", "Trống = không làm. Xong thì app đổi thành \"xong\""],
        [L.account, "Tài khoản đăng nhập: gmail|mật khẩu|mail khôi phục|mã 2FA", "Mail khôi phục và 2FA có thể bỏ trống. Bảo mật: giới hạn quyền xem Sheet"],
        [L.chromeVersion, "Bản Chrome mong muốn, ví dụ 129", "Tuỳ chọn. GPM bản cũ luôn dùng bản đã cài sẵn và app chỉ kiểm tra bản chính"],
        [L.profileProxy, "Proxy riêng của profile nếu khác cột Proxy tải", "Tuỳ chọn. Trống = dùng cột Proxy tải"],
        [L.monetized, "Điền \"có\" nếu kênh ĐÃ BẬT KIẾM TIỀN (BKT)", "Kênh BKT có thêm bước trong hộp thoại chỉnh video nên cần quy trình riêng khi đổi thumbnail / lên lịch / đăng video. Trống = kênh thường"],
        [L.autoChannel, "Điền \"có\" để tạo channel cho kênh này", "Cần có GPM Profile ID và Tên hiển thị. Xong thì app đổi thành \"xong\""],
        [L.channelTitle, "Tên hiển thị của channel", "Bắt buộc khi bật tạo channel"],
        [L.channelDesc, "Mô tả kênh", ""],
        [L.videoDesc, "Mô tả mặc định khi tải video lên", ""],
        [L.videoTags, "Tag của kênh, cách nhau bằng dấu phẩy", ""],
        [L.channelHandle, "Handle của kênh, ví dụ @tenkenh", ""],
        [L.autoStatus, "App tự ghi kết quả từng lần chạy", "Không cần nhập tay"],
        ["", "", ""],
        ["LƯU Ý", "", ""],
        ["Giá trị ô \"có\"", "Nhận: có, yes, y, 1, x, true, bật, ✓. Không phân biệt hoa thường và dấu. Ô trống hoặc giá trị khác = không làm.", ""],
        ["Màu sắc", "Trong Google Sheet, nút \"Tạo cột còn thiếu\" tự tô màu dải nhóm và tiêu đề cột: cam = Tạo profile, tím = Tạo channel, xám xanh = Kết quả.", "File Excel này không có màu vì thư viện Excel của app không ghi được màu"],
        ["Dữ liệu mẫu", "Hai dòng ví dụ dùng mail @example.com và proxy giả. Cờ \"Tạo profile/Tạo channel\" để TRỐNG nên dán nguyên mẫu vào cũng không chạy gì.", ""],
        ["Template đầy đủ", "Muốn có cả các cột render, tải xuống, lên lịch (59 cột, có màu theo từng chế độ) thì tải \"Template đầy đủ\" ở nút Template mẫu, rồi dùng \"Tạo cột còn thiếu\" để thêm các cột tự động hoá.", ""],
      ],
      cols: [26, 78, 60],
    },
  ];
}

const BUILDERS = { login: loginSample, channel: channelSample, changega: changeGASample, sheet: sheetSample };
const isText = (kind) => TEXT_KINDS.has(kind);

export function buildSample(kind) {
  if (isText(kind)) return [{ name: kind, text: TEXT_SAMPLES[kind] }];
  const b = BUILDERS[kind];
  if (!b) throw new Error(`Không có file mẫu loại "${kind}"`);
  return b();
}

/**
 * Ghi file mẫu ra `filePath`. Mẫu .xlsx tự thêm đuôi .xlsx; mẫu .txt tự thêm .txt. Trả về đường dẫn cuối.
 * `fullSheetSource` (chỉ dùng cho "fullsheet"): đường dẫn file Excel mẫu đầy đủ có sẵn để sao chép.
 */
export function writeSample(kind, filePath, { fullSheetSource } = {}) {
  if (kind === "fullsheet") {
    // Nhánh này LUÔN trả Promise (kể cả khi lỗi): các loại mẫu khác trả đường dẫn ngay, nên người gọi dùng `await`.
    if (!fullSheetSource || !fs.existsSync(fullSheetSource)) return Promise.reject(new Error("Không tìm thấy file mẫu đầy đủ đi kèm app (docs/sheet-mau)"));
    return writeFullSheetSample(fullSheetSource, filePath);
  }
  const sheets = buildSample(kind);
  if (isText(kind)) {
    const out = /\.txt$/i.test(filePath) ? filePath : `${filePath}.txt`;
    fs.writeFileSync(out, sheets[0].text, "utf8");
    return out;
  }
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws["!cols"] = s.cols.map((wch) => ({ wch }));
    if (s.merges?.length) ws["!merges"] = s.merges.map((m) => XLSX.utils.decode_range(m));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = /\.xlsx$/i.test(filePath) ? filePath : `${filePath}.xlsx`;
  XLSX.writeFile(wb, out);
  return out;
}
