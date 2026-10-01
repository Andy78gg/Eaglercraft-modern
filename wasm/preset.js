/*!
* Ruian 首次启动设置预设 (preset.js)  v2.2
* ---------------------------------------------
* 在游戏启动前把用户指定的设置写入 /options（IndexedDB 虚拟文件系统）：
*   localStorage 是错误的存储位置（wasm 只有 PlatformFilesystem，无 localStorage 桥接），
*   游戏设置真实存储在 IndexedDB 对象仓库 "filesystem" 的 "/options" 文件里。
*
* v2.2 变更（解决"改了不生效"）：
*   - 根因：修改 preset.js 内容后，若不同步 wasm/index.html 里引用的版本号
*     （preset.js?v=2.1），浏览器会继续使用缓存的旧脚本，改动根本不加载。
*   - 本版升到 v2.2，index.html 同步引用 ?v=2.2，强制重新下载。
*   - 新增写入失败显式告警：若控制台出现 [RuianPreset] 写入失败，
*     请查看 [RuianStorage] 日志。首次启动时游戏 IndexedDB 数据库尚未创建，
*     预设无法写入，属于正常现象，游戏创建数据库后的下一次启动才会生效。
*
* v2.1 修复（键位值）：
*   - key.saveToolbarActivator: 48(B键) → 47(V键)（用户要求改成 V）
*   - key.hotbar.8: -97(Button3) → -96(Button4)
*   - key.hotbar.7: -96(Button4) → -95(Button5)
*
* v2.0 重大修正：
*   - 写入目标改为 IndexedDB /options（通过 ruianstorage.js 读写）
*   - 写入机制从"同步 localStorage"改为"异步 IndexedDB"，index.html 中必须 await
*
* v1.6 修复（沿用）：
*   按键绑定键名是 "key.xxx" 而非 "key_key.xxx"（v1.5 及以前键位修改一直没生效）
*
* v1.5 变更: 渲染距离 6 -> 7（折中）
*   v1.4 降到 6 后近处流畅了, 但 6 格以外玩家放的建筑不显示(远处空)。
*   改 7 格: 比 9 流畅(近处不缺方块), 远处建筑可见(7~32 格走 LOD)。
*   lodStartDistance 同步 8->7, 不留空白带。
*
* 各项设置（对照 classes.wasm 字符串与官方 1.12.2 源码核实）：
*   - 视野 FOV: Pro(90°)        → fov:0.5      （存储值=(角度-70)/40，0.5→90°）
*   - 渲染距离: 7 格             → renderDistance:7
*   - 亮度: 拉满(Bright)        → gamma:1.0
*   - 亮点 Fullbright: 开       → modern_fullbright:true
*   - GUI 尺寸: 大              → guiScale:3   （0=自动 1=小 2=普通 3=大）
*   - 云: 关                    → renderClouds:false
*   - 快捷栏 9 → 左Alt           → key.hotbar.9:56     (LWJGL KEY_LMENU=56)
*   - 快捷栏 8 → Button 4        → key.hotbar.8:-96
*   - 快捷栏 7 → Button 5        → key.hotbar.7:-95
*   - 保存工具栏激活器 → V        → key.saveToolbarActivator:47 (KEY_V=47)
*   - 自由视角 → 左Ctrl           → key.freelook:29    (KEY_LCONTROL=29)
*
* 为什么每次启动都执行：
*   EaglerBoost(perfmod) 在每次启动时都会整体覆写设置键，若只在第一次写入，
*   重启后这些项会被冲掉。本脚本在 boost 之后执行、每次与现有设置合并后写回，
*   保证上述设置始终生效；用户在游戏里改动的其他设置会保留（合并模式）。
* 控制台：__ruianPreset.apply() 手动重放；__ruianPreset.dump() 打印当前 /options
* ---------------------------------------------
*/
(function () {
"use strict";
// 需要强制生效的预设项（每次启动合并覆写）
var PRESET_KEYS = {
"fov": "0.5",
"renderDistance": "7",
"gamma": "1.0",
"guiScale": "3",
"renderClouds": "false",
"modern_fullbright": "true",
"key.hotbar.9": "56",
"key.hotbar.8": "-96",
"key.hotbar.7": "-95",
"key.saveToolbarActivator": "47",
"key.freelook": "29"
};
// 旧版本写错的键名（key_key.* 前缀），游戏不识别，清掉避免残留
var CLEAN_KEYS = ["key_key.hotbar.9", "key_key.hotbar.8", "key_key.hotbar.7", "key_key.saveToolbarActivator", "key_key.freelook"];
// 全量兜底预设：version:1343 + EaglerBoost 28 项 + 上述 11 项（纯文本，无 gzip）。
// 仅在"/options 不存在"时使用，保证一次启动后就干净可用。
var FULL_PRESET_B64 =
"dmVyc2lvbjoxMzQzCm1vZGVybl9sb2RSZW5kZXJpbmc6dHJ1ZQptb2Rlcm5fbG9kVmlld0Rpc3RhbmNlOjMyCm1vZGVybl9sb2RTdGFydERpc3RhbmNlOjcKcmVuZGVyRGlzdGFuY2U6NwpvZkNodW5rVXBkYXRlczoxCmNodW5rRml4OnRydWUKZm9nOnRydWUKbW9kZXJuX2VudGl0eUN1bGxpbmc6dHJ1ZQplbnRpdHlTaGFkb3dzOmZhbHNlCm1vZGVybl9zaG93T3duTmFtZXRhZzp0cnVlCm1heEZwczoyNjAKZW5hYmxlVnN5bmM6dHJ1ZQpwYXJ0aWNsZXM6MgphbzowCm1pcG1hcExldmVsczowCmZhbmN5R3JhcGhpY3M6ZmFsc2UKcmVuZGVyQ2xvdWRzOmZhbHNlCm1vZGVybl9ub1JhaW46dHJ1ZQptb2Rlcm5fbm9QYXJ0aWNsZXM6dHJ1ZQptb2Rlcm5fbm9HbGludDpmYWxzZQptb2Rlcm5fYmxvY2tGYWNlQ3VsbGluZzp0cnVlCm1vZGVybl9jaHVua01lc2hPcHRpbWl6YXRpb246dHJ1ZQptb2Rlcm5fY3J5c3RhbE9wdGltaXplcjp0cnVlCm1vZGVybl9lYXRpbmdPcHRpbWl6ZXI6dHJ1ZQptb2Rlcm5fbW90aW9uQmx1cjpmYWxzZQptb2Rlcm5fZnVsbGJyaWdodDp0cnVlCm1vZGVybl90b3RlbUNvdW50ZXI6ZmFsc2UKbW9kZXJuX2NsaXBwaW5nOmZhbHNlCmZvdjowLjUKcmVuZGVyRGlzdGFuY2U6NwpnYW1tYToxLjAKZ3VpU2NhbGU6MwpyZW5kZXJDbG91ZHM6ZmFsc2UKbW9kZXJuX2Z1bGxicmlnaHQ6dHJ1ZQprZXkuaG90YmFyLjk6NTYKa2V5LmhvdGJhci44Oi05NgprZXkuaG90YmFyLjc6LTk1CmtleS5zYXZlVG9vbGJhckFjdGl2YXRvcjo0NwprZXkuZnJlZWxvb2s6Mjk=";
async function applyPreset() {
try {
if (typeof window.__ruianStorageReadOptions !== "function") {
console.warn("[RuianPreset] ruianstorage 未加载，跳过。");
return false;
}
var text = await window.__ruianStorageReadOptions();
var map = {};
var source = "empty";
if (text !== null && text.length > 0) {
map = window.__ruianStorageParse(text);
source = "existing";
}
var pKeys = Object.keys(PRESET_KEYS);
for (var i = 0; i < pKeys.length; i++) {
map[pKeys[i]] = PRESET_KEYS[pKeys[i]];
}
for (var c = 0; c < CLEAN_KEYS.length; c++) {
if (CLEAN_KEYS[c] in map) delete map[CLEAN_KEYS[c]];
}
var newText;
if (source === "existing" && Object.keys(map).length >= 2) {
// 与现有设置合并（保留用户在游戏里改的其他项）
newText = window.__ruianStorageSerialize(map);
} else {
// 空：直接写完整预设
newText = window.__ruianStorageB64ToText(FULL_PRESET_B64);
}
var ok = await window.__ruianStorageWriteOptions(newText);
if (ok) {
console.log("[RuianPreset] v2.2 已写入（来源: " + source + "，共 " + Object.keys(map).length + " 项设置，渲染距离:7）。");
} else {
console.error("[RuianPreset] 写入 /options 失败！请查看上方 [RuianStorage] 日志：未找到游戏数据库时（首次启动/无痕模式）预设无法写入，游戏创建数据库后的下一次启动才会生效。");
}
return ok;
} catch (ex) {
console.error("[RuianPreset] 应用失败（不影响游戏启动）: " + ex);
return false;
}
}
// 供 wasm/index.html 在 EaglerBoost 设置写入之后调用（保证不被覆盖）
window.__eaglerPresetApply = function () {
return applyPreset();
};
// 控制台工具
window.__ruianPreset = {
apply: function () { return applyPreset(); },
dump: function () {
return window.__ruianStorageReadOptions().then(function (t) {
return t === null ? "（/options 不存在）" : t;
}).catch(function (e) { return "解码失败: " + e; });
}
};
})();
