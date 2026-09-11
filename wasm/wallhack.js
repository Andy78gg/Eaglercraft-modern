/*!
 * Ruian Client - 人物透视 / Wallhack Mod (wallhack.js)
 * -----------------------------------------------------
 * 功能：
 *   - 开启后：方块（墙/山体）不再写入深度缓冲，玩家、矿石、物品
 *     都会从墙后面"透"出来显示（人物透视 + 简易 Xray 效果）
 *   - 按 X 键：直接【打开 / 关闭】透视
 *   - 左上角 XR 圆钮：同样开关透视（绿=开，红=关）
 *   - 设置保存在 localStorage，下次启动自动生效
 *
 * v1.0 实现原理（已按本仓库 wasm/eagruntime.js 逐一核实）：
 *   EaglercraftX 1.12 WASM-GC 客户端中，wasm 的所有 OpenGL 调用都
 *   经由 eagruntime.js 绑定到 WebGL context 的 JS 方法：
 *     K.glDepthMask = a.depthMask.bind(a)
 *     K.glDrawElements = a.drawElements.bind(a)
 *   其中 a = canvas.getContext("webgl2"/"webgl") 返回的 context。
 *
 *   因此本 Mod 在 eagruntime.js 加载之前 hook
 *   HTMLCanvasElement.prototype.getContext，抢先替换 context 上的
 *   depthMask / drawElements / drawArrays / useProgram，之后游戏
 *   拿到的就是被包装过的 GL 方法，wasm 每帧渲染都会经过本 Mod。
 *
 *   原理：
 *   1) 拦截 useProgram 记录当前 shader program；
 *   2) 统计每个 program 每次 draw 的顶点数，自学习出"方块 program"
 *      （chunk 一次 draw 数百~数千顶点，实体/玩家一般 < 500）；
 *   3) 透视开启时，对"方块 program"的 draw 强制 depthMask(false)
 *      —— 墙不写深度，后面渲染的玩家/矿石通过深度测试，透出墙体。
 *
 * 必须在 eagruntime.js 之前加载（由 wasm/index.html 引入）。
 */
(function () {
  "use strict";

  var SETTINGS_KEY = "eagler_wallhack_settings";

  // ---------- 设置（默认值） ----------
  var settings = { enabled: false };

  function loadSettings() {
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === "object" && typeof obj.enabled === "boolean") {
          settings.enabled = obj.enabled;
        }
      }
    } catch (ex) { /* 使用默认值 */ }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (ex) { /* 忽略写入失败 */ }
  }

  // ---------- WebGL 包装 ----------
  var STAT = new Map();          // program -> { draws, verts }
  var BLOCK_PROGRAMS = new Set(); // 已学习的方块 program 集合
  var LEARNED = false;            // 是否完成学习
  var lastLearnAt = 0;

  // 每 8 秒或累计 100 次 draw 后重新学习一次（画面内容会变化）
  function maybeLearn(now) {
    if (LEARNED && now - lastLearnAt < 8000) return;
    var totalDraws = 0;
    STAT.forEach(function (s) { totalDraws += s.draws; });
    if (totalDraws < 100) return; // 数据太少，先不学习

    // 平均每次 draw 顶点数 > 600 的 program 视为方块（chunk）program
    // 玩家/实体模型一次 draw 一般 < 500 顶点，地形 chunk 一次 draw 数百~数千
    var blockSet = new Set();
    STAT.forEach(function (s, prog) {
      if (s.draws > 0 && (s.verts / s.draws) > 600) blockSet.add(prog);
    });
    // 需要至少识别出 1 个，否则沿用旧的
    if (blockSet.size > 0) {
      BLOCK_PROGRAMS.clear();
      blockSet.forEach(function (p) { BLOCK_PROGRAMS.add(p); });
      LEARNED = true;
      lastLearnAt = now;
      if (window.__ruianWallhackDebug) {
        console.log("[Wallhack] 学习完成: block programs=" + BLOCK_PROGRAMS.size + " 总programs=" + STAT.size);
      }
    }
  }

  function isBlockProgram(prog) {
    return LEARNED && BLOCK_PROGRAMS.has(prog);
  }

  var WRAPPED = false;

  function wrapGL(gl) {
    if (gl.__ruianWallhackWrapped) return;
    try { Object.defineProperty(gl, "__ruianWallhackWrapped", { value: true }); } catch (e) {}

    var origDepthMask = gl.depthMask && gl.depthMask.bind(gl);
    var origDrawElements = gl.drawElements && gl.drawElements.bind(gl);
    var origDrawArrays = gl.drawArrays && gl.drawArrays.bind(gl);
    var origUseProgram = gl.useProgram && gl.useProgram.bind(gl);

    if (!origDepthMask || !origDrawElements || !origUseProgram) return;

    var currentProgram = null;

    gl.useProgram = function (prog) {
      currentProgram = prog;
      return origUseProgram(prog);
    };

    gl.depthMask = function (flag) {
      // 原样透传，游戏自身状态不受影响；真正的强制由 draw 前注入完成
      return origDepthMask(flag);
    };

    function beforeDraw(now) {
      maybeLearn(now);
      if (settings.enabled && isBlockProgram(currentProgram)) {
        // 方块 program 强制不写深度 → 墙透明化，玩家/矿石透出
        origDepthMask(false);
      }
      if (currentProgram) {
        var s = STAT.get(currentProgram) || { draws: 0, verts: 0 };
        s.draws++;
        STAT.set(currentProgram, s);
      }
    }

    gl.drawElements = function (mode, count, type, offset) {
      beforeDraw(Date.now());
      if (currentProgram) {
        var s = STAT.get(currentProgram);
        if (s) s.verts += count;
      }
      return origDrawElements(mode, count, type, offset);
    };

    gl.drawArrays = function (mode, first, count) {
      beforeDraw(Date.now());
      if (currentProgram) {
        var s = STAT.get(currentProgram);
        if (s) s.verts += count;
      }
      return origDrawArrays(mode, first, count);
    };
  }

  function installHook() {
    var origGetContext = HTMLCanvasElement.prototype.getContext;
    if (origGetContext.__ruianWallhackHook) return;
    var hooked = function (type) {
      var ctx = origGetContext.apply(this, arguments);
      if (ctx && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
        wrapGL(ctx);
      }
      return ctx;
    };
    try { Object.defineProperty(hooked, "__ruianWallhackHook", { value: true }); } catch (e) {}
    HTMLCanvasElement.prototype.getContext = hooked;
    WRAPPED = true;
  }

  // ---------- UI：开关提示条 ----------
  var toastEl = null, toastTimer = null;
  function showToast(text) {
    if (!toastEl) {
      var st = document.createElement("style");
      st.textContent = "#ruian-xr-toast{position:fixed;top:84px;left:50%;transform:translateX(-50%);z-index:1000000;background:rgba(15,15,15,.92);border:1px solid #55ff55;color:#55ff55;font-family:monospace;font-size:14px;font-weight:700;padding:6px 16px;border-radius:4px;letter-spacing:1px;opacity:0;transition:opacity .15s;pointer-events:none;user-select:none;-webkit-user-select:none}";
      document.head.appendChild(st);
      toastEl = document.createElement("div");
      toastEl.id = "ruian-xr-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = "1";
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = "0"; toastTimer = null; }, 1200);
  }

  // ---------- 左上角 XR 圆钮 ----------
  var fabEl = null;
  function buildFab() {
    var st = document.createElement("style");
    st.textContent = "#ruian-xr-fab{position:fixed;left:8px;top:48px;z-index:999998;width:32px;height:32px;border-radius:50%;background:rgba(20,20,20,.72);border:2px solid #ff5555;color:#ff5555;font-family:monospace;font-weight:700;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;opacity:.55;padding:0}#ruian-xr-fab:hover{opacity:1;background:rgba(40,20,20,.9)}#ruian-xr-fab.ruian-xr-on{border-color:#55ff55;color:#55ff55}#ruian-xr-fab.ruian-xr-on:hover{background:rgba(20,40,20,.9)}";
    document.head.appendChild(st);
    var fab = document.createElement("button");
    fab.id = "ruian-xr-fab";
    fab.type = "button";
    fab.textContent = "XR";
    fab.title = "人物透视 / Wallhack（按 X 开关）";
    fab.addEventListener("click", function (ev) {
      if (ev.stopPropagation) ev.stopPropagation();
      toggleEnabled();
    });
    document.body.appendChild(fab);
    fabEl = fab;
    updateFabState();
  }

  function updateFabState() {
    if (!fabEl) return;
    if (settings.enabled) {
      fabEl.classList.add("ruian-xr-on");
      fabEl.style.borderColor = "#55ff55";
      fabEl.style.color = "#55ff55";
    } else {
      fabEl.classList.remove("ruian-xr-on");
      fabEl.style.borderColor = "#ff5555";
      fabEl.style.color = "#ff5555";
    }
  }

  // ---------- 开关 ----------
  function toggleEnabled() {
    settings.enabled = !settings.enabled;
    saveSettings();
    updateFabState();
    showToast(settings.enabled ? "透视：开" : "透视：关");
  }

  // ---------- 监听 X 键 ----------
  function isXKey(e) {
    if (e.key === "x" || e.key === "X") return true;
    if (e.keyCode === 88) return true;
    if (e.code === "KeyX") return true;
    return false;
  }

  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    var ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
    if (isXKey(e)) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      console.log("[Wallhack] 触发按键: key=" + JSON.stringify(e.key) + " keyCode=" + e.keyCode + " code=" + e.code);
      toggleEnabled();
    }
  }, true);

  // ---------- 初始化 ----------
  loadSettings();
  installHook();
  if (document.body) {
    buildFab();
  } else {
    document.addEventListener("DOMContentLoaded", buildFab);
  }
  console.log("[Wallhack] 已加载。按 X 键开关人物透视；左上角 XR 圆钮也可切换。");

  // 供调试 / 验证用的小接口
  window.__ruianWallhack = {
    getSettings: function () { return JSON.parse(JSON.stringify(settings)); },
    toggleEnabled: toggleEnabled,
    setEnabled: function (v) {
      settings.enabled = !!v;
      saveSettings();
      updateFabState();
    },
    isHookInstalled: function () { return WRAPPED; },
    getBlockPrograms: function () { return BLOCK_PROGRAMS.size; },
    getProgramStats: function () {
      var out = [];
      STAT.forEach(function (s, p) {
        out.push({ prog: p, draws: s.draws, verts: s.verts, avg: s.draws ? Math.round(s.verts / s.draws) : 0, block: BLOCK_PROGRAMS.has(p) });
      });
      return out;
    }
  };
})();
