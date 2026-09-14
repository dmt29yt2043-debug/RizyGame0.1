#!/usr/bin/env node
// Быстрый headless-тест игры через Chrome DevTools Protocol (без внешних зависимостей, Node ≥ 22).
// Параллельно-безопасно: у каждого запуска свой профиль и свой порт.
//   node tools/cdp.mjs --query "seed=7&shot=1&at=4" --out shot.png [--w 1280 --h 720]
//        [--page /run/] [--wait-title SHOT_READY] [--eval "JS-выражение"] [--settle 1500] [--timeout 150]
// Печатает JSON: { ok, title, crash, exceptions, console, eval, ms, out }
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2), A = {};
for (let i = 0; i < argv.length; i++){
  if (!argv[i].startsWith("--")) continue;
  const k = argv[i].slice(2), v = argv[i+1];
  if (v === undefined || v.startsWith("--")) A[k] = true; else { A[k] = v; i++; }
}
const T0 = Date.now();
const timeoutMs = (+(A.timeout || 150)) * 1000;
const W = +(A.w || 1280), H = +(A.h || 720);
const query = typeof A.query === "string" ? A.query : "";

async function alive(u){ try { const r = await fetch(u, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; } }
const gameRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let base = "http://localhost:5199";
if (!await alive(base + "/run/index.html")){
  base = "http://localhost:5198";
  if (!await alive(base + "/run/index.html")){
    spawn("python3", ["-m", "http.server", "5198"], { cwd: gameRoot, detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 40 && !await alive(base + "/run/index.html"); i++) await sleep(250);
  }
}

const CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const prof = mkdtempSync(join(tmpdir(), "rizy-cdp-"));
const chrome = spawn(CH, [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${prof}`,
  "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "--disable-component-update",
  "--disable-background-networking", "--disable-sync", "--mute-audio",
  "--autoplay-policy=no-user-gesture-required", `--window-size=${W},${H}`, "about:blank",
], { stdio: "ignore" });

let finished = false;
function cleanup(){
  try { chrome.kill("SIGKILL"); } catch {}
  setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 400);
}
const hard = setTimeout(() => {
  if (finished) return;
  console.log(JSON.stringify({ ok:false, error:"hard timeout", ms: Date.now()-T0 }));
  cleanup(); setTimeout(() => process.exit(2), 600);
}, timeoutMs + 20000);

const result = { ok:false, title:"", crash:null, exceptions:[], console:[], eval:undefined, ms:0, out: A.out || null, url:"" };
try {
  let port = 0;
  for (let i = 0; i < 200 && !port; i++){
    const f = join(prof, "DevToolsActivePort");
    if (existsSync(f)){ const p = +readFileSync(f, "utf8").split("\n")[0]; if (p) port = p; }
    if (!port) await sleep(100);
  }
  if (!port) throw new Error("Chrome не открыл порт DevTools");
  let page = null;
  for (let i = 0; i < 50 && !page; i++){
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page"); } catch {}
    if (!page) await sleep(100);
  }
  if (!page) throw new Error("нет вкладки");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.consoleAPICalled"){
      if (["error","warning","warn","assert"].includes(m.params.type) || A.all)
        result.console.push(`[${m.params.type}] ` + m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || "")).join(" "));
    }
    if (m.method === "Runtime.exceptionThrown"){
      const d = m.params.exceptionDetails;
      result.exceptions.push(((d.exception && d.exception.description) || d.text || "exception") + (d.url ? ` @ ${d.url.split("/").pop()}:${d.lineNumber}` : ""));
    }
    if (m.method === "Log.entryAdded"){
      const e = m.params.entry;
      if (e.level === "error" || e.level === "warning") result.console.push(`[log-${e.level}] ${e.text}${e.url ? " " + e.url.split("/").slice(-2).join("/") : ""}`);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id:i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width:W, height:H, deviceScaleFactor:1, mobile:false });
  result.url = `${base}${A.page || "/run/"}?${query}`;
  await send("Page.navigate", { url: result.url });

  const waitTitle = typeof A["wait-title"] === "string" ? A["wait-title"] : (query.includes("shot=1") ? "SHOT_READY" : null);
  const probe = `JSON.stringify({ t: document.title, run: !!window.RUN,
    c: (function(){ var c = document.getElementById("crash"); if (!c) return null;
      return getComputedStyle(c).display === "flex" ? ((document.getElementById("crashMsg")||{}).textContent || "crash overlay") : null; })() })`;
  while (Date.now() - T0 < timeoutMs){
    const r = await send("Runtime.evaluate", { expression: probe, returnByValue: true }).catch(() => null);
    if (r && r.result && typeof r.result.value === "string"){
      const v = JSON.parse(r.result.value);
      result.title = v.t; result.crash = v.c;
      if (v.c) break;
      if (waitTitle ? v.t === waitTitle : v.run) break;
    }
    await sleep(200);
  }
  if (!waitTitle) await sleep(+(A.settle || 1500));
  if (typeof A.eval === "string"){
    const r = await send("Runtime.evaluate", { expression: A.eval, returnByValue: true, awaitPromise: true }).catch(e => ({ error: String(e) }));
    result.eval = r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r;
  }
  if (A.out){
    const s = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(A.out, Buffer.from(s.data, "base64"));
  }
  result.console = result.console.filter(s => !/AudioContext was not allowed|GPU stall due to ReadPixels|favicon\.ico/.test(s));
  result.ok = !result.crash && result.exceptions.length === 0 && (!waitTitle || result.title === waitTitle);
} catch (e){
  result.error = String(e && e.message || e);
}
result.ms = Date.now() - T0;
finished = true; clearTimeout(hard);
console.log(JSON.stringify(result, null, 1));
cleanup();
setTimeout(() => process.exit(0), 600);
