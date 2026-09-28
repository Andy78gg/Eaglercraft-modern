/*!
* Ruian Mod 屏蔽 (modfilter.js)  v1.1
* ---------------------------------------------
* 在游戏启动时强制覆盖指定 Modern 设置，让对应 mod 功能不生效：
*   - 动态模糊 Motion Blur        → modern_motionBlur:false
*   - 关闭 Boss 血条 Disable Boss Bar → modern_disableBossBar:false
*   - 图腾计数 Totem Counter      → modern_totemCounter:false
*   - Mod 菜单快捷键失效          → key.modmenu:-1 （未绑定，按原键打不开菜单）
*
* v1.1 修复（重要）：
*   按键绑定的存储键名是 "key.modmenu" 而不是 "key_key.modmenu"！
*   （wasm 里只有 key.attack / key.modmenu 等字符串，不存在 key_key 前缀；
*     游戏读到不认识的键会打 "Skipping bad option" 直接跳过 → v1.0 快捷键没失效）
*
* 写入机制与 preset.js 相同：
*   localStorage["_eaglercraft_1.12.g"] = base64(UTF-8 "key:value" 逐行文本)
*
* 时序（在 wasm/index.html 中）：
*   perfmod(Boost 写完整配置) → preset(合并覆盖 11 项) → 本脚本(最后执行，保证不被覆盖)
* ---------------------------------------------
*/
(function () {
"use strict";
var STORAGE_NAMESPACE = "_eaglercraft_1.12";
var SETTINGS_KEY = "g";
var FULL_KEY = STORAGE_NAMESPACE + "." + SETTINGS_KEY;
// 每次启动强制生效的屏蔽项（存在则覆盖，不存在则新增）
var FORCE_KEYS = {
"modern_motionBlur": "false",
"modern_disableBossBar": "false",
"modern_totemCounter": "false",
"key.modmenu": "-1"
};
// 旧版本写错的键名（key_key.* 前缀），游戏不识别，清掉避免残留
var CLEAN_KEYS = ["key_key.modmenu"];
function getStorage() {
try {
if (window.localStorage) return window.localStorage;
} catch (ex) {}
return null;
}
function b64ToText(b64) {
var bin = atob(b64);
var bytes = new Uint8Array(bin.length);
for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new TextDecoder("utf-8").decode(bytes);
}
function textToB64(text) {
var bytes = new TextEncoder().encode(text);
var bin = "";
var CHUNK = 0x8000;
for (var i = 0; i < bytes.length; i += CHUNK) {
bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
}
return btoa(bin);
}
function parseSettings(text) {
var map = {};
var lines = text.split("\n");
for (var i = 0; i < lines.length; i++) {
var idx = lines[i].indexOf(":");
if (idx > 0) map[lines[i].slice(0, idx)] = lines[i].slice(idx + 1);
}
return map;
}
function serializeSettings(map) {
var keys = Object.keys(map);
var out = [];
for (var i = 0; i < keys.length; i++) out.push(keys[i] + ":" + map[keys[i]]);
return out.join("\n");
}
// 旧版本写入的是 gzip，在【字节层】检测（gzip magic 0x1F 0x8B）
function decodeStorageText(existing) {
var bin = atob(existing);
var bytes = new Uint8Array(bin.length);
for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
return null; // 旧 gzip 二进制，游戏无法解析
}
return new TextDecoder("utf-8").decode(bytes);
}
function applyModFilter() {
var ls = getStorage();
if (!ls) return false;
var map = {};
var existing = null;
try { existing = ls.getItem(FULL_KEY); } catch (ex) {}
if (existing) {
try {
var text = decodeStorageText(existing);
if (text !== null) {
map = parseSettings(text);
} else {
console.warn("[RuianModFilter] 现有设置是旧 gzip 格式，将用干净设置重建。");
}
} catch (ex) {
console.warn("[RuianModFilter] 现有设置解码失败，将重建: " + ex);
}
}
var fKeys = Object.keys(FORCE_KEYS);
for (var i = 0; i < fKeys.length; i++) {
map[fKeys[i]] = FORCE_KEYS[fKeys[i]];
}
for (var j = 0; j < CLEAN_KEYS.length; j++) {
if (CLEAN_KEYS[j] in map) delete map[CLEAN_KEYS[j]];
}
var b64 = textToB64(serializeSettings(map));
try {
ls.setItem(FULL_KEY, b64);
console.log("[RuianModFilter] v1.1 applied: MotionBlur/BossBar/TotemCounter 已关闭, Mod菜单键已失效(key.modmenu=-1)");
return true;
} catch (ex) {
console.error("[RuianModFilter] 写入失败（不影响游戏启动）: " + ex);
return false;
}
}
// 供 wasm/index.html 在 preset 写入之后调用（保证不被覆盖）
window.__eaglerModFilterApply = function () {
try {
applyModFilter();
} catch (ex) {
console.error("[RuianModFilter] 应用失败（不影响游戏启动）: " + ex);
}
};
// 控制台工具
window.__ruianModFilter = {
apply: function () {
try { window.__eaglerModFilterApply(); } catch (ex) {}
},
dump: function () {
var ls = getStorage();
if (!ls) return "localStorage 不可用";
try {
var raw = ls.getItem(FULL_KEY);
if (!raw) return "未找到 " + FULL_KEY;
var text = decodeStorageText(raw);
if (text === null) return "现有值仍是旧 gzip 乱码";
var lines = text.split("\n");
var out = [];
for (var i = 0; i < lines.length; i++) {
if (lines[i].indexOf("modern_motionBlur") === 0 ||
lines[i].indexOf("modern_disableBossBar") === 0 ||
lines[i].indexOf("modern_totemCounter") === 0 ||
lines[i].indexOf("key.modmenu") === 0) {
out.push(lines[i]);
}
}
return out.length ? out.join("\n") : "（未找到屏蔽项）";
} catch (ex) {
return "解码失败: " + ex;
}
}
};
})();
