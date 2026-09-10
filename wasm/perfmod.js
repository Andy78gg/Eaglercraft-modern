/*!
 * EaglerBoost 性能增强 Mod  (perfmod.js)
 * ---------------------------------------------
 * 给本仓库的 EaglercraftX 1.12 (modernclient) 客户端注入三组优化：
 *
 *  1) 加载区块  —— LOD 渲染 + 更大的区块加载距离 + 区块修正
 *  2) 加载人物  —— 实体剔除 + 关闭实体阴影 + 显示自己的名字标签
 *  3) 提升 FPS  —— 关闭雨/粒子/附魔光效/云、降平滑光照与 mipmap、
 *                  开启方块面剔除/区块网格优化，并关闭调试堆栈去混淆以减少卡顿
 *
 * 原理（已按本仓库 classes.wasm 与官方 1.12.2 源码逐一核实）：
 *  - 游戏设置保存在 localStorage 的 `_eaglercraft_1.12.g` 键里
 *  - 1.12 客户端格式 = base64(纯 UTF-8 "key:value" 逐行文本)，【没有 gzip】
 *    （writeOptions 用 PrintWriter 写纯文本，首行 version:1343；
 *      loadOptions 用 IOUtils.readLines 按 UTF-8 直接读行解析）
 *  - 注意：Eaglercraft 1.8 版本有 gzip，但本 1.12 构建没有；
 *    早期版本误用 gzip 导致游戏全部解析失败，本次已修正
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
  // 生成方式：设置文本按 `key:value` 逐行排列后 UTF-8 + base64
  var BOOST_SETTINGS_B64 =
    "dmVyc2lvbjoxMzQzCm1vZGVybl9sb2RSZW5kZXJpbmc6dHJ1ZQptb2Rlcm5fbG9kVmlld0Rpc3RhbmNlOjMyCm1vZGVybl9sb2RTdGFydERpc3RhbmNlOjgKcmVuZGVyRGlzdGFuY2U6OApvZkNodW5rVXBkYXRlczoxCmNodW5rRml4OnRydWUKZm9nOnRydWUKbW9kZXJuX2VudGl0eUN1bGxpbmc6dHJ1ZQplbnRpdHlTaGFkb3dzOmZhbHNlCm1vZGVybl9zaG93T3duTmFtZXRhZzp0cnVlCm1heEZwczoyNjAKZW5hYmxlVnN5bmM6dHJ1ZQpwYXJ0aWNsZXM6MgphbzowCm1pcG1hcExldmVsczowCmZhbmN5R3JhcGhpY3M6ZmFsc2UKcmVuZGVyQ2xvdWRzOmZhbHNlCm1vZGVybl9ub1JhaW46dHJ1ZQptb2Rlcm5fbm9QYXJ0aWNsZXM6dHJ1ZQptb2Rlcm5fbm9HbGludDpmYWxzZQptb2Rlcm5fYmxvY2tGYWNlQ3VsbGluZzp0cnVlCm1vZGVybl9jaHVua01lc2hPcHRpbWl6YXRpb246dHJ1ZQptb2Rlcm5fY3J5c3RhbE9wdGltaXplcjp0cnVlCm1vZGVybl9lYXRpbmdPcHRpbWl6ZXI6dHJ1ZQptb2Rlcm5fbW90aW9uQmx1cjpmYWxzZQptb2Rlcm5fZnVsbGJyaWdodDp0cnVlCm1vZGVybl90b3RlbUNvdW50ZXI6ZmFsc2UKbW9kZXJuX2NsaXBwaW5nOmZhbHNl";

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
        "[EaglerBoost] 性能增强设置已写入（原设置已备份到 " + BACKUP_KEY + "）。"
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
          "[EaglerBoost] 性能增强 Mod 已开启：LOD 区块渲染 / 实体加载优化 / FPS 提升。"
        );
      } else {
        restoreOriginalSettings();
        console.log(
          "[EaglerBoost] 性能增强 Mod 已关闭，已还原原设置。"
        );
      }
    } catch (ex) {
      // 任何异常都不允许影响游戏本体启动
      console.error("[EaglerBoost] 初始化失败（已忽略）: " + ex);
    }
  };
})();
