/*!
* Ruian 首次启动设置预设 (preset.js)  v3.0
* ---------------------------------------------
* 在游戏启动前把用户指定的设置写入游戏设置存储：
*   localStorage["_eaglercraft_1.12.g"] = base64("key:value" 逐行 UTF-8 纯文本)
*
* v3.0 重大反转（真正生效，浏览器实测确认）：
*   游戏设置存在 localStorage["_eaglercraft_1.12.g"]，不是 IndexedDB！
*   【实测】游戏改 FOV 后自己回写该 localStorage；写入 fov:0.5 后重启游戏
*   FOV 显示 90°。IndexedDB /options 游戏不读（v2.x 写那里是给死数据）。
*   同时确认游戏内部键名是 "key_key.xxx"（如 key_key.hotbar.9），
*   不是 "key.xxx"！v1.6 的 key. 前缀结论是错的。
*   键码修正：鼠标 Button4 = -97（快捷栏8）、Button5 = -96（快捷栏7）。
*
* v2.2 变更（沿用）：
*   - 版本号强制刷新：改动 preset.js 必须同步 index.html 的 ?v= 版本号
* v2.1 修复（沿用）：
*   - key.saveToolbarActivator: 47(V键)
* v1.5 变更（沿用）: 渲染距离 6 -> 7（折中）
*
* 各项设置（对照游戏回写的真实 options 核实）：
*   - 视野 FOV: Pro(90°)        → fov:0.5      （存储值=(角度-70)/40，0.5→90°）
*   - 渲染距离: 7 格             → renderDistance:7
*   - 亮度: 拉满(Bright)        → gamma:1.0
*   - 亮点 Fullbright: 开       → modern_fullbright:true
*   - GUI 尺寸: 大              → guiScale:3   （0=自动 1=小 2=普通 3=大）
*   - 云: 关                    → renderClouds:false
*   - 快捷栏 9 → 左Alt           → key_key.hotbar.9:56      (LWJGL KEY_LMENU=56)
*   - 快捷栏 8 → 鼠标侧键4        → key_key.hotbar.8:-97     （鼠标键: -100左键/-99右键/-98中键/-97 B4/-96 B5）
*   - 快捷栏 7 → 鼠标侧键5        → key_key.hotbar.7:-96
*   - 保存工具栏激活器 → V        → key_key.saveToolbarActivator:47 (KEY_V=47)
*   - 自由视角 → 左Ctrl           → key_key.freelook:29    (KEY_LCONTROL=29)
*
* 为什么每次启动都执行：
*   EaglerBoost(perfmod) 在每次启动时都会整体覆写设置键，若只在第一次写入，
*   重启后这些项会被冲掉。本脚本在 boost 之后执行、每次与现有设置合并后写回，
*   保证上述设置始终生效；用户在游戏里改动的其他设置会保留（合并模式）。
* 控制台：__ruianPreset.apply() 手动重放；__ruianPreset.dump() 打印当前设置文本
* ---------------------------------------------
*/
(function () {
"use strict";
// 需要强制生效的预设项（每次启动合并覆写；键名用游戏真实格式 key_key.）
var PRESET_KEYS = {
"fov": "0.5",
"renderDistance": "7",
"gamma": "1.0",
"guiScale": "3",
"renderClouds": "false",
"modern_fullbright": "true",
"key_key.hotbar.9": "56",
"key_key.hotbar.8": "-97",
"key_key.hotbar.7": "-96",
"key_key.saveToolbarActivator": "47",
"key_key.freelook": "29"
};
// 旧版本写错的键名（key. 前缀 / 旧键码），游戏不识别，清掉避免残留
var CLEAN_KEYS = ["key.hotbar.9", "key.hotbar.8", "key.hotbar.7", "key.saveToolbarActivator", "key.freelook",
"key_key.hotbar.8:-96", "key_key.hotbar.7:-95"];
// 全量兜底预设：version:1343 + 增强项 + 上述 11 项（纯文本 base64，无 gzip）。
// 仅在"现有设置为空或损坏"时使用，保证一次启动后就干净可用。
var FULL_PRESET_B64 =
"dmVyc2lvbjoxMzQzCm1vZGVybl9sb2RSZW5kZXJpbmc6dHJ1ZQptb2Rlcm5fbG9kVmlld0Rpc3RhbmNlOjMyCm1vZGVybl9sb2RTdGFydERpc3RhbmNlOjcKcmVuZGVyRGlzdGFuY2U6NwpvZkNodW5rVXBkYXRlczoxCmNodW5rRml4OnRydWUKZm9nOnRydWUKbW9kZXJuX2VudGl0eUN1bGxpbmc6dHJ1ZQplbnRpdHlTaGFkb3dzOmZhbHNlCm1vZGVybl9zaG93T3duTmFtZXRhZzp0cnVlCm1heEZwczoyNjAKZW5hYmxlVnN5bmM6dHJ1ZQpwYXJ0aWNsZXM6MgphbzowCm1pcG1hcExldmVsczowCmZhbmN5R3JhcGhpY3M6ZmFsc2UKcmVuZGVyQ2xvdWRzOmZhbHNlCm1vZGVybl9ub1JhaW46dHJ1ZQptb2Rlcm5fbm9QYXJ0aWNsZXM6dHJ1ZQptb2Rlcm5fbm9HbGludDpmYWxzZQptb2Rlcm5fYmxvY2tGYWNlQ3VsbGluZzp0cnVlCm1vZGVybl9jaHVua01lc2hPcHRpbWl6YXRpb246dHJ1ZQptb2Rlcm5fY3J5c3RhbE9wdGltaXplcjp0cnVlCm1vZGVybl9lYXRpbmdPcHRpbWl6ZXI6dHJ1ZQptb2Rlcm5fbW90aW9uQmx1cjpmYWxzZQptb2Rlcm5fZnVsbGJyaWdodDp0cnVlCm1vZGVybl90b3RlbUNvdW50ZXI6ZmFsc2UKbW9kZXJuX2NsaXBwaW5nOmZhbHNlCmZvdjowLjUKcmVuZGVyRGlzdGFuY2U6NwpnYW1tYToxLjAKZ3VpU2NhbGU6MwpyZW5kZXJDbG91ZHM6ZmFsc2UKbW9kZXJuX2Z1bGxicmlnaHQ6dHJ1ZQprZXlfa2V5LmhvdGJhci45OjU2CmtleV9rZXkuaG90YmFyLjg6LTk3CmtleV9rZXkuaG90YmFyLjc6LTk2CmtleV9rZXkuc2F2ZVRvb2xiYXJBY3RpdmF0b3I6NDcKa2V5X2tleS5mcmVlbG9vazoyOQ==";
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
console.log("[RuianPreset] v3.0 已写入（来源: " + source + "，共 " + Object.keys(map).length + " 项设置，渲染距离:7，FOV:90）。");
} else {
console.error("[RuianPreset] 写入失败！请查看上方 [RuianStorage] 日志（无痕模式/禁用 localStorage 时无法写入）。");
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
return t === null ? "（设置不存在）" : t;
}).catch(function (e) { return "解码失败: " + e; });
}
};
})();
