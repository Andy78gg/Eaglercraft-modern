/*!
 * Ruian 首次启动设置预设 (preset.js)  v1.3
 * ---------------------------------------------
 * 在游戏启动时把用户指定的设置写入游戏设置存储：
 *   localStorage["_eaglercraft_1.12.g"] = base64("key:value" 逐行 UTF-8 文本)
 *
 * 格式核实（重要修正 v1.3）：
 *   本仓库 1.12 客户端的 GameSettings 与 Eaglercraft 1.8 不同：
 *   - writeOptions() 用 PrintWriter 直接写纯文本（首行 version:1343），没有 gzip；
 *   - loadOptions() 用 IOUtils.readLines() 按 UTF-8 读行解析，也没有解压步骤；
 *   - 存储 = base64(纯文本行)。
 *   之前的版本误用了 base64(GZIP(文本))，游戏把 gzip 二进制当 UTF-8 文本解析，
 *   所有设置项一个都匹配不上，全部落回默认值——这就是设置"没生效"的根因。
 *
 * 各项设置（对照 classes.wasm 字符串与官方 1.12.2 源码核实）：
 *   - 视野 FOV: Pro(90°)        → fov:0.5      （存储值=(角度-70)/40，0.5→90°）
 *   - 渲染距离: 9 格             → renderDistance:9
 *   - 亮度: 拉满(Bright)        → gamma:1.0
 *   - 亮点 Fullbright: 开       → modern_fullbright:true
 *   - GUI 尺寸: 大              → guiScale:3   （0=自动 1=小 2=普通 3=大）
 *   - 云: 关                    → renderClouds:false
 *   - 快捷栏 9 → 左Alt           → key_key.hotbar.9:56     (LWJGL KEY_LMENU=56)
 *   - 快捷栏 8 → Button 4        → key_key.hotbar.8:-97    （鼠标键=-100+按钮号）
 *   - 快捷栏 7 → Button 5        → key_key.hotbar.7:-96
 *   - 保存工具栏激活器 → B        → key_key.saveToolbarActivator:48 (KEY_B=48)
 *   - 自由视角 → 左Ctrl           → key_key.freelook:29    (KEY_LCONTROL=29)
 *
 * 为什么每次启动都执行：
 *   EaglerBoost(perfmod) 在每次启动时都会整体覆写设置键，若只在第一次写入，
 *   重启后这些项会被冲掉。本脚本在 boost 之后执行、每次与现有设置合并后写回，
 *   保证上述设置始终生效；用户在游戏里改动的其他设置会保留（合并模式）。
 * 控制台：__ruianPreset.apply() 手动重放；__ruianPreset.dump() 打印当前存储文本
 * ---------------------------------------------
 */
(function () {
  "use strict";

  var STORAGE_NAMESPACE = "_eaglercraft_1.12";
  var SETTINGS_KEY = "g";
  var FULL_KEY = STORAGE_NAMESPACE + "." + SETTINGS_KEY;

  // 需要强制生效的预设项（每次启动合并覆写）
  var PRESET_KEYS = {
    "fov": "0.5",
    "renderDistance": "9",
    "gamma": "1.0",
    "guiScale": "3",
    "renderClouds": "false",
    "modern_fullbright": "true",
    "key_key.hotbar.9": "56",
    "key_key.hotbar.8": "-97",
    "key_key.hotbar.7": "-96",
    "key_key.saveToolbarActivator": "48",
    "key_key.freelook": "29"
  };

  // 全量兜底预设：version:1343 + EaglerBoost 28 项 + 上述 11 项（纯文本 base64，无 gzip）。
  // 仅在"现有设置为空或损坏（旧 gzip 乱码）"时使用，保证一次启动后就干净可用。
  var FULL_PRESET_B64 =
    "dmVyc2lvbjoxMzQzCm1vZGVybl9sb2RSZW5kZXJpbmc6dHJ1ZQptb2Rlcm5fbG9kVmlld0Rpc3RhbmNlOjMyCm1vZGVybl9sb2RTdGFydERpc3RhbmNlOjgKcmVuZGVyRGlzdGFuY2U6OApvZkNodW5rVXBkYXRlczoxCmNodW5rRml4OnRydWUKZm9nOnRydWUKbW9kZXJuX2VudGl0eUN1bGxpbmc6dHJ1ZQplbnRpdHlTaGFkb3dzOmZhbHNlCm1vZGVybl9zaG93T3duTmFtZXRhZzp0cnVlCm1heEZwczoyNjAKZW5hYmxlVnN5bmM6dHJ1ZQpwYXJ0aWNsZXM6MgphbzowCm1pcG1hcExldmVsczowCmZhbmN5R3JhcGhpY3M6ZmFsc2UKcmVuZGVyQ2xvdWRzOmZhbHNlCm1vZGVybl9ub1JhaW46dHJ1ZQptb2Rlcm5fbm9QYXJ0aWNsZXM6dHJ1ZQptb2Rlcm5fbm9HbGludDpmYWxzZQptb2Rlcm5fYmxvY2tGYWNlQ3VsbGluZzp0cnVlCm1vZGVybl9jaHVua01lc2hPcHRpbWl6YXRpb246dHJ1ZQptb2Rlcm5fY3J5c3RhbE9wdGltaXplcjp0cnVlCm1vZGVybl9lYXRpbmdPcHRpbWl6ZXI6dHJ1ZQptb2Rlcm5fbW90aW9uQmx1cjpmYWxzZQptb2Rlcm5fZnVsbGJyaWdodDp0cnVlCm1vZGVybl90b3RlbUNvdW50ZXI6ZmFsc2UKbW9kZXJuX2NsaXBwaW5nOmZhbHNlCmZvdjowLjUKcmVuZGVyRGlzdGFuY2U6OQpnYW1tYToxLjAKZ3VpU2NhbGU6MwpyZW5kZXJDbG91ZHM6ZmFsc2UKbW9kZXJuX2Z1bGxicmlnaHQ6dHJ1ZQprZXlfa2V5LmhvdGJhci45OjU2CmtleV9rZXkuaG90YmFyLjg6LTk3CmtleV9rZXkuaG90YmFyLjc6LTk2CmtleV9rZXkuc2F2ZVRvb2xiYXJBY3RpdmF0b3I6NDgKa2V5X2tleS5mcmVlbG9vazoyOQ==";

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

  // 旧版本写入的是 gzip，需要在【字节层】检测（gzip magic 0x1F 0x8B）。
  // 注意：不能在 UTF-8 解码后检测——gzip 二进制里 0x8B 会被 UTF-8 解码器
  // 替换成 U+FFFD，magic 就丢了。这里先用 atob 拿到原始字节再判断。
  function decodeStorageText(existing) {
    var bin = atob(existing);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      return null; // 旧 gzip 二进制，游戏无法解析
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  function applyPreset() {
    var ls = getStorage();
    if (!ls) return false;

    var map = {};
    var source = "empty";
    var existing = null;
    try { existing = ls.getItem(FULL_KEY); } catch (ex) {}

    if (existing) {
      try {
        var text = decodeStorageText(existing);
        if (text !== null) {
          map = parseSettings(text);
          source = "existing";
        } else {
          console.warn("[RuianPreset] 现有设置是旧的 gzip 格式（游戏读不了），将用全新预设替换。");
        }
      } catch (ex) {
        console.warn("[RuianPreset] 现有设置解码失败，将用全新预设替换: " + ex);
      }
    }

    var pKeys = Object.keys(PRESET_KEYS);
    for (var i = 0; i < pKeys.length; i++) {
      map[pKeys[i]] = PRESET_KEYS[pKeys[i]];
    }

    var b64;
    if (source === "existing" && Object.keys(map).length >= 2) {
      // 与现有设置合并（保留用户在游戏里改的其他项）
      b64 = textToB64(serializeSettings(map));
    } else {
      // 空或损坏：直接写完整预设
      b64 = FULL_PRESET_B64;
    }

    try {
      ls.setItem(FULL_KEY, b64);
      console.log("[RuianPreset] 首次启动设置已写入（来源: " + source + "，共 " + Object.keys(map).length + " 项设置）。");
      return true;
    } catch (ex) {
      console.error("[RuianPreset] 写入失败（不影响游戏启动）: " + ex);
      return false;
    }
  }

  // 供 wasm/index.html 在 EaglerBoost 设置写入之后调用（保证不被覆盖）
  window.__eaglerPresetApply = function () {
    try {
      applyPreset();
    } catch (ex) {
      console.error("[RuianPreset] 应用失败（不影响游戏启动）: " + ex);
    }
  };

  // 控制台工具
  window.__ruianPreset = {
    apply: function () {
      try { window.__eaglerPresetApply(); } catch (ex) {}
    },
    dump: function () {
      var ls = getStorage();
      if (!ls) return "localStorage 不可用";
      try {
        var raw = ls.getItem(FULL_KEY);
        if (!raw) return "未找到 " + FULL_KEY;
        var text = decodeStorageText(raw);
        return text === null
          ? "现有值仍是旧 gzip 乱码（下次启动会被本脚本替换为正确格式）"
          : text;
      } catch (ex) {
        return "解码失败: " + ex;
      }
    }
  };
})();
