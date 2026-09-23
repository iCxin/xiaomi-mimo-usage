/* ============================================================
   MiMo Token 用量看板 — renderer
   MiMo Token Usage Dashboard — renderer

   Consumes window.MIMO_TOKEN_DATA (emitted by export_tokens.py) and
   window.MIMO_I18N (i18n.js). No framework, no network at load: every
   chart is hand-built SVG.
   ============================================================ */

(function () {
  "use strict";

  // Surface script errors to the headless verification harness.
  window.addEventListener("error", function (ev) {
    (window.__errs || (window.__errs = [])).push(String(ev.message));
  });

  var DATA = window.MIMO_TOKEN_DATA;
  var STRINGS = window.MIMO_I18N || { zh: {}, en: {} };

  /* ---------- language ---------- */

  var LANG_KEY = "mimo-dashboard-lang";

  function detectLang() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved && STRINGS[saved]) return saved;
    } catch (e) { /* private mode */ }
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    return nav.indexOf("zh") === 0 ? "zh" : "en";
  }

  var lang = detectLang();

  function t(key, vars) {
    var table = STRINGS[lang] || {};
    var fallback = STRINGS.zh || {};
    var s = table[key];
    if (s === undefined) s = fallback[key];
    if (s === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  /* ---------- palette ---------- */

  // Categorical ramp for series identity, assigned in fixed order so a model
  // keeps its colour across every chart on the page.
  var SERIES_COLORS = ["#1a73e8", "#1a9c4a", "#9b7fd4", "#e5484d", "#f5a524", "#14a08a"];

  var HEAT_COLORS = ["#ebebed", "#cfe2fb", "#8fbdf5", "#4a94ee", "#1a73e8"];

  var PART_COLORS = {
    cacheRead: "#8fbdf5",
    input: "#1a73e8",
    output: "#f5a524",
    reasoning: "#9b7fd4",
    cacheWrite: "#e5484d",
  };

  // In-bar labels sit on their own fill, so the ink has to flip on the pale
  // hues or the text disappears.
  var PART_TEXT = {
    cacheRead: "#1c1c1e",
    input: "#ffffff",
    output: "#1c1c1e",
    reasoning: "#ffffff",
    cacheWrite: "#ffffff",
  };

  var PART_KEYS = ["cacheRead", "input", "output", "reasoning", "cacheWrite"];

  /* ---------- formatting ---------- */

  var EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function fmtInt(n) {
    return (n || 0).toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  }

  function trimZero(s) {
    return s.replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  }

  // Large-number scale. Chinese groups by 万/亿, English by K/M/B.
  function fmtScaleParts(n) {
    n = n || 0;
    if (lang === "zh") {
      if (n >= 1e8) return { num: trimZero((n / 1e8).toFixed(2)), unit: "亿" };
      if (n >= 1e4) return { num: trimZero((n / 1e4).toFixed(1)), unit: "万" };
      return { num: fmtInt(n), unit: "" };
    }
    if (n >= 1e9) return { num: trimZero((n / 1e9).toFixed(2)), unit: "B" };
    if (n >= 1e6) return { num: trimZero((n / 1e6).toFixed(2)), unit: "M" };
    if (n >= 1e3) return { num: trimZero((n / 1e3).toFixed(1)), unit: "K" };
    return { num: fmtInt(n), unit: "" };
  }

  function fmtScale(n) {
    var p = fmtScaleParts(n);
    return p.num + p.unit;
  }

  // Axis ticks stay on K/M/B in both languages: they are read as magnitudes,
  // and the Chinese scale would make a 50M axis read "5000万".
  function fmtCompact(n) {
    n = n || 0;
    if (n >= 1e9) return trimZero((n / 1e9).toFixed(2)) + "B";
    if (n >= 1e6) return trimZero((n / 1e6).toFixed(2)) + "M";
    if (n >= 1e3) return trimZero((n / 1e3).toFixed(1)) + "K";
    return String(n);
  }

  function fmtPct(part, whole) {
    if (!whole) return "0%";
    var p = (part / whole) * 100;
    // A non-zero share that rounds to 0.0% is worse than useless: it reads as
    // "none". Say so explicitly instead.
    if (p > 0 && p < 0.1) return "<0.1%";
    return (p < 10 ? p.toFixed(1) : Math.round(p)) + "%";
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function fmtTime(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmtClock() {
    var d = new Date();
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function fmtDateFull(d) {
    if (lang === "zh") {
      return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    }
    return EN_MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function fmtDateShort(d) {
    if (lang === "zh") return (d.getMonth() + 1) + "月" + d.getDate() + "日";
    return EN_MONTHS[d.getMonth()] + " " + d.getDate();
  }

  // Chinese has no plural forms, so both keys hold the same string there.
  function unitFor(key, n) {
    return t(n === 1 ? key : key + "Plural");
  }

  // Single dominant unit, matching the reference ("22 分钟" / "22 min").
  function fmtDuration(ms) {
    if (!ms || ms < 1000) return { value: "0", unit: unitFor("unit.minute", 0) };
    var s = Math.round(ms / 1000);
    var m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return { value: String(d), unit: unitFor("unit.day", d) };
    if (h >= 1) return { value: String(h), unit: unitFor("unit.hour", h) };
    if (m >= 1) return { value: String(m), unit: unitFor("unit.minute", m) };
    return { value: String(s), unit: unitFor("unit.second", s) };
  }

  function fmtDurationText(ms) {
    var d = fmtDuration(ms);
    return lang === "zh" ? d.value + d.unit : d.value + " " + d.unit;
  }

  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  // Monday-start week, matching the local calendar convention.
  function startOfWeek(d) {
    var x = startOfDay(d);
    var dow = (x.getDay() + 6) % 7;
    return addDays(x, -dow);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function clear(id) {
    var n = document.getElementById(id);
    if (n) n.textContent = "";
    return n;
  }

  // Billable = what a provider actually meters, excluding cache reads.
  function billable(o) {
    return (o.input || 0) + (o.output || 0) + (o.cacheWrite || 0);
  }

  /* ---------- derived data ---------- */

  function modelColorMap() {
    var map = {};
    (DATA.models || []).forEach(function (m, i) {
      map[m.model] = SERIES_COLORS[i % SERIES_COLORS.length];
    });
    return map;
  }

  function dayStats() {
    var tokens = {}, messages = {};
    (DATA.events || []).forEach(function (e) {
      if (!e.day) return;
      tokens[e.day] = (tokens[e.day] || 0) + (e.all || 0);
      messages[e.day] = (messages[e.day] || 0) + 1;
    });
    return { tokens: tokens, messages: messages };
  }

  // Session titles and paths are arbitrary text from the user's own database,
  // so anything interpolated into tooltip markup has to be escaped.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- hover tooltip ---------- */

  var tipEl = null;

  function tipNode() {
    if (!tipEl) {
      tipEl = document.getElementById("tip");
      if (!tipEl) {
        tipEl = el("div", "tip");
        tipEl.id = "tip";
        tipEl.setAttribute("role", "tooltip");
        document.body.appendChild(tipEl);
      }
    }
    return tipEl;
  }

  function placeTip(node, x, y) {
    var pad = 14;
    var r = node.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = x + pad;
    var top = y + pad;
    // Flip to the other side of the cursor rather than overflow the viewport.
    if (left + r.width > vw - 8) left = x - r.width - pad;
    if (top + r.height > vh - 8) top = y - r.height - pad;
    node.style.left = Math.max(8, left) + "px";
    node.style.top = Math.max(8, top) + "px";
  }

  function showTip(html, x, y) {
    var node = tipNode();
    node.innerHTML = html;
    node.classList.add("show");
    placeTip(node, x, y);
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove("show");
  }

  function moveTip(x, y) {
    if (tipEl && tipEl.classList.contains("show")) placeTip(tipEl, x, y);
  }

  function tipRows(rows) {
    return '<div class="tip-rows">' + rows.map(function (r) {
      return '<div class="tip-row">' +
        '<span class="dot" style="background:' + r.color + '"></span>' +
        '<span class="name">' + esc(r.name) + "</span>" +
        '<span class="val">' + r.value + "</span>" +
        "</div>";
    }).join("") + "</div>";
  }

  function tipKv(pairs) {
    return '<dl class="tip-kv">' + pairs.map(function (p) {
      return "<dt>" + esc(p[0]) + "</dt><dd" +
        (p[2] ? ' class="em"' : "") + ">" + p[1] + "</dd>";
    }).join("") + "</dl>";
  }

  // Build once on enter, then only reposition — rebuilding markup on every
  // mousemove would thrash the layout.
  function bindRowTip(tr, build) {
    tr.classList.add("row-hoverable");
    tr.addEventListener("mouseenter", function (ev) {
      showTip(build(), ev.clientX, ev.clientY);
    });
    tr.addEventListener("mousemove", function (ev) {
      moveTip(ev.clientX, ev.clientY);
    });
    tr.addEventListener("mouseleave", hideTip);
  }

  function hitRate(o) {
    var denom = (o.cacheRead || 0) + (o.input || 0);
    return denom ? ((o.cacheRead / denom) * 100).toFixed(1) + "%" : "-";
  }

  function sessionTip(s) {
    var d = fmtDuration(s.durationMs);
    return '<div class="tip-head">' + esc(s.title || t("cell.noSession")) + "</div>" +
      (s.directory ? '<div class="tip-line">' + esc(s.directory) + "</div>" : "") +
      tipKv([
        [t("tip.billed"), fmtInt(billable(s)) + " tokens", true],
        [t("tip.input"), fmtInt(s.input)],
        [t("tip.output"), fmtInt(s.output)],
        [t("tip.reasoning"), fmtInt(s.reasoning)],
        [t("tip.cacheRead"), fmtInt(s.cacheRead)],
        [t("tip.requests"), t("tip.requestsValue", { n: fmtInt(s.messages) })],
        [t("tip.duration"), s.durationMs ? d.value + d.unit : "-"],
        [t("tip.created"), fmtTime(s.createdAt)],
      ]);
  }

  function modelTip(m) {
    return '<div class="tip-head">' + esc(m.model) + "</div>" +
      (m.providers && m.providers.length
        ? '<div class="tip-line">' + esc(t("cell.providers", { list: m.providers.join(", ") })) + "</div>"
        : "") +
      tipKv([
        [t("tip.totalTraffic"), fmtInt(m.all) + " tokens", true],
        [t("tip.input"), fmtInt(m.input)],
        [t("tip.output"), fmtInt(m.output)],
        [t("tip.reasoning"), fmtInt(m.reasoning)],
        [t("tip.cacheRead"), fmtInt(m.cacheRead)],
        [t("tip.cacheHit"), hitRate(m)],
        [t("tip.requests"), t("tip.requestsValue", { n: fmtInt(m.messages) })],
      ]);
  }

  /* ---------- stat row ---------- */

  function renderStats() {
    var host = clear("stats");
    if (!host) return;
    var s = DATA.stats || {};
    var dur = fmtDuration(s.longestSessionMs);
    var cum = fmtScaleParts(s.cumulativeTokens);
    var peak = fmtScaleParts(s.peakDailyTokens);

    var cells = [
      { value: cum.num, unit: cum.unit, label: t("stat.cumulative"),
        title: t("stat.cumulativeTitle", { n: fmtInt(s.cumulativeTokens) }) },
      { value: peak.num, unit: peak.unit, label: t("stat.peak"),
        title: s.peakDay ? t("stat.peakTitle", { day: s.peakDay }) : "" },
      { value: dur.value, unit: dur.unit, label: t("stat.longestChat"),
        title: s.longestSessionTitle
          ? t("stat.longestChatTitle", { title: s.longestSessionTitle }) : "" },
      { value: String(s.currentStreak || 0), unit: t("unit.day"),
        label: t("stat.currentStreak") },
      { value: String(s.longestStreak || 0), unit: t("unit.day"),
        label: t("stat.longestStreak") },
    ];

    cells.forEach(function (c) {
      var box = el("div", "stat");
      var v = el("div", "value");
      v.appendChild(document.createTextNode(c.value));
      if (c.unit) v.appendChild(el("span", "unit", c.unit));
      box.appendChild(v);
      box.appendChild(el("div", "label", c.label));
      if (c.title) box.title = c.title;
      host.appendChild(box);
    });
  }

  /* ---------- activity heatmap ---------- */

  var heatMode = "daily";

  function heatTip(key, m) {
    var d = new Date(key + "T00:00:00");
    if (m.kind === "week") {
      var head = fmtDateFull(m.from) + " – " + fmtDateShort(m.to);
      return '<div class="tip-head">' + esc(head) + "</div>" +
        '<div class="tip-line">' + fmtScale(m.tokens) + " tokens · " +
        t("heat.tipMessages", { n: m.messages }) + "</div>";
    }
    if (m.kind === "cumulative") {
      return '<div class="tip-head">' + esc(fmtDateFull(d)) + "</div>" +
        '<div class="tip-line">' +
        t("heat.tipCumulative", { v: fmtScale(m.tokens) + " tokens" }) + "</div>" +
        '<div class="tip-line">' +
        t("heat.tipThatDay", { v: fmtScale(m.today) + " tokens" }) + " · " +
        t("heat.tipMessages", { n: m.todayMessages }) + "</div>";
    }
    return '<div class="tip-head">' + esc(fmtDateFull(d)) + "</div>" +
      '<div class="tip-line">' + fmtScale(m.tokens) + " tokens · " +
      t("heat.tipMessages", { n: m.messages }) + "</div>";
  }

  function renderHeatmap() {
    var host = clear("heatmap");
    if (!host) return;

    var stats = dayStats();
    var totals = stats.tokens;
    var counts = stats.messages;
    var today = startOfDay(new Date());

    // A full 53-week grid ending with the current week, like the reference —
    // a grid sized to the data range collapses to a couple of cells and stops
    // reading as a calendar.
    var maxWeeks = 53;
    var first = addDays(startOfWeek(today), -(maxWeeks - 1) * 7);

    var weeks = [];
    var cursor = new Date(first);
    while (cursor <= today) {
      var col = [];
      for (var i = 0; i < 7; i++) {
        var d = addDays(cursor, i);
        col.push(d > today ? null : d);
      }
      weeks.push(col);
      cursor = addDays(cursor, 7);
    }
    if (!weeks.length) return;

    // Value per cell depends on the mode. Weekly paints the whole week with the
    // week total; cumulative paints each day with the running total so the
    // gradient reads left-to-right as growth.
    var dayVals = {};
    weeks.forEach(function (col) {
      col.forEach(function (d) {
        if (d) dayVals[dayKey(d)] = totals[dayKey(d)] || 0;
      });
    });

    var values = {};
    // Parallel metadata so the tooltip can describe whatever the cell shows.
    var cellMeta = {};
    if (heatMode === "daily") {
      values = dayVals;
      Object.keys(dayVals).forEach(function (k) {
        cellMeta[k] = { kind: "day", tokens: dayVals[k], messages: counts[k] || 0 };
      });
    } else if (heatMode === "weekly") {
      weeks.forEach(function (col) {
        var sum = 0, msgs = 0, days = [];
        col.forEach(function (d) {
          if (!d) return;
          var k = dayKey(d);
          sum += dayVals[k] || 0;
          msgs += counts[k] || 0;
          days.push(d);
        });
        col.forEach(function (d) {
          if (!d) return;
          var k = dayKey(d);
          values[k] = sum;
          cellMeta[k] = {
            kind: "week", tokens: sum, messages: msgs,
            from: days.length ? days[0] : d,
            to: days.length ? days[days.length - 1] : d,
          };
        });
      });
    } else {
      var running = 0, runningMsgs = 0;
      weeks.forEach(function (col) {
        col.forEach(function (d) {
          if (!d) return;
          var k = dayKey(d);
          running += dayVals[k] || 0;
          runningMsgs += counts[k] || 0;
          values[k] = running;
          cellMeta[k] = {
            kind: "cumulative", tokens: running, messages: runningMsgs,
            today: dayVals[k] || 0, todayMessages: counts[k] || 0,
          };
        });
      });
    }

    var maxVal = 0;
    Object.keys(values).forEach(function (k) { maxVal = Math.max(maxVal, values[k]); });

    function level(v) {
      if (!v) return 0;
      if (!maxVal) return 1;
      var r = v / maxVal;
      if (r <= 0.25) return 1;
      if (r <= 0.5) return 2;
      if (r <= 0.75) return 3;
      return 4;
    }

    // Size the cells to the card instead of scaling one fixed grid: that keeps
    // the whole year visible on a laptop and readable on a phone (where the
    // floor kicks in and the wrapper scrolls).
    var hostW = host.clientWidth || 742;
    var PITCH = Math.max(11, Math.min(20, hostW / weeks.length));
    var CELL = PITCH - 3;

    var W = Math.round(weeks.length * PITCH);
    var H = Math.round(7 * PITCH + 24);

    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    // Never upscale past the natural grid size.
    svg.style.minWidth = W + "px";
    svg.style.maxWidth = W + "px";
    var title = svgEl("title");
    title.textContent = t("heat.svgTitle");
    svg.appendChild(title);

    weeks.forEach(function (col, ci) {
      col.forEach(function (d, ri) {
        if (!d) return;
        var key = dayKey(d);
        var v = values[key] || 0;
        var rect = svgEl("rect", {
          x: ci * PITCH, y: ri * PITCH, width: CELL, height: CELL,
          rx: Math.max(2, Math.round(CELL * 0.28)),
          fill: HEAT_COLORS[level(v)],
          class: "heat-cell",
        });
        rect.setAttribute("data-day", key);
        svg.appendChild(rect);
      });
    });

    // One delegated handler beats 370 per-cell listeners.
    svg.addEventListener("mousemove", function (ev) {
      var tgt = ev.target;
      var key = tgt && tgt.getAttribute ? tgt.getAttribute("data-day") : null;
      if (!key || !cellMeta[key]) { hideTip(); return; }
      showTip(heatTip(key, cellMeta[key]), ev.clientX, ev.clientY);
    });
    svg.addEventListener("mouseleave", hideTip);

    // Month labels under the grid, one per month change, skipping cramped ones.
    var lastMonth = -1, lastLabelCol = -99;
    weeks.forEach(function (col, ci) {
      if (!col[0]) return;
      var m = col[0].getMonth();
      if (m === lastMonth) return;
      lastMonth = m;
      if (ci - lastLabelCol < 2) return;
      lastLabelCol = ci;
      var lab = svgEl("text", {
        x: ci * PITCH, y: 7 * PITCH + 16, class: "heat-label",
      });
      lab.textContent = lang === "zh" ? (m + 1) + "月" : EN_MONTHS[m];
      svg.appendChild(lab);
    });

    host.appendChild(svg);

    // legend swatches pick up the same ramp
    var swatches = document.querySelectorAll(".heat-legend .swatch");
    Array.prototype.forEach.call(swatches, function (s) {
      s.style.background = HEAT_COLORS[Number(s.getAttribute("data-lv"))] || HEAT_COLORS[0];
    });
  }

  /* ---------- multi-series trend chart ---------- */

  var rangeKey = "7";

  function buildBuckets() {
    var today = startOfDay(new Date());
    var days = (DATA.events || []).map(function (e) { return e.day; }).filter(Boolean).sort();
    var from;
    if (rangeKey === "all") {
      from = days.length ? startOfDay(new Date(days[0] + "T00:00:00")) : today;
    } else {
      from = addDays(today, -(Number(rangeKey) - 1));
    }
    if (from > today) from = today;

    var out = [];
    var c = new Date(from);
    while (c <= today) {
      out.push(new Date(c));
      c = addDays(c, 1);
    }
    return out;
  }

  function renderTrend() {
    var host = clear("trend-chart");
    var legendHost = clear("trend-legend");
    if (!host) return;

    var days = buildBuckets();
    var colors = modelColorMap();
    var models = (DATA.models || []).map(function (m) { return m.model; });

    var index = {};
    days.forEach(function (d, i) { index[dayKey(d)] = i; });

    var series = models.map(function (name) {
      return { name: name, color: colors[name], values: new Array(days.length).fill(0) };
    });
    var byName = {};
    series.forEach(function (s) { byName[s.name] = s; });

    (DATA.events || []).forEach(function (e) {
      var i = index[e.day];
      if (i === undefined) return;
      // Series are keyed by the bare model id, matching how models are merged.
      var s = byName[e.model];
      if (s) s.values[i] += e.all || 0;
    });

    // drop models with nothing in the visible window
    series = series.filter(function (s) {
      return s.values.some(function (v) { return v > 0; });
    });

    var note = document.getElementById("trend-note");
    if (note) {
      var a = days[0], b = days[days.length - 1];
      note.textContent = days.length === 1
        ? t("trend.singleDay")
        : t("trend.rangeNote", { from: fmtDateShort(a), to: fmtDateShort(b) });
    }

    if (!series.length) {
      host.appendChild(el("div", "chart-empty", t("trend.empty")));
      return;
    }

    series.forEach(function (s) {
      var item = el("span", "item");
      var d = el("span", "dot");
      d.style.background = s.color;
      item.appendChild(d);
      item.appendChild(document.createTextNode(s.name));
      legendHost.appendChild(item);
    });

    var W = 1000, H = 280;
    var M = { top: 14, right: 14, bottom: 34, left: 54 };

    // Match the viewBox to the host width so the SVG renders at roughly 1:1.
    // A fixed viewBox either shrinks labels away on a phone or blows them up
    // into oversized type on a full-screen card.
    var hostW = host.clientWidth || 1000;
    W = Math.round(Math.max(440, Math.min(1600, hostW)));
    var narrow = W < 700;
    if (narrow) {
      H = 230;
      M = { top: 12, right: 10, bottom: 32, left: 46 };
    }
    var iw = W - M.left - M.right;
    var ih = H - M.top - M.bottom;

    var maxV = 0;
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (v > maxV) maxV = v; });
    });
    if (!maxV) maxV = 1;
    var top = niceCeil(maxV);

    var xAt = function (i) {
      return days.length === 1 ? M.left + iw / 2 : M.left + (i / (days.length - 1)) * iw;
    };
    var yAt = function (v) { return M.top + ih - (v / top) * ih; };

    var svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H, role: "img",
      class: narrow ? "chart-narrow" : "",
    });
    var title = svgEl("title");
    title.textContent = t("trend.svgTitle");
    svg.appendChild(title);

    // dashed grid, mirroring the reference's faint rules
    for (var g = 0; g <= 4; g++) {
      var gv = (top / 4) * g;
      var gy = yAt(gv);
      svg.appendChild(svgEl("line", {
        x1: M.left, y1: gy, x2: W - M.right, y2: gy,
        stroke: "#ededef", "stroke-width": 1, "stroke-dasharray": "3 5",
      }));
      var yl = svgEl("text", {
        x: M.left - 10, y: gy + 4, class: "axis-text", "text-anchor": "end",
      });
      yl.textContent = fmtCompact(gv);
      svg.appendChild(yl);
    }

    series.forEach(function (s) {
      var pts = s.values.map(function (v, i) { return { x: xAt(i), y: yAt(v), v: v }; });

      if (pts.length === 1) {
        // A lone bucket has no line to draw; mark it instead.
        svg.appendChild(svgEl("circle", {
          cx: pts[0].x, cy: pts[0].y, r: 4, fill: s.color,
        }));
        return;
      }

      var d = smoothPath(pts);
      var area = d + " L " + pts[pts.length - 1].x + " " + (M.top + ih) +
        " L " + pts[0].x + " " + (M.top + ih) + " Z";

      svg.appendChild(svgEl("path", {
        d: area, fill: s.color, opacity: 0.08, stroke: "none",
      }));
      svg.appendChild(svgEl("path", {
        d: d, fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
    });

    var showEvery = Math.max(1, Math.ceil(days.length / (narrow ? 4 : 8)));
    days.forEach(function (day, i) {
      if (i % showEvery !== 0 && i !== days.length - 1) return;
      var xl = svgEl("text", {
        x: xAt(i), y: H - M.bottom + 22, class: "axis-text", "text-anchor": "middle",
      });
      xl.textContent = fmtDateShort(day);
      svg.appendChild(xl);
    });

    // --- hover: crosshair + per-series breakdown -------------------------
    var hoverLayer = svgEl("g");
    svg.appendChild(hoverLayer);

    // An invisible sheet on top of the plot catches the pointer without
    // stealing it from the series paths.
    var sheet = svgEl("rect", {
      x: M.left, y: M.top, width: iw, height: ih,
      fill: "transparent", style: "cursor:crosshair",
    });
    svg.appendChild(sheet);

    var hoverIndex = -1;

    function drawHover(i) {
      hoverLayer.textContent = "";
      if (i < 0) return;
      var x = xAt(i);
      hoverLayer.appendChild(svgEl("line", {
        x1: x, y1: M.top, x2: x, y2: M.top + ih, class: "trend-hover-line",
      }));
      series.forEach(function (s) {
        hoverLayer.appendChild(svgEl("circle", {
          cx: x, cy: yAt(s.values[i]), r: 4, fill: s.color, class: "trend-hover-dot",
        }));
      });
    }

    function trendTipHtml(i) {
      var total = series.reduce(function (a, s) { return a + s.values[i]; }, 0);
      var day = days[i];
      var head = '<div class="tip-head">' + esc(fmtDateShort(day)) +
        ' <span class="tip-dim">– ' + fmtScale(total) + " tokens</span></div>";
      var rows = series
        .map(function (s) { return { name: s.name, color: s.color, v: s.values[i] }; })
        .filter(function (r) { return r.v > 0; })
        .sort(function (a, b) { return b.v - a.v; })
        .map(function (r) { return { name: r.name, color: r.color, value: fmtScale(r.v) + " tokens" }; });
      if (!rows.length) return head + '<div class="tip-line">' + t("trend.noUsage") + "</div>";
      return head + tipRows(rows);
    }

    sheet.addEventListener("mousemove", function (ev) {
      var box = svg.getBoundingClientRect();
      if (!box.width) return;
      // Map the pointer back into viewBox units, then to the nearest bucket.
      var vx = (ev.clientX - box.left) * (W / box.width);
      var i = days.length === 1 ? 0
        : Math.round(((vx - M.left) / iw) * (days.length - 1));
      i = Math.max(0, Math.min(days.length - 1, i));
      if (i !== hoverIndex) {
        hoverIndex = i;
        drawHover(i);
      }
      showTip(trendTipHtml(i), ev.clientX, ev.clientY);
    });
    sheet.addEventListener("mouseleave", function () {
      hoverIndex = -1;
      drawHover(-1);
      hideTip();
    });

    host.appendChild(svg);
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / mag;
    var m = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 5 ? 5 : n <= 7 ? 7 : 10;
    return m * mag;
  }

  // Fritsch-Carlson monotone cubic — smooth without overshooting below zero,
  // which a plain Catmull-Rom would do on a spiky daily series.
  function smoothPath(pts) {
    var n = pts.length;
    if (n < 2) return "";
    var dx = [], dy = [], slope = [], m = [];
    for (var i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      dy[i] = pts[i + 1].y - pts[i].y;
      slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
    }
    m[0] = slope[0];
    m[n - 1] = slope[n - 2];
    for (var j = 1; j < n - 1; j++) {
      if (slope[j - 1] * slope[j] <= 0) {
        m[j] = 0;
      } else {
        var w1 = 2 * dx[j] + dx[j - 1];
        var w2 = dx[j] + 2 * dx[j - 1];
        m[j] = (w1 + w2) / (w1 / slope[j - 1] + w2 / slope[j]);
      }
    }
    var d = "M " + pts[0].x + " " + pts[0].y;
    for (var k = 0; k < n - 1; k++) {
      var c1x = pts[k].x + dx[k] / 3;
      var c1y = pts[k].y + (m[k] * dx[k]) / 3;
      var c2x = pts[k + 1].x - dx[k] / 3;
      var c2y = pts[k + 1].y - (m[k + 1] * dx[k]) / 3;
      d += " C " + c1x + " " + c1y + " " + c2x + " " + c2y + " " +
        pts[k + 1].x + " " + pts[k + 1].y;
    }
    return d;
  }

  /* ---------- model donut ---------- */

  function renderDonut() {
    var host = clear("donut");
    var legend = clear("donut-legend");
    if (!host) return;

    var colors = modelColorMap();
    var models = DATA.models || [];
    var total = models.reduce(function (a, m) { return a + (m.all || 0); }, 0);
    if (!total) {
      host.appendChild(el("div", "chart-empty", t("comp.empty")));
      return;
    }

    var R = 70, SW = 32, CX = 100, CY = 100;
    var C = 2 * Math.PI * R;

    var svg = svgEl("svg", { viewBox: "0 0 200 200", class: "donut", role: "img" });
    var title = svgEl("title");
    title.textContent = t("donut.svgTitle");
    svg.appendChild(title);

    svg.appendChild(svgEl("circle", {
      cx: CX, cy: CY, r: R, fill: "none", stroke: "#ebebed", "stroke-width": SW,
    }));

    var offset = 0;
    var segs = models.filter(function (m) { return (m.all || 0) > 0; });
    segs.forEach(function (m) {
      var len = (m.all / total) * C;
      // Leave a hairline gap so adjacent hues stay legible.
      var gap = segs.length > 1 ? 3 : 0;
      var draw = Math.max(0.5, len - gap);
      var arc = svgEl("circle", {
        cx: CX, cy: CY, r: R, fill: "none",
        stroke: colors[m.model] || SERIES_COLORS[0], "stroke-width": SW,
        "stroke-dasharray": draw + " " + (C - draw),
        "stroke-dashoffset": -offset,
        transform: "rotate(-90 " + CX + " " + CY + ")",
      });
      var ttl = svgEl("title");
      ttl.textContent = m.model + " · " + fmtScale(m.all) + " tokens (" + fmtPct(m.all, total) + ")";
      arc.appendChild(ttl);
      svg.appendChild(arc);
      offset += len;
    });

    var cv = svgEl("text", {
      x: CX, y: CY - 2, class: "donut-center-value", "text-anchor": "middle",
    });
    cv.textContent = fmtScale(total);
    svg.appendChild(cv);

    var cl = svgEl("text", {
      x: CX, y: CY + 20, class: "donut-center-label", "text-anchor": "middle",
    });
    cl.textContent = t("donut.tokens");
    svg.appendChild(cl);

    host.appendChild(svg);

    models.forEach(function (m) {
      var row = el("div", "row");

      var name = el("div", "name");
      var d = el("span", "dot");
      d.style.background = colors[m.model] || SERIES_COLORS[0];
      name.appendChild(d);
      var nm = el("span", "", m.model);
      nm.title = m.model;
      name.appendChild(nm);
      row.appendChild(name);

      row.appendChild(el("div", "pct", fmtPct(m.all, total)));
      row.appendChild(el("div", "amt", fmtScale(m.all) + " tokens"));

      legend.appendChild(row);
    });
  }

  /* ---------- composition bar ---------- */

  function renderComposition() {
    var bar = clear("comp-bar");
    var legend = clear("comp-legend");
    if (!bar) return;

    var tot = DATA.totals || {};
    var parts = PART_KEYS.map(function (k) { return { key: k, v: tot[k] || 0 }; })
      .filter(function (p) { return p.v > 0; });
    var total = parts.reduce(function (a, p) { return a + p.v; }, 0);

    var totalNote = document.getElementById("comp-total");
    if (totalNote) totalNote.textContent = t("comp.totalNote", { n: fmtInt(total) });

    if (!total) {
      bar.appendChild(el("div", "chart-empty", t("comp.empty")));
      return;
    }

    parts.forEach(function (p) {
      var pct = (p.v / total) * 100;
      var seg = el("div", "comp-seg");
      seg.style.width = pct + "%";
      seg.style.background = PART_COLORS[p.key];
      seg.style.color = PART_TEXT[p.key];
      if (pct > 8) seg.textContent = fmtPct(p.v, total);
      seg.title = t("part." + p.key) + ": " + fmtInt(p.v) + " tokens (" + fmtPct(p.v, total) + ")";
      bar.appendChild(seg);
    });

    parts.forEach(function (p) {
      var item = el("span", "item");
      var d = el("span", "dot");
      d.style.background = PART_COLORS[p.key];
      item.appendChild(d);
      item.appendChild(document.createTextNode(t("part." + p.key) + " " + fmtCompact(p.v)));
      legend.appendChild(item);
    });
  }

  /* ---------- tables ---------- */

  function renderSessions() {
    var tbody = clear("session-rows");
    if (!tbody) return;

    var rows = (DATA.sessions || []).slice();
    var max = 0;
    rows.forEach(function (s) { max = Math.max(max, billable(s)); });
    if (!max) max = 1;

    rows.forEach(function (s, i) {
      var tr = document.createElement("tr");
      var b = billable(s);

      var name = el("td", "name");
      var line = el("span");
      line.appendChild(el("span", "rank", "#" + (i + 1)));
      line.appendChild(document.createTextNode(s.title || t("cell.noSession")));
      name.appendChild(line);

      var bits = [];
      if (s.createdAt) bits.push(fmtTime(s.createdAt));
      if (s.durationMs) bits.push(t("cell.duration", { v: fmtDurationText(s.durationMs) }));
      if (s.directory) bits.push(s.directory);
      if (s.archived) bits.push(t("cell.archived"));
      if (bits.length) name.appendChild(el("span", "meta", bits.join("  ·  ")));
      tr.appendChild(name);

      var c1 = el("td", "strong");
      var spark = el("span", "spark");
      spark.style.width = Math.max(3, (b / max) * 52) + "px";
      c1.appendChild(spark);
      c1.appendChild(document.createTextNode(fmtInt(b)));
      tr.appendChild(c1);

      // Column classes mirror the <th> classes so the container queries can
      // drop whole columns on a narrow card.
      tr.appendChild(el("td", "", fmtInt(s.input)));
      tr.appendChild(el("td", "", fmtInt(s.output)));
      tr.appendChild(el("td", "col-tertiary", fmtInt(s.reasoning)));
      tr.appendChild(el("td", "col-secondary", fmtInt(s.cacheRead)));
      tr.appendChild(el("td", "", fmtInt(s.messages)));

      bindRowTip(tr, function () { return sessionTip(s); });
      tbody.appendChild(tr);
    });
  }

  function renderModels() {
    var tbody = clear("model-rows");
    if (!tbody) return;

    (DATA.models || []).forEach(function (m) {
      var tr = document.createElement("tr");

      var name = el("td", "name");
      name.appendChild(document.createTextNode(m.model));
      var meta = t("cell.allTokens", { n: fmtInt(m.all) });
      if (m.providers && m.providers.length) {
        meta += "  ·  " + t("cell.providers", { list: m.providers.join(", ") });
      }
      name.appendChild(el("span", "meta", meta));
      tr.appendChild(name);

      tr.appendChild(el("td", "strong", fmtInt((m.input || 0) + (m.output || 0))));
      tr.appendChild(el("td", "", fmtInt(m.input)));
      tr.appendChild(el("td", "", fmtInt(m.output)));
      tr.appendChild(el("td", "col-tertiary", fmtInt(m.reasoning)));
      tr.appendChild(el("td", "col-secondary", fmtInt(m.cacheRead)));
      tr.appendChild(el("td", "", fmtInt(m.messages)));
      tr.appendChild(el("td", "col-secondary", hitRate(m)));

      bindRowTip(tr, function () { return modelTip(m); });
      tbody.appendChild(tr);
    });
  }

  /* ---------- header / footer ---------- */

  function renderMeta() {
    var foot = document.getElementById("foot-note");
    if (!foot) return;
    var tot = DATA.totals || {};
    foot.textContent = [
      t("foot.source", { src: DATA.source }),
      t("foot.requests", { n: fmtInt(tot.messages) }),
      t("foot.sessions", { n: (DATA.sessions || []).length }),
      t("foot.models", { n: (DATA.models || []).length }),
      t("foot.snapshot", { at: fmtTime(DATA.generatedAt) }),
    ].join("　·　");
  }

  /* ---------- static strings ---------- */

  function applyStaticStrings() {
    var nodes = document.querySelectorAll("[data-i18n]");
    Array.prototype.forEach.call(nodes, function (node) {
      var key = node.getAttribute("data-i18n");
      var value = t(key);
      if (value !== key) node.textContent = value;
    });

    var notesList = document.getElementById("notes-list");
    if (notesList) {
      notesList.textContent = "";
      var body = t("notes.body");
      if (Object.prototype.toString.call(body) === "[object Array]") {
        body.forEach(function (html) {
          var li = document.createElement("li");
          li.innerHTML = html;
          notesList.appendChild(li);
        });
      }
    }

    var closeBtn = document.getElementById("close-notes");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("notes.close"));

    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = t("boot.title");

    var langBtn = document.getElementById("lang-toggle");
    if (langBtn) {
      langBtn.textContent = t("lang.other");
      langBtn.setAttribute("aria-label", t("lang.self"));
    }
  }

  /* ---------- toggles ---------- */

  function bindPills(id, attr, onPick) {
    var box = document.getElementById(id);
    if (!box) return;
    var buttons = box.querySelectorAll("button");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(buttons, function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        onPick(btn.getAttribute(attr));
      });
    });
  }

  /* ---------- notes modal ---------- */

  function bindNotes() {
    var dlg = document.getElementById("notes-dialog");
    var openBtn = document.getElementById("open-notes");
    var closeBtn = document.getElementById("close-notes");
    if (!dlg || !openBtn) return;

    openBtn.addEventListener("click", function () {
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (typeof dlg.close === "function") dlg.close();
        else dlg.removeAttribute("open");
      });
    }
    // A click landing on the dialog element itself is a click on the backdrop.
    dlg.addEventListener("click", function (ev) {
      if (ev.target === dlg && typeof dlg.close === "function") dlg.close();
    });
  }

  /* ---------- toast ---------- */

  var toastTimer = null;
  function toast(msg) {
    var node = document.getElementById("toast");
    if (!node) return;
    node.textContent = msg;
    node.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove("show"); }, 3200);
  }

  /* ---------- auto update ---------- */

  var AUTO_MS = 20000;
  var autoStamp = null;

  // Compare a fingerprint rather than generatedAt alone: a snapshot whose
  // numbers moved must still repaint even if its timestamp happens to match.
  function fingerprint(d) {
    if (!d) return "";
    return [
      d.generatedAt || "",
      JSON.stringify(d.totals || {}),
      (d.sessions || []).length,
      (d.models || []).length,
    ].join("|");
  }

  function setAutoStatus(text, pulse) {
    var host = document.getElementById("auto-status");
    if (!host) return;
    host.textContent = "";
    host.appendChild(el("span", "live"));
    host.appendChild(document.createTextNode(text));
    if (pulse) {
      host.classList.remove("pulse");
      void host.offsetWidth; // restart the animation
      host.classList.add("pulse");
    }
  }

  function readData() {
    return fetchData().catch(function () { return reloadViaScriptTag(); });
  }

  // Re-read the snapshot and repaint only when the export actually moved, so
  // polling stays cheap while the watcher is idle.
  function autoTick() {
    if (document.hidden) return;
    readData().then(function (next) {
      if (!next) return;
      var fp = fingerprint(next);
      if (fp === autoStamp) return;
      autoStamp = fp;
      DATA = next;
      renderAll();
      setAutoStatus(t("auto.updated", { at: fmtClock() }), true);
    }).catch(function () {
      // Nothing readable yet (watcher not running, or file:// blocked): keep
      // the last good render rather than blanking the page.
    });
  }

  function startAuto() {
    autoStamp = fingerprint(DATA);
    setAutoStatus(t("auto.checking", { n: AUTO_MS / 1000 }));
    setInterval(autoTick, AUTO_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) autoTick();
    });
  }

  /* ---------- refresh ---------- */

  // data.js is a plain script, so lift the object literal out of its text.
  function parseDataScript(text) {
    var i = text.indexOf("{");
    var j = text.lastIndexOf("}");
    if (i < 0 || j < 0) throw new Error("payload not found");
    return JSON.parse(text.slice(i, j + 1));
  }

  function fetchData() {
    return fetch("data.js", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(parseDataScript);
  }

  // fetch() is blocked for file:// pages, which is how the page is opened when
  // the user double-clicks index.html. Re-injecting the script tag still works
  // there, so keep it as a fallback.
  function reloadViaScriptTag() {
    return new Promise(function (resolve, reject) {
      var prev = window.MIMO_TOKEN_DATA;
      var old = document.getElementById("data-script");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var s = document.createElement("script");
      s.id = "data-script";
      s.src = "data.js?t=" + Date.now();
      s.onload = function () {
        var next = window.MIMO_TOKEN_DATA;
        if (next && next !== prev) resolve(next);
        else reject(new Error("data.js unchanged or cached"));
      };
      s.onerror = function () { reject(new Error("data.js load failed")); };
      document.head.appendChild(s);
    });
  }

  function bindRefresh() {
    var btn = document.getElementById("refresh");
    if (!btn) return;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.classList.add("spinning");

      readData()
        .then(function (next) {
          DATA = next;
          autoStamp = fingerprint(next);
          renderAll();
          toast(t("toast.refreshed", { n: fmtInt((DATA.totals || {}).messages) }));
        })
        .catch(function () {
          toast(t("toast.failed"));
        })
        .then(function () {
          btn.disabled = false;
          btn.classList.remove("spinning");
        });
    });
  }

  /* ---------- waterfall layout ---------- */

  // CSS Grid has no reliable masonry, so each card is given a row span measured
  // from its own content. Rows are 1px with no gap, which lets the span match
  // the height exactly; the visual gap comes from the card's bottom margin. A
  // short card therefore never leaves a hole beside a tall one.
  function layoutMasonry() {
    var grid = document.querySelector(".grid");
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.children);
    if (!cards.length) return;

    // Measure with packing switched off, or we would be measuring the spans we
    // applied on the previous pass.
    grid.classList.remove("masonry");
    cards.forEach(function (c) { c.style.gridRowEnd = ""; });

    var cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    if (cols < 2) return; // a single column needs no packing

    var heights = cards.map(function (c) { return c.getBoundingClientRect().height; });

    grid.classList.add("masonry");
    cards.forEach(function (c, i) {
      c.style.gridRowEnd = "span " + (Math.ceil(heights[i]) + 16);
    });
  }

  /* ---------- responsive re-render ---------- */

  // Both the trend chart and the heatmap derive their geometry from the card
  // width, so crossing a column breakpoint means rebuilding them. The packing
  // is refreshed on every resize, since text reflow changes card heights too.
  function bindResize() {
    var lastW = null;
    var timer = null;
    window.addEventListener("resize", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var host = document.getElementById("trend-chart");
        if (host) {
          var w = host.clientWidth || 0;
          if (lastW === null || Math.abs(w - lastW) >= 40) {
            lastW = w;
            renderTrend();
            renderHeatmap();
          }
        }
        layoutMasonry();
      }, 180);
    });
  }

  /* ---------- language switch ---------- */

  function setLang(next, rerender) {
    lang = STRINGS[next] ? next : "en";
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    applyStaticStrings();
    if (rerender) {
      renderAll();
    } else {
      renderMeta();
    }
  }

  function bindLang() {
    var btn = document.getElementById("lang-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      setLang(lang === "zh" ? "en" : "zh", true);
    });
  }

  /* ---------- render all ---------- */

  function renderAll() {
    hideTip(); // the elements it described are about to be replaced
    renderStats();
    renderHeatmap();
    renderTrend();
    renderDonut();
    renderComposition();
    renderSessions();
    renderModels();
    renderMeta();
    layoutMasonry();
  }

  if (!DATA) {
    applyStaticStrings();
    var app = document.getElementById("app");
    if (app) {
      app.innerHTML = '<section class="card"><div class="chart-empty">' +
        t("boot.noData") + "</div></section>";
    }
    return;
  }

  applyStaticStrings();
  renderAll();

  bindPills("heat-toggle", "data-mode", function (mode) {
    heatMode = mode;
    renderHeatmap();
    layoutMasonry();
  });
  bindPills("range-toggle", "data-range", function (r) {
    rangeKey = r;
    renderTrend();
    layoutMasonry();
  });
  bindRefresh();
  bindNotes();
  bindLang();
  bindResize();
  startAuto();

  // A fixed-position tip would be stranded by a scroll, so drop it.
  window.addEventListener("scroll", hideTip, true);

  // Web fonts can land after the first paint and change card heights.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(layoutMasonry);
  }
})();
