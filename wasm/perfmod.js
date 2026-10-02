/*!
* EaglerBoost 性能增强 Mod  (perfmod.js)  v3.4
* ---------------------------------------------
* 给本仓库的 EaglercraftX 1.12 (modernclient) 客户端注入三组优化：
*
*  1) 加载区块  —— LOD 渲染 + 更大的区块加载距离 + 区块修正
*  2) 加载人物  —— 实体剔除 + 关闭实体阴影
*  3) 提升 FPS  —— 关闭雨/粒子/附魔光效/云、降平滑光照与 mipmap、
*                  开启方块面剔除/区块网格优化，并关闭调试堆栈去混淆以减少卡顿
*
* v3.4 修正（存储位置结论反转，浏览器实测确认）：
*   游戏设置真实存储在 localStorage["_eaglercraft_1.12.g"]（base64 纯文本），
*   不是 IndexedDB！v3.3 的"IndexedDB"结论是错的（当时被误导）。
*   本版仍通过 ruianstorage.js 接口读写 —— ruianstorage v1.2 已改为
*   localStorage 桥接，此文件逻辑无需改动，仅更新版本号强制刷新缓存。
*
* v3.3 变更（沿用）：
*   - maxFps 260 -> 120 / particles 2 -> 0 / fog true -> false / renderDistance 9 -> 7
*   - lodStartDistance 8 -> 7（与 preset 对齐）
*   - 关掉 showOwnNametag / entityShadows
*
* 通过 URL 参数控制：?boost=1 开启（默认），?boost=0 关闭
* ---------------------------------------------
*/
(function () {
"use strict";
// 性能增强预设：base64(设置文本)，纯文本行、无 gzip
// v3.1: renderDistance:7 / lodStartDistance:7 / fog:false / maxFps:120 / particles:0
var BOOST_SETTINGS_B64 =
"dmVyc2lvbjoxMzQzCm1vZGVybl9sb2RSZW5kZXJpbmc6dHJ1ZQptb2Rlcm5fbG9kVmlld0Rpc3RhbmNlOjMyCm1vZGVybl9sb2RTdGFydERpc3RhbmNlOjcKcmVuZGVyRGlzdGFuY2U6NwpvZkNodW5rVXBkYXRlczoxCmNodW5rRml4OnRydWUKZm9nOmZhbHNlCm1vZGVybl9lbnRpdHlDdWxsaW5nOnRydWUKZW50aXR5U2hhZG93czpmYWxzZQptb2Rlcm5fc2hvd093bk5hbWV0YWc6ZmFsc2UKbWF4RnBzOjEyMAplbmFibGVWU3luYzp0cnVlCnBhcnRpY2xlczowCmFvOjAKbWlwbWFwTGV2ZWxzOjAKZmFuY3lHcmFwaGljczpmYWxzZQplbmRlckNsb3VkczpmYWxzZQptb2Rlcm5fbm9SYWluOnRydWUKbW9kZXJuX25vUGFydGljbGVzOnRydWUKbW9kZXJuX25vR2xpbnQ6ZmFsc2UKbW9kZXJuX2Jsb2NrRmFjZUN1bGxpbmc6dHJ1ZQptb2Rlcm5fY2h1bmtNZXNoT3B0aW1pemF0aW9uOnRydWUKbW9kZXJuX2NyeXN0YWxPcHRpbWl6ZXI6dHJ1ZQptb2Rlcm5fZWF0aW5nT3B0aW1pZXI6dHJ1ZQptb2Rlcm5fbW90aW9uQmx1cjpmYWxzZQptb2Rlcm5fZnVsbGJyaWdodDp0cnVlCm1vZGVybl90b3RlbUNvdW50ZXI6ZmFsc2UKbW9kZXJuX2NsaXBwaW5nOmZhbHNlZQ==";
function getURLParam(name) {
try {
var q = window.location.search;
if (typeof q !== "string" || q.length < 1) return null;
var params = new URLSearchParams(q);
var v = params.get(name);
return v === null ? null : v;
} catch (ex) {
return null;
}
}
// 是否开启性能增强（默认开启）
function isBoostEnabled() {
var v = getURLParam("boost");
if (v === null) return true; // 未指定时默认开启
return v === "1" || v === "true" || v === "on";
}
// 写入增强预设到游戏设置存储（localStorage，经 ruianstorage），合并保留其他设置
async function applyBoostSettings() {
try {
if (typeof window.__ruianStorageReadOptions !== "function") {
console.warn("[EaglerBoost] ruianstorage 未加载，跳过设置注入。");
return false;
}
var text = await window.__ruianStorageReadOptions();
var map = {};
if (text !== null && text.length > 0) {
map = window.__ruianStorageParse(text);
} else {
console.warn("[EaglerBoost] 设置不存在，将用完整增强预设初始化。");
}
// BOOST 预设解析并合并覆盖
var boostMap = window.__ruianStorageParse(window.__ruianStorageB64ToText(BOOST_SETTINGS_B64));
for (var k in boostMap) {
map[k] = boostMap[k];
}
var newText = window.__ruianStorageSerialize(map);
var ok = await window.__ruianStorageWriteOptions(newText);
if (ok) {
console.log("[EaglerBoost] 性能增强设置已写入 v3.4（渲染7/ maxFps120/ 无粒子/ 关雾）。");
}
return ok;
} catch (ex) {
console.error("[EaglerBoost] 写入设置失败: " + ex);
return false;
}
}
// 供 wasm/index.html 在创建 eaglercraftXOpts 之后调用（返回 Promise，必须 await）
window.__eaglerBoostApply = function (opts) {
try {
if (!opts || typeof opts !== "object") return Promise.resolve(false);
var boost = isBoostEnabled();
// ---- 启动/渲染层优化（这些项由客户端读取，安全）----
opts.enforceVSync = true;
opts.deobfStackTraces = false;
opts.checkGLErrors = false;
opts.checkShaderGLErrors = false;
opts.useDelayOnSwap = false;
opts.useWebGLExt = true;
// ---- 游戏设置注入（localStorage，经 ruianstorage）----
if (boost) {
return applyBoostSettings().then(function (ok) {
console.log("[EaglerBoost] 性能增强 Mod v3.4 已开启：LOD 区块渲染 / 实体加载优化 / FPS 提升。");
return ok;
});
} else {
console.log("[EaglerBoost] 性能增强 Mod 已关闭（?boost=0），不改动设置。");
return Promise.resolve(false);
}
} catch (ex) {
// 任何异常都不允许影响游戏本体启动
console.error("[EaglerBoost] 初始化失败（已忽略）: " + ex);
return Promise.resolve(false);
}
};
})();
