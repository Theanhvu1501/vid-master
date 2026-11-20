import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// channel-dashboard.js là script trình duyệt (IIFE gắn vào window): nạp trong môi trường giả để test phần logic thuần.
globalThis.window = {};
const require = createRequire(import.meta.url);
require("../channel-dashboard.js");
const { successRate, proxyLevel, proxyOrder, statusOf, dailyBars, sparkBars } = globalThis.window.ChannelDashboard;

const ch = (o = {}) => ({ id: 1, name: "K1", enabled: true, uploadEnabled: true, hasProfile: true, proxy: "", proxyDaysLeft: null, proxyState: "none", warnings: 0, videoStats: {}, ...o });

test("successRate: ok/(ok+lỗi) làm tròn; chưa có upload nào thì null, không bịa 0% hay 100%", () => {
  assert.equal(successRate(9, 1), 90);
  assert.equal(successRate(2, 1), 67);
  assert.equal(successRate(0, 5), 0);
  assert.equal(successRate(4, 0), 100);
  assert.equal(successRate(0, 0), null);
  assert.equal(successRate(undefined, undefined), null);
});

test("proxyLevel: hết hạn / còn ≤3 / ≤7 / ổn / chưa rõ / không dùng, đúng nhãn và độ khẩn", () => {
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: 0 })).key, "expired");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: -2 })).key, "expired");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: 3 })).key, "soon");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: 4 })).key, "week");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: 7 })).key, "week");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: 8 })).key, "ok");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: 5 })).label, "Còn 5 ngày");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: null, proxyState: "searching" })).label, "Đang tra hạn…");
  assert.equal(proxyLevel(ch({ proxy: "socks5://1.1.1.1:80", proxyDaysLeft: null, proxyState: "notfound" })).key, "unknown");
  assert.equal(proxyLevel(ch({ proxy: "" })).key, "none", "không dùng proxy thì không có hạn");
});

test("proxyOrder: kênh hết hạn hoặc sắp hết hạn lên đầu, ít ngày hơn trước, không proxy xuống cuối", () => {
  const list = [
    ch({ id: 1, name: "OK30", proxy: "p", proxyDaysLeft: 30 }),
    ch({ id: 2, name: "KHONG", proxy: "" }),
    ch({ id: 3, name: "SAP2", proxy: "p", proxyDaysLeft: 2 }),
    ch({ id: 4, name: "HET", proxy: "p", proxyDaysLeft: -1 }),
    ch({ id: 5, name: "TUAN5", proxy: "p", proxyDaysLeft: 5 }),
    ch({ id: 6, name: "CHUARO", proxy: "p", proxyDaysLeft: null }),
  ];
  assert.deepEqual(proxyOrder(list).map((x) => x.c.name), ["HET", "SAP2", "TUAN5", "OK30", "CHUARO", "KHONG"]);
});

test("statusOf: tắt > lỗi > cần chú ý > ổn, kèm lý do", () => {
  assert.equal(statusOf(ch({ enabled: false, videoStats: { errors: 9 } })).key, "off", "kênh tắt không báo lỗi");
  const e = statusOf(ch({ videoStats: { errors: 3 } })); assert.equal(e.key, "error"); assert.deepEqual(e.reasons, ["3 video lỗi"]);
  assert.equal(statusOf(ch({ proxy: "p", proxyDaysLeft: 0 })).key, "error");
  const w = statusOf(ch({ hasProfile: false })); assert.equal(w.key, "warn"); assert.ok(w.reasons.includes("chưa có GPM profile"));
  assert.equal(statusOf(ch({ hasProfile: false, uploadEnabled: false })).key, "ok", "tắt upload thì không cần GPM profile");
  assert.equal(statusOf(ch({ proxy: "p", proxyDaysLeft: 6 })).key, "warn");
  assert.equal(statusOf(ch()).key, "ok");
});

test("dailyBars: vẽ đủ cột, lỗi nằm trên thành công, có chữ khi chưa có dữ liệu, tên ngày không bị chèn HTML", () => {
  const days = ["2026-11-18", "2026-11-19", "2026-11-20"];
  const svg = dailyBars(days, [3, 0, 5], [1, 0, 0], { width: 600 });
  assert.equal((svg.match(/fill="#51cf66"/g) || []).length, 2, "hai cột có video thành công");
  assert.equal((svg.match(/fill="#ff6b6b"/g) || []).length, 1, "một cột có lỗi");
  assert.ok(svg.includes("viewBox=\"0 0 600 210\""));
  // Cột ngày 18/11 có 3 thành công + 1 lỗi: đoạn lỗi phải nằm TRÊN đoạn thành công (y nhỏ hơn) và chạm đỉnh phần thành công
  const rects = [...svg.matchAll(/<rect x="(\d+\.?\d*)" y="(\d+\.?\d*)" width="\d+\.?\d*" height="(\d+\.?\d*)" fill="(#[0-9a-f]{6})"/g)].map((m) => ({ x: m[1], y: +m[2], h: +m[3], fill: m[4] }));
  const firstX = rects[0].x, col = rects.filter((r) => r.x === firstX);
  const g = col.find((r) => r.fill === "#51cf66"), r = col.find((r) => r.fill === "#ff6b6b");
  assert.ok(g && r, "cột đầu có cả đoạn thành công lẫn đoạn lỗi");
  assert.ok(r.y < g.y, "đoạn lỗi nằm trên đoạn thành công");
  assert.ok(Math.abs((r.y + r.h) - g.y) < 0.2, "hai đoạn khít nhau, không hở");
  assert.ok(g.h > r.h, "3 thành công cao hơn 1 lỗi");
  assert.ok(dailyBars(days, [0, 0, 0], [0, 0, 0]).includes("Chưa có video nào được đăng"));
  assert.ok(svg.includes("18/11") && svg.includes("20/11"));
});

test("sparkBars: một cột mỗi ngày, lỗi nằm trên thành công, tên ngày được thoát ký tự, ngày trống chỉ có đường nét đứt", () => {
  const days = ["2026-11-18", "2026-11-19", "2026-11-20"];
  const svg = sparkBars(days, [2, 0, 4], [1, 0, 0], { w: 90, h: 24 });
  assert.equal((svg.match(/<g>/g) || []).length, 3, "ba ngày thì ba nhóm");
  assert.equal((svg.match(/fill="#51cf66"/g) || []).length, 2);
  assert.equal((svg.match(/fill="#ff6b6b"/g) || []).length, 1);
  assert.ok(svg.includes("viewBox=\"0 0 90 24\""));
  const empty = sparkBars(days, [0, 0, 0], [0, 0, 0]);
  assert.ok(empty.includes("stroke-dasharray"), "không có dữ liệu thì vẽ đường nét đứt");
  assert.equal((empty.match(/fill="#51cf66"/g) || []).length, 0);
  const evil = sparkBars(["2026-11-18<script>"], [1], [0]);
  assert.ok(!evil.includes("<script>"), "không chèn HTML thô");
});
