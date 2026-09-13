/* ============================================================
 * Eaglercraft X Autoclicker  v1.6  (Ruian Client)
 * 按键:  V = 开关连点器(不弹窗)   | = 打开参数面板
 *       长按左键/右键自动连点, CPS 1~100, 支持 CPS 随机跳动
 * v1.6 修复: 游戏内指针锁定(pointer lock)下长按中途断连
 *   - mousedown/mouseup 只作状态入口, 用 mousemove.buttons 实时
 *     校验收音键物理状态, mouseup 事件丢失不再误停
 *   - 指针锁定丢失 / 页面失焦才停止, 重新锁定后保持待命
 * ============================================================ */
(function () {
  'use strict';
  var LS_KEY = 'eagler_autoclicker_settings';
  var DEFAULTS = { enabled: false, cps: 12, left: true, right: false, jitter: true, jitterPct: 10 };
  var settings = loadSettings();
  var held = { 0: false, 2: false };   // 物理按键状态(0=左键 2=右键)
  var timer = null;                    // setTimeout 句柄(自调度, 不用 setInterval)
  var panelEl = null;
  var btnEl = null;
  var canvas = null;

  /* ---------- 基础工具 ---------- */
  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') return Object.assign({}, DEFAULTS, o); }
    } catch (e) {}
    return Object.assign({}, DEFAULTS);
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function getCanvas() {
    if (canvas && canvas.isConnected) return canvas;
    canvas = document.querySelector('._eaglercraftX_canvas_element') || document.querySelector('canvas');
    return canvas;
  }
  function toast(msg) {
    try {
      var t = document.getElementById('ruian_ac_toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'ruian_ac_toast';
        t.style.cssText = 'position:fixed;top:56px;right:12px;z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;font:12px/1.6 sans-serif;padding:6px 12px;border-radius:6px;pointer-events:none;transition:opacity .3s;';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(t._t);
      t._t = setTimeout(function () { t.style.opacity = '0'; }, 1600);
    } catch (e) {}
  }

  /* ---------- 合成点击(发给游戏画布) ---------- */
  function fireClick(btn) {
    var c = getCanvas();
    if (!c) return;
    var opts = { bubbles: true, cancelable: true, button: btn, buttons: btn === 0 ? 1 : 2, detail: 1, view: window };
    try {
      var down = new MouseEvent('mousedown', opts); down.isAutoClick = true; c.dispatchEvent(down);
      var up = new MouseEvent('mouseup', opts); up.isAutoClick = true; c.dispatchEvent(up);
      var clk = new MouseEvent('click', opts); clk.isAutoClick = true; c.dispatchEvent(clk);
    } catch (e) {}
  }

  /* ---------- 连点节奏(CPS 跳动) ---------- */
  function nextInterval() {
    var base = 1000 / clamp(settings.cps, 1, 100);
    if (settings.jitter) {
      var pct = clamp(settings.jitterPct, 0, 50) / 100;
      return base * (1 + (Math.random() * 2 - 1) * pct); // 例:20cps±10% => 18~22
    }
    return base;
  }
  function anyHeld() {
    return (settings.left && held[0]) || (settings.right && held[2]);
  }
  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
  }
  function tick() {
    timer = null;
    if (!settings.enabled || !anyHeld()) { stop(); return; }
    if (settings.left && held[0]) fireClick(0);
    if (settings.right && held[2]) fireClick(2);
    timer = setTimeout(tick, nextInterval());
  }
  function ensureRunning() {
    if (settings.enabled && anyHeld() && !timer) { timer = setTimeout(tick, 30); }
  }

  /* ---------- 真实鼠标事件 ---------- */
  function onMouseDown(e) {
    if (e.isAutoClick) return;
    var b = e.button;
    if (b === 0 || b === 2) held[b] = true;
    ensureRunning();
  }
  function onMouseUp(e) {
    if (e.isAutoClick) return;
    var b = e.button;
    if (b === 0 || b === 2) held[b] = false;
    if (!anyHeld()) stop();
  }
  function onMouseMove(e) {
    if (e.isAutoClick) return; // 忽略自瞄等合成事件
    // v1.6 核心: 用 buttons 交叉校正, mouseup 丢失也不误停
    if (held[0] && !(e.buttons & 1)) held[0] = false;
    if (held[2] && !(e.buttons & 2)) held[2] = false;
    if (!anyHeld()) stop();
  }
  function onPointerLockChange() {
    if (!document.pointerLockElement) {
      // 锁定丢失(按Esc/切窗) -> 安全停止, 设置保持, 下次按下自动恢复
      held[0] = held[2] = false;
      stop();
    }
  }
  function onBlur() { held[0] = held[2] = false; stop(); }
  function onKey(e) {
    if (e.isAutoClick) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var k = e.key, kc = e.keyCode, code = e.code;
    // V = 直接开关(不弹界面)
    if (kc === 86 || k === 'v' || k === 'V' || code === 'KeyV') {
      e.preventDefault();
      settings.enabled = !settings.enabled;
      saveSettings();
      updateBtn();
      if (!settings.enabled) stop();
      toast('连点器 ' + (settings.enabled ? '开启' : '关闭'));
      if (settings.enabled) ensureRunning();
      return;
    }
    // | 或 \ = 打开参数面板
    if (kc === 220 || kc === 226 || k === '|' || k === '\\' || k === '｜' || k === '、' || code === 'Backslash' || code === 'IntlBackslash') {
      e.preventDefault();
      togglePanel();
      return;
    }
  }

  /* ---------- 悬浮圆钮 ---------- */
  function makeBtn() {
    if (btnEl && btnEl.isConnected) return;
    btnEl = document.createElement('div');
    btnEl.textContent = 'AC';
    btnEl.title = '连点器: 点击开关 (V)';
    btnEl.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483646;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:bold 12px/1 sans-serif;color:#fff;cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.4);background:' + (settings.enabled ? '#2ecc71' : '#555') + ';';
    btnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      settings.enabled = !settings.enabled;
      saveSettings();
      updateBtn();
      toast('连点器 ' + (settings.enabled ? '开启' : '关闭'));
      if (settings.enabled) ensureRunning();
    });
    document.body.appendChild(btnEl);
  }
  function updateBtn() {
    if (btnEl && btnEl.isConnected) btnEl.style.background = settings.enabled ? '#2ecc71' : '#555';
  }

  /* ---------- 参数面板 ---------- */
  function togglePanel() {
    if (panelEl && panelEl.isConnected) { panelEl.remove(); panelEl = null; return; }
    panelEl = document.createElement('div');
    panelEl.style.cssText = 'position:fixed;top:12px;right:54px;z-index:2147483647;width:260px;background:rgba(18,18,24,.94);color:#eee;border:1px solid #333;border-radius:10px;padding:14px;font:13px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);';
    var h = document.createElement('div');
    h.style.cssText = 'font-weight:bold;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;';
    h.innerHTML = '<span>连点器设置</span><span style="color:#888;font-weight:normal;font-size:11px">| 关闭</span>';
    panelEl.appendChild(h);
    panelEl.appendChild(row('启用连点器', toggle('enabled', function (v) {
      if (!v) stop();
      updateBtn();
      toast('连点器 ' + (v ? '开启' : '关闭'));
    })));
    panelEl.appendChild(slider('CPS 速度', 'cps', 1, 100, 1, '次/秒'));
    panelEl.appendChild(row('左键连点', toggle('left')));
    panelEl.appendChild(row('右键连点', toggle('right')));
    panelEl.appendChild(row('CPS 跳动', toggle('jitter')));
    panelEl.appendChild(slider('跳动幅度', 'jitterPct', 0, 50, 1, '%'));
    var tip = document.createElement('div');
    tip.style.cssText = 'margin-top:8px;color:#999;font-size:11px;line-height:1.8;';
    tip.innerHTML = 'V 开关连点 · | 此面板<br>长按左/右键自动连点';
    panelEl.appendChild(tip);
    document.body.appendChild(panelEl);
  }
  function row(label, ctrl) {
    var r = document.createElement('div');
    r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:6px 0;';
    var l = document.createElement('span'); l.textContent = label; l.style.color = '#ccc';
    r.appendChild(l); r.appendChild(ctrl);
    return r;
  }
  function toggle(key, onChange) {
    var b = document.createElement('div');
    b.style.cssText = 'width:40px;height:22px;border-radius:11px;background:' + (settings[key] ? '#2ecc71' : '#444') + ';position:relative;cursor:pointer;transition:background .2s;flex:none;';
    var k = document.createElement('div');
    k.style.cssText = 'position:absolute;top:2px;left:' + (settings[key] ? '20px' : '2px') + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;';
    b.appendChild(k);
    b.addEventListener('click', function () {
      settings[key] = !settings[key];
      b.style.background = settings[key] ? '#2ecc71' : '#444';
      k.style.left = settings[key] ? '20px' : '2px';
      saveSettings();
      if (onChange) onChange(settings[key]);
    });
    return b;
  }
  function slider(key, min, max, step, unit) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:8px 0;';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;color:#ccc;';
    var lab = document.createElement('span'); lab.textContent = unit === '次/秒' ? 'CPS 速度' : '跳动幅度';
    var val = document.createElement('span'); val.textContent = settings[key] + (unit || '');
    val.style.color = '#fff'; val.style.fontWeight = 'bold';
    head.appendChild(lab); head.appendChild(val);
    var inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = settings[key];
    inp.style.cssText = 'width:100%;margin:4px 0 0;accent-color:#2ecc71;';
    inp.addEventListener('input', function () {
      settings[key] = parseInt(inp.value, 10);
      val.textContent = settings[key] + (unit || '');
      saveSettings();
    });
    wrap.appendChild(head); wrap.appendChild(inp);
    return wrap;
  }

  /* ---------- 启动 ---------- */
  function init() {
    makeBtn();
    updateBtn();
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', function () { if (document.hidden) onBlur(); });
    if (!window.__ruianAutoClicker) {
      window.__ruianAutoClicker = {
        getSettings: function () { return JSON.parse(JSON.stringify(settings)); },
        setSettings: function (o) { Object.assign(settings, o); saveSettings(); updateBtn(); return settings; },
        toggle: function () { settings.enabled = !settings.enabled; saveSettings(); updateBtn(); if (!settings.enabled) stop(); return settings.enabled; },
        setEnabled: function (v) { settings.enabled = !!v; saveSettings(); updateBtn(); if (!settings.enabled) stop(); return settings.enabled; },
        click: fireClick,
        isRunning: function () { return !!timer; },
        openPanel: togglePanel
      };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
