/* ============================================================
 * Eaglercraft X ESP + Aim Assist  v1.0  (Ruian Client)
 *  G = 开关碰撞箱ESP    H = 开关辅助瞄准
 *  ESP: 红色玩家碰撞箱线框(0.3 x 1.8 x 0.3), 128格内
 *  自瞄: 准星 aimRange(180px) 内自动吸附敌人视角, 强度 aimStrength(0.35)
 *  原理: Hook WebSocket 解析 1.12.2 协议包 -> 3D->2D 投影绘制
 * ============================================================ */
(function () {
  'use strict';
  var LS_KEY = 'eagler_esp_settings';
  var DEFAULTS = { esp: false, aim: false, aimRange: 180, aimStrength: 0.35, drawMobs: true };
  var settings = loadSettings();
  var entities = new Map();  // id -> {x,y,z,yaw,pitch,type,last}
  var local = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, known: false };
  var stats = { in: 0, out: 0, parsed: 0 };
  var overlay = null, ctx = null, rafId = null, aimTimer = null;
  var btnEsp = null, btnAim = null;
  var W = 0, H = 0;

  var ENTITY_TTL = 5000;
  var MAX_RENDER_DIST = 128;
  var BOX_W = 0.3, BOX_H = 1.8;
  var YAW_UNIT = 360 / 256;

  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o === 'object') return Object.assign({}, DEFAULTS, o); }
    } catch (e) {}
    return Object.assign({}, DEFAULTS);
  }
  function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {} }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function getCanvas() { return document.querySelector('._eaglercraftX_canvas_element') || document.querySelector('canvas'); }
  function toast(msg) {
    try {
      var t = document.getElementById('ruian_esp_toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'ruian_esp_toast';
        t.style.cssText = 'position:fixed;top:56px;right:12px;z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;font:12px/1.6 sans-serif;padding:6px 12px;border-radius:6px;pointer-events:none;transition:opacity .3s;';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(t._t);
      t._t = setTimeout(function () { t.style.opacity = '0'; }, 1600);
    } catch (e) {}
  }

  /* ========== 字节流解析 ========== */
  function toBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }
  function Reader(u8) { this.u8 = u8; this.o = 0; }
  Reader.prototype.varint = function () {
    var r = 0, s = 0, b;
    do {
      if (this.o >= this.u8.length) return -1;
      b = this.u8[this.o++];
      r |= (b & 0x7f) << s;
      s += 7;
      if (s > 35) return -1;
    } while (b & 0x80);
    return r >>> 0;
  };
  Reader.prototype.byte = function () { return this.o < this.u8.length ? this.u8[this.o++] : 0; };
  Reader.prototype.ubyte = function () { return this.byte(); };
  Reader.prototype.bool = function () { return this.byte() !== 0; };
  Reader.prototype.short = function () {
    if (this.o + 2 > this.u8.length) return 0;
    var v = (this.u8[this.o] << 8) | this.u8[this.o + 1];
    this.o += 2;
    return v > 0x7fff ? v - 0x10000 : v;
  };
  Reader.prototype.float = function () {
    if (this.o + 4 > this.u8.length) return 0;
    var v = new DataView(this.u8.buffer, this.u8.byteOffset + this.o, 4).getFloat32(0, false);
    this.o += 4;
    return v;
  };
  Reader.prototype.double = function () {
    if (this.o + 8 > this.u8.length) return 0;
    var v = new DataView(this.u8.buffer, this.u8.byteOffset + this.o, 8).getFloat64(0, false);
    this.o += 8;
    return v;
  };
  Reader.prototype.skip = function (n) { this.o += n; };
  Reader.prototype.remaining = function () { return this.u8.length - this.o; };
  function byteAngle(b) { return b * YAW_UNIT; }

  /* ========== 实体表 ========== */
  function setEntity(eid, x, y, z, yaw, pitch, type, now) {
    entities.set(eid, { x: x, y: y, z: z, yaw: yaw, pitch: pitch, type: type, last: now });
  }
  function moveEntity(eid, dx, dy, dz, now, yaw, pitch) {
    var e = entities.get(eid);
    if (!e) return;
    e.x += dx; e.y += dy; e.z += dz;
    if (typeof yaw === 'number') e.yaw = yaw;
    if (typeof pitch === 'number') e.pitch = pitch;
    e.last = now;
  }
  function lookEntity(eid, yaw, pitch, now) {
    var e = entities.get(eid);
    if (e) { e.yaw = yaw; e.pitch = pitch; e.last = now; }
  }
  function headEntity(eid, yaw, now) {
    var e = entities.get(eid);
    if (e) { e.yaw = yaw; e.last = now; }
  }

  /* ========== 进站包解析 (1.12.2 S->C) ========== */
  function feedIncoming(data) {
    var u8 = toBytes(data);
    if (!u8 || u8.length < 2) return;
    stats.in++;
    var r = new Reader(u8);
    var pkt = r.varint();
    if (pkt < 0) return;
    var now = Date.now();
    var id, x, y, z, yaw, pitch, eid, dx, dy, dz, flags;
    switch (pkt) {
      case 0x05: // SpawnPlayer
        eid = r.varint();
        if (eid < 0) return;
        r.skip(16); // UUID
        x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte());
        setEntity(eid, x, y, z, yaw, pitch, 'player', now);
        break;
      case 0x03: // SpawnMob
        eid = r.varint();
        if (eid < 0) return;
        r.skip(1); // type
        x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte());
        r.skip(1); // head pitch
        setEntity(eid, x, y, z, yaw, pitch, 'mob', now);
        break;
      case 0x25: // EntityRelativeMove
        eid = r.varint();
        if (eid < 0) return;
        dx = r.short() / 4096; dy = r.short() / 4096; dz = r.short() / 4096;
        r.skip(1);
        moveEntity(eid, dx, dy, dz, now);
        break;
      case 0x26: // EntityLookAndRelativeMove
        eid = r.varint();
        if (eid < 0) return;
        dx = r.short() / 4096; dy = r.short() / 4096; dz = r.short() / 4096;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte());
        r.skip(1);
        moveEntity(eid, dx, dy, dz, now, yaw, pitch);
        break;
      case 0x27: // EntityLook
        eid = r.varint();
        if (eid < 0) return;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte());
        r.skip(1);
        lookEntity(eid, yaw, pitch, now);
        break;
      case 0x36: // EntityHeadLook
        eid = r.varint();
        if (eid < 0) return;
        headEntity(eid, byteAngle(r.byte()), now);
        break;
      case 0x4C: // EntityTeleport
        eid = r.varint();
        if (eid < 0) return;
        x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte());
        r.skip(1);
        setEntity(eid, x, y, z, yaw, pitch, entities.has(eid) ? entities.get(eid).type : 'mob', now);
        break;
      case 0x32: // DestroyEntities
        var n = r.varint();
        for (var i = 0; i < n; i++) { var del = r.varint(); if (del >= 0) entities.delete(del); }
        break;
      case 0x2F: // S2C PlayerPosLook -> 校准本地位置/视角
        x = r.double(); y = r.double(); z = r.double();
        yaw = r.float(); pitch = r.float();
        flags = r.byte();
        if (!(flags & 1)) local.x = x;
        if (!(flags & 2)) local.y = y;
        if (!(flags & 4)) local.z = z;
        if (!(flags & 8)) local.yaw = yaw;
        if (!(flags & 16)) local.pitch = pitch;
        local.known = true;
        break;
      default:
        return;
    }
    stats.parsed++;
  }

  /* ========== 出站包解析 (C->S, 更新本地) ========== */
  function feedOutgoing(data) {
    var u8 = toBytes(data);
    if (!u8 || u8.length < 2) return;
    stats.out++;
    var first = 0, pkt = 0, r;
    var r0 = new Reader(u8);
    first = r0.varint();
    if (first < 0) return;
    if (first > 0x1A) {
      // VarInt 长度帧形态: first=包体长度, 后面才是包ID
      r = new Reader(u8);
      r.varint();
      pkt = r.varint();
      if (pkt < 0) return;
    } else {
      // 裸包形态: first 就是包ID
      r = new Reader(u8);
      pkt = r.varint();
    }
    var x, y, z, yaw, pitch;
    switch (pkt) {
      case 0x03: // Player (onGround)
        break;
      case 0x04: // PlayerPosition
        x = r.double(); y = r.double(); z = r.double();
        local.x = x; local.y = y; local.z = z; local.known = true;
        break;
      case 0x05: // PlayerLook
        yaw = r.float(); pitch = r.float();
        local.yaw = yaw; local.pitch = pitch;
        break;
      case 0x06: // PlayerPositionAndLook
        x = r.double(); y = r.double(); z = r.double();
        yaw = r.float(); pitch = r.float();
        local.x = x; local.y = y; local.z = z;
        local.yaw = yaw; local.pitch = pitch; local.known = true;
        break;
      default:
        return;
    }
  }

  /* ========== WebSocket Hook ========== */
  function hookWS() {
    if (window.__ruianEspHooked) return;
    window.__ruianEspHooked = true;
    var OrigWS = window.WebSocket;
    function isGameWS(url) {
      return typeof url === 'string' && /^wss?:\/\//i.test(url) && url.indexOf('relay') === -1;
    }
    window.WebSocket = function (url, protocols) {
      var ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
      if (isGameWS(url)) {
        ws.__espHooked = true;
        try {
          ws.addEventListener('message', function (ev) { feedIncoming(ev.data); });
        } catch (e) {}
      }
      return ws;
    };
    try { window.WebSocket.prototype = OrigWS.prototype; } catch (e) {}
    try {
      window.WebSocket.CONNECTING = OrigWS.CONNECTING;
      window.WebSocket.OPEN = OrigWS.OPEN;
      window.WebSocket.CLOSING = OrigWS.CLOSING;
      window.WebSocket.CLOSED = OrigWS.CLOSED;
    } catch (e) {}
    var origSend = OrigWS.prototype.send;
    try {
      OrigWS.prototype.send = function (data) {
        if (this.__espHooked) { try { feedOutgoing(data); } catch (e) {} }
        return origSend.apply(this, arguments);
      };
    } catch (e) {}
  }

  /* ========== 3D -> 2D 投影 ========== */
  function getFovRad() {
    var fovDeg = 70;
    try {
      var raw = localStorage.getItem('_eaglercraft_1.12.g');
      if (raw) {
        var text = atob(raw);
        var m = text.match(/(?:^|\n)fov:([-\d.]+)/);
        if (m) fovDeg = 70 + parseFloat(m[1]) * 40;
      }
    } catch (e) {}
    return fovDeg * Math.PI / 180;
  }
  function basis() {
    var yaw = local.yaw * Math.PI / 180;
    var pitch = local.pitch * Math.PI / 180;
    var fx = -Math.sin(yaw) * Math.cos(pitch);
    var fy = Math.sin(pitch);
    var fz = -Math.cos(yaw) * Math.cos(pitch);
    var rx = -fz, rz = fx;                       // right = forward x worldUp(水平)
    var ux = -fx * fy, uy = fx * fx + fz * fz, uz = -fz * fy; // up = right x forward
    var tanHalf = Math.tan(getFovRad() / 2);
    return { fx: fx, fy: fy, fz: fz, rx: rx, rz: rz, ux: ux, uy: uy, uz: uz, tanHalf: tanHalf };
  }
  function project(ent) {
    if (!local.known) return null;
    var dx = ent.x - local.x, dy = ent.y - local.y, dz = ent.z - local.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > MAX_RENDER_DIST) return null;
    var b = basis();
    var fwd = dx * b.fx + dy * b.fy + dz * b.fz;
    if (fwd < 0.1) return null;
    var right = dx * b.rx + dz * b.rz;
    var up = dx * b.ux + dy * b.uy + dz * b.uz;
    var scale = 1 / (fwd * b.tanHalf);
    var sx = W / 2 + right * scale * (W / 2);
    var sy = H / 2 - up * scale * (H / 2);
    if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) return null;
    return { sx: sx, sy: sy, depth: fwd };
  }
  function boxPoints(ent) {
    var c = project(ent);
    if (!c) return null;
    var b = basis();
    var scale = 1 / (c.depth * b.tanHalf);
    var x0 = ent.x - BOX_W, x1 = ent.x + BOX_W;
    var y0 = ent.y, y1 = ent.y + BOX_H;
    var z0 = ent.z - BOX_W, z1 = ent.z + BOX_W;
    var corners = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
                   [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    var out = [];
    for (var i = 0; i < 8; i++) {
      var dx = corners[i][0] - local.x, dy = corners[i][1] - local.y, dz = corners[i][2] - local.z;
      var fwd = dx * b.fx + dy * b.fy + dz * b.fz;
      if (fwd < 0.1) return null;
      var right = dx * b.rx + dz * b.rz;
      var up = dx * b.ux + dy * b.uy + dz * b.uz;
      out.push({ sx: W / 2 + right * scale * (W / 2), sy: H / 2 - up * scale * (H / 2), depth: fwd });
    }
    return out;
  }

  /* ========== 渲染 ========== */
  function ensureOverlay() {
    if (overlay && overlay.isConnected) return;
    overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;';
    document.body.appendChild(overlay);
    ctx = overlay.getContext('2d');
    resize();
  }
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    if (overlay) { overlay.width = W; overlay.height = H; }
  }
  function render() {
    rafId = requestAnimationFrame(render);
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!settings.esp) return;
    var now = Date.now();
    ctx.strokeStyle = '#ff4040';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,0,0,.6)';
    ctx.shadowBlur = 4;
    entities.forEach(function (ent, id) {
      if (now - ent.last > ENTITY_TTL) { entities.delete(id); return; }
      if (ent.type === 'mob' && !settings.drawMobs) return;
      var dx = ent.x - local.x, dy = ent.y - local.y, dz = ent.z - local.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.5) return; // 跳过自己
      var p = boxPoints(ent);
      if (!p) return;
      line(p[0], p[1]); line(p[1], p[2]); line(p[2], p[3]); line(p[3], p[0]);
      line(p[4], p[5]); line(p[5], p[6]); line(p[6], p[7]); line(p[7], p[4]);
      line(p[0], p[4]); line(p[1], p[5]); line(p[2], p[6]); line(p[3], p[7]);
    });
    ctx.shadowBlur = 0;
    function line(a, b) {
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
  }

  /* ========== 辅助瞄准 ========== */
  function aimTick() {
    if (!settings.aim || !document.pointerLockElement) return;
    var c = getCanvas();
    if (!c) return;
    var best = null, bestDist = settings.aimRange;
    var now = Date.now();
    entities.forEach(function (ent, id) {
      if (now - ent.last > ENTITY_TTL) return;
      var dx = ent.x - local.x, dy = ent.y - local.y, dz = ent.z - local.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.5) return;
      var p = project(ent);
      if (!p) return;
      var ox = p.sx - W / 2, oy = p.sy - H / 2;
      var d = Math.sqrt(ox * ox + oy * oy);
      if (d <= bestDist) { bestDist = d; best = { ox: ox, oy: oy }; }
    });
    if (best) {
      var mx = -best.ox * settings.aimStrength;
      var my = -best.oy * settings.aimStrength;
      try {
        var ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, movementX: mx, movementY: my });
        ev.isAutoClick = true; // 防连点器误判
        c.dispatchEvent(ev);
      } catch (e) {}
    }
  }

  /* ========== 按键 & UI ========== */
  function onKey(e) {
    if (e.isAutoClick) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var kc = e.keyCode, code = e.code, k = e.key;
    if (kc === 71 || code === 'KeyG' || k === 'g' || k === 'G') {
      e.preventDefault();
      settings.esp = !settings.esp;
      saveSettings(); updateBtns();
      toast('ESP ' + (settings.esp ? '开启' : '关闭'));
      if (settings.esp) ensureOverlay();
    } else if (kc === 72 || code === 'KeyH' || k === 'h' || k === 'H') {
      e.preventDefault();
      settings.aim = !settings.aim;
      saveSettings(); updateBtns();
      toast('辅助瞄准 ' + (settings.aim ? '开启' : '关闭'));
    }
  }
  function makeBtn(top, label, onColor) {
    var b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'position:fixed;top:' + top + 'px;right:8px;z-index:2147483646;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:bold 11px/1 sans-serif;color:#fff;cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.4);background:#555;';
    document.body.appendChild(b);
    return b;
  }
  function updateBtns() {
    if (btnEsp) btnEsp.style.background = settings.esp ? '#ff4040' : '#555';
    if (btnAim) btnAim.style.background = settings.aim ? '#ffa500' : '#555';
  }

  /* ========== 启动 ========== */
  function init() {
    hookWS();
    btnEsp = makeBtn(88, 'ES');
    btnEsp.title = '碰撞箱ESP (G)';
    btnEsp.addEventListener('click', function () {
      settings.esp = !settings.esp;
      saveSettings(); updateBtns();
      toast('ESP ' + (settings.esp ? '开启' : '关闭'));
      if (settings.esp) ensureOverlay();
    });
    btnAim = makeBtn(128, 'AIM');
    btnAim.title = '辅助瞄准 (H)';
    btnAim.addEventListener('click', function () {
      settings.aim = !settings.aim;
      saveSettings(); updateBtns();
      toast('辅助瞄准 ' + (settings.aim ? '开启' : '关闭'));
    });
    updateBtns();
    if (settings.esp) ensureOverlay();
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', onKey, true);
    render();
    aimTimer = setInterval(aimTick, 50);
    if (!window.__ruianESP) {
      window.__ruianESP = {
        getSettings: function () { return JSON.parse(JSON.stringify(settings)); },
        setEsp: function (v) { settings.esp = !!v; saveSettings(); updateBtns(); if (settings.esp) ensureOverlay(); return settings.esp; },
        setAim: function (v) { settings.aim = !!v; saveSettings(); updateBtns(); return settings.aim; },
        setAimRange: function (v) { settings.aimRange = clamp(+v || 180, 0, 500); saveSettings(); return settings.aimRange; },
        setAimStrength: function (v) { settings.aimStrength = clamp(+v || 0.35, 0, 1); saveSettings(); return settings.aimStrength; },
        toggleEsp: function () { return this.setEsp(!settings.esp); },
        toggleAim: function () { return this.setAim(!settings.aim); },
        getEntities: function () {
          var out = [];
          entities.forEach(function (e, id) { out.push({ id: id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, type: e.type }); });
          return out;
        },
        getLocal: function () { return JSON.parse(JSON.stringify(local)); },
        getPacketStats: function () { return JSON.parse(JSON.stringify(stats)); },
        project: project,
        _feedIncoming: feedIncoming,
        _feedOutgoing: feedOutgoing,
        _testSetLocal: function (x, y, z, yaw, pitch) { local.x = x; local.y = y; local.z = z; local.yaw = yaw; local.pitch = pitch; local.known = true; },
        _testClear: function () { entities.clear(); }
      };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
