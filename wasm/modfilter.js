/*!
* Ruian Mod 屏蔽 (modfilter.js)  v3.1
* ---------------------------------------------
* 在游戏启动前强制修改游戏设置存储里的指定 Modern 设置：
*   存储 = localStorage["_eaglercraft_1.12.g"]（base64 纯文本，实测确认）
*   - 动态模糊 Motion Blur        → modern_motionBlur:false     （关闭）
*   - 屏蔽 Boss 血条 Boss Bar     → modern_disableBossBar:true  （隐藏 BossBar）
*   - 图腾计数 Totem Counter      → modern_totemCounter:false   （关闭）
*
* v3.1 修正（语义，浏览器实测确认）：
*   - modern_disableBossBar 的含义是“禁用 Boss 血条”：true = 隐藏，
*     false = 不禁用（BossBar 照常显示）。v3.0 写成 false 导致
*     “屏蔽 BossBar”实际未生效 —— 这是用户反馈“Mod 还是没用”的根因。
*   - 实测确认写入机制本身正确：把 modern_noRain 改为 false 后
*     Mods 菜单里 No Rain 开关确实变关（localStorage 键 ↔ 游戏开关一一对应）。
*   - 另确认：Motion Blur / Disable Boss Bar / Totem Counter 三个条目
*     不显示在 Mods 菜单里（隐藏功能），只能通过设置键控制。
*
* v3.0 变更（沿用）：
*   - 存储位置修正：v2.x 写 IndexedDB /options 是给死数据（游戏不读），
*     本版通过 ruianstorage v1.2 写 localStorage["_eaglercraft_1.12.g"]，
*     与游戏真实读取位置一致 → 屏蔽项真正生效。
*   - Mod 菜单保持开放（沿用 v2.1）：删除 key.modmenu / key_key.modmenu 残留。
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
"modern_disableBossBar": "true",
"modern_totemCounter": "false"
};
// 开放 Mod 菜单：写入前强制删除这些键，让游戏使用默认的 Mod 菜单快捷键
// （v2.0 曾写入 key.modmenu:-1，不删掉的话菜单仍然打不开）
var REMOVE_KEYS = ["key.modmenu", "key_key.modmenu"];
// 空设置时的最小兜底（缺的键游戏会用默认值，不会崩溃）
function minimalBase() {
return "version:1343";
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
console.log("[RuianModFilter] v3.1 applied: MotionBlur/TotemCounter 已关闭, BossBar 已屏蔽, Mod 菜单已开放");
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
})();
