#!/usr/bin/env node
// «Киноплёнка» забега: одна вкладка headless Chrome, N кадров подряд с шагом, который задаёт вызывающий,
// плюс состояние игры на каждом кадре и контактный лист. Не зависит от конкретного API игры.
//   node tools/filmstrip.mjs --out DIR [--page /run/] [--query "seed=7&q=low"]
//     [--ready "!!window.RUN"]            JS-условие готовности (опрос)
//     [--setup "RUN.startRun()"]          JS один раз после готовности (можно async)
//     [--advance "RUN.sim(2,'perfect')"]  JS перед каждым кадром кроме первого (можно async)
//     [--render "RUN.render()"]           JS перед снимком (если цикл игры заморожен)
//     [--probe "JSON.stringify({d:RUN.G.dist|0,m:RUN.G.mode})"]  JS-строка, пишется подписью кадра
//     [--count 12] [--w 640 --h 360] [--cols 4] [--timeout 300]
// Совет: для детерминизма заморозь собственный цикл игры в --setup (например window.__freeze = true)
// и двигай симуляцию только через --advance.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
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
if (!A.out){ console.error("нужен --out DIR"); process.exit(1); }
mkdirSync(A.out, { recursive: true });
const T0 = Date.now(), timeoutMs = (+(A.timeout || 300)) * 1000;
const W = +(A.w || 640), H = +(A.h || 360), COUNT = +(A.count || 12), COLS = +(A.cols || 4);

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
const prof = mkdtempSync(join(tmpdir(), "rizy-film-"));
const chrome = spawn(CH, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${prof}`,
  "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", "--disable-component-update", "--disable-background-networking",
  "--disable-sync", "--mute-audio", "--autoplay-policy=no-user-gesture-required", `--window-size=${W},${H}`, "about:blank"],
  { stdio: "ignore" });
const cleanup = () => { try { chrome.kill("SIGKILL"); } catch {} setTimeout(() => { try { rmSync(prof, { recursive:true, force:true }); } catch {} }, 400); };
const hard = setTimeout(() => { console.log(JSON.stringify({ ok:false, error:"hard timeout" })); cleanup(); setTimeout(() => process.exit(2), 600); }, timeoutMs + 20000);

const res = { ok:false, frames:[], exceptions:[], console:[], sheet:null, ms:0, url:"" };
try {
  let port = 0;
  for (let i = 0; i < 200 && !port; i++){
    const f = join(prof, "DevToolsActivePort");
    if (existsSync(f)){ const p = +readFileSync(f, "utf8").split("\n")[0]; if (p) port = p; }
    if (!port) await sleep(100);
  }
  if (!port) throw new Error("нет порта DevTools");
  let page = null;
  for (let i = 0; i < 50 && !page; i++){
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page"); } catch {}
    if (!page) await sleep(100);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("ws")); });
  let id = 0; const pend = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)){ const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(m.error.message)) : p.ok(m.result); return; }
    if (m.method === "Runtime.exceptionThrown"){ const d = m.params.exceptionDetails; res.exceptions.push(((d.exception && d.exception.description) || d.text || "").slice(0, 400)); }
    if (m.method === "Runtime.consoleAPICalled" && ["error","warning"].includes(m.params.type))
      res.console.push(m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || "")).join(" ").slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; pend.set(i, { ok, no }); ws.send(JSON.stringify({ id:i, method, params })); });
  const ev = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result ? r.result.value : undefined;
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width:W, height:H, deviceScaleFactor:1, mobile:false });
  res.url = `${base}${A.page || "/run/"}?${typeof A.query === "string" ? A.query : ""}`;
  await send("Page.navigate", { url: res.url });
  const ready = typeof A.ready === "string" ? A.ready : "!!window.RUN";
  let isReady = false;
  while (Date.now() - T0 < timeoutMs){ try { isReady = !!(await ev(ready)); } catch {} if (isReady) break; await sleep(250); }
  if (!isReady) throw new Error("условие --ready не выполнилось");
  if (typeof A.setup === "string") await ev(A.setup);
  for (let i = 0; i < COUNT; i++){
    if (Date.now() - T0 > timeoutMs) { res.truncatedAt = i; break; }
    if (i > 0 && typeof A.advance === "string") await ev(A.advance);
    if (typeof A.render === "string") await ev(A.render);
    let probe = "";
    if (typeof A.probe === "string"){ try { probe = String(await ev(A.probe)); } catch (e){ probe = "probe error: " + e.message; } }
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const file = join(A.out, `frame_${String(i).padStart(2, "0")}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    res.frames.push({ i, file, probe });
  }
  writeFileSync(join(A.out, "frames.json"), JSON.stringify(res.frames, null, 1));
  // контактный лист через PIL
  const py = `
import json,sys
from PIL import Image, ImageDraw
fr=json.load(open(sys.argv[1])); cols=int(sys.argv[2]); out=sys.argv[3]
ims=[Image.open(f["file"]).convert("RGB") for f in fr]
if not ims: sys.exit()
w,h=ims[0].size; pad=26; rows=(len(ims)+cols-1)//cols
sheet=Image.new("RGB",(cols*w, rows*(h+pad)),(7,13,54))
d=ImageDraw.Draw(sheet)
for k,(im,f) in enumerate(zip(ims,fr)):
    x=(k%cols)*w; y=(k//cols)*(h+pad)
    sheet.paste(im,(x,y+pad))
    d.text((x+6,y+6), f"#{f['i']} {f['probe'][:int(w/6.2)]}", fill=(192,255,63))
sheet.save(out)
`;
  const sheet = join(A.out, "sheet.png");
  const r = spawnSync("python3", ["-c", py, join(A.out, "frames.json"), String(COLS), sheet], { encoding: "utf8" });
  if (r.status === 0 && existsSync(sheet)) res.sheet = sheet; else res.sheetError = (r.stderr || "").slice(0, 300);
  res.ok = res.exceptions.length === 0 && res.frames.length > 0;
} catch (e){ res.error = String(e && e.message || e); }
res.ms = Date.now() - T0;
clearTimeout(hard);
console.log(JSON.stringify(res, null, 1));
cleanup(); setTimeout(() => process.exit(0), 600);
