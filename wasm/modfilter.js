/*!
* Ruian Mod 屏蔽 (modfilter.js)  v3.2
* ---------------------------------------------
* 锁定式屏蔽：在游戏启动前 AND 游戏运行期间，强制锁定以下 Modern 功能：
*   - 动态模糊 Motion Blur        → modern_motionBlur:false     （永远关闭）
*   - 禁用 Boss 血条功能           → modern_disableBossBar:false （该 mod 功能永远关闭）
*   - 图腾计数 Totem Counter      → modern_totemCounter:false   （永远关闭）
*
* v3.2 变更（实现“打开了还是没用”的锁定屏蔽）：
*   - 恢复三项均强制 false（用户确认的屏蔽语义：关闭这三个 mod 功能；
*     v3.1 把 disableBossBar 写成 true 是误改，已撤销）。
*   - 新增【运行时守护】Runtime Guard：
*     ① 拦截 localStorage.setItem：游戏回写设置时，屏蔽键一律强制写回 false；
*     ② 每 5 秒定时强制写回：即使游戏绕过拦截直接写存储，也会被修正；
*     → 玩家在游戏里打开这三个开关，也会被立即改回 / 下次读取时强制关闭，
*       达到“打开了还是没用”的锁定效果。
*
* v3.1 变更（已撤销）：
*   - modern_disableBossBar:true（误改，恢复为 false）
*
* v3.0 变更（沿用）：
*   - 存储位置修正：v2.x 写 IndexedDB /options 是给死数据（游戏不读），
*     本版通过 ruianstorage v1.2 写 localStorage["_eaglercraft_1.12.g"]，
*     与游戏真实读取位置一致 → 屏蔽项真正生效（实测：改 modern_noRain:false
*     后 Mods 菜单 No Rain 开关确实变关，键 ↔ 开关一一对应）。
*   - Mod 菜单保持开放（沿用 v2.1）：删除 key.modmenu / key_key.modmenu 残留。
*
* 时序（在 wasm/index.html 中，全部 await 串行）：
*   ruianstorage → perfmod(Boost 写完整配置) → preset(合并 11 项) →
*   modfilter(本脚本，最后执行合并覆盖，保证不被覆盖) → eagruntime.js
* ---------------------------------------------
*/
(function () {
"use strict";
// 每次启动强制生效的屏蔽项（存在则覆盖，不存在则新增；永远锁定为 false）
var FORCE_KEYS = {
"modern_motionBlur": "false",
"modern_disableBossBar": "false",
"modern_totemCounter": "false"
};
// 开放 Mod 菜单：写入前强制删除这些键，让游戏使用默认的 Mod 菜单快捷键
// （v2.0 曾写入 key.modmenu:-1，不删掉的话菜单仍然打不开）
var REMOVE_KEYS = ["key.modmenu", "key_key.modmenu"];
var STORAGE_KEY = "_eaglercraft_1.12.g";
function b64ToText(b64) {
var bin = atob(b64);
var bytes = new Uint8Array(bin.length);
for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new TextDecoder("utf-8").decode(bytes);
}
function textToB64(text) {
var bytes = new TextEncoder().encode(text);
var s = "";
for (var j = 0; j < bytes.length; j += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
return btoa(s);
}
// 强制文本中的屏蔽键为 FORCE_KEYS 值，并删除 REMOVE_KEYS 键；返回新文本
function forceKeysInText(txt) {
var lines = txt.split("\n");
var map = {};
var order = [];
for (var i = 0; i < lines.length; i++) {
var idx = lines[i].indexOf(":");
if (idx > 0) {
var k = lines[i].slice(0, idx);
var v = lines[i].slice(idx + 1);
if (REMOVE_KEYS.indexOf(k) >= 0) continue;
if (FORCE_KEYS.hasOwnProperty(k)) v = FORCE_KEYS[k];
if (!(k in map)) order.push(k);
map[k] = v;
}
}
for (var fk in FORCE_KEYS) {
if (!(fk in map)) { map[fk] = FORCE_KEYS[fk]; order.push(fk); }
}
var out = [];
for (var j = 0; j < order.length; j++) out.push(order[j] + ":" + map[order[j]]);
return out.join("\n");
}
// 运行时守护：拦截写入 + 定时兜底，玩家打开被屏蔽的开关也会被强制关闭
function installRuntimeGuard() {
try {
var ls = window.localStorage;
if (!ls) return;
var origSet = ls.setItem.bind(ls);
var origGet = ls.getItem.bind(ls);
ls.setItem = function(k, v) {
if (k === STORAGE_KEY && typeof v === "string") {
try {
var txt = b64ToText(v);
var ntxt = forceKeysInText(txt);
if (ntxt !== txt) v = textToB64(ntxt);
} catch (ex) {}
}
return origSet(k, v);
};
// 每 5 秒兜底强制写回（防游戏内存回写绕过拦截）
setInterval(function() {
try {
var raw = origGet(STORAGE_KEY);
if (!raw) return;
var txt = b64ToText(raw);
var ntxt = forceKeysInText(txt);
if (ntxt !== txt) origSet(STORAGE_KEY, textToB64(ntxt));
} catch (ex) {}
}, 5000);
console.log("[RuianModFilter] v3.2 运行时守护已安装：三个屏蔽开关将被锁定关闭（打开无效）");
} catch (ex) {
console.warn("[RuianModFilter] 运行时守护安装失败: " + ex);
}
}
// 启动前写入屏蔽（合并保留其他设置）
async function applyModFilter() {
try {
if (typeof window.__ruianStorageReadOptions !== "function") {
console.warn("[RuianModFilter] ruianstorage 未加载，跳过。");
return false;
}
var text = await window.__ruianStorageReadOptions();
var map = {};
if (text !== null && text.length > 0) {
map = window.__ruianStorageParse(text);
} else {
console.warn("[RuianModFilter] 设置不存在，使用最小兜底（依赖 Boost 先写完整配置）。");
map = window.__ruianStorageParse(minimalBase());
}
var fKeys = Object.keys(FORCE_KEYS);
for (var i = 0; i < fKeys.length; i++) {
map[fKeys[i]] = FORCE_KEYS[fKeys[i]];
}
var rKeys = REMOVE_KEYS;
for (var k = 0; k < rKeys.length; k++) {
if (rKeys[k] in map) delete map[rKeys[k]];
}
var newText = window.__ruianStorageSerialize(map);
var ok = await window.__ruianStorageWriteOptions(newText);
if (ok) {
console.log("[RuianModFilter] v3.2 applied: MotionBlur/BossBar/TotemCounter 已锁定关闭（打开无效）, Mod 菜单已开放");
}
return ok;
} catch (ex) {
console.error("[RuianModFilter] 应用失败（不影响游戏启动）: " + ex);
return false;
}
}
// 供 wasm/index.html 在 preset 写入之后调用（保证不被覆盖）
window.__eaglerModFilterApply = function () {
return applyModFilter();
};
// 控制台工具
window.__ruianModFilter = {
apply: function () { return applyModFilter(); },
dump: function () {
return window.__ruianStorageReadOptions().then(function (text) {
if (text === null) return "（设置不存在）";
var lines = text.split("\n");
var out = [];
for (var i = 0; i < lines.length; i++) {
if (lines[i].indexOf("modern_motionBlur") === 0 ||
lines[i].indexOf("modern_disableBossBar") === 0 ||
lines[i].indexOf("modern_totemCounter") === 0) {
out.push(lines[i]);
}
}
return out.length ? out.join("\n") : "（未找到屏蔽项）";
}).catch(function (e) { return "解码失败: " + e; });
}
};
// 立即安装运行时守护（modfilter 加载时生效，不依赖游戏启动时序）
installRuntimeGuard();
})();
