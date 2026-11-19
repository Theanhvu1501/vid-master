import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseProxy, maskProxy, toGpmProxy, checkProxy, runProxySync, runProxyCheck } from "../sheet/proxy-tools.js";

const GPM_STYLE = "socks5://1.2.3.4:19424:user1:p@ss";

test("parseProxy: dạng GPM scheme://host:port:user:pass", () => {
  const p = parseProxy("socks5://1.2.3.4:19424:user1:pw1");
  assert.deepEqual(p, { scheme: "socks5", host: "1.2.3.4", port: "19424", user: "user1", pass: "pw1" });
});

test("parseProxy: dạng user:pass@host:port và host:port", () => {
  assert.equal(parseProxy("http://u:p@h.com:8080").user, "u");
  const bare = parseProxy("h.com:8080");
  assert.equal(bare.scheme, "http");
  assert.equal(bare.user, "");
});

test("maskProxy không bao giờ lộ user/pass", () => {
  const m = maskProxy("socks5://1.2.3.4:19424:user1:secretpw");
  assert.equal(m, "socks5://1.2.3.4:19424");
  assert.ok(!m.includes("secretpw") && !m.includes("user1"));
  assert.equal(maskProxy(""), "");
  assert.equal(maskProxy("rác"), "(không đọc được)");
});


// curl giả: ghi lại argv + stdin, trả stdout/exit code cho trước
function fakeSpawn({ stdout = "", stderr = "", code = 0 } = {}) {
  const calls = [];
  const fn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => {};
    let stdin = "";
    child.stdin = Object.assign(new EventEmitter(), { end: (s) => {
      stdin = s; calls.push({ cmd, args, stdin });
      setImmediate(() => { if (stdout) child.stdout.emit("data", stdout); if (stderr) child.stderr.emit("data", stderr); child.emit("close", code); });
    } });
    return child;
  };
  return { fn, calls };
}

test("checkProxy: sống -> trả IP; user/pass đi qua stdin, KHÔNG nằm trong argv", async () => {
  const { fn, calls } = fakeSpawn({ stdout: "9.9.9.9\n" });
  const r = await checkProxy(GPM_STYLE.replace("p@ss", "pw"), { spawnFn: fn });
  assert.equal(r.ok, true);
  assert.equal(r.ip, "9.9.9.9");
  assert.deepEqual(calls[0].args, ["-K", "-"]);
  assert.ok(calls[0].stdin.includes("socks5h://1.2.3.4:19424"));
  assert.ok(calls[0].stdin.includes("user1:pw"));
  assert.ok(!calls[0].args.join(" ").includes("pw"));
});

test("checkProxy: chết -> báo lỗi và che mật khẩu nếu curl lỡ in ra", async () => {
  const { fn } = fakeSpawn({ stderr: "curl: (97) auth failed for user1:pw", code: 97 });
  const r = await checkProxy("socks5://1.2.3.4:19424:user1:pw", { spawnFn: fn });
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes("pw"));
  assert.ok(!r.error.includes("user1"));
});

test("checkProxy: chuỗi proxy sai -> ok:false, không gọi curl", async () => {
  const { fn, calls } = fakeSpawn();
  const r = await checkProxy("hỏng", { spawnFn: fn });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test("toGpmProxy: chuẩn hoá về scheme://host:port:user:pass", () => {
  assert.equal(toGpmProxy("socks5://1.2.3.4:80:u:p"), "socks5://1.2.3.4:80:u:p");
  assert.equal(toGpmProxy("1.2.3.4:80:u:p"), "http://1.2.3.4:80:u:p");
  assert.equal(toGpmProxy("http://u:p@1.2.3.4:80"), "http://1.2.3.4:80:u:p");
  assert.equal(toGpmProxy(""), "");
  assert.throws(() => toGpmProxy("rác"), /không hợp lệ/);
});

const prof = (id, name, proxy) => ({ id, name, proxy });
const cur = (list) => async () => list; // listFn giả

test("runProxySync: gán proxy từ Sheet, bỏ qua ô trống, log không lộ mật khẩu", async () => {
  const sent = [], logs = [];
  const r = await runProxySync({
    gpmHost: "h",
    profiles: [prof("a", "A", "1.1.1.1:80:u:SECRET1"), prof("b", "B", ""), prof("c", "C", "3.3.3.3:80:u:SECRET3")],
    listFn: cur([{ id: "a", rawProxy: "" }, { id: "b", rawProxy: "socks5://9.9.9.9:1:x:y" }, { id: "c", rawProxy: "" }]),
    updateFn: async (h, id, raw) => sent.push([id, raw]),
    onLog: (m) => logs.push(m),
  });
  assert.deepEqual(sent.map((s) => s[0]), ["a", "c"]);
  assert.equal(r.ok, 2);
  assert.equal(r.skipped, 1, "ô trống giữ nguyên proxy cũ");
  assert.ok(!logs.join("\n").includes("SECRET"));
});

test("runProxySync: proxy đã đúng thì không gọi GPM nữa", async () => {
  const sent = [];
  const r = await runProxySync({
    gpmHost: "h", profiles: [prof("a", "A", "1.1.1.1:80:u:p")],
    listFn: cur([{ id: "a", rawProxy: "http://1.1.1.1:80:u:p" }]),
    updateFn: async (...x) => sent.push(x), onLog: () => {},
  });
  assert.equal(sent.length, 0);
  assert.equal(r.same, 1);
});

test("runProxySync: hai kênh cùng proxy -> kênh sau bị từ chối, kênh đầu vẫn được gán", async () => {
  const sent = [];
  const r = await runProxySync({
    gpmHost: "h", profiles: [prof("a", "A", "1.1.1.1:80:u:p"), prof("b", "B", "1.1.1.1:80:u:p")],
    listFn: cur([{ id: "a", rawProxy: "" }, { id: "b", rawProxy: "" }]),
    updateFn: async (h, id) => sent.push(id), onLog: () => {},
  });
  assert.deepEqual(sent, ["a"]);
  assert.equal(r.fail, 1);
});

test("runProxySync: proxy sai hoặc GPM từ chối chỉ lỗi đúng kênh đó", async () => {
  const sent = [];
  const r = await runProxySync({
    gpmHost: "h", profiles: [prof("a", "A", "rác"), prof("b", "B", "2.2.2.2:80:u:p"), prof("c", "C", "3.3.3.3:80:u:p")],
    listFn: cur([{ id: "a" }, { id: "b" }, { id: "c" }]),
    updateFn: async (h, id) => { if (id === "b") throw new Error("GPM từ chối"); sent.push(id); }, onLog: () => {},
  });
  assert.deepEqual(sent, ["c"]);
  assert.equal(r.fail, 2);
  assert.equal(r.ok, 1);
});

test("runProxySync: không chọn kênh nào thì báo lỗi", async () => {
  await assert.rejects(runProxySync({ gpmHost: "h", profiles: [], listFn: cur([]), updateFn: async () => {}, onLog: () => {} }), /Chưa chọn/);
});
