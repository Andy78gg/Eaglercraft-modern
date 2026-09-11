/*!
 * Ruian Client - AutoClicker 连点器 Mod (autoclicker.js)
 * -------------------------------------------------------
 * 功能：
 *   - 按住鼠标左键 / 右键时，按设定 CPS 自动连点
 *   - CPS 可在 1 ~ 100 之间调节（默认 12）
 *   - CPS 跳动：每次点击间隔在 ±X% 内随机波动（默认 ±10%，可调 0~50%）
 *   - 按 V 键：直接【打开 / 关闭】连点器（不弹界面）
 *   - 按 | 键（Shift + \）：打开 / 关闭设置面板（调 CPS / 跳动 / 左右键）
 *   - 左上角绿色 AC 圆钮：同样打开设置面板
 *   - 设置保存在 localStorage，下次启动自动生效
 *
 * v1.5 变更：
 *   新增 CPS 跳动（jitter）：开启后每次点击间隔在目标 CPS 的
 *   ±jitterPct% 范围内随机波动（例：CPS 20、跳动 ±10% → 实际 18~22），
 *   更接近人手点击、不易被反作弊检测。
 * v1.4 变更：
 *   按键分工明确：V = 连点器总开关；| = 打开参数设置面板。
 *   （v1.3 曾把 | 一并改为开关，用户要求 | 用于调参数，已恢复）
 *
 * 原理（已按本仓库 wasm/eagruntime.js 逐一核实）：
 *   EaglercraftX WASM-GC 客户端把鼠标输入绑定在
 *   `._eaglercraftX_canvas_element` 画布元素上：
 *     T.addEventListener("mousedown", ... W({eventType:0, posX:l.offsetX, posY:l.offsetY, button:l.button}))
 *     T.addEventListener("mouseup",   ... W({eventType:1, posX:l.offsetX, posY:l.offsetY, button:l.button}))
 *   因此本 Mod 在用户真实按住某键时，向该画布派发合成的
 *   mousedown / mouseup 事件，游戏端会像收到真实点击一样处理。
 *
 * 必须在 eagruntime.js 之前加载（由 wasm/index.html 引入）。
 */
(function () {
  "use strict";

  var CANVAS_SELECTOR = "._eaglercraftX_canvas_element";
  var SETTINGS_KEY = "eagler_autoclicker_settings";

  // ---------- 设置（默认值） ----------
  var settings = {
    enabled: true, // 连点器总开关
    cps: 12,       // 每秒点击数，1~100
    jitter: true,  // CPS 跳动开关
    jitterPct: 10, // 跳动幅度（±百分比），例：CPS 20 ±10% → 18~22
    left: true,    // 左键连点
    right: true    // 右键连点
  };

  function loadSettings() {
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === "object") {
          if (typeof obj.enabled === "boolean") settings.enabled = obj.enabled;
          if (typeof obj.cps === "number") {
            settings.cps = Math.min(100, Math.max(1, Math.round(obj.cps)));
          }
          if (typeof obj.jitter === "boolean") settings.jitter = obj.jitter;
          if (typeof obj.jitterPct === "number") {
            settings.jitterPct = Math.min(50, Math.max(0, Math.round(obj.jitterPct)));
          }
          if (typeof obj.left === "boolean") settings.left = obj.left;
          if (typeof obj.right === "boolean") settings.right = obj.right;
        }
      }
    } catch (ex) {
      // localStorage 不可用或设置损坏时使用默认值
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (ex) {
      // 忽略写入失败
    }
  }

  // ---------- 运行状态 ----------
  var held = { 0: false, 2: false }; // 真实按住的鼠标键（0=左键，2=右键）
  var intervalId = null;             // 连点循环定时器
  var panelEl = null;                // 设置面板 DOM
  var panelVisible = false;          // 面板是否显示
  var fabEl = null;                  // 左上角 AC 圆钮
  var toastEl = null;                // 开关提示条
  var toastTimer = null;
  var virtX = 0, virtY = 0;          // 光标屏幕坐标（指针锁定时累加位移推算）

  // ---------- 工具 ----------
  function getCanvas() {
    return document.querySelector(CANVAS_SELECTOR);
  }

  function shouldClick() {
    if (panelVisible) return false; // 面板打开时不连点，避免误操作
    if (!settings.enabled) return false;
    return (held[0] && settings.left) || (held[2] && settings.right);
  }

  // 下一次点击的间隔（毫秒）：目标 CPS 为基准，开启跳动则在 ±jitterPct% 内随机
  function nextInterval() {
    var base = 1000 / settings.cps;
    if (settings.jitter && settings.jitterPct > 0) {
      var r = (Math.random() * 2 - 1) * (settings.jitterPct / 100); // -1~1 * pct
      return Math.max(1, base * (1 + r));
    }
    return base;
  }

  // 向游戏画布派发一次完整的“按下-抬起”点击
  function fireClick(button) {
    var canvas = getCanvas();
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var clientX = virtX, clientY = virtY;
    var offsetX = clientX - rect.left, offsetY = clientY - rect.top;
    var buttons = button === 2 ? 2 : 1;

    function makeEvent(type) {
      var ev;
      try {
        ev = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: button,
          buttons: buttons,
          clientX: clientX,
          clientY: clientY
        });
      } catch (ex) {
        ev = document.createEvent("MouseEvent");
        ev.initMouseEvent(type, true, true, window, 0,
          clientX, clientY, clientX, clientY,
          false, false, false, false, button, null);
      }
      // 确保 offsetX / offsetY 精确（部分浏览器合成事件不会自动计算）
      try {
        Object.defineProperty(ev, "offsetX", { get: function () { return offsetX; } });
        Object.defineProperty(ev, "offsetY", { get: function () { return offsetY; } });
      } catch (ex) {}
      ev.isAutoClick = true; // 标记合成事件，避免被本 Mod 误判为真实按住
      return ev;
    }

    canvas.dispatchEvent(makeEvent("mousedown"));
    // 按下后短暂保持再抬起，保证游戏能识别为一次完整点击（时长同样跟随跳动）
    var holdMs = Math.max(1, Math.min(5, Math.round(nextInterval() / 3)));
    setTimeout(function () {
      if (getCanvas() === canvas) {
        canvas.dispatchEvent(makeEvent("mouseup"));
      }
    }, holdMs);
  }

  // 按当前 CPS（含跳动）重启连点循环（仅在需要时运行）
  function refreshClicking() {
    if (intervalId !== null) {
      clearTimeout(intervalId);
      intervalId = null;
    }
    if (!shouldClick()) return;
    function tick() {
      if (!shouldClick()) {
        intervalId = null;
        return;
      }
      fireClick(held[0] && settings.left ? 0 : 2);
      intervalId = setTimeout(tick, nextInterval());
    }
    intervalId = setTimeout(tick, nextInterval());
  }

  // ---------- 连点器总开关（V 键调用） ----------
  function toggleEnabled() {
    settings.enabled = !settings.enabled;
    saveSettings();
    refreshClicking();
    updateFabState();
    showToast(settings.enabled ? "连点器：开" : "连点器：关");
  }

  // ---------- 顶部开关提示条 ----------
  var TOAST_CSS = [
    "#ruian-ac-toast{position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:1000000;background:rgba(15,15,15,.92);border:1px solid #55ff55;color:#55ff55;font-family:monospace;font-size:14px;font-weight:700;padding:6px 16px;border-radius:4px;letter-spacing:1px;opacity:0;transition:opacity .15s;pointer-events:none;user-select:none;-webkit-user-select:none}"
  ].join("");

  function ensureToast() {
    if (toastEl) return toastEl;
    var style = document.createElement("style");
    style.id = "ruian-ac-toast-style";
    style.textContent = TOAST_CSS;
    document.head.appendChild(style);
    toastEl = document.createElement("div");
    toastEl.id = "ruian-ac-toast";
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function showToast(text) {
    var t = ensureToast();
    t.textContent = text;
    t.style.opacity = "1";
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.style.opacity = "0";
      toastTimer = null;
    }, 1200);
  }

  // ---------- 设置面板（| 键 / AC 按钮打开） ----------
  var PANEL_CSS = [
    "#ruian-ac-panel{position:fixed;top:12px;right:12px;z-index:999999;width:250px;background:rgba(15,15,15,.94);border:2px solid #55ff55;border-radius:4px;padding:10px 12px;font-family:monospace;color:#e0e0e0;box-shadow:0 0 14px rgba(85,255,85,.25);user-select:none;-webkit-user-select:none;cursor:default;box-sizing:border-box;display:none}",
    "#ruian-ac-panel .ac-title{font-weight:700;color:#55ff55;font-size:13px;margin-bottom:8px;letter-spacing:1px}",
    "#ruian-ac-panel .ac-row{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px}",
    "#ruian-ac-panel .ac-btn{flex:1;background:#2a2a2a;color:#fff;border:1px solid #555;border-radius:3px;padding:4px 6px;font-family:monospace;font-size:12px;cursor:pointer}",
    "#ruian-ac-panel .ac-btn.on{background:#0e4a0e;border-color:#55ff55;color:#55ff55}",
    "#ruian-ac-panel .ac-btn.off{background:#3a1010;border-color:#ff5555;color:#ff5555}",
    "#ruian-ac-panel input[type=range]{flex:1;accent-color:#55ff55;min-width:0}",
    "#ruian-ac-panel .ac-cps{width:34px;text-align:center;color:#55ff55;font-weight:700}",
    "#ruian-ac-panel .ac-hint{margin-top:8px;color:#888;font-size:11px;line-height:1.4}"
  ].join("");

  // 左上角 AC 圆钮（打开设置面板，并显示连点器开关状态）
  var FAB_CSS = [
    "#ruian-ac-fab{position:fixed;left:8px;top:8px;z-index:999998;width:32px;height:32px;border-radius:50%;background:rgba(20,20,20,.72);border:2px solid #55ff55;color:#55ff55;font-family:monospace;font-weight:700;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;opacity:.55;padding:0}",
    "#ruian-ac-fab:hover{opacity:1;background:rgba(20,40,20,.9)}",
    "#ruian-ac-fab.ruian-ac-off{border-color:#ff5555;color:#ff5555}",
    "#ruian-ac-fab.ruian-ac-off:hover{background:rgba(40,20,20,.9)}"
  ].join("");

  // | 键（Shift+\，含各种输入法形态）：打开 / 关闭设置面板
  function isPipeKey(e) {
    var k = e.key;
    if (k === "|" || k === "｜" || k === "\\" || k === "、" || k === "¦") return true;
    var kc = e.keyCode;
    if (kc === 220 || kc === 226) return true;
    var c = e.code;
    if (c === "Backslash" || c === "IntlBackslash") return true;
    return false;
  }

  // V 键：直接开关连点器
  function isVKey(e) {
    var k = e.key;
    if (k === "v" || k === "V") return true;
    if (e.keyCode === 86) return true;
    if (e.code === "KeyV") return true;
    return false;
  }

  function makeToggleButton(label, on) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ac-btn " + (on ? "on" : "off");
    btn.textContent = label + "：" + (on ? "开" : "关");
    return btn;
  }

  function buildPanel() {
    var style = document.createElement("style");
    style.id = "ruian-ac-style";
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    var panel = document.createElement("div");
    panel.id = "ruian-ac-panel";

    var title = document.createElement("div");
    title.className = "ac-title";
    title.textContent = "AutoClicker 连点器";

    // 总开关
    var rowToggle = document.createElement("div");
    rowToggle.className = "ac-row";
    var btnToggle = makeToggleButton("连点器", settings.enabled);
    btnToggle.addEventListener("click", function () {
      settings.enabled = !settings.enabled;
      btnToggle.className = "ac-btn " + (settings.enabled ? "on" : "off");
      btnToggle.textContent = "连点器：" + (settings.enabled ? "开" : "关");
      saveSettings();
      refreshClicking();
      updateFabState();
    });
    rowToggle.appendChild(btnToggle);

    // CPS 滑杆 1~100
    var rowCps = document.createElement("div");
    rowCps.className = "ac-row";
    var cpsLabel = document.createElement("span");
    cpsLabel.textContent = "CPS";
    var cpsRange = document.createElement("input");
    cpsRange.type = "range";
    cpsRange.min = "1";
    cpsRange.max = "100";
    cpsRange.step = "1";
    cpsRange.value = settings.cps;
    var cpsVal = document.createElement("span");
    cpsVal.className = "ac-cps";
    cpsVal.textContent = settings.cps;
    cpsRange.addEventListener("input", function () {
      var v = parseInt(cpsRange.value, 10);
      settings.cps = (isNaN(v) ? 12 : Math.min(100, Math.max(1, v)));
      cpsVal.textContent = settings.cps;
      saveSettings();
      refreshClicking();
    });
    rowCps.appendChild(cpsLabel);
    rowCps.appendChild(cpsRange);
    rowCps.appendChild(cpsVal);

    // CPS 跳动开关（±随机，更像人手）
    var rowJitter = document.createElement("div");
    rowJitter.className = "ac-row";
    var btnJitter = makeToggleButton("CPS跳动", settings.jitter);
    btnJitter.addEventListener("click", function () {
      settings.jitter = !settings.jitter;
      btnJitter.className = "ac-btn " + (settings.jitter ? "on" : "off");
      btnJitter.textContent = "CPS跳动：" + (settings.jitter ? "开" : "关");
      saveSettings();
      refreshClicking();
    });
    rowJitter.appendChild(btnJitter);

    // 跳动幅度 ±1~50%
    var rowJp = document.createElement("div");
    rowJp.className = "ac-row";
    var jpLabel = document.createElement("span");
    jpLabel.textContent = "±";
    var jpRange = document.createElement("input");
    jpRange.type = "range";
    jpRange.min = "1";
    jpRange.max = "50";
    jpRange.step = "1";
    jpRange.value = settings.jitterPct;
    var jpVal = document.createElement("span");
    jpVal.className = "ac-cps";
    jpVal.textContent = settings.jitterPct + "%";
    jpRange.addEventListener("input", function () {
      var v = parseInt(jpRange.value, 10);
      settings.jitterPct = (isNaN(v) ? 10 : Math.min(50, Math.max(0, v)));
      jpVal.textContent = settings.jitterPct + "%";
      saveSettings();
      refreshClicking();
    });
    rowJp.appendChild(jpLabel);
    rowJp.appendChild(jpRange);
    rowJp.appendChild(jpVal);

    // 左键 / 右键 连点开关
    var rowBtns = document.createElement("div");
    rowBtns.className = "ac-row";
    var btnLeft = makeToggleButton("左键", settings.left);
    btnLeft.addEventListener("click", function () {
      settings.left = !settings.left;
      btnLeft.className = "ac-btn " + (settings.left ? "on" : "off");
      btnLeft.textContent = "左键：" + (settings.left ? "开" : "关");
      saveSettings();
      refreshClicking();
    });
    var btnRight = makeToggleButton("右键", settings.right);
    btnRight.addEventListener("click", function () {
      settings.right = !settings.right;
      btnRight.className = "ac-btn " + (settings.right ? "on" : "off");
      btnRight.textContent = "右键：" + (settings.right ? "开" : "关");
      saveSettings();
      refreshClicking();
    });
    rowBtns.appendChild(btnLeft);
    rowBtns.appendChild(btnRight);

    var hint = document.createElement("div");
    hint.className = "ac-hint";
    hint.textContent = "按 | 打开/关闭本面板调参数；按 V 直接开关连点器";

    panel.appendChild(title);
    panel.appendChild(rowToggle);
    panel.appendChild(rowCps);
    panel.appendChild(rowJitter);
    panel.appendChild(rowJp);
    panel.appendChild(rowBtns);
    panel.appendChild(hint);
    document.body.appendChild(panel);
    return panel;
  }

  function togglePanel() {
    if (!panelEl) panelEl = buildPanel();
    panelVisible = !panelVisible;
    panelEl.style.display = panelVisible ? "block" : "none";
    // 打开面板时若处于指针锁定，先解锁，方便操作面板
    if (panelVisible && document.pointerLockElement && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (ex) {}
    }
    refreshClicking();
  }

  // 左上角 AC 圆钮：打开设置面板，并反映连点器开关状态
  function buildFab() {
    var style = document.createElement("style");
    style.textContent = FAB_CSS;
    document.head.appendChild(style);

    var fab = document.createElement("button");
    fab.id = "ruian-ac-fab";
    fab.type = "button";
    fab.textContent = "AC";
    fab.title = "连点器设置面板（调 CPS / 跳动 / 左右键；按 | 打开，按 V 直接开关连点器）";
    fab.addEventListener("click", function (ev) {
      if (ev.stopPropagation) ev.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(fab);
    fabEl = fab;
    updateFabState();
    return fab;
  }

  // 根据连点器开关状态更新 AC 圆钮颜色
  function updateFabState() {
    if (!fabEl) return;
    if (settings.enabled) {
      fabEl.classList.remove("ruian-ac-off");
      fabEl.style.borderColor = "#55ff55";
      fabEl.style.color = "#55ff55";
    } else {
      fabEl.classList.add("ruian-ac-off");
      fabEl.style.borderColor = "#ff5555";
      fabEl.style.color = "#ff5555";
    }
  }

  // ---------- 监听真实输入 ----------
  window.addEventListener("keydown", function (e) {
    if (e.repeat) return; // 忽略长按重复触发，避免反复开关
    if (isPipeKey(e)) {
      // | 键：打开 / 关闭参数设置面板（调 CPS、跳动、左右键等）
      if (e.preventDefault) e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      console.log("[AutoClicker] 触发按键: key=" + JSON.stringify(e.key) + " keyCode=" + e.keyCode + " code=" + e.code + "（| 键：面板）");
      togglePanel();
    } else if (isVKey(e)) {
      // V 键：直接打开 / 关闭连点器（不弹设置界面）
      if (e.preventDefault) e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      console.log("[AutoClicker] 触发按键: key=" + JSON.stringify(e.key) + " keyCode=" + e.keyCode + " code=" + e.code + "（V 键：开关连点器）");
      toggleEnabled();
    } else if (e.keyCode === 220 || e.keyCode === 226 || e.code === "Backslash" || e.code === "IntlBackslash") {
      // 按到了反斜杠/竖线附近的键但没有匹配上，打印实际 key 值便于排查
      console.log("[AutoClicker] 按到 \\ 键但未匹配（key=" + JSON.stringify(e.key) + "），面板未打开，请把此 key 值反馈给我");
    }
  }, true);

  window.addEventListener("mousedown", function (e) {
    if (e.isAutoClick) return;
    if (e.button === 0 || e.button === 2) {
      held[e.button] = true;
      refreshClicking();
    }
  }, true);

  window.addEventListener("mouseup", function (e) {
    if (e.isAutoClick) return;
    if (e.button === 0 || e.button === 2) {
      held[e.button] = false;
      refreshClicking();
    }
  }, true);

  window.addEventListener("blur", function () {
    held[0] = held[2] = false;
    refreshClicking();
  }, true);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      held[0] = held[2] = false;
      refreshClicking();
    }
  }, true);

  // 追踪光标位置：指针锁定时用位移累加推算，否则直接用屏幕坐标
  window.addEventListener("mousemove", function (e) {
    if (document.pointerLockElement) {
      virtX += (e.movementX || 0);
      virtY += (e.movementY || 0);
    } else {
      virtX = e.clientX;
      virtY = e.clientY;
    }
  }, true);

  // ---------- 初始化 ----------
  loadSettings();
  virtX = Math.round(window.innerWidth / 2);
  virtY = Math.round(window.innerHeight / 2);
  buildFab();
  console.log("[AutoClicker] 已加载。按 | 键（Shift+\\）打开设置面板调参数；按 V 键直接开关连点器。");

  // 供调试 / 验证用的小接口（不影响游戏）
  window.__ruianAC = {
    getSettings: function () {
      return JSON.parse(JSON.stringify(settings));
    },
    togglePanel: togglePanel,
    openPanel: function () {
      if (!panelVisible) togglePanel();
    },
    closePanel: function () {
      if (panelVisible) togglePanel();
    },
    toggleEnabled: toggleEnabled,
    setEnabled: function (v) {
      settings.enabled = !!v;
      saveSettings();
      refreshClicking();
      updateFabState();
    },
    setCps: function (v) {
      var n = parseInt(v, 10);
      settings.cps = isNaN(n) ? 12 : Math.min(100, Math.max(1, n));
      saveSettings();
      refreshClicking();
    },
    setJitter: function (v) {
      settings.jitter = !!v;
      saveSettings();
      refreshClicking();
    },
    setJitterPct: function (v) {
      var n = parseInt(v, 10);
      settings.jitterPct = isNaN(n) ? 10 : Math.min(50, Math.max(0, n));
      saveSettings();
      refreshClicking();
    },
    setLeft: function (v) {
      settings.left = !!v;
      saveSettings();
      refreshClicking();
    },
    setRight: function (v) {
      settings.right = !!v;
      saveSettings();
      refreshClicking();
    }
  };
})();
