/*!
* EaglerBoost 性能增强 Mod  (perfmod.js)  v3.2
* ---------------------------------------------
* 给本仓库的 EaglercraftX 1.12 (modernclient) 客户端注入三组优化：
*
*  1) 加载区块  —— LOD 渲染 + 更大的区块加载距离 + 区块修正
*  2) 加载人物  —— 实体剔除 + 关闭实体阴影
*  3) 提升 FPS  —— 关闭雨/粒子/附魔光效/云、降平滑光照与 mipmap、
*                  开启方块面剔除/区块网格优化，并关闭调试堆栈去混淆以减少卡顿
*
* v3.2 瘦身：
*  - 关掉 showOwnNametag（头顶额外渲染自己的名字标签），纯性能不加花架子
*  - 修掉 FULL_KEY 重复行
*
* v3.1 流畅性：
*  - maxFps 260 -> 120（WASM 版跑 260 帧时间抖动反而卡，锁 120 更稳更顺）
*  - particles 2 -> 0（粒子全关，省 CPU/GC）
*  - fog true -> false（关雾，省远处填充）
*  - renderDistance 9 -> 7 / lodStartDistance 8 -> 7（与 preset 对齐）
*
* 原理（已按本仓库 classes.wasm 与官方 1.12.2 源码逐一核实）：
*  - 游戏设置保存在 localStorage 的 `_eaglercraft_1.12.g` 键里
*  - 1.12 客户端格式 = base64(纯 UTF-8 "key:value" 逐行文本)，【没有 gzip】
*    （writeOptions 用 PrintWriter 写纯文本，首行 version:1343；
*      loadOptions 用 IOUtils.readLines 按 UTF-8 直接读行解析）
*  - 注意：Eaglercraft 1.8 版本有 gzip，但本 1.12 构建没有
*  - 本脚本在游戏启动前把增强预设直接写入该键（同时备份原设置），
*    关闭时还原备份——不使用客户端 hooks 机制（该构建的 hooks 有 JSO null 崩溃问题）
*  - eaglercraftXOpts 支持 enforceVSync / deobfStackTraces / checkGLErrors 等启动项
*
* 通过 URL 参数控制：?boost=1 开启（默认），?boost=0 关闭
* ---------------------------------------------
*/
(function () {
"use strict";
// 本客户端实际的 localStorage 命名空间（从 classes.wasm 中核实）
var STORAGE_NAMESPACE = "_eaglercraft_1.12";
// 游戏设置键名
var SETTINGS_KEY = "g";
// 完整 localStorage 键
var FULL_KEY = STORAGE_NAMESPACE + "." + SETTINGS_KEY;
// 备份键（游戏不会读取这个键）
var BACKUP_KEY = STORAGE_NAMESPACE + "." + SETTINGS_KEY + "_eaglerboost_backup";
// 性能增强预设：base64(设置文本)，纯文本行、无 gzip（与 1.12 游戏端完全一致）
// v3.1: renderDistance:7 / lodStartDistance:7 / fog:false / maxFps:120 / particles:0
var BOOST_SETTINGS_B64 =
"dmVyc2lvbjoxMzQzCm1vZGVybl9sb2RSZW5kZXJpbmc6dHJ1ZQptb2Rlcm5fbG9kVmlld0Rpc3RhbmNlOjMyCm1vZGVybl9sb2RTdGFydERpc3RhbmNlOjcKcmVuZGVyRGlzdGFuY2U6NwpvZkNodW5rVXBkYXRlczoxCmNodW5rRml4OnRydWUKZm9nOmZhbHNlCm1vZGVybl9lbnRpdHlDdWxsaW5nOnRydWUKZW50aXR5U2hhZG93czpmYWxzZQptb2Rlcm5fc2hvd093bk5hbWV0YWc6ZmFsc2UKbWF4RnBzOjEyMAplbmFibGVWU3luYzp0cnVlCnBhcnRpY2xlczowCmFvOjAKbWlwbWFwTGV2ZWxzOjAKZmFuY3lHcmFwaGljczpmYWxzZQplbmRlckNsb3VkczpmYWxzZQptb2Rlcm5fbm9SYWluOnRydWUKbW9kZXJuX25vUGFydGljbGVzOnRydWUKbW9kZXJuX25vR2xpbnQ6ZmFsc2UKbW9kZXJuX2Jsb2NrRmFjZUN1bGxpbmc6dHJ1ZQptb2Rlcm5fY2h1bmtNZXNoT3B0aW1pemF0aW9uOnRydWUKbW9kZXJuX2NyeXN0YWxPcHRpbWl6ZXI6dHJ1ZQptb2Rlcm5fZWF0aW5nT3B0aW1pemVyOnRydWUKbW9kZXJuX21vdGlvbkJsdXI6ZmFsc2UKbW9kZXJuX2Z1bGxicmlnaHQ6dHJ1ZQptb2Rlcm5fdG90ZW1Db3VudGVyOmZhbHNlCm1vZGVybl9jbGlwcGluZzpmYWxzZQ==";
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
// 安全获取 localStorage（隐私模式下可能不可用）
function getStorage() {
try {
if (window.localStorage) return window.localStorage;
} catch (ex) {}
return null;
}
// 写入增强预设到游戏设置键，并备份原设置
function applyBoostSettings() {
var ls = getStorage();
if (!ls) {
console.warn("[EaglerBoost] localStorage 不可用，跳过设置注入。");
return;
}
try {
// 仅在没有备份时备份原设置（避免反复覆盖备份）
var existing = ls.getItem(FULL_KEY);
var backup = ls.getItem(BACKUP_KEY);
if (backup === null && existing !== null) {
ls.setItem(BACKUP_KEY, existing);
}
// 写入增强预设
ls.setItem(FULL_KEY, BOOST_SETTINGS_B64);
console.log(
"[EaglerBoost] 性能增强设置已写入 v3.1（渲染7/ maxFps120/ 无粒子/ 关雾）。"
);
} catch (ex) {
console.error("[EaglerBoost] 写入设置失败: " + ex);
}
}
// 还原备份的原设置
function restoreOriginalSettings() {
var ls = getStorage();
if (!ls) return;
try {
var backup = ls.getItem(BACKUP_KEY);
if (backup !== null) {
ls.setItem(FULL_KEY, backup);
ls.removeItem(BACKUP_KEY);
console.log("[EaglerBoost] 已还原原设置，性能增强已关闭。");
} else {
console.log("[EaglerBoost] 无备份可还原，保持当前设置。");
}
} catch (ex) {
console.error("[EaglerBoost] 还原设置失败: " + ex);
}
}
// 供 wasm/index.html 在创建 eaglercraftXOpts 之后调用
window.__eaglerBoostApply = function (opts) {
try {
if (!opts || typeof opts !== "object") return;
var boost = isBoostEnabled();
// ---- 固定命名空间，保证与游戏端存储键一致 ----
opts.localStorageNamespace = STORAGE_NAMESPACE;
// ---- 启动/渲染层优化（这些项由客户端读取，安全）----
// 强制 VSync：WASM-GC 端建议开启，避免事件循环被"跑太快"卡死输入
opts.enforceVSync = true;
// 关闭堆栈去混淆：减少日志时的微卡顿
opts.deobfStackTraces = false;
// 关闭 OpenGL 错误检查开销
opts.checkGLErrors = false;
opts.checkShaderGLErrors = false;
// 用 MessageChannel 续帧，比 setTimeout(0) 更顺滑
opts.useDelayOnSwap = false;
// 正常使用 WebGL 扩展
opts.useWebGLExt = true;
// ---- 游戏设置注入（直接写 localStorage，不使用 hooks）----
if (boost) {
applyBoostSettings();
console.log(
"[EaglerBoost] 性能增强 Mod v3.1 已开启：LOD 区块渲染 / 实体加载优化 / FPS 提升。"
);
} else {
restoreOriginalSettings();
console.log("[EaglerBoost] 性能增强 Mod 已关闭，已还原原设置。");
}
} catch (ex) {
// 任何异常都不允许影响游戏本体启动
console.error("[EaglerBoost] 初始化失败（已忽略）: " + ex);
}
};
})();
