/*!
* Ruian 设置存储桥接 (ruianstorage.js)  v1.0
* ---------------------------------------------
* 关键修正：游戏设置真实存储在 IndexedDB 虚拟文件系统的 /options 文件里，
* 不是 localStorage！证据：
*   - classes.wasm 里有 "Failed to load options, The filesystem has not been initialized yet!"
*     和文件路径 "/options"，以及 PlatformFilesystem_1_12_2 类；
*   - eagruntime.js 的文件系统桥接 = IndexedDB 对象仓库 "filesystem"（keyPath:["path"]）；
*   - classes.wasm 里没有任何 localStorage 的 Java 桥接。
*
* 本模块提供 IndexedDB 读写 /options 的统一接口，供 perfmod/preset/modfilter 使用。
* 通过遍历 indexedDB.databases() 找到含 filesystem 仓库的游戏数据库（不依赖猜数据库名）。
* ---------------------------------------------
*/
(function () {
"use strict";
var OPTIONS_PATH = "/options";
function openDB(name) {
return new Promise(function (resolve, reject) {
try {
var r = indexedDB.open(name);
r.onsuccess = function () { resolve(r.result); };
r.onerror = function () { reject(r.error || new Error("open failed")); };
r.onupgradeneeded = function () {
if (!r.result.objectStoreNames.contains("filesystem")) {
r.result.createObjectStore("filesystem", { keyPath: ["path"] });
}
};
} catch (e) { reject(e); }
});
}
function getRecord(db, path) {
return new Promise(function (resolve, reject) {
try {
var tx = db.transaction("filesystem", "readonly");
var req = tx.objectStore("filesystem").get([path]);
req.onsuccess = function () { resolve(req.result || null); };
req.onerror = function () { reject(req.error); };
} catch (e) { reject(e); }
});
}
function putRecord(db, path, data) {
return new Promise(function (resolve, reject) {
try {
var tx = db.transaction("filesystem", "readwrite");
var req = tx.objectStore("filesystem").put({ path: path, data: data });
req.onsuccess = function () { resolve(true); };
req.onerror = function () { reject(req.error); };
} catch (e) { reject(e); }
});
}
function decodeData(data) {
if (!data) return "";
var bytes = (data instanceof Uint8Array) ? data : new Uint8Array(data);
return new TextDecoder("utf-8").decode(bytes);
}
function encodeData(text) {
var bytes = new TextEncoder().encode(text);
var buf = new ArrayBuffer(bytes.byteLength);
new Uint8Array(buf).set(bytes);
return buf;
}
async function findGameDB() {
var names = [];
try {
var dbs = await indexedDB.databases();
names = dbs.map(function (d) { return d.name; });
} catch (e) {}
for (var i = 0; i < names.length; i++) {
try {
var db = await openDB(names[i]);
if (db.objectStoreNames.contains("filesystem")) return db;
db.close();
} catch (e) {}
}
// 兜底候选名（依次尝试）
var candidates = ["_eaglercraft_1.12", "EaglercraftX", "Eaglercraft", "eaglercraftx", "_eaglercraftX", "eaglercraft"];
for (var j = 0; j < candidates.length; j++) {
try {
var db2 = await openDB(candidates[j]);
if (db2.objectStoreNames.contains("filesystem")) return db2;
db2.close();
} catch (e) {}
}
return null;
}
// 读取 /options 文本；不存在返回 null
window.__ruianStorageReadOptions = async function () {
try {
var db = await findGameDB();
if (!db) {
console.warn("[RuianStorage] 未找到游戏 IndexedDB 数据库（首次游玩？）");
return null;
}
try {
var rec = await getRecord(db, OPTIONS_PATH);
return rec ? decodeData(rec.data) : null;
} finally { db.close(); }
} catch (e) {
console.warn("[RuianStorage] 读取失败: " + e);
return null;
}
};
// 写入 /options 文本；成功返回 true
window.__ruianStorageWriteOptions = async function (text) {
try {
var db = await findGameDB();
if (!db) {
console.warn("[RuianStorage] 未找到游戏 IndexedDB 数据库，无法写入 /options");
return false;
}
try {
await putRecord(db, OPTIONS_PATH, encodeData(text));
console.log("[RuianStorage] /options 已写入（" + (text.split("\n").length) + " 行）");
return true;
} finally { db.close(); }
} catch (e) {
console.warn("[RuianStorage] 写入失败: " + e);
return false;
}
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
var bin = atob(b64);
var bytes = new Uint8Array(bin.length);
for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new TextDecoder("utf-8").decode(bytes);
};
// 控制台工具
window.__ruianStorage = {
read: function () { return window.__ruianStorageReadOptions(); },
write: function (t) { return window.__ruianStorageWriteOptions(t); },
dump: function () {
return window.__ruianStorageReadOptions().then(function (t) {
return t === null ? "（/options 不存在）" : t;
});
}
};
})();
//（注：内容由AI生成）
