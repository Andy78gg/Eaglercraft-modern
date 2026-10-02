/*!
* Ruian 设置存储桥接 (ruianstorage.js)  v1.2
* ---------------------------------------------
* v1.2 重大反转修复（真正的根因，浏览器实测确认）：
*   游戏设置真实存储在 localStorage["_eaglercraft_1.12.g"]，
*   值 = base64(UTF-8 "key:value" 逐行纯文本)！
*   【实测证据】
*   - 在游戏设置界面把 FOV 改一档后，游戏自己回写了 localStorage
*     ["_eaglercraft_1.12.g"]（含 hasSeenFirstLoad:true 等完整 100+ 行）；
*   - 手动写入 localStorage 的 fov:0.5 后重启游戏，设置界面显示 FOV: 90
*     → 游戏确实从 localStorage 读取并应用设置；
*   - 游戏写入的键位是 "key_key.attack" 等 key_key. 前缀（写读对称）；
*   - IndexedDB 数据库 _net_lax1dude_eaglercraft_v1_8_internal_
*     PlatformFilesystem_1_12_2_ 只用于其他文件（世界存档等），
*     游戏设置不读 IndexedDB /options。
*   v1.0/v1.1 写 IndexedDB /options 是给"死数据"，游戏根本不读
*   → 这就是预设/屏蔽一直不生效的真正根因。
*
* 键名说明（实测确认）：
*   游戏内部键名为 "key_key.xxx"（如 key_key.hotbar.9 / key_key.modmenu）。
*   preset/modfilter 必须用 key_key. 前缀写入。
*
* 本模块提供读写游戏设置的统一接口，供 perfmod/preset/modfilter 使用。
* ---------------------------------------------
*/
(function () {
"use strict";
var OPTIONS_PATH = "/options"; // 兼容旧命名，实际存于 localStorage
var STORAGE_NAMESPACE = "_eaglercraft_1.12";
var SETTINGS_KEY = "g";
var FULL_KEY = STORAGE_NAMESPACE + "." + SETTINGS_KEY;
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
// 读取设置文本（base64 解码）；不存在或损坏返回 null
window.__ruianStorageReadOptions = function () {
return new Promise(function (resolve) {
try {
var ls = getStorage();
if (!ls) { resolve(null); return; }
var raw = null;
try { raw = ls.getItem(FULL_KEY); } catch (ex) {}
if (!raw) { resolve(null); return; }
try {
resolve(b64ToText(raw));
} catch (ex) {
console.warn("[RuianStorage] 设置解码失败（将被重建）: " + ex);
resolve(null);
}
} catch (ex) {
console.warn("[RuianStorage] 读取失败: " + ex);
resolve(null);
}
});
};
// 写入设置文本（base64 编码）；成功返回 true
window.__ruianStorageWriteOptions = function (text) {
return new Promise(function (resolve) {
try {
var ls = getStorage();
if (!ls) { resolve(false); return; }
try {
ls.setItem(FULL_KEY, textToB64(text));
console.log("[RuianStorage] /options 已写入 localStorage（" + (text.split("\n").length) + " 行）");
resolve(true);
} catch (ex) {
console.warn("[RuianStorage] 写入失败: " + ex);
resolve(false);
}
} catch (ex) {
console.warn("[RuianStorage] 写入失败: " + ex);
resolve(false);
}
});
};
// 设置文本 → map
window.__ruianStorageParse = function (text) {
var map = {};
var lines = (text || "").split("\n");
for (var i = 0; i < lines.length; i++) {
var idx = lines[i].indexOf(":");
if (idx > 0) map[lines[i].slice(0, idx)] = lines[i].slice(idx + 1);
}
return map;
};
// map → 设置文本
window.__ruianStorageSerialize = function (map) {
var keys = Object.keys(map);
var out = [];
for (var i = 0; i < keys.length; i++) out.push(keys[i] + ":" + map[keys[i]]);
return out.join("\n");
};
// base64(UTF-8) → 文本
window.__ruianStorageB64ToText = function (b64) {
return b64ToText(b64);
};
// 控制台工具
window.__ruianStorage = {
read: function () { return window.__ruianStorageReadOptions(); },
write: function (t) { return window.__ruianStorageWriteOptions(t); },
dump: function () {
return window.__ruianStorageReadOptions().then(function (t) {
return t === null ? "（设置不存在）" : t;
});
}
};
})();
