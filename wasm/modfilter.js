/*!
* Ruian Mod 屏蔽 (modfilter.js)  v3.0
* ---------------------------------------------
* 在游戏启动前强制修改游戏设置存储里的指定 Modern 设置：
*   存储 = localStorage["_eaglercraft_1.12.g"]（base64 纯文本，实测确认）
*   - 动态模糊 Motion Blur        → modern_motionBlur:false
*   - 关闭 Boss 血条 Disable Boss Bar → modern_disableBossBar:false
*   - 图腾计数 Totem Counter      → modern_totemCounter:false
*
* v3.0 变更：
*   - 存储位置修正：v2.x 写 IndexedDB /options 是给死数据（游戏不读），
*     本版通过 ruianstorage v1.2 写 localStorage["_eaglercraft_1.12.g"]，
*     与游戏真实读取位置一致 → 屏蔽项真正生效。
*   - Mod 菜单保持开放（沿用 v2.1）：删除 key.modmenu / key_key.modmenu 残留，
*     让游戏使用内置默认的 Mod 菜单快捷键，玩家也可在 Controls 里自行绑定。
*
* v2.1 变更（沿用）：
*   - 移除 "key.modmenu:-1" 强制禁用，Mod 菜单恢复可用；
*   - 仅保留上述三项 Modern 功能强制关闭（存在则覆盖，不存在则新增）。
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
console.log("[RuianModFilter] v3.0 applied: MotionBlur/BossBar/TotemCounter 已关闭, Mod 菜单已开放(key.modmenu 恢复默认)");
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
