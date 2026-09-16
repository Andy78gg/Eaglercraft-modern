/* ============================================================
 * Eaglercraft X ESP + Aim Assist  v1.4  (Ruian Client)
 *  G = ESP开关   H = 自瞄开关   (右上角 ES / AIM 圆钮)
 * v1.4 fixes (对照 1.12.2 协议逐项核对):
 *  - 出站包 0x0E=PlayerPositionAndRotation(x,y,z,yaw,pitch)
 *    0x0F=PlayerRotation(仅yaw,pitch); 旧版把 0x0F 当坐标包读
 *    导致转头时本地坐标被垃圾值污染 -> 红框乱飞/屏幕乱转
 *  - 进站 DestroyEntities 修正为 0x31 (旧版误写 0x32)
 *    0x32 实际是 RemoveEntityEffect, 误解析会读穿包边界并疯狂误删实体
 *  - 进站 EntityHeadLook 修正为 0x35 (旧版误写 0x36)
 *  - SpawnMob 补读 UUID(16B)+type, 旧版漏读导致怪物坐标错位
 *  - 包解析增加边界限制, 防止误读串包
 * ============================================================ */
(function () {
  'use strict';
  var LS_KEY = 'eagler_esp_settings';
  var DEFAULTS = { esp: false, aim: false, aimRange: 180, aimStrength: 0.25, drawMobs: true };
  var settings = loadSettings();
  var local = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, known: false };
  var stats = { in: 0, out: 0, parsed: 0, unparsed: 0, ids: {}, topIds: [], proto: 'v112', e112parsed: 0, e18parsed: 0, compressed: 0, localOk: false };
  var overlay = null, ctx = null, rafId = null, aimTimer = null, lastAim = 0;
  var btnEsp = null, btnAim = null, booted = false;
  var W = 0, H = 0;
  var ENTITY_TTL = 5000, MAX_RENDER_DIST = 128, BOX_W = 0.3, BOX_H = 1.8;
  var YAW_UNIT = 360 / 256, WORLD_LIMIT = 3e7;
  var P112 = { ents: new Map(), parsed: 0 };
  var P18 = { ents: new Map(), parsed: 0 };

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
  function saneCoord(v) { return typeof v === 'number' && isFinite(v) && Math.abs(v) < WORLD_LIMIT; }
  function log() { try { console.log.apply(console, ['[RuianESP]'].concat([].slice.call(arguments))); } catch (e) {} }

  /* ===== 字节流(带边界) ===== */
  function toBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }
  function Reader(u8, max) { this.u8 = u8; this.o = 0; this.max = (max === undefined) ? u8.length : max; }
  Reader.prototype.varint = function () {
    var r = 0, s = 0, b;
    do {
      if (this.o >= this.max) return -1;
      b = this.u8[this.o++];
      r |= (b & 0x7f) << s;
      s += 7;
      if (s > 35) return -1;
    } while (b & 0x80);
    return r >>> 0;
  };
  Reader.prototype.byte = function () { return this.o < this.max ? this.u8[this.o++] : 0; };
  Reader.prototype.short = function () {
    if (this.o + 2 > this.max) return 0;
    var v = (this.u8[this.o] << 8) | this.u8[this.o + 1];
    this.o += 2;
    return v > 0x7fff ? v - 0x10000 : v;
  };
  Reader.prototype.int = function () {
    if (this.o + 4 > this.max) return 0;
    var v = new DataView(this.u8.buffer, this.u8.byteOffset + this.o, 4).getInt32(0, false);
    this.o += 4;
    return v;
  };
  Reader.prototype.float = function () {
    if (this.o + 4 > this.max) return 0;
    var v = new DataView(this.u8.buffer, this.u8.byteOffset + this.o, 4).getFloat32(0, false);
    this.o += 4;
    return v;
  };
  Reader.prototype.double = function () {
    if (this.o + 8 > this.max) return 0;
    var v = new DataView(this.u8.buffer, this.u8.byteOffset + this.o, 8).getFloat64(0, false);
    this.o += 8;
    return v;
  };
  Reader.prototype.skip = function (n) { this.o += n; };
  function byteAngle(b) { return b * YAW_UNIT; }

  /* ===== 实体表 ===== */
  function setEnt(P, eid, x, y, z, yaw, pitch, type, now) {
    if (!saneCoord(x) || !saneCoord(y) || !saneCoord(z)) return false;
    P.ents.set(eid, { x: x, y: y, z: z, yaw: yaw, pitch: pitch, type: type, last: now });
    return true;
  }
  function moveEnt(P, eid, dx, dy, dz, now, yaw, pitch) {
    var e = P.ents.get(eid);
    if (!e) return;
    var nx = e.x + dx, ny = e.y + dy, nz = e.z + dz;
    if (!saneCoord(nx) || !saneCoord(ny) || !saneCoord(nz)) return;
    e.x = nx; e.y = ny; e.z = nz;
    if (typeof yaw === 'number') e.yaw = yaw;
    if (typeof pitch === 'number') e.pitch = pitch;
    e.last = now;
  }
  function lookEnt(P, eid, yaw, pitch, now) {
    var e = P.ents.get(eid);
    if (e) { e.yaw = yaw; e.pitch = pitch; e.last = now; }
  }
  function headEnt(P, eid, yaw, now) {
    var e = P.ents.get(eid);
    if (e) { e.yaw = yaw; e.last = now; }
  }
  function setLocal(x, y, z, yaw, pitch) {
    if (!saneCoord(x) || !saneCoord(y) || !saneCoord(z)) return;
    local.x = x; local.y = y; local.z = z; local.yaw = yaw; local.pitch = pitch; local.known = true;
    stats.localOk = true;
  }

  /* ===== 1.12.2 进站 ===== */
  function d112(pkt, r) {
    var now = Date.now(), eid, x, y, z, yaw, pitch, dx, dy, dz;
    switch (pkt) {
      case 0x05: /* SpawnPlayer */
        eid = r.varint(); if (eid < 0) return false;
        r.skip(16); x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte());
        setEnt(P112, eid, x, y, z, yaw, pitch, 'player', now); P112.parsed++; return true;
      case 0x03: /* SpawnMob: eid + UUID(16) + type(VarInt) + x,y,z + yaw,pitch,headPitch */
        eid = r.varint(); if (eid < 0) return false;
        r.skip(16); r.varint();
        x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        setEnt(P112, eid, x, y, z, yaw, pitch, 'mob', now); P112.parsed++; return true;
      case 0x25: /* EntityRelativeMove */
        eid = r.varint(); if (eid < 0) return false;
        dx = r.short() / 4096; dy = r.short() / 4096; dz = r.short() / 4096; r.skip(1);
        moveEnt(P112, eid, dx, dy, dz, now); P112.parsed++; return true;
      case 0x26: /* EntityLookAndRelativeMove */
        eid = r.varint(); if (eid < 0) return false;
        dx = r.short() / 4096; dy = r.short() / 4096; dz = r.short() / 4096;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        moveEnt(P112, eid, dx, dy, dz, now, yaw, pitch); P112.parsed++; return true;
      case 0x27: /* EntityLook */
        eid = r.varint(); if (eid < 0) return false;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        lookEnt(P112, eid, yaw, pitch, now); P112.parsed++; return true;
      case 0x35: /* EntityHeadLook (1.12.2) */
        eid = r.varint(); if (eid < 0) return false;
        headEnt(P112, eid, byteAngle(r.byte()), now); P112.parsed++; return true;
      case 0x4B: /* EntityTeleport (1.12.2) */
        eid = r.varint(); if (eid < 0) return false;
        x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        setEnt(P112, eid, x, y, z, yaw, pitch, P112.ents.has(eid) ? P112.ents.get(eid).type : 'mob', now);
        P112.parsed++; return true;
      case 0x31: /* DestroyEntities (1.12.2) */
        var n = r.varint();
        for (var i = 0; i < n; i++) { var del = r.varint(); if (del >= 0) P112.ents.delete(del); }
        P112.parsed++; return true;
      case 0x2F: /* PlayerPosLook */
        x = r.double(); y = r.double(); z = r.double(); var fYaw = r.float(), fPitch = r.float(); var flags = r.byte();
        setLocal(!(flags & 1) ? x : local.x, !(flags & 2) ? y : local.y, !(flags & 4) ? z : local.z,
                 !(flags & 8) ? fYaw : local.yaw, !(flags & 16) ? fPitch : local.pitch);
        P112.parsed++; return true;
      default: return false;
    }
  }

  /* ===== 1.8 进站 ===== */
  function d18(pkt, r) {
    var now = Date.now(), eid, x, y, z, yaw, pitch, dx, dy, dz;
    switch (pkt) {
      case 0x0C: /* SpawnPlayer */
        eid = r.varint(); if (eid < 0) return false;
        r.skip(16); x = r.double(); y = r.double(); z = r.double();
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(2);
        setEnt(P18, eid, x, y, z, yaw, pitch, 'player', now); P18.parsed++; return true;
      case 0x0F: /* SpawnMob */
        eid = r.varint(); if (eid < 0) return false;
        r.skip(1); x = r.int() / 32; y = r.int() / 32; z = r.int() / 32;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(3);
        setEnt(P18, eid, x, y, z, yaw, pitch, 'mob', now); P18.parsed++; return true;
      case 0x15: /* EntityRelativeMove */
        eid = r.varint(); if (eid < 0) return false;
        dx = r.byte() / 32; dy = r.byte() / 32; dz = r.byte() / 32; r.skip(1);
        moveEnt(P18, eid, dx, dy, dz, now); P18.parsed++; return true;
      case 0x16: /* EntityLook */
        eid = r.varint(); if (eid < 0) return false;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        lookEnt(P18, eid, yaw, pitch, now); P18.parsed++; return true;
      case 0x17: /* EntityLookAndRelativeMove */
        eid = r.varint(); if (eid < 0) return false;
        dx = r.byte() / 32; dy = r.byte() / 32; dz = r.byte() / 32;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        moveEnt(P18, eid, dx, dy, dz, now, yaw, pitch); P18.parsed++; return true;
      case 0x18: /* EntityTeleport */
        eid = r.varint(); if (eid < 0) return false;
        x = r.int() / 32; y = r.int() / 32; z = r.int() / 32;
        yaw = byteAngle(r.byte()); pitch = byteAngle(r.byte()); r.skip(1);
        setEnt(P18, eid, x, y, z, yaw, pitch, P18.ents.has(eid) ? P18.ents.get(eid).type : 'mob', now);
        P18.parsed++; return true;
      case 0x19: /* EntityHeadLook */
        eid = r.varint(); if (eid < 0) return false;
        headEnt(P18, eid, byteAngle(r.byte()), now); P18.parsed++; return true;
      case 0x13: /* DestroyEntities */
        var n = r.varint();
        for (var i = 0; i < n; i++) { var del = r.varint(); if (del >= 0) P18.ents.delete(del); }
        P18.parsed++; return true;
      case 0x08: /* PlayerPosLook */
        x = r.double(); y = r.double(); z = r.double(); var fYaw = r.float(), fPitch = r.float(); var flags = r.byte();
        setLocal(!(flags & 1) ? x : local.x, !(flags & 2) ? y : local.y, !(flags & 4) ? z : local.z,
                 !(flags & 8) ? fYaw : local.yaw, !(flags & 16) ? fPitch : local.pitch);
        P18.parsed++; return true;
      default: return false;
    }
  }

  /* ===== 进站: 帧格式自适应(裸包/长度帧), 带包边界 ===== */
  function tryDecode(pkt, r) {
    var a = d112(pkt, r);
    var b = d18(pkt, r);
    if (a || b) { stats.parsed++; return true; }
    stats.unparsed++;
    stats.ids['0x' + pkt.toString(16)] = (stats.ids['0x' + pkt.toString(16)] || 0) + 1;
    return false;
  }
  function feedIncoming(data) {
    var u8 = toBytes(data);
    if (!u8 || !u8.length) return;
    stats.in++;
    var fb = u8[0];
    if (fb === 0x78) stats.compressed++;
    var off = 0, guard = 0;
    while (off < u8.length && guard++ < 32) {
      var r0 = new Reader(u8); r0.o = off;
      var f = r0.varint();
      if (f < 0) break;
      var remaining = u8.length - r0.o;
      var handled = false;
      // 尝试长度帧: first=payload长度, 包ID在长度之后
      if (f >= 1 && f <= remaining && f < 0x10000) {
        var end = r0.o + f;
        var rF = new Reader(u8, end); rF.o = r0.o;
        var pktF = rF.varint();
        if (pktF >= 0 && pktF <= 0x60 && rF.o <= end) {
          var rF2 = new Reader(u8, end); rF2.o = r0.o;
          var okF = tryDecode(pktF, rF2);
          if (okF && rF2.o <= end) {
            handled = true;
            off = end;
            continue;
          }
        }
      }
      // 尝试裸包: first=包ID
      if (!handled && f <= 0x60) {
        var rB = new Reader(u8); rB.o = off;
        if (tryDecode(f, rB)) {
          handled = true;
          off = u8.length;
          break;
        }
      }
      if (!handled) {
        stats.unparsed++;
        stats.ids['0x' + f.toString(16)] = (stats.ids['0x' + f.toString(16)] || 0) + 1;
        break;
      }
    }
  }

  /* ===== 出站: 更新本地(1.12.2 与 1.8 双套 ID) ===== */
  function feedOutgoing(data) {
    var u8 = toBytes(data);
    if (!u8 || !u8.length) return;
    stats.out++;
    var r0 = new Reader(u8);
    var first = r0.varint();
    if (first < 0) return;
    var pkt = first, r = r0;
    if (first > 0x60) { r = new Reader(u8); r.varint(); pkt = r.varint(); if (pkt < 0) return; }
    var x, y, z, yaw, pitch;
    switch (pkt) {
      /* --- 1.12.2 --- */
      case 0x0D: /* PlayerPosition */
        x = r.double(); y = r.double(); z = r.double();
        if (saneCoord(x) && saneCoord(y) && saneCoord(z)) { local.x = x; local.y = y; local.z = z; local.known = true; stats.localOk = true; }
        break;
      case 0x0E: /* PlayerPositionAndRotation */
        x = r.double(); y = r.double(); z = r.double(); yaw = r.float(); pitch = r.float();
        if (saneCoord(x) && saneCoord(y) && saneCoord(z)) { local.x = x; local.y = y; local.z = z; }
        local.yaw = yaw; local.pitch = pitch; local.known = true; stats.localOk = true; break;
      case 0x0F: /* PlayerRotation */
        yaw = r.float(); pitch = r.float(); local.yaw = yaw; local.pitch = pitch; break;
      /* --- 1.8 --- */
      case 0x04: /* PlayerPosition */
        x = r.double(); y = r.double(); z = r.double();
        if (saneCoord(x) && saneCoord(y) && saneCoord(z)) { local.x = x; local.y = y; local.z = z; local.known = true; stats.localOk = true; }
        break;
      case 0x05: /* PlayerPositionAndRotation */
        x = r.double(); y = r.double(); z = r.double(); yaw = r.float(); pitch = r.float();
        if (saneCoord(x) && saneCoord(y) && saneCoord(z)) { local.x = x; local.y = y; local.z = z; }
        local.yaw = yaw; local.pitch = pitch; local.known = true; stats.localOk = true; break;
      case 0x06: /* PlayerRotation */
        yaw = r.float(); pitch = r.float(); local.yaw = yaw; local.pitch = pitch; break;
      default: break;
    }
  }

  /* ===== WebSocket Hook ===== */
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
        try { ws.addEventListener('message', function (ev) { feedIncoming(ev.data); }); } catch (e) {}
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

  /* ===== 投影 ===== */
  function getFovRad() {
    var fovDeg = 70;
    try {
      var raw = localStorage.getItem('_eaglercraft_1.12.g');
      if (raw) {
        var m = atob(raw).match(/(?:^|\n)fov:([-\d.]+)/);
        if (m) fovDeg = 70 + parseFloat(m[1]) * 40;
      }
    } catch (e) {}
    return fovDeg * Math.PI / 180;
  }
  function basis() {
    var yaw = local.yaw * Math.PI / 180, pitch = local.pitch * Math.PI / 180;
    var fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    var rx = -fz, rz = fx;
    var ux = -fx * fy, uy = fx * fx + fz * fz, uz = -fz * fy;
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
    var x0 = ent.x - BOX_W, x1 = ent.x + BOX_W, y0 = ent.y, y1 = ent.y + BOX_H, z0 = ent.z - BOX_W, z1 = ent.z + BOX_W;
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
  function activeEnts() {
    if (P18.parsed > P112.parsed) { stats.proto = 'v18'; return P18.ents; }
    stats.proto = 'v112';
    return P112.ents;
  }

  /* ===== 渲染 ===== */
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
    var ents = activeEnts();
    ctx.strokeStyle = '#ff4040';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,0,0,.6)';
    ctx.shadowBlur = 4;
    ents.forEach(function (ent, id) {
      if (now - ent.last > ENTITY_TTL) { ents.delete(id); return; }
      if (ent.type === 'mob' && !settings.drawMobs) return;
      var dx = ent.x - local.x, dy = ent.y - local.y, dz = ent.z - local.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.5) return;
      var p = boxPoints(ent);
      if (!p) return;
      line(p[0], p[1]); line(p[1], p[2]); line(p[2], p[3]); line(p[3], p[0]);
      line(p[4], p[5]); line(p[5], p[6]); line(p[6], p[7]); line(p[7], p[4]);
      line(p[0], p[4]); line(p[1], p[5]); line(p[2], p[6]); line(p[3], p[7]);
    });
    ctx.shadowBlur = 0;
    function line(a, b) {
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
  }

  /* ===== 自瞄(防抖) ===== */
  function aimTick() {
    if (!settings.aim || !document.pointerLockElement) return;
    var c = getCanvas();
    if (!c) return;
    var now = Date.now();
    if (now - lastAim < 80) return;
    var ents = activeEnts();
    var best = null, bestDist = settings.aimRange;
    ents.forEach(function (ent, id) {
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
      var mx = -best.ox * settings.aimStrength, my = -best.oy * settings.aimStrength;
      if (Math.abs(mx) < 0.5 && Math.abs(my) < 0.5) return;
      try {
        var ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, movementX: mx, movementY: my });
        ev.isAutoClick = true;
        c.dispatchEvent(ev);
        lastAim = now;
      } catch (e) {}
    }
  }

  /* ===== 按键 & UI ===== */
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
  function makeBtn(top, label) {
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

  /* ===== 启动 ===== */
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
    booted = true;
    log('v1.4 loaded OK, esp=' + settings.esp + ' aim=' + settings.aim);
    if (!window.__ruianESP) {
      window.__ruianESP = {
        getSettings: function () { return JSON.parse(JSON.stringify(settings)); },
        setEsp: function (v) { settings.esp = !!v; saveSettings(); updateBtns(); if (settings.esp) ensureOverlay(); return settings.esp; },
        setAim: function (v) { settings.aim = !!v; saveSettings(); updateBtns(); return settings.aim; },
        setAimRange: function (v) { settings.aimRange = clamp(+v || 180, 0, 500); saveSettings(); return settings.aimRange; },
        setAimStrength: function (v) { settings.aimStrength = clamp(+v || 0.25, 0, 1); saveSettings(); return settings.aimStrength; },
        toggleEsp: function () { return this.setEsp(!settings.esp); },
        toggleAim: function () { return this.setAim(!settings.aim); },
        getEntities: function () {
          var out = [], ents = activeEnts();
          ents.forEach(function (e, id) { out.push({ id: id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, type: e.type }); });
          return out;
        },
        getLocal: function () { return JSON.parse(JSON.stringify(local)); },
        getPacketStats: function () {
          var top = Object.keys(stats.ids).map(function (k) { return [k, stats.ids[k]]; })
            .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
          stats.topIds = top;
          return JSON.parse(JSON.stringify({
            in: stats.in, out: stats.out, parsed: stats.parsed, unparsed: stats.unparsed,
            proto: stats.proto, e112parsed: P112.parsed, e18parsed: P18.parsed,
            ids: stats.ids, topIds: top, compressed: stats.compressed, localOk: stats.localOk,
            local: local, entities: P112.ents.size + P18.ents.size, booted: booted
          }));
        },
        project: project,
        _feedIncoming: feedIncoming,
        _feedOutgoing: feedOutgoing,
        _testSetLocal: function (x, y, z, yaw, pitch) { setLocal(x, y, z, yaw, pitch); },
        _testClear: function () { P112.ents.clear(); P18.ents.clear(); }
      };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
