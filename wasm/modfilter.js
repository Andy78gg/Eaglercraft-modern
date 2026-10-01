/*!
* Ruian Mod 屏蔽 (modfilter.js)  v2.0
* ---------------------------------------------
* 在游戏启动前强制修改 /options（IndexedDB 虚拟文件系统）里的指定 Modern 设置：
*   - 动态模糊 Motion Blur        → modern_motionBlur:false
*   - 关闭 Boss 血条 Disable Boss Bar → modern_disableBossBar:false
*   - 图腾计数 Totem Counter      → modern_totemCounter:false
*   - Mod 菜单快捷键失效          → key.modmenu:-1 （未绑定，按原键打不开菜单）
*
* v2.0 重大修正：
*   游戏设置真实存储在 IndexedDB 的 /options 文件里，不是 localStorage！
*   （wasm 只有 PlatformFilesystem 桥接，无 localStorage；v1.x 写 localStorage
*     是写给"死数据"，游戏根本不读 → 这就是一直没生效的根因）
*   本版通过 ruianstorage.js 读写 IndexedDB 的 /options。
*
* v1.1 修复（沿用）：
*   按键绑定键名是 "key.modmenu" 而非 "key_key.modmenu"。
*
* 时序（在 wasm/index.html 中，全部 await 串行）：
*   ruianstorage → perfmod(Boost 写完整配置) → preset(合并 11 项) →
*   modfilter(本脚本，最后执行合并覆盖，保证不被覆盖) → eagruntime.js
* ---------------------------------------------
*/
(function () {
"use strict";
// 每次启动强制生效的屏蔽项（存在则覆盖，不存在则新增）
var FORCE_KEYS = {
"modern_motionBlur": "false",
"modern_disableBossBar": "false",
"modern_totemCounter": "false",
"key.modmenu": "-1"
};
// 旧版本写错的键名（key_key.* 前缀），游戏不识别，清掉避免残留
var CLEAN_KEYS = ["key_key.modmenu"];
// 空 /options 时的最小兜底（缺的键游戏会用默认值，不会崩溃）
function minimalBase() {
return ["version:1343", "key.modmenu:-1"].join("\n");
}
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
console.warn("[RuianModFilter] /options 不存在，使用最小兜底（依赖 Boost 先写完整配置）。");
map = window.__ruianStorageParse(minimalBase());
}
var fKeys = Object.keys(FORCE_KEYS);
for (var i = 0; i < fKeys.length; i++) {
map[fKeys[i]] = FORCE_KEYS[fKeys[i]];
}
for (var j = 0; j < CLEAN_KEYS.length; j++) {
if (CLEAN_KEYS[j] in map) delete map[CLEAN_KEYS[j]];
}
var newText = window.__ruianStorageSerialize(map);
var ok = await window.__ruianStorageWriteOptions(newText);
if (ok) {
console.log("[RuianModFilter] v2.0 applied: MotionBlur/BossBar/TotemCounter 已关闭, Mod菜单键已失效(key.modmenu=-1)");
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
if (text === null) return "（/options 不存在）";
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
}).catch(function (e) { return "解码失败: " + e; });
}
};
})();
