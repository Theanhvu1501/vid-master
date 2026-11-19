import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseProxy, maskProxy, toGpmProxy, checkProxy, runProxyCheck } from "../sheet/proxy-tools.js";

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

// ---- runProxyCheck: chỉ đọc proxy từ GPM, không ghi gì ----
test("runProxyCheck: kiểm tra từng profile, đếm sống/chết/chưa có, log không lộ mật khẩu", async () => {
  const logs = [];
  const profiles = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  const r = await runProxyCheck({
    gpmHost: "h", profiles, onLog: (m) => logs.push(m),
    listFn: async () => [
      { id: "a", rawProxy: "socks5://1.1.1.1:80:u:SECRETA" },
      { id: "b", rawProxy: "socks5://2.2.2.2:80:u:SECRETB" },
      { id: "c", rawProxy: "" },
    ],
    checkFn: async (raw) => (raw.includes("1.1.1.1") ? { ok: true, ip: "9.9.9.9", ms: 120 } : { ok: false, error: "quá thời gian chờ" }),
  });
  assert.equal(r.ok, 1);
  assert.equal(r.dead, 1);
  assert.equal(r.none, 1);
  assert.ok(!logs.join("\n").includes("SECRET"));
});

test("runProxyCheck: không chọn profile nào thì báo lỗi", async () => {
  await assert.rejects(runProxyCheck({ gpmHost: "h", profiles: [], listFn: async () => [], checkFn: async () => ({}), onLog: () => {} }), /Chưa chọn/);
});
