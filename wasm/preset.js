/*!
 * Ruian 首次启动设置预设 (preset.js)
 * ---------------------------------------------
 * 在游戏第一次打开时，把用户指定的设置写入游戏设置存储：
 *   localStorage["_eaglercraft_1.12.g"] = base64(GZIP("key:value" 逐行文本))
 *
 * 各项均已对照 classes.wasm 字符串与官方 1.12.2 反编译源码核实：
 *   - 视野 FOV: Pro(90°)        → fov:0.5   （存储值=(角度-70)/40，0.5→90°）
 *   - 渲染距离: 9 格             → renderDistance:9
 *   - 亮度: 拉满(Bright)        → gamma:1.0
 *   - 亮点 Fullbright: 开       → modern_fullbright:true
 *   - GUI 尺寸: 大              → guiScale:3  （0=自动 1=小 2=普通 3=大）
 *   - 云: 关                    → renderClouds:false
 *   - 快捷栏 9 → 左Alt           → key_key.hotbar.9:56   (LWJGL KEY_LMENU=56)
 *   - 快捷栏 8 → Button 4        → key_key.hotbar.8:-97  （鼠标侧键，显示名=键码+101）
 *   - 快捷栏 7 → Button 5        → key_key.hotbar.7:-96
 *   - 保存工具栏激活器 → V        → key_key.saveToolbarActivator:47 (KEY_V=47)
 *   - 自由视角 → 左Ctrl           → key_key.freelook:29  (KEY_LCONTROL=29)
 *
 * 只在第一次启动时生效（localStorage 标记 ruian_preset_applied=1 后不再覆盖），
 * 之后用户在游戏里的改动会正常保存、不会被本脚本覆盖。
 * 控制台手动重放：__ruianPreset.apply() ；清除标记：__ruianPreset.reset()
 * ---------------------------------------------
 */
(function () {
  "use strict";

  // 与 perfmod.js 相同的存储命名空间（从 classes.wasm 核实）
  var STORAGE_NAMESPACE = "_eaglercraft_1.12";
  var SETTINGS_KEY = "g";
  var FULL_KEY = STORAGE_NAMESPACE + "." + SETTINGS_KEY;
  var MARKER_KEY = "ruian_preset_applied";

  var PRESET_TEXT = [
    "fov:0.5",
    "renderDistance:9",
    "gamma:1.0",
    "guiScale:3",
    "renderClouds:false",
    "modern_fullbright:true",
    "key_key.hotbar.9:56",
    "key_key.hotbar.8:-97",
    "key_key.hotbar.7:-96",
    "key_key.saveToolbarActivator:47",
    "key_key.freelook:29"
  ].join("\n");

  function getStorage() {
    try {
      if (window.localStorage) return window.localStorage;
    } catch (ex) {}
    return null;
  }

  function parseSettings(text) {
    var map = {};
    text.split("\n").forEach(function (line) {
      var i = line.indexOf(":");
      if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
    });
    return map;
  }

  function serializeSettings(map) {
    var keys = Object.keys(map);
    var out = [];
    for (var i = 0; i < keys.length; i++) out.push(keys[i] + ":" + map[keys[i]]);
    return out.join("\n");
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function gunzipText(b64) {
    var ds = new DecompressionStream("gzip");
    var stream = new Blob([b64ToBytes(b64)]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new TextDecoder("utf-8").decode(buf);
  }

  async function gzipText(text) {
    var data = new TextEncoder().encode(text);
    var cs = new CompressionStream("gzip");
    var stream = new Blob([data]).stream().pipeThrough(cs);
    var buf = await new Response(stream).arrayBuffer();
    return bytesToB64(new Uint8Array(buf));
  }

  async function applyPresetOnce() {
    var ls = getStorage();
    if (!ls) return false;

    var map = {};
    var existing = ls.getItem(FULL_KEY);
    if (existing) {
      try {
        map = parseSettings(await gunzipText(existing));
      } catch (ex) {
        console.warn("[RuianPreset] 现有设置解码失败，将仅写入预设项: " + ex);
        map = {};
      }
    }

    PRESET_TEXT.split("\n").forEach(function (line) {
      var i = line.indexOf(":");
      if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
    });

    var b64 = await gzipText(serializeSettings(map));
    ls.setItem(FULL_KEY, b64);
    ls.setItem(MARKER_KEY, "1");
    console.log("[RuianPreset] 首次启动设置已写入（共 " + Object.keys(map).length + " 项设置）。");
    return true;
  }

  // 供 wasm/index.html 在 EaglerBoost 设置写入之后调用（保证不被覆盖）
  window.__eaglerPresetApply = function () {
    var ls = getStorage();
    if (!ls) return;
    try {
      if (ls.getItem(MARKER_KEY) === "1") {
        console.log("[RuianPreset] 首次设置已应用过（标记存在），跳过。如需重放：__ruianPreset.apply()");
        return;
      }
    } catch (ex) {}

    if (typeof DecompressionStream === "undefined" || typeof CompressionStream === "undefined") {
      console.warn("[RuianPreset] 浏览器不支持 CompressionStream/DecompressionStream，跳过首次设置写入。");
      return;
    }

    applyPresetOnce().catch(function (err) {
      console.error("[RuianPreset] 写入失败（不影响游戏启动）: " + err);
    });
  };

  // 控制台工具
  window.__ruianPreset = {
    apply: function () {
      var ls = getStorage();
      if (ls) {
        try { ls.removeItem(MARKER_KEY); } catch (ex) {}
      }
      window.__eaglerPresetApply();
    },
    reset: function () {
      var ls = getStorage();
      if (ls) {
        try { ls.removeItem(MARKER_KEY); } catch (ex) {}
      }
      console.log("[RuianPreset] 已清除首次设置标记，下次打开游戏会重新应用预设。");
    }
  };
})();
