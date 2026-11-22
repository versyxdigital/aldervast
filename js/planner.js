/* Aldervast build planner: the page. The numbers come from planner-engine.js (the game's own maths). */
(function () {
  "use strict";
  var E = window.AVPlan, app = document.getElementById("planner"), ROOT = document.documentElement.getAttribute("data-root") || "";
  var D, I;
  var SLOTS = [["main_hand", "Main hand"], ["off_hand", "Off hand"], ["helm", "Helm"], ["chest", "Body armour"], ["gloves", "Gloves"], ["boots", "Boots"],
    ["belt", "Belt"], ["amulet", "Amulet"], ["ring1", "Ring"], ["ring2", "Ring"]];
  var RARITY = ["Normal", "Magic", "Rare", "Unique", "Set"];
  var RCLS = ["r-normal", "r-magic", "r-rare", "r-unique", "r-set"];
  var COLOUR_NAME = { r: "red (Strength)", g: "green (Dexterity)", b: "blue (Intelligence)", w: "white (any)" };
  var ATTR_COLOUR = { str: "r", dex: "g", int: "b" };
  var SITUATIONS = [["full_life", "On full life"], ["low_life", "On low life"], ["moving", "Moving"], ["stationary", "Standing still"], ["killed_recently", "Killed recently"],
    ["crit_recently", "Crit recently"], ["damaged_recently", "Hit recently"], ["has_ward", "Has ward"], ["has_fervor", "Has a fervor charge"], ["full_mana", "On full mana"]];
  var MAX_ILVL = 80, QUEST_POINTS = 44, SPEC_POINTS = 4;
  var S = null;          // the build being planned
  var tab = "gear", openSlot = "main_hand", selNode = -1, hoverPath = [], search = "", view = null, msgTimer = 0;
  var uidN = 0;

  // ---------------------------------------------------------------- little helpers
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
  function num(v) { return Math.round(v).toLocaleString("en-GB"); }
  function num1(v) { return (Math.round(v * 10) / 10).toLocaleString("en-GB"); }
  function num2(v) { return (Math.round(v * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { return Math.round(v) + "%"; }
  function signed(v) { v = Math.round(v); return (v >= 0 ? "+" : "") + v + "%"; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function uid() { return "p" + (++uidN).toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function select(opts, value, onchange, attrs) {
    var s = h("select", Object.assign({ onchange: function () { onchange(this.value); } }, attrs || {}));
    opts.forEach(function (o) {
      if (o.group) { var g = h("optgroup", { label: o.group }); o.items.forEach(function (x) { g.appendChild(h("option", { value: x[0], selected: String(x[0]) === String(value) }, x[1])); }); s.appendChild(g); }
      else s.appendChild(h("option", { value: o[0], selected: String(o[0]) === String(value) }, o[1]));
    });
    return s;
  }
  function field(label, control, note) { return h("label", { class: "pl-field" }, h("span", { class: "pl-label" }, label), control, note ? h("small", { class: "pl-note" }, note) : null); }
  function icon(path, cls) { var i = h("img", { src: ROOT + "assets/icons/" + path + ".webp", alt: "", class: cls || "pl-ico", loading: "lazy" }); i.onerror = function () { this.style.visibility = "hidden"; }; return i; }
  function flash(text) {
    var m = document.getElementById("pl-msg");
    if (!m) return;
    m.textContent = text; m.classList.add("on");
    clearTimeout(msgTimer); msgTimer = setTimeout(function () { m.classList.remove("on"); }, 2600);
  }
  function classLabel(cls) {
    var NAMES = { one_hand_sword: "One-Handed Sword", one_hand_axe: "One-Handed Axe", one_hand_mace: "One-Handed Mace", two_hand_sword: "Two-Handed Sword",
      two_hand_axe: "Two-Handed Axe", hand_crossbow: "Hand Crossbow", chest: "Body Armour", helm: "Helm", gloves: "Gloves", boots: "Boots", shield: "Shield" };
    var DEF = { ar: "Armour", ev: "Evasion", wd: "Ward" };
    if (NAMES[cls]) return NAMES[cls];
    var p = cls.split("_"), head = p[0], tail = p[1] || "";
    if (tail && NAMES[head]) { var d = []; for (var i = 0; i < tail.length; i += 2) d.push(DEF[tail.substr(i, 2)] || tail.substr(i, 2).toUpperCase()); return NAMES[head] + " · " + d.join(" / "); }
    return E.capitalize(cls);
  }

  // ---------------------------------------------------------------- the build
  function slotKind(slot) { return slot === "ring1" || slot === "ring2" ? "ring" : slot; }
  function basesFor(slot) {
    return D.bases.filter(function (b) {
      if ((b.tags || []).indexOf("cosmetic") >= 0) return false;
      if (slot === "off_hand") return b.slot === "off_hand" || (b.slot === "main_hand" && (b.hands || 1) === 1);
      return b.slot === slotKind(slot);
    });
  }
  function newItem(baseId, ilvl) {
    return { uid: uid(), kind: "equip", base: baseId, ilvl: ilvl || MAX_ILVL, rarity: 0, prefixes: [], suffixes: [], quality: 0, sockets: [], gems: [], corrupted: false, name: "" };
  }
  function gem(id, support, level) { return { uid: uid(), kind: "gem", gem: id, support: !!support, level: level || 1, xp: 0, quality: 0 }; }
  function freshBuild(classId) {
    var c = I.classes[classId] || D.classes[0];
    var b = { v: 1, name: "", cls: c.id, anc: D.ancestries[0].id, level: 1, qp: 0, trial: false, spec: "", specNodes: [], passives: [], eq: {}, cond: {}, free: S ? !!S.free : false };
    var w = newItem(c.start_weapon || "rusted_blade", 1); w.starter = true;
    w.sockets = [{ c: ATTR_COLOUR[(I.skills[c.start_skill] || {}).attr] || "b", g: 0 }, { c: "w", g: 0 }];
    w.gems = [gem(c.start_skill || "cleaving_strike", false, 1), null];
    b.eq.main_hand = w;
    if (c.start_offhand) { var o = newItem(c.start_offhand, 1); o.starter = true; b.eq.off_hand = o; }
    var a = newItem(c.start_armor || "leather_vest", 1); a.starter = true; b.eq.chest = a;
    return b;
  }
  function ch() {
    return { id: "planner", class: S.cls, ancestry: S.anc, level: S.level, bonus_points: S.qp, passives: S.passives, spec: S.trial ? S.spec : "",
      spec_nodes: S.trial ? S.specNodes : [], spec_points: S.trial ? SPEC_POINTS : 0, equipment: S.eq };
  }
  function situation() { var c = {}; for (var k in S.cond) if (S.cond[k]) c[k] = true; return c; }
  function hasSituation() { return Object.keys(situation()).length > 0; }
  function liveConds(sheet) {
    var live = E.restConds(Math.max(0, sheet.stats.value("ward")));
    var c = situation();
    if (c.low_life) live.full_life = false;
    if (c.moving) live.stationary = false;
    for (var k in c) live[k] = true;
    if (c.has_fervor) live._fervor = 1;
    return live;
  }

  // ---------------------------------------------------------------- saving and sharing
  function encodeState() {
    var eq = {};
    Object.keys(S.eq).forEach(function (slot) {
      var it = S.eq[slot]; if (!it) return;
      var o = { b: it.base, l: it.ilvl, r: it.rarity };
      if (it.quality) o.q = it.quality;
      if (it.starter) o.st = 1;
      if (it.prefixes.length) o.p = it.prefixes.map(function (a) { return [a.id, a.tier, a.rolls]; });
      if (it.suffixes.length) o.s = it.suffixes.map(function (a) { return [a.id, a.tier, a.rolls]; });
      if (it.unique) { o.u = it.unique; o.ur = it.unique_rolls; }
      if (it.set) o.set = it.set;
      if (it.crafted) o.im = it.crafted.id;
      if (it.woven) o.wv = it.woven.id;
      if (it.corrupt_mods) o.co = D.corrupt.findIndex(function (c) { return JSON.stringify(c) === JSON.stringify(it.corrupt_mods[0]); });
      if (it.sockets.length) o.k = it.sockets.map(function (s, i) { var g = it.gems[i]; return [s.c, s.g].concat(g ? [g.gem, g.support ? 1 : 0, g.level, g.quality || 0] : []); });
      eq[slot] = o;
    });
    return { v: 1, n: S.name, c: S.cls, a: S.anc, l: S.level, qp: S.qp, t: S.trial ? 1 : 0, sp: S.spec, sn: S.specNodes, p: S.passives, e: eq, cd: Object.keys(situation()), f: S.free ? 1 : 0 };
  }
  function decodeState(o) {
    if (!o || o.v !== 1 || !I.classes[o.c]) return null;
    var b = { v: 1, name: String(o.n || "").slice(0, 60), cls: o.c, anc: I.ancestries[o.a] ? o.a : D.ancestries[0].id, level: Math.max(1, Math.min(60, o.l | 0)),
      qp: Math.max(0, Math.min(QUEST_POINTS, o.qp | 0)), trial: !!o.t, spec: I.specs[o.sp] ? o.sp : "", specNodes: (o.sn || []).map(String),
      passives: [], eq: {}, cond: {}, free: !!o.f };
    (o.cd || []).forEach(function (k) { b.cond[k] = true; });
    b.passives = E.mended((o.p || []).map(function (x) { return x | 0; }).filter(function (x) { return I.nodes[x] && I.nodes[x].kind !== "start"; }), b.cls);
    Object.keys(o.e || {}).forEach(function (slot) {
      var x = o.e[slot];
      if (!I.bases[x.b] || !SLOTS.some(function (s) { return s[0] === slot; })) return;
      var it = newItem(x.b, Math.max(1, Math.min(MAX_ILVL, x.l | 0)));
      it.rarity = Math.max(0, Math.min(4, x.r | 0));
      it.quality = Math.max(0, Math.min(20, x.q | 0));
      if (x.st) it.starter = true;
      function aff(list) { return (list || []).filter(function (a) { return I.affixes[a[0]]; }).map(function (a) { return { id: a[0], tier: Math.max(0, Math.min(I.affixes[a[0]].tiers.length - 1, a[1] | 0)), rolls: (a[2] || []).map(Number) }; }); }
      it.prefixes = aff(x.p); it.suffixes = aff(x.s);
      if (x.u && I.uniques[x.u]) { it.unique = x.u; it.unique_rolls = (x.ur || []).map(Number); it.name = I.uniques[x.u].name; }
      if (x.set && I.sets[x.set]) { it.set = x.set; var pc = I.sets[x.set].pieces.find(function (p) { return p.base === it.base; }); it.name = pc ? pc.name : ""; }
      if (x.im && I.imbues[x.im]) it.crafted = { id: x.im, mods: I.imbues[x.im].mods };
      if (x.wv && I.weaves[x.wv]) it.woven = { id: x.wv, mods: I.weaves[x.wv].mods };
      if (x.co != null && x.co >= 0 && D.corrupt[x.co]) { it.corrupted = true; it.corrupt_mods = [D.corrupt[x.co]]; }
      (x.k || []).slice(0, 6).forEach(function (k) {
        it.sockets.push({ c: "rgbw".indexOf(k[0]) >= 0 ? k[0] : "w", g: k[1] | 0 });
        it.gems.push(k.length > 2 && (I.skills[k[2]] || I.supports[k[2]]) ? { uid: uid(), kind: "gem", gem: k[2], support: !!k[3], level: Math.max(1, Math.min(30, k[4] | 0)), xp: 0, quality: Math.max(0, Math.min(20, k[5] | 0)) } : null);
      });
      b.eq[slot] = it;
    });
    return b;
  }
  function b64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function streamBytes(bytes, stream) { return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  // SLOTS and SITUATIONS are named by place in a packed link: only ever add to the end of them
  function codeOpts() { return { index: I, slots: SLOTS.map(function (x) { return x[0]; }), situations: SITUATIONS.map(function (x) { return x[0]; }) }; }
  function makeCode() {
    if (window.AVCode && D.reg) { try { return Promise.resolve("p" + AVCode.pack(encodeState(), D, codeOpts())); } catch (e) { /* fall back to the long form */ } }
    var json = new TextEncoder().encode(JSON.stringify(encodeState()));
    if (typeof CompressionStream === "function") return streamBytes(json, new CompressionStream("deflate-raw")).then(function (z) { return "z" + b64(z); });
    return Promise.resolve("j" + b64(json));
  }
  function readCode(code) {
    try {
      if (code[0] === "p") return Promise.resolve(decodeState(AVCode.unpack(code.slice(1), D, codeOpts())));
      if (code[0] === "j") return Promise.resolve(decodeState(JSON.parse(new TextDecoder().decode(unb64(code.slice(1))))));
      if (code[0] === "z" && typeof DecompressionStream === "function")
        return streamBytes(unb64(code.slice(1)), new DecompressionStream("deflate-raw")).then(function (b) { return decodeState(JSON.parse(new TextDecoder().decode(b))); }).catch(function () { return null; });
    } catch (e) { /* a broken link */ }
    return Promise.resolve(null);
  }
  var saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem("av-planner", JSON.stringify(encodeState())); } catch (e) { /* storage off */ }
      makeCode().then(function (c) { try { history.replaceState(null, "", hashOf(c)); } catch (e) { /* file:// */ } });
    }, 250);
  }
  function hashOf(c) { return c[0] === "p" ? "#" + c : "#b=" + c; }
  function copyLink() {
    makeCode().then(function (c) {
      var url = location.href.split("#")[0] + hashOf(c);
      try { history.replaceState(null, "", hashOf(c)); } catch (e) { /* ignore */ }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { flash("Link copied. Anyone who opens it sees this build."); }, function () { prompt("Copy this link:", url); });
      else prompt("Copy this link:", url);
    });
  }

  // ---------------------------------------------------------------- history: the build is one state, and every edit is a step
  var undoStack = [], redoStack = [], committed = null;
  function snap() { return JSON.stringify(S); }
  function commit() {
    var now = snap();
    if (committed !== null && now !== committed) { undoStack.push(committed); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
    committed = now;
  }
  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(snap()); committed = from.pop(); S = JSON.parse(committed);
    save(); render();
  }
  function undo() { stepHistory(undoStack, redoStack); }
  function redo() { stepHistory(redoStack, undoStack); }

  // ---------------------------------------------------------------- the whole page
  function changed() { commit(); save(); render(); }
  var lastM = null, impact = null, sideScroll = [0, 0], openProp = null, picker = null, selSock = {}, ilvlMsg = null, drag = null;
  var IMPACT = [["life", "Life", "n"], ["mana", "Mana", "n"], ["ward", "Ward", "n"], ["armor", "Armour", "n"], ["evasion", "Evasion", "n"],
    ["block", "Block", "p"], ["spell_block", "Spell block", "p"], ["dodge", "Dodge", "p"],
    ["res_fire", "Fire resistance", "p"], ["res_cold", "Cold resistance", "p"], ["res_lightning", "Lightning resistance", "p"], ["res_chaos", "Chaos resistance", "p"],
    ["str", "Strength", "n"], ["dex", "Dexterity", "n"], ["int", "Intelligence", "n"],
    ["attack_speed", "Attack speed", "s"], ["cast_speed", "Cast speed", "s"], ["crit_multi", "Critical multiplier", "p"], ["accuracy", "Accuracy", "n"],
    ["move_speed", "Movement speed", "m"], ["life_regen", "Life regeneration", "r"], ["mana_regen", "Mana regeneration", "r"],
    ["item_rarity", "Item rarity", "s"], ["item_quantity", "Item quantity", "s"], ["passive_points", "Passive points left", "n"]];
  function fmt(kind, v) {
    if (kind === "p") return pct(v);
    if (kind === "s") return signed(v);
    if (kind === "m") return num1(v) + " m/s";
    if (kind === "r") return num1(v) + "/s";
    if (kind === "d") return num1(v);
    return num(v);
  }
  function fmtDelta(kind, v) {
    var a = Math.abs(v), s = v >= 0 ? "+" : "−";
    if (kind === "m") return s + num2(a) + " m/s";
    if (kind === "r") return s + num1(a) + "/s";
    if (kind === "p" || kind === "s") return s + num1(a) + "%";
    if (kind === "d") return s + num1(a);
    return s + num(a);
  }
  function metrics(ctx) {
    var m = {}, best = null;
    IMPACT.forEach(function (k) { m[k[0]] = ctx.d[k[0]]; });
    ctx.skills.forEach(function (x) {
      if (!x.s || x.s.preview.total <= 0) return;
      var dps = x.s.preview.total / Math.max(x.s.use_time, 0.05);
      if (!best || dps > best.dps) best = { dps: dps, name: x.s.name, x: x };
    });
    m.dps = best ? best.dps : 0; m.dpsName = best ? best.name : ""; m.best = best ? best.x : null;
    return m;
  }
  function differs(a, b, k) { return Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6 * Math.max(1, Math.abs(a[k] || 0)); }
  function context(quiet) {
    var c = ch(), sheet = E.build(c), live = liveConds(sheet);
    var d = E.derived(c, sheet, {}), ds = hasSituation() ? E.derived(c, sheet, situation(), live) : null;
    var skills = E.socketedSkills(c).map(function (e) { return { e: e, s: E.resolve(c, sheet, e, situation(), live) }; });
    var ctx = { c: c, sheet: sheet, d: d, ds: ds, skills: skills };
    ctx.warn = warnings(c, sheet, d);
    ctx.m = metrics(ctx);
    if (lastM && (differs(lastM, ctx.m, "dps") || IMPACT.some(function (k) { return differs(lastM, ctx.m, k[0]); }))) {
      impact = { a: lastM, b: ctx.m };
      if (!quiet) announce(impact);
    }
    lastM = ctx.m;
    return ctx;
  }
  function changes(imp) {
    return IMPACT.filter(function (k) { return differs(imp.a, imp.b, k[0]); }).map(function (k) {
      var dv = imp.b[k[0]] - imp.a[k[0]];
      return { k: k[0], label: k[1], kind: k[2], a: imp.a[k[0]], b: imp.b[k[0]], d: dv, good: k[0] === "passive_points" ? dv >= 0 : dv > 0 };
    });
  }
  function dpsChange(imp) { var a = imp.a.dps, b = imp.b.dps; return a > 0 ? (b - a) / a * 100 : (b > 0 ? Infinity : 0); }
  // on a narrow screen the sheet is out of sight, so say what the change did
  function announce(imp) {
    if (!window.matchMedia || !window.matchMedia("(max-width: 1279px)").matches) return;
    var bits = [];
    if (differs(imp.a, imp.b, "dps")) { var p = dpsChange(imp); bits.push("DPS " + num1(imp.a.dps) + " → " + num1(imp.b.dps) + (isFinite(p) ? " (" + (p >= 0 ? "+" : "") + num1(p) + "%)" : "")); }
    changes(imp).slice(0, 2).forEach(function (c) { bits.push(c.label + " " + fmtDelta(c.kind, c.d)); });
    if (bits.length) setTimeout(function () { flash(bits.join(" · ")); }, 0);
  }

  function render() {
    var ctx = context();
    var scrollY = window.scrollY, ae = document.activeElement, keepFocus = ae && ae.id ? ae.id : null;
    var L = app.querySelector(".pl-left"), R = app.querySelector(".pl-right");
    if (L) sideScroll[0] = L.scrollTop;
    if (R) sideScroll[1] = R.scrollTop;
    var msg = document.getElementById("pl-msg") || h("div", { id: "pl-msg", class: "pl-msg", role: "status", "aria-live": "polite" });
    app.textContent = "";
    app.appendChild(header(ctx));
    var tabs = [["gear", "Gear"], ["skills", "Skills"], ["passives", "Passive web"], ["character", "Character"], ["sheet", "Sheet"]];
    var centre = h("div", { class: "pl-centre" }, h("nav", { class: "pl-tabs", role: "tablist", "aria-label": "Planner" }, tabs.map(function (t) {
      return h("button", { role: "tab", class: "pl-tab" + (tab === t[0] ? " on" : "") + (t[0] === "sheet" ? " pl-only-narrow" : ""), "aria-selected": tab === t[0] ? "true" : "false",
        onclick: function () { tab = t[0]; render(); } }, t[1], t[0] === "skills" ? h("span", { class: "pl-count" }, String(ctx.skills.length)) : null,
        t[0] === "passives" ? h("span", { class: "pl-count pts" + (ctx.d.passive_points < 0 ? " bad" : "") }, String(ctx.d.passive_points)) : null);
    })));
    var main = h("div", { class: "pl-main" });
    if (tab === "gear") { main.appendChild(h("div", { class: "pl-only-phone" }, equipment(ctx))); main.appendChild(itemEditor(openSlot, ctx)); }
    else if (tab === "skills") main.appendChild(skillsTab(ctx));
    else if (tab === "passives") main.appendChild(passivesTab(ctx));
    else if (tab === "character") main.appendChild(characterTab(ctx));
    else main.appendChild(sheetPanel(ctx));
    centre.appendChild(main);
    var left = h("aside", { class: "pl-left", "aria-label": "Equipment" }, equipment(ctx));
    var right = h("aside", { class: "pl-right", "aria-label": "Character sheet" }, sheetPanel(ctx));
    app.appendChild(h("div", { class: "pl-work" }, left, centre, right));
    app.appendChild(about());
    app.appendChild(msg);
    if (keepFocus) { var f = document.getElementById(keepFocus); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } } }
    left.scrollTop = sideScroll[0]; right.scrollTop = sideScroll[1];
    var strip = app.querySelector(".pl-only-phone .pl-doll"), onS = strip && strip.querySelector(".pl-slot.on");
    if (onS && strip.offsetParent) strip.scrollLeft = Math.max(0, onS.offsetLeft - strip.offsetLeft - 8);
    window.scrollTo(0, scrollY);
  }

  // ---------------------------------------------------------------- the build header
  var ICONS = { undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11", redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
    share: "M18 8a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM6 15a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm12 7a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
    plus: "M12 5v14M5 12h14", chev: "m6 9 6 6 6-6", x: "M6 6l12 12M18 6 6 18", left: "m15 18-6-6 6-6", right: "m9 18 6-6-6-6", info: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" };
  function svgIcon(name) {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg"), p = document.createElementNS(NS, "path");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "pl-svgi");
    p.setAttribute("d", ICONS[name]); s.appendChild(p); return s;
  }
  function header(ctx) {
    var cls = I.classes[S.cls], d = ctx.d, m = ctx.m, total = S.level - 1 + S.qp, used = S.passives.length, n = ctx.warn.length;
    function hs(label, value, cls2, title, key) {
      return h("button", { class: "pl-hstat " + (cls2 || ""), title: title || "", onclick: function () { if (key) openBreakdown(key); } }, h("span", null, label), h("b", null, value));
    }
    return h("header", { class: "pl-head" },
      h("div", { class: "pl-head-id" },
        h("h1", { class: "pl-eyebrow" }, "Aldervast · Build planner"),
        h("input", { id: "pl-name", class: "pl-name", value: S.name, placeholder: "Name this build", maxlength: "60", "aria-label": "Build name",
          oninput: function () { S.name = this.value; save(); }, onchange: function () { commit(); } }),
        h("button", { class: "pl-sub pl-linkish", title: "Class, level and specialisation", onclick: function () { tab = "character"; render(); } },
          "Level " + S.level + " " + (I.ancestries[S.anc] || {}).name + " " + cls.name + (S.trial && S.spec ? " · " + I.specs[S.spec].name : ""))),
      h("div", { class: "pl-head-stats" },
        hs("Life", num(d.life), "life", "Maximum life", "life"),
        hs(d.ward > 0 ? "Mana · Ward" : "Mana", num(d.mana) + (d.ward > 0 ? " · " + num(d.ward) : ""), "mana", "Maximum mana" + (d.ward > 0 ? " and ward" : ""), "mana"),
        hs("DPS", m.dps > 0 ? num1(m.dps) : "–", "dps", m.dpsName ? m.dpsName + ", your strongest socketed skill" : "Socket a skill glyph to see its damage", m.dps > 0 ? "dps" : null),
        hs("Points", used + "/" + total, used > total ? "bad" : "pts", "Passive points taken, of what level " + S.level + " and " + S.qp + " quest points give")),
      h("div", { class: "pl-head-side" },
        h("div", { class: "pl-rules" },
          h("div", { class: "pl-seg sm", role: "group", "aria-label": "Which rules apply" },
            h("button", { class: S.free ? "" : "on", "aria-pressed": S.free ? "false" : "true", title: "Only what the game allows: property tiers and sockets by item level, glyphs and runes by socket colour.", onclick: function () { setFree(false); } }, "Game rules"),
            h("button", { class: S.free ? "on" : "", "aria-pressed": S.free ? "true" : "false", title: "Try what the game wouldn't allow: tiers and sockets past the item level, and any glyph in any socket.", onclick: function () { setFree(true); } }, "Hypothetical")),
          h("button", { class: "pl-legal " + (n ? "warn" : "ok"), onclick: showIssues, title: n ? "See what the game wouldn't allow" : "Everything here can be made in the game" },
            n ? n + (n === 1 ? " rule break" : " rule breaks") : "Valid in game")),
        h("div", { class: "pl-head-actions" },
          h("button", { class: "pl-iconbtn", title: "Undo (Ctrl+Z)", "aria-label": "Undo", disabled: !undoStack.length, onclick: undo }, svgIcon("undo")),
          h("button", { class: "pl-iconbtn", title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo", disabled: !redoStack.length, onclick: redo }, svgIcon("redo")),
          h("button", { class: "pl-iconbtn", title: "Copy a link to this build", "aria-label": "Copy share link", onclick: copyLink }, svgIcon("share")),
          h("button", { class: "pl-iconbtn gold", title: "Start a new build", "aria-label": "New build", onclick: function () {
            if (confirm("Start a new build? You can undo it.")) { S = freshBuild(S.cls); openSlot = "main_hand"; changed(); } } }, svgIcon("plus")))));
  }
  function setFree(v) {
    if (!!S.free === v) return;
    S.free = v;
    if (!v) {
      var fixed = 0;
      Object.keys(S.eq).forEach(function (slot) { var it = S.eq[slot]; if (!it) return; var before = JSON.stringify(it); fitAffixes(it); if (JSON.stringify(it) !== before) fixed++; });
      flash(fixed ? "Game rules: " + fixed + " piece" + (fixed === 1 ? "" : "s") + " brought back to what its item level allows." : "Game rules: only what the game allows.");
    } else flash("Hypothetical: tiers and sockets past the item level, and any glyph in any socket. The badge counts what the game wouldn't allow.");
    changed();
  }
  function showIssues() {
    openSecs.issues = true; saveUi();
    if (window.matchMedia && window.matchMedia("(max-width: 1279px)").matches) tab = "sheet";
    render();
    var el = app.querySelector(tab === "sheet" ? ".pl-main .pl-issues" : ".pl-right .pl-issues");
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function about() {
    return h("details", { class: "pl-about" }, h("summary", null, "About the planner"),
      h("p", null, "Pick your class and level, put gear on and roll its properties, socket glyphs and link runes, and take passives. The sheet is what the game's own character window would show. The numbers come from the game's code for version " + D.version + ", checked against the game itself. A link holds the whole build, so you can share it."),
      h("p", null, "Game rules keeps to what can really be made: property tiers and sockets follow the item level, and a glyph or rune only goes in a socket of its colour or white. Hypothetical lifts those limits so you can try ideas; the badge at the top counts what the game wouldn't allow."),
      h("p", null, "Every edit can be undone (Ctrl+Z) and redone (Ctrl+Shift+Z). Click any number on the sheet to see where it comes from."));
  }

  // ---------------------------------------------------------------- warnings: what the game wouldn't allow
  function warnings(c, sheet, d) {
    var out = [];
    SLOTS.forEach(function (sl) {
      var it = S.eq[sl[0]]; if (!it) return;
      var b = E.base(it), name = itemName(it);
      if (!E.meets(it, S.level, sheet.attrs)) {
        var req = E.requirements(it), need = [];
        if (S.level < (req.level || 1)) need.push("level " + req.level);
        ["str", "dex", "int"].forEach(function (a) { if ((req[a] || 0) > sheet.attrs[a]) need.push(req[a] + " " + cap(a) + " (have " + Math.floor(sheet.attrs[a]) + ")"); });
        out.push([sl[0], name + " needs " + need.join(", ") + "; the game won't let you put it on."]);
      }
      it.prefixes.concat(it.suffixes).forEach(function (e) {
        var a = I.affixes[e.id], t = a.tiers[e.tier];
        if (t.ilvl > it.ilvl) out.push([sl[0], name + ": tier " + (a.tiers.length - e.tier) + " " + affixShort(a) + " needs item level " + t.ilvl + " (this is " + it.ilvl + ")."]);
      });
      var capN = E.maxSocketsFor(b, it.ilvl);
      if (it.sockets.length > capN) out.push([sl[0], name + " has " + it.sockets.length + " sockets; at item level " + it.ilvl + " it can have " + capN + "."]);
      it.gems.forEach(function (g, i) {
        if (!g) return;
        var gname = (I.skills[g.gem] || I.supports[g.gem]).name;
        if (!E.gemFits(g, it.sockets[i].c)) out.push([sl[0], gname + " is in a " + COLOUR_NAME[it.sockets[i].c].split(" ")[0] + " socket of " + name + "; it needs " + COLOUR_NAME[ATTR_COLOUR[E.gemAttr(g)]].split(" ")[0] + " or white."]);
        var lr = E.requirements(g).level || 1;
        if (S.level < lr) out.push([sl[0], gname + " at level " + g.level + " needs a hero of level " + lr + " to socket."]);
      });
    });
    var mh = S.eq.main_hand, oh = S.eq.off_hand;
    if (oh) {
      var ob = E.base(oh);
      if (mh && (E.base(mh).hands || 1) === 2 && ob.class !== "quiver") out.push(["off_hand", "Your main hand weapon needs both hands, so nothing but a quiver goes in the off hand."]);
      if (ob.class === "quiver" && !(mh && ["crossbow", "hand_crossbow"].indexOf(E.base(mh).class) >= 0)) out.push(["off_hand", "A quiver needs a crossbow in the main hand."]);
    }
    if (d.passive_points < 0) out.push(["passives", "The passive web holds " + (-d.passive_points) + " more point" + (d.passive_points === -1 ? "" : "s") + " than a hero of level " + S.level + " has" + (S.qp < QUEST_POINTS ? " (quest points: " + S.qp + " of " + QUEST_POINTS + ")" : "") + "."]);
    return out;
  }

  // ---------------------------------------------------------------- items
  function slotLabel(slot) { return SLOTS.find(function (s) { return s[0] === slot; })[1]; }
  function itemName(it) {
    var b = E.base(it);
    if (it.rarity === 1) {
      var n = b.name;
      it.prefixes.forEach(function (e) { n = I.affixes[e.id].tiers[e.tier].name + " " + n; });
      it.suffixes.forEach(function (e) { n = n + " " + I.affixes[e.id].tiers[e.tier].name; });
      return n;
    }
    if (it.unique) return I.uniques[it.unique].name;
    if (it.set && it.name) return it.name;
    return b.name;
  }
  function tooltip(it, sheet) {
    var b = E.base(it), box = h("div", { class: "pl-tip" });
    box.appendChild(h("div", { class: "pl-tip-name " + RCLS[it.rarity] }, it.rarity === 2 ? (it.name || "Rare " + b.name) : itemName(it)));
    if (it.rarity >= 2) box.appendChild(h("div", { class: "pl-tip-base " + RCLS[it.rarity] }, b.name));
    box.appendChild(h("div", { class: "pl-tip-class" }, classLabel(b.class) + (it.quality ? "   Quality +" + it.quality + "%" : "")));
    var ws = E.weaponStats(it);
    if (ws) {
      Object.keys(ws.damage).forEach(function (t) { box.appendChild(h("div", { class: "pl-tip-prop" }, cap(t) + " Damage: " + Math.trunc(ws.damage[t][0]) + "-" + Math.trunc(ws.damage[t][1]))); });
      box.appendChild(h("div", { class: "pl-tip-prop" }, "Attacks per Second: " + ws.aps.toFixed(2) + "   Critical: " + ws.crit.toFixed(2) + "%"));
      box.appendChild(h("div", { class: "pl-tip-dps" }, "DPS: " + E.itemDps(it).toFixed(1)));
    }
    var ds = E.defenseStats(it);
    Object.keys(ds).forEach(function (k) { box.appendChild(h("div", { class: "pl-tip-prop" }, (k === "armor" ? "Armour" : cap(k)) + ": " + Math.trunc(ds[k]))); });
    if (it.sockets.length) {
      var ss = h("div", { class: "pl-tip-socks" }, "Sockets: ");
      it.sockets.forEach(function (s, i) { if (i > 0) ss.appendChild(h("span", { class: "pl-link" + (s.g === it.sockets[i - 1].g ? " on" : "") })); ss.appendChild(h("span", { class: "pl-sock s-" + s.c })); });
      box.appendChild(ss);
    }
    var req = E.requirements(it), parts = ["Level " + (req.level || 1)];
    ["str", "dex", "int"].forEach(function (a) { if (req[a] > 0) parts.push(req[a] + " " + cap(a)); });
    var ok = sheet ? E.meets(it, S.level, sheet.attrs) : true;
    box.appendChild(h("div", { class: "pl-tip-req" + (ok ? "" : " bad") }, it.starter ? "Starting gear: no requirements" : "Requires " + parts.join(", ")));
    var imp = (b.implicit || []).map(function (md) { return E.fromDict(md); });
    E.describeAll(imp).forEach(function (t) { box.appendChild(h("div", { class: "pl-tip-imp" }, t)); });
    if (imp.length) box.appendChild(h("div", { class: "pl-tip-sep" }));
    it.prefixes.concat(it.suffixes).forEach(function (e) {
      var a = I.affixes[e.id];
      E.describeAll(E.affixMods(e, "")).forEach(function (t) { box.appendChild(h("div", { class: "pl-tip-mod" }, t, h("span", { class: "pl-tier" }, "  T" + (a.tiers.length - e.tier) + " " + a.type[0].toUpperCase()))); });
    });
    if (it.unique) {
      var u = I.uniques[it.unique];
      E.describeAll(u.mods.map(function (md, i) { var x = Object.assign({}, md); if (i < (it.unique_rolls || []).length) x.value = it.unique_rolls[i]; return E.fromDict(x); }))
        .forEach(function (t) { box.appendChild(h("div", { class: "pl-tip-mod r-unique" }, t)); });
      (u.flag_text || []).forEach(function (t) { box.appendChild(h("div", { class: "pl-tip-flag" }, t)); });
      if (u.lore) box.appendChild(h("div", { class: "pl-tip-lore" }, u.lore));
    }
    if (it.set) {
      var st = I.sets[it.set];
      box.appendChild(h("div", { class: "pl-tip-set" }, st.name));
      var have = sheet ? (sheet.set_counts[it.set] || 0) : 0;
      Object.keys(st.bonuses).forEach(function (k) { st.bonuses[k].forEach(function (md) { box.appendChild(h("div", { class: "pl-tip-setb" + (have >= (k | 0) ? " on" : "") }, "(" + k + ") " + E.describe(E.fromDict(md)))); }); });
    }
    if (it.crafted) it.crafted.mods.forEach(function (md) { box.appendChild(h("div", { class: "pl-tip-craft" }, E.describe(E.fromDict(md)) + "  (imbued)")); });
    if (it.woven) it.woven.mods.forEach(function (md) { box.appendChild(h("div", { class: "pl-tip-woven" }, E.describe(E.fromDict(md)) + "  (woven)")); });
    (it.corrupt_mods || []).forEach(function (md) { box.appendChild(h("div", { class: "pl-tip-corrupt" }, E.describe(E.fromDict(md)))); });
    if (it.corrupted) box.appendChild(h("div", { class: "pl-tip-corrupted" }, "Corrupted"));
    return box;
  }
  // starting gear is item level 1; once it is changed it is a found piece, so it takes the best item level
  function unstarter(it) { if (it.starter) { delete it.starter; it.ilvl = MAX_ILVL; } }
  function rollStep(md) { var lo = +md.min, hi = +md.max; return (hi - lo < 3 && hi < 5) ? 0.1 : 1; }
  function bestTier(a, ilvl) { var t = 0; a.tiers.forEach(function (x, i) { if (x.ilvl <= ilvl) t = i; }); return t; }
  function tierRolls(tier) { return tier.mods.map(function (md) { return +md.max; }); }
  function canRoll(a, it) { return E.affixWeight(a, E.itemTags(it)) > 0 && (S.free || a.tiers[0].ilvl <= it.ilvl); }
  function socketCap(it) { var b = E.base(it); return S.free ? (b.max_sockets || 0) : E.maxSocketsFor(b, it.ilvl); }
  function fitAffixes(it) {
    // keep what can still roll on the piece; under the game's rules, tiers and sockets follow its item level
    var mx = it.rarity === 4 ? 1 : E.maxAffixes(it.rarity);
    ["prefixes", "suffixes"].forEach(function (k) {
      it[k] = it[k].filter(function (e) { return I.affixes[e.id] && canRoll(I.affixes[e.id], it); }).slice(0, mx);
      if (!S.free) it[k].forEach(function (e) { var a = I.affixes[e.id]; if (a.tiers[e.tier].ilvl > it.ilvl) { e.tier = bestTier(a, it.ilvl); e.rolls = tierRolls(a.tiers[e.tier]); } });
    });
    var ms = socketCap(it);
    if (it.sockets.length > ms) { it.sockets.length = ms; it.gems.length = ms; }
    var tags = E.itemTags(it);
    if (it.crafted && !I.imbues[it.crafted.id].tags.some(function (t) { return tags.indexOf(t) >= 0; })) delete it.crafted;
    if (it.woven && !I.weaves[it.woven.id].tags.some(function (t) { return tags.indexOf(t) >= 0; })) delete it.woven;
    if (!hasQuality(it)) it.quality = 0;
  }
  function hasQuality(it) { var t = E.base(it).tags || []; return t.indexOf("weapon") >= 0 || t.indexOf("armour") >= 0; }
  // a property's text with its range in place of the number: "+96–131 Evasion Rating"
  function rangeText(tier) {
    var t = E.describeAll(tier.mods.map(function (md, i) { return E.fromDict({ stat: md.stat, kind: md.kind, value: 987651 + i, tags: md.tags }); })).join(", ");
    tier.mods.forEach(function (md, i) { t = t.replace(String(987651 + i), +md.min === +md.max ? String(+md.max) : md.min + "–" + md.max); });
    return t;
  }
  function propText(tier, rolls) { return E.describeAll(tier.mods.map(function (md, i) { return E.fromDict({ stat: md.stat, kind: md.kind, value: i < rolls.length ? rolls[i] : +md.max, tags: md.tags }); })).join(", "); }
  function affixShort(a) { return rangeText(a.tiers[a.tiers.length - 1]).replace(/^[+]?[\d.–]+%?\s*/, "").replace(/^Adds [\d.–]+ to [\d.–]+ /, ""); }

  // ---------------------------------------------------------------- equipment (left)
  var findQuery = "", findList = null;
  function equipment(ctx) {
    var card = h("section", { class: "pl-card pl-equip" }, h("h2", { class: "pl-ptitle" }, "Equipment"));
    card.appendChild(finder());
    var doll = h("div", { class: "pl-doll" });
    SLOTS.forEach(function (sl) {
      var it = S.eq[sl[0]], warn = ctx.warn.some(function (w) { return w[0] === sl[0]; });
      doll.appendChild(h("button", { class: "pl-slot" + (openSlot === sl[0] ? " on" : "") + (warn ? " warn" : ""), "aria-current": openSlot === sl[0] ? "true" : null,
        onclick: function () { openSlot = sl[0]; tab = "gear"; picker = null; render(); } },
        it ? icon(it.base) : h("span", { class: "pl-ico pl-empty-ico" }),
        h("span", { class: "pl-slot-txt" }, h("span", { class: "pl-slot-name" }, sl[1]),
          it ? h("span", { class: "pl-slot-item " + RCLS[it.rarity] }, itemName(it)) : h("span", { class: "pl-slot-item muted" }, "Empty"),
          it ? h("span", { class: "pl-slot-meta" }, (it.starter ? "Starting gear" : RARITY[it.rarity] + " · item level " + it.ilvl),
            it.sockets.length ? h("span", { class: "pl-slot-socks" }, it.sockets.map(function (s, i) { return [i > 0 ? h("span", { class: "pl-link" + (s.g === it.sockets[i - 1].g ? " on" : "") }) : null, h("span", { class: "pl-sock s-" + s.c + (it.gems[i] ? " full" : "") })]; })) : null) : null)));
    });
    card.appendChild(doll);
    return card;
  }
  function findAll() {
    if (findList) return findList;
    findList = [];
    D.bases.forEach(function (b) { if ((b.tags || []).indexOf("cosmetic") < 0) findList.push({ kind: "base", name: b.name, base: b.id, sub: classLabel(b.class) + ", level " + b.level, cls: "r-normal" }); });
    D.uniques.forEach(function (u) { if (I.bases[u.base]) findList.push({ kind: "unique", id: u.id, name: u.name, base: u.base, sub: "Unique " + I.bases[u.base].name, cls: "r-unique" }); });
    D.sets.forEach(function (st) { st.pieces.forEach(function (p) { if (I.bases[p.base]) findList.push({ kind: "set", id: st.id, name: p.name, base: p.base, sub: "Set piece of " + st.name, extra: st.name, cls: "r-set" }); }); });
    return findList;
  }
  function slotsFor(baseId) { return SLOTS.map(function (s) { return s[0]; }).filter(function (sl) { return basesFor(sl).some(function (b) { return b.id === baseId; }); }); }
  function finder() {
    var list = h("div", { class: "pl-find-list", role: "listbox" });
    function show() {
      list.textContent = "";
      var q = findQuery.trim().toLowerCase();
      if (q.length < 2) return;
      var hits = findAll().filter(function (e) { return e.name.toLowerCase().indexOf(q) >= 0 || (e.extra || "").toLowerCase().indexOf(q) >= 0; });
      hits.sort(function (a, b) { return (a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) - (b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1) || a.name.localeCompare(b.name); });
      if (!hits.length) { list.appendChild(h("p", { class: "pl-note" }, "Nothing by that name.")); return; }
      hits.slice(0, 12).forEach(function (e) {
        list.appendChild(h("button", { class: "pl-find-hit", role: "option", onclick: function () { wear(e); } },
          icon(e.base), h("span", null, h("span", { class: "pl-find-name " + e.cls }, e.name), h("span", { class: "pl-find-sub" }, e.sub))));
      });
      if (hits.length > 12) list.appendChild(h("p", { class: "pl-note" }, (hits.length - 12) + " more: keep typing to narrow it down."));
    }
    function wear(e) {
      var sl = slotsFor(e.base);
      if (!sl.length) { flash("That doesn't go in any slot."); return; }
      var slot = sl.indexOf(openSlot) >= 0 ? openSlot : (sl.find(function (x) { return !S.eq[x]; }) || sl[0]);
      var it = newItem(e.base, MAX_ILVL), was = S.eq[slot];
      if (was) { it.sockets = was.sockets; it.gems = was.gems; } // the sockets and what's in them move to the new piece
      if (e.kind === "unique") setUnique(it, e.id);
      else if (e.kind === "set") setSetPiece(it, e.id, e.base);
      else it.rarity = 2;
      S.eq[slot] = it; openSlot = slot; tab = "gear"; findQuery = ""; fitAffixes(it); changed();
    }
    var inp = h("input", { type: "search", class: "pl-find-in", placeholder: "Find an item: base, unique or set piece", value: findQuery, "aria-label": "Find an item",
      oninput: function () { findQuery = this.value; show(); } });
    show();
    return h("div", { class: "pl-find" }, inp, list);
  }

  // ---------------------------------------------------------------- the item editor (centre)
  function itemEditor(slot, ctx) {
    var it = S.eq[slot], label = slotLabel(slot);
    var box = h("section", { class: "pl-card pl-editor" });
    box.appendChild(h("div", { class: "pl-card-head" },
      h("div", { class: "pl-ed-title" }, h("div", { class: "pl-kicker" }, "Item editor · " + label),
        h("h2", { class: "pl-ed-name " + (it ? RCLS[it.rarity] : "muted") }, it ? (it.rarity === 2 ? (it.name || "Rare " + E.base(it).name) : itemName(it)) : "Nothing worn")),
      it ? h("button", { class: "pl-mini", onclick: function () { delete S.eq[slot]; changed(); } }, "Take off") : null));
    var mode = !it ? "" : it.unique ? "unique" : it.set ? "set" : "base";
    box.appendChild(h("div", { class: "pl-seg" }, [["base", "Base item"], ["unique", "Unique"], ["set", "Set piece"]].map(function (k) {
      return h("button", { class: mode === k[0] ? "on" : "", onclick: function () { setMode(slot, k[0]); } }, k[1]);
    })));
    if (!it) { box.appendChild(h("p", { class: "muted" }, "Nothing worn here. Pick what kind of piece to put on, or find one by name.")); return box; }
    var grid = h("div", { class: "pl-fields" });
    if (mode === "base") {
      var groups = {};
      basesFor(slot).forEach(function (x) { var g = classLabel(x.class); (groups[g] || (groups[g] = [])).push([x.id, x.name + " (level " + x.level + ")"]); });
      grid.appendChild(field("Base", select(Object.keys(groups).map(function (g) { return { group: g, items: groups[g] }; }), it.base, function (v) { it.base = v; unstarter(it); fitAffixes(it); changed(); })));
      grid.appendChild(field("Rarity", select([[0, "Normal"], [1, "Magic"], [2, "Rare"]], it.rarity, function (v) { it.rarity = v | 0; unstarter(it); fitAffixes(it); changed(); }),
        it.rarity === 0 ? "Normal: no properties" : it.rarity === 1 ? "Magic: 1 prefix, 1 suffix" : "Rare: 3 prefixes, 3 suffixes"));
    } else if (mode === "unique") {
      var us = D.uniques.filter(function (u) { return basesFor(slot).some(function (x) { return x.id === u.base; }); });
      grid.appendChild(field("Unique", select(us.map(function (u) { return [u.id, u.name + " (" + I.bases[u.base].name + ")"]; }), it.unique, function (v) { setUnique(it, v); changed(); })));
    } else {
      var pcs = [];
      D.sets.forEach(function (st) { st.pieces.forEach(function (p) { if (basesFor(slot).some(function (x) { return x.id === p.base; })) pcs.push([st.id + "|" + p.base, p.name + " (" + st.name + ")"]); }); });
      grid.appendChild(field("Set piece", select(pcs, it.set + "|" + it.base, function (v) { var p = v.split("|"); setSetPiece(it, p[0], p[1]); changed(); })));
    }
    var il = h("input", { id: "pl-ilvl", type: "number", min: "1", max: String(MAX_ILVL), value: it.ilvl, "aria-describedby": "pl-ilvl-hint",
      onchange: function () { setIlvl(it, Math.max(1, Math.min(MAX_ILVL, this.value | 0))); } });
    var ilf = field("Item level", il);
    ilf.appendChild(h("small", { id: "pl-ilvl-hint", class: "pl-hint" + (ilvlMsg && ilvlMsg.uid === it.uid ? " news" : "") }, ilvlMsg && ilvlMsg.uid === it.uid ? ilvlMsg.text : ilvlHint(it)));
    grid.appendChild(ilf);
    if (hasQuality(it)) grid.appendChild(field("Quality", select([0, 5, 10, 15, 20].map(function (q) { return [q, q ? "+" + q + "%" : "None"]; }), it.quality, function (v) { it.quality = v | 0; changed(); }),
      E.base(it).phys ? "Raises its physical damage" : "Raises its armour, evasion and ward"));
    box.appendChild(grid);
    if (it.unique) box.appendChild(uniqueCard(it));
    else box.appendChild(propsCard(it));
    box.appendChild(socketEditor(it, slot, ctx));
    box.appendChild(craftingCard(it));
    var warns = ctx.warn.filter(function (w) { return w[0] === slot; });
    if (warns.length) box.appendChild(h("ul", { class: "pl-warns" }, warns.map(function (w) { return h("li", null, w[1]); })));
    box.appendChild(h("div", { class: "pl-sec" }, h("h4", null, "How it looks in the game"), h("div", { class: "pl-tipwrap" }, tooltip(it, ctx.sheet))));
    return box;
  }
  // what the item level allows here, and the next thing it would unlock
  function ilvlHint(it) {
    var b = E.base(it), parts = [];
    if (b.max_sockets) {
      var capN = E.maxSocketsFor(b, it.ilvl), next = [10, 25, 35, 50].filter(function (t) { return t > it.ilvl && E.maxSocketsFor(b, t) > capN; })[0];
      parts.push("Up to " + capN + " socket" + (capN === 1 ? "" : "s") + (next ? " (" + E.maxSocketsFor(b, next) + " from item level " + next + ")" : ""));
    }
    var locked = [];
    it.prefixes.concat(it.suffixes).forEach(function (e) {
      var a = I.affixes[e.id], nt = a.tiers.findIndex(function (t) { return t.ilvl > it.ilvl; });
      if (nt > e.tier) locked.push("T" + (a.tiers.length - nt) + " " + affixShort(a) + " at " + a.tiers[nt].ilvl);
    });
    if (locked.length) parts.push("better tiers: " + locked.slice(0, 2).join(", "));
    else if (!it.prefixes.length && !it.suffixes.length && it.rarity > 0 && it.rarity !== 3) parts.push("the best property tiers need item level " + TOP_ILVL);
    return parts.join(" · ") || "Sets which property tiers can roll and how many sockets it can have";
  }
  var TOP_ILVL = 60;
  function setIlvl(it, lv) {
    var old = it.ilvl, b = E.base(it), before = it.prefixes.concat(it.suffixes).map(function (e) { return { id: e.id, tier: e.tier, best: bestTier(I.affixes[e.id], old) }; }), socks = it.sockets.length;
    it.ilvl = lv; unstarter(it); it.ilvl = lv; fitAffixes(it);
    var notes = [], capA = E.maxSocketsFor(b, old), capB = E.maxSocketsFor(b, lv);
    if (b.max_sockets && capB !== capA) notes.push(capB > capA ? "now up to " + capB + " sockets" : "sockets capped at " + capB + (it.sockets.length < socks ? " (" + (socks - it.sockets.length) + " taken off)" : ""));
    before.forEach(function (x) {
      var a = I.affixes[x.id], nb = bestTier(a, lv), e = it.prefixes.concat(it.suffixes).find(function (y) { return y.id === x.id; });
      if (nb > x.best) notes.push("T" + (a.tiers.length - nb) + " " + affixShort(a) + " unlocked");
      else if (e && e.tier < x.tier) notes.push(affixShort(a) + " down to T" + (a.tiers.length - e.tier));
      else if (!e) notes.push(affixShort(a) + " can't roll this low, so it came off");
    });
    ilvlMsg = { uid: it.uid, text: "Item level " + lv + ": " + (notes.length ? notes.join("; ") : "nothing changes for this piece") + "." };
    changed();
  }
  function setMode(slot, mode) {
    var it = S.eq[slot], ilvl = it && !it.starter ? it.ilvl : MAX_ILVL;
    var keepSocks = it ? { s: it.sockets, g: it.gems } : null;
    if (mode === "base") {
      var bs = basesFor(slot), cur = it && bs.some(function (x) { return x.id === it.base; }) ? it.base : bs[bs.length - 1].id;
      it = newItem(cur, ilvl); it.rarity = 2;
    } else if (mode === "unique") {
      var us = D.uniques.filter(function (u) { return basesFor(slot).some(function (x) { return x.id === u.base; }); });
      if (!us.length) { flash("No unique goes in this slot."); return; }
      it = newItem(us[0].base, ilvl); setUnique(it, us[0].id);
    } else {
      var found = null;
      D.sets.some(function (st) { return st.pieces.some(function (p) { if (basesFor(slot).some(function (x) { return x.id === p.base; })) { found = [st.id, p.base]; return true; } return false; }); });
      if (!found) { flash("No set piece goes in this slot."); return; }
      it = newItem(found[1], ilvl); setSetPiece(it, found[0], found[1]);
    }
    if (keepSocks) { it.sockets = keepSocks.s; it.gems = keepSocks.g; }
    S.eq[slot] = it; fitAffixes(it); changed();
  }
  function setUnique(it, id) {
    var u = I.uniques[id];
    it.base = u.base; it.rarity = 3; it.unique = id; it.name = u.name; it.prefixes = []; it.suffixes = []; delete it.set; unstarter(it);
    it.unique_rolls = u.mods.map(function (md) { return +md.value; });
    fitAffixes(it);
  }
  function setSetPiece(it, sid, baseId) {
    var st = I.sets[sid], p = st.pieces.find(function (x) { return x.base === baseId; });
    it.base = baseId; it.rarity = 4; it.set = sid; it.name = p.name; delete it.unique; delete it.unique_rolls; unstarter(it);
    fitAffixes(it);
  }

  // ---- properties: a compact row each; choosing one is apart from tuning it
  function propsCard(it) {
    var mx = it.rarity === 4 ? 1 : E.maxAffixes(it.rarity), box = h("div", { class: "pl-sec pl-props" });
    var have = it.prefixes.length + it.suffixes.length;
    box.appendChild(h("div", { class: "pl-sec-head" }, h("h4", null, "Properties"), mx ? h("span", { class: "pl-sec-count" }, have + " of " + mx * 2) : null));
    if (!mx) { box.appendChild(h("p", { class: "pl-note" }, "A normal item has no properties. Make it magic (one prefix and one suffix) or rare (three of each).")); return box; }
    if (it.rarity === 4) box.appendChild(h("p", { class: "pl-note" }, "A set piece drops as a magic item, so it can carry one prefix and one suffix."));
    ["prefixes", "suffixes"].forEach(function (k) { it[k].forEach(function (e, i) { box.appendChild(propRow(it, k, i)); }); });
    var adds = h("div", { class: "pl-adds" });
    [["prefixes", "prefix"], ["suffixes", "suffix"]].forEach(function (p) {
      var full = it[p[0]].length >= mx, open = picker && picker.uid === it.uid && picker.type === p[1];
      adds.appendChild(h("button", { class: "pl-add" + (open ? " on" : ""), disabled: full, "aria-expanded": open ? "true" : "false",
        title: full ? (RARITY[it.rarity] + " items carry " + mx + " " + p[1] + (mx === 1 ? "" : "es")) : "",
        onclick: function () { picker = open ? null : { uid: it.uid, type: p[1], q: "" }; render(); } },
        full ? "All " + p[1] + (mx === 1 ? "" : "es") + " taken" : "+ Add " + p[1]));
    });
    box.appendChild(adds);
    if (picker && picker.uid === it.uid) box.appendChild(pickerPanel(it, picker.type));
    return box;
  }
  function pickerPanel(it, type) {
    var k = type === "prefix" ? "prefixes" : "suffixes", tags = E.itemTags(it);
    var used = it.prefixes.concat(it.suffixes).map(function (x) { return I.affixes[x.id].group || x.id; });
    var rows = D.affixes.filter(function (a) { return a.type === type; }).map(function (a) {
      var why = "";
      if (E.affixWeight(a, tags) <= 0) why = "doesn't roll on " + classLabel(E.base(it).class).split(" · ")[0].toLowerCase();
      else if (!S.free && a.tiers[0].ilvl > it.ilvl) why = "needs item level " + a.tiers[0].ilvl;
      else if (used.indexOf(a.group || a.id) >= 0) why = "already has one of these";
      var t = S.free ? a.tiers.length - 1 : bestTier(a, it.ilvl);
      return { a: a, why: why, t: t, text: rangeText(a.tiers[t]) };
    });
    rows.sort(function (x, y) { return (x.why ? 1 : 0) - (y.why ? 1 : 0) || x.text.replace(/[^A-Za-z ]/g, "").trim().localeCompare(y.text.replace(/[^A-Za-z ]/g, "").trim()); });
    var list = h("div", { class: "pl-pick-list", role: "listbox", "aria-label": "Choose a " + type });
    function show() {
      list.textContent = "";
      var q = (picker.q || "").toLowerCase();
      rows.filter(function (r) { return !q || r.text.toLowerCase().indexOf(q) >= 0; }).forEach(function (r) {
        var a = r.a;
        list.appendChild(h("button", { class: "pl-pick" + (r.why ? " off" : ""), role: "option", disabled: !!r.why, title: r.why ? "Can't: " + r.why : "",
          onclick: function () { it[k].push({ id: a.id, tier: r.t, rolls: tierRolls(a.tiers[r.t]) }); picker = null; openProp = null; changed(); } },
          h("span", { class: "pl-pick-text" }, r.text), h("span", { class: "pl-pick-sub" }, r.why ? r.why : "T" + (a.tiers.length - r.t) + " here · " + a.tiers[r.t].name)));
      });
    }
    var inp = h("input", { type: "search", class: "pl-pick-in", placeholder: "Filter " + type + "es (life, fire, speed…)", value: picker.q || "", "aria-label": "Filter " + type + "es",
      oninput: function () { picker.q = this.value; show(); } });
    show();
    setTimeout(function () { if (inp.isConnected) inp.focus({ preventScroll: true }); }, 0);
    return h("div", { class: "pl-picker" }, h("div", { class: "pl-picker-head" }, h("b", null, "Add a " + type), inp,
      h("button", { class: "pl-iconbtn sm", "aria-label": "Close", onclick: function () { picker = null; render(); } }, svgIcon("x"))), list,
      h("p", { class: "pl-note" }, "Each shows the best tier it can roll at item level " + it.ilvl + (S.free ? " (hypothetical: any tier)" : "") + ". Greyed out: why it can't go on this piece."));
  }
  function propRow(it, k, i) {
    var e = it[k][i], a = I.affixes[e.id], tier = a.tiers[e.tier], key = it.uid + ":" + k + ":" + i, open = openProp === key, tn = a.tiers.length - e.tier;
    var beyond = tier.ilvl > it.ilvl;
    var row = h("div", { class: "pl-prop" + (open ? " open" : "") + (beyond ? " beyond" : "") });
    function toggle() { openProp = open ? null : key; render(); }
    var text = h("span", { class: "pl-prop-text" }, propText(tier, e.rolls));
    row.appendChild(h("div", { class: "pl-prop-head" },
      h("span", { class: "pl-prop-kind", title: k === "prefixes" ? "Prefix" : "Suffix" }, k === "prefixes" ? "P" : "S"), text,
      h("button", { class: "pl-chip" + (beyond ? " bad" : ""), title: "Tier " + tn + " of " + a.tiers.length + " (" + tier.name + "), from item level " + tier.ilvl + (beyond ? ": past this item's level" : "") + ". Click for tiers.", onclick: toggle }, "T" + tn),
      h("button", { class: "pl-iconbtn sm" + (open ? " flip" : ""), "aria-expanded": open ? "true" : "false", "aria-label": open ? "Hide tiers" : "Tiers and roll options", title: open ? "Hide tiers" : "Tiers and roll options", onclick: toggle }, svgIcon("chev")),
      h("button", { class: "pl-iconbtn sm", "aria-label": "Remove this property", title: "Remove", onclick: function () { it[k].splice(i, 1); openProp = null; changed(); } }, svgIcon("x"))));
    var multi = tier.mods.filter(function (md) { return +md.min !== +md.max; }).length > 1;
    tier.mods.forEach(function (md, mi) {
      if (+md.min === +md.max) return;
      var nm = /_min$/.test(md.stat) ? "Low end" : /_max$/.test(md.stat) ? "High end" : multi ? "Roll " + (mi + 1) : "";
      row.appendChild(rollLine(key + ":" + mi, nm, +md.min, +md.max, rollStep(md), mi < e.rolls.length ? e.rolls[mi] : +md.max,
        function (v) { e.rolls[mi] = v; text.textContent = propText(tier, e.rolls); },
        function (v) { typeRoll(it, e, mi, v); }));
    });
    if (open) {
      var adv = h("div", { class: "pl-prop-adv" });
      adv.appendChild(h("div", { class: "pl-tiers", role: "radiogroup", "aria-label": "Tier" }, a.tiers.map(function (t, ti) {
        var lockd = t.ilvl > it.ilvl, n = a.tiers.length - ti;
        return h("button", { class: "pl-tierbtn" + (ti === e.tier ? " on" : "") + (lockd ? " locked" : ""), role: "radio", "aria-checked": ti === e.tier ? "true" : "false",
          disabled: lockd && !S.free, title: lockd ? "Needs item level " + t.ilvl + (S.free ? " (allowed: hypothetical)" : "; raise the item level to roll it") : "",
          onclick: function () { e.tier = ti; e.rolls = tierRolls(t); changed(); } },
          h("b", null, "T" + n), h("span", null, rangeText(t)), h("small", null, lockd ? "item level " + t.ilvl : t.name + " · item level " + t.ilvl));
      })));
      var others = D.affixes.filter(function (x) { return x.type === a.type && x.id !== a.id && canRoll(x, it) && !it.prefixes.concat(it.suffixes).some(function (y) { return y !== e && (I.affixes[y.id].group || y.id) === (x.group || x.id); }); });
      adv.appendChild(h("div", { class: "pl-prop-tools" },
        h("button", { class: "pl-mini", onclick: function () { e.rolls = tierRolls(tier); changed(); } }, "Best roll"),
        h("button", { class: "pl-mini", onclick: function () { e.rolls = tier.mods.map(function (md) { return +md.min; }); changed(); } }, "Worst roll"),
        field("Swap for", select([["", "Another " + a.type + "…"]].concat(others.map(function (x) { return [x.id, rangeText(x.tiers[S.free ? x.tiers.length - 1 : bestTier(x, it.ilvl)])]; })), "", function (v) {
          if (!v) return; var x = I.affixes[v], t = S.free ? x.tiers.length - 1 : bestTier(x, it.ilvl); it[k][i] = { id: v, tier: t, rolls: tierRolls(x.tiers[t]) }; changed(); }))));
      row.appendChild(adv);
    }
    return row;
  }
  // a roll: a slider within its range, and the number to type
  function rollLine(id, label, lo, hi, step, val, onslide, ontype) {
    var num_ = h("input", { id: "pl-r-" + id.replace(/[^A-Za-z0-9_-]/g, "_"), type: "number", class: "pl-num", min: S.free ? null : null, step: String(step), value: String(val), "aria-label": (label || "Roll") + " (" + lo + " to " + hi + ")",
      onchange: function () { var v = parseFloat(this.value); if (isNaN(v)) { this.value = String(val); return; } ontype(v); } });
    var rng = h("input", { type: "range", class: "pl-rng", min: String(lo), max: String(hi), step: String(step), value: String(Math.max(lo, Math.min(hi, val))), "aria-label": (label || "Roll") + " slider",
      oninput: function () { var v = step < 1 ? E.snapped(+this.value, 0.1) : Math.round(+this.value); num_.value = String(v); onslide(v); },
      onchange: function () { changed(); } });
    return h("div", { class: "pl-rollline" }, label ? h("span", { class: "pl-roll-n" }, label) : null, rng, num_, h("span", { class: "pl-range" }, lo + "–" + hi));
  }
  // a typed roll picks the tier that rolls it; under the game's rules only tiers the item level allows
  function typeRoll(it, e, mi, v) {
    var a = I.affixes[e.id], ok = a.tiers.map(function (t, ti) { return ti; }).filter(function (ti) { return S.free || a.tiers[ti].ilvl <= it.ilvl; });
    var md = function (ti) { return a.tiers[ti].mods[mi] || a.tiers[ti].mods[0]; };
    var step = rollStep(md(e.tier)); v = step < 1 ? E.snapped(v, 0.1) : Math.round(v);
    var inTier = function (ti) { var m = md(ti); return v >= +m.min && v <= +m.max; };
    var t = inTier(e.tier) && ok.indexOf(e.tier) >= 0 ? e.tier : ok.filter(inTier).pop();
    if (t == null) {
      var top = ok[ok.length - 1], bottom = ok[0], mTop = md(top), mBot = md(bottom);
      if (v > +mTop.max) { t = top; v = +mTop.max; var locked = a.tiers.findIndex(function (x) { return x.ilvl > it.ilvl; });
        flash("The best roll at item level " + it.ilvl + " is " + v + " (T" + (a.tiers.length - t) + ")" + (locked > t && !S.free ? "; T" + (a.tiers.length - locked) + " needs item level " + a.tiers[locked].ilvl : "") + "."); }
      else if (v < +mBot.min) { t = bottom; v = +mBot.min; flash("The lowest it rolls is " + v + "."); }
      else { t = ok.reduce(function (b, ti) { var m = md(ti), dd = Math.min(Math.abs(v - m.min), Math.abs(v - m.max)); return !b || dd < b[1] ? [ti, dd] : b; }, null)[0]; var m2 = md(t); v = Math.max(+m2.min, Math.min(+m2.max, v)); flash("No tier rolls exactly that; the nearest is " + v + "."); }
    }
    if (t !== e.tier) {
      var nt = a.tiers[t];
      e.rolls = nt.mods.map(function (m, j) { var r = j < e.rolls.length ? e.rolls[j] : +m.max; return Math.max(+m.min, Math.min(+m.max, r)); });
      e.tier = t;
    }
    e.rolls[mi] = v;
    changed();
  }
  function uniqueCard(it) {
    var u = I.uniques[it.unique], box = h("div", { class: "pl-sec pl-props" });
    box.appendChild(h("div", { class: "pl-sec-head" }, h("h4", null, "Rolls"), h("span", { class: "pl-sec-count" }, "±15%")));
    box.appendChild(h("p", { class: "pl-note" }, "A unique's properties roll within 15% either side of their listed value."));
    u.mods.forEach(function (md, i) {
      var v = +md.value, step = Math.abs(v) < 5 ? 0.1 : 1, lo = E.snapped(v * 0.85, step), hi = E.snapped(v * 1.15, step);
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      var cur = i < it.unique_rolls.length ? it.unique_rolls[i] : v;
      var row = h("div", { class: "pl-prop" }), text = h("span", { class: "pl-prop-text r-unique" }, E.describe(E.fromDict(Object.assign({}, md, { value: cur }))));
      row.appendChild(h("div", { class: "pl-prop-head" }, text));
      if (lo !== hi) row.appendChild(rollLine(it.uid + ":u" + i, "", lo, hi, step, cur,
        function (x) { it.unique_rolls[i] = x; text.textContent = E.describe(E.fromDict(Object.assign({}, md, { value: x }))); },
        function (x) { var c = E.snapped(Math.max(lo, Math.min(hi, x)), step); if (Math.abs(c - x) > 1e-9) flash("It rolls " + lo + " to " + hi + ", so " + c + "."); it.unique_rolls[i] = c; changed(); }));
      box.appendChild(row);
    });
    var flags = (u.flag_text || []);
    if (flags.length) box.appendChild(h("div", { class: "pl-note" }, flags.join(" ")));
    return box;
  }
  function craftingCard(it) {
    var tags = E.itemTags(it), cg = h("div", { class: "pl-fields" });
    var ims = D.imbues.filter(function (im) { return im.tags.some(function (t) { return tags.indexOf(t) >= 0; }); });
    cg.appendChild(field("Imbue (Enchanting)", select([["", "None"]].concat(ims.map(function (im) { return [im.id, im.name + ": " + E.describeAll(im.mods.map(function (m) { return E.fromDict(m); })).join(", ") + " (Enchanting " + im.prof + ")"]; })),
      it.crafted ? it.crafted.id : "", function (v) { if (v) it.crafted = { id: v, mods: I.imbues[v].mods }; else delete it.crafted; changed(); })));
    var wvs = D.weaves.filter(function (w) { return w.tags.some(function (t) { return tags.indexOf(t) >= 0; }); });
    cg.appendChild(field("Weave (Warp Thread)", select([["", "None"]].concat(wvs.map(function (w) { return [w.id, w.name + ": " + E.describeAll(w.mods.map(function (m) { return E.fromDict(m); })).join(", ")]; })),
      it.woven ? it.woven.id : "", function (v) { if (v) it.woven = { id: v, mods: I.weaves[v].mods }; else delete it.woven; changed(); })));
    var co = it.corrupt_mods ? D.corrupt.findIndex(function (c) { return JSON.stringify(c) === JSON.stringify(it.corrupt_mods[0]); }) : (it.corrupted ? -1 : -2);
    cg.appendChild(field("Corruption", select([[-2, "Not corrupted"], [-1, "Corrupted, nothing gained"]].concat(D.corrupt.map(function (c, i) { return [i, E.describe(E.fromDict(c))]; })), co,
      function (v) { v = v | 0; if (v === -2) { it.corrupted = false; delete it.corrupt_mods; } else if (v === -1) { it.corrupted = true; delete it.corrupt_mods; } else { it.corrupted = true; it.corrupt_mods = [D.corrupt[v]]; } changed(); })));
    var n = (it.crafted ? 1 : 0) + (it.woven ? 1 : 0) + (it.corrupted ? 1 : 0);
    var det = h("details", { class: "pl-sec pl-craft", open: n > 0 || openSecs.craft ? true : null, ontoggle: function () { openSecs.craft = this.open; saveUi(); } },
      h("summary", null, h("h4", null, "Crafting"), h("span", { class: "pl-sec-count" }, n ? n + " applied" : "imbue, weave, corruption")), cg);
    return det;
  }

  // ---- sockets: a strip to click, link and drag, and what each glyph and rune does there
  function sockKey(it) { return it.uid; }
  function gemData(g) { return I.skills[g.gem] || I.supports[g.gem]; }
  function gemIcon(g, cls) { return icon("glyph_" + g.gem, cls); }
  function colourOf(g) { return ATTR_COLOUR[E.gemAttr(g)] || "w"; }
  function skillAt(ctx, slot, i) { return ctx.skills.find(function (x) { return x.e.slot === slot && x.e.index === i; }); }
  function whyNot(sup, s) {
    var tags = (s && s.tags) || [], kind = (I.skills[s.id] || {}).kind;
    var req = sup.requires || [];
    for (var r = 0; r < req.length; r++) {
      var alts = String(req[r]).split("|");
      if (!alts.some(function (x) { return tags.indexOf(x) >= 0 || kind === x; })) return "only modifies " + alts.join(" or ").replace(/_/g, " ") + " skills";
    }
    var ex = (sup.excludes || []).find(function (x) { return tags.indexOf(x) >= 0 || kind === x; });
    return ex ? "doesn't work on " + ex.replace(/_/g, " ") + " skills" : "";
  }
  function socketEditor(it, slot, ctx) {
    var b = E.base(it), capN = socketCap(it), gameCap = E.maxSocketsFor(b, it.ilvl), n = it.sockets.length;
    var box = h("div", { class: "pl-sec pl-socket-ed" });
    var links = it.sockets.filter(function (s, i) { return i > 0 && s.g === it.sockets[i - 1].g; }).length;
    box.appendChild(h("div", { class: "pl-sec-head" }, h("h4", null, "Sockets"), b.max_sockets ? h("span", { class: "pl-sec-count" }, n + " socket" + (n === 1 ? "" : "s") + " · " + links + " link" + (links === 1 ? "" : "s")) : null));
    if (!b.max_sockets) { box.appendChild(h("p", { class: "pl-note" }, "This piece takes no sockets.")); return box; }
    var why = capN >= b.max_sockets ? "This base takes up to " + b.max_sockets + "." : "Item level " + it.ilvl + " allows " + capN + " of this base's " + b.max_sockets + "; " +
      [10, 25, 35, 50].filter(function (t) { return t > it.ilvl && E.maxSocketsFor(b, t) > capN; }).slice(0, 1).map(function (t) { return E.maxSocketsFor(b, t) + " from item level " + t; })[0] + ".";
    box.appendChild(h("div", { class: "pl-sock-count" },
      h("button", { class: "pl-iconbtn sm", "aria-label": "One socket fewer", disabled: n === 0, onclick: function () { it.sockets.length = n - 1; it.gems.length = n - 1; changed(); } }, "−"),
      h("b", null, String(n)),
      h("button", { class: "pl-iconbtn sm", "aria-label": "One more socket", disabled: n >= capN, title: n >= capN ? why : "",
        onclick: function () { it.sockets.push({ c: ATTR_COLOUR[Object.keys(b.sock_attr || {})[0]] || "w", g: n ? it.sockets[n - 1].g : 0 }); it.gems.push(null); selSock[sockKey(it)] = n; changed(); } }, "+"),
      h("small", { class: "pl-hint" + (n > gameCap ? " bad" : "") }, n > gameCap ? n + " is past what item level " + it.ilvl + " allows (" + gameCap + ")." : why)));
    if (!n) return box;
    var sel = Math.min(selSock[sockKey(it)] || 0, n - 1), sg = it.gems[sel];
    // what the selected socket's gem does to the others in its group
    var rel = {};
    if (sg) it.sockets.forEach(function (s, i) {
      var g = it.gems[i]; if (!g || i === sel || s.g !== it.sockets[sel].g) return;
      if (!sg.support && g.support) { var x = skillAt(ctx, slot, sel); rel[i] = x && x.s && x.s.supports.indexOf(g.gem) >= 0 ? "ok" : "no"; }
      else if (sg.support && !g.support) { var y = skillAt(ctx, slot, i); rel[i] = y && y.s && y.s.supports.indexOf(sg.gem) >= 0 ? "ok" : "no"; }
    });
    var strip = h("div", { class: "pl-sstrip", role: "group", "aria-label": "Sockets: click one to edit it, click between two to link them, drag a glyph to move it" });
    it.sockets.forEach(function (s, i) {
      var g = it.gems[i];
      if (i > 0) {
        var on = s.g === it.sockets[i - 1].g;
        strip.appendChild(h("button", { class: "pl-slink" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", "aria-label": (on ? "Unlink" : "Link") + " sockets " + i + " and " + (i + 1),
          title: on ? "Linked: runes here modify glyphs in the same group. Click to unlink." : "Not linked. Click to link.", onclick: function () { relink(it, i, !on); changed(); } }));
      }
      var fits = !g || E.gemFits(g, s.c);
      var el = h("button", { class: "pl-ssock s-" + s.c + (i === sel ? " sel" : "") + (g ? " full" : "") + (fits ? "" : " misfit") + (rel[i] ? " rel-" + rel[i] : ""),
        draggable: g ? "true" : null, "aria-label": "Socket " + (i + 1) + ", " + COLOUR_NAME[s.c] + (g ? ", " + gemData(g).name : ", empty"), "aria-current": i === sel ? "true" : null,
        title: (g ? gemData(g).name + (g.support ? " (rune)" : " (glyph)") : "Empty") + " · " + COLOUR_NAME[s.c] + " socket" + (fits ? "" : " · wrong colour"),
        onclick: function () { selSock[sockKey(it)] = i; render(); },
        ondragstart: function (ev) { drag = { uid: it.uid, i: i }; try { ev.dataTransfer.setData("text/plain", String(i)); ev.dataTransfer.effectAllowed = "move"; } catch (x) { /* old browsers */ } },
        ondragover: function (ev) { if (drag && drag.uid === it.uid && drag.i !== i) { ev.preventDefault(); this.classList.add("drop"); } },
        ondragleave: function () { this.classList.remove("drop"); },
        ondrop: function (ev) { ev.preventDefault(); if (drag && drag.uid === it.uid) moveGem(it, drag.i, i); drag = null; },
        ondragend: function () { drag = null; } }, g ? gemIcon(g, "pl-sgem") : null);
      strip.appendChild(el);
    });
    box.appendChild(strip);
    box.appendChild(socketPanel(it, slot, ctx, sel));
    box.appendChild(groupSummary(it, slot, ctx));
    return box;
  }
  function moveGem(it, from, to) {
    var a = it.gems[from], b = it.gems[to];
    if (!S.free) {
      var bad = (a && !E.gemFits(a, it.sockets[to].c)) ? [a, to] : (b && !E.gemFits(b, it.sockets[from].c)) ? [b, from] : null;
      if (bad) { flash(gemData(bad[0]).name + " can't go in a " + COLOUR_NAME[it.sockets[bad[1]].c].split(" ")[0] + " socket: it needs " + COLOUR_NAME[colourOf(bad[0])].split(" ")[0] + " or white."); return; }
    }
    it.gems[from] = b; it.gems[to] = a; selSock[sockKey(it)] = to; changed();
  }
  function socketPanel(it, slot, ctx, i) {
    var s = it.sockets[i], g = it.gems[i], p = h("div", { class: "pl-spanel" });
    var cols = h("div", { class: "pl-scolours", role: "radiogroup", "aria-label": "Socket colour" }, ["r", "g", "b", "w"].map(function (c) {
      var lbl = { r: "Str", g: "Dex", b: "Int", w: "Any" }[c];
      return h("button", { class: "pl-scol s-" + c + (s.c === c ? " on" : ""), role: "radio", "aria-checked": s.c === c ? "true" : "false", title: cap(COLOUR_NAME[c]) + " socket",
        onclick: function () { s.c = c; changed(); } }, lbl);
    }));
    p.appendChild(h("div", { class: "pl-spanel-head" }, h("b", null, "Socket " + (i + 1)), cols,
      h("span", { class: "pl-spanel-move" },
        h("button", { class: "pl-iconbtn sm", "aria-label": "Move left", title: "Swap with the socket to the left", disabled: i === 0, onclick: function () { moveGem(it, i, i - 1); } }, svgIcon("left")),
        h("button", { class: "pl-iconbtn sm", "aria-label": "Move right", title: "Swap with the socket to the right", disabled: i >= it.sockets.length - 1, onclick: function () { moveGem(it, i, i + 1); } }, svgIcon("right")))));
    function opt(x, sup) {
      var c = ATTR_COLOUR[sup ? x.sock_attr : x.attr] || "w", fits = s.c === "w" || c === s.c;
      return { v: (sup ? "r:" : "s:") + x.id, t: x.name + " (" + cap(sup ? x.sock_attr : x.attr) + ")" + (fits ? "" : " · needs " + COLOUR_NAME[c].split(" ")[0] + " or white"), off: !fits && !S.free };
    }
    var sel = h("select", { "aria-label": "Socket " + (i + 1) + " holds", onchange: function () {
      var v = this.value;
      if (!v) it.gems[i] = null;
      else { var sup = v[0] === "r", id = v.slice(2); it.gems[i] = gem(id, sup, g ? g.level : Math.max(1, Math.min(20, S.level))); }
      changed(); } });
    sel.appendChild(h("option", { value: "" }, "Empty"));
    [["Skill glyphs", D.skills, false], ["Support runes", D.supports, true]].forEach(function (grp) {
      var og = h("optgroup", { label: grp[0] });
      grp[1].slice().sort(function (a, c) { return a.name < c.name ? -1 : 1; }).forEach(function (x) {
        var o = opt(x, grp[2]);
        og.appendChild(h("option", { value: o.v, disabled: o.off, selected: g && (g.support ? "r:" : "s:") + g.gem === o.v }, o.t));
      });
      sel.appendChild(og);
    });
    var row = h("div", { class: "pl-spanel-row" }, sel);
    if (g) {
      var sk = gemData(g), maxL = sk.max_level || 20, lv = [];
      for (var l = 1; l <= maxL; l++) lv.push([l, "Level " + l]);
      row.appendChild(select(lv, g.level, function (v) { g.level = v | 0; changed(); }, { "aria-label": "Level" }));
      if (!g.support) { var qs = []; for (var q = 0; q <= 20; q++) qs.push([q, q ? "Quality " + q + "%" : "No quality"]); row.appendChild(select(qs, g.quality || 0, function (v) { g.quality = v | 0; changed(); }, { "aria-label": "Quality" })); }
    }
    p.appendChild(row);
    // why it fits or not, and what it needs
    var lines = [];
    if (g) {
      var gc = colourOf(g), fits = E.gemFits(g, s.c), lr = E.requirements(g).level || 1;
      lines.push(h("li", { class: fits ? "ok" : "bad" }, fits ? (s.c === "w" ? "A white socket takes anything." : sk.name + " is " + (g.support ? "a" : "an") + " " + { r: "Strength", g: "Dexterity", b: "Intelligence", w: "any" }[gc] + (g.support ? " rune" : " glyph") + ": it fits a " + COLOUR_NAME[gc].split(" ")[0] + " socket.")
        : sk.name + " needs a " + COLOUR_NAME[gc].split(" ")[0] + " or white socket; the game won't socket it here."));
      lines.push(h("li", { class: S.level >= lr ? "ok" : "bad" }, "Level " + g.level + " needs a hero of level " + lr + (S.level >= lr ? "." : " (this one is " + S.level + ").")));
      if (!g.support) { var x = skillAt(ctx, slot, i); if (x && x.s && x.s.missing) lines.push(h("li", { class: "bad" }, "Socketed, but it can't be used without " + aOr(x.s.missing.replace(/_/g, " ")) + " equipped.")); }
    } else lines.push(h("li", null, "Empty. A " + COLOUR_NAME[s.c].split(" ")[0] + " socket takes " + (s.c === "w" ? "any glyph or rune" : { r: "Strength", g: "Dexterity", b: "Intelligence" }[s.c] + " glyphs and runes") + (S.free ? "" : "; others are greyed out") + "."));
    p.appendChild(h("ul", { class: "pl-why" }, lines));
    return p;
  }
  function aOr(w) { return ("aeiou".indexOf(w[0]) >= 0 ? "an " : "a ") + w; }
  function groupSummary(it, slot, ctx) {
    var out = h("div", { class: "pl-groups" }), seen = {};
    it.sockets.forEach(function (s0) {
      if (seen[s0.g]) return; seen[s0.g] = true;
      var idx = it.sockets.map(function (s, i) { return s.g === s0.g ? i : -1; }).filter(function (i) { return i >= 0 && it.gems[i]; });
      if (!idx.length) return;
      var glyphs = idx.filter(function (i) { return !it.gems[i].support; }), runes = idx.filter(function (i) { return it.gems[i].support; });
      var card = h("div", { class: "pl-group" });
      var sockNos = it.sockets.map(function (s, i) { return s.g === s0.g ? i + 1 : 0; }).filter(Boolean);
      card.appendChild(h("div", { class: "pl-group-head" }, sockNos.length > 1 ? "Linked sockets " + sockNos.join("–") : "Socket " + sockNos[0]));
      if (!glyphs.length) card.appendChild(h("p", { class: "pl-note" }, "These runes modify nothing: link them to a skill glyph."));
      glyphs.forEach(function (gi) {
        var g = it.gems[gi], x = skillAt(ctx, slot, gi), s = x && x.s;
        card.appendChild(h("div", { class: "pl-gline" }, gemIcon(g, "pl-ico sm"), h("b", null, gemData(g).name), h("small", null, " level " + g.level + " · active glyph"),
          s && s.missing ? h("span", { class: "pl-badge bad" }, "Unusable without " + aOr(s.missing.replace(/_/g, " "))) : null));
        runes.forEach(function (ri) {
          var r = it.gems[ri], on = s && s.supports.indexOf(r.gem) >= 0, why = on ? "" : whyNot(I.supports[r.gem], s || { id: g.gem, tags: (I.skills[g.gem] || {}).tags });
          card.appendChild(h("div", { class: "pl-rline " + (on ? "ok" : "no") }, h("span", { class: "pl-mark", "aria-hidden": "true" }, on ? "✓" : "✗"),
            gemIcon(r, "pl-ico sm"), gemData(r).name, h("small", null, on ? " modifies " + gemData(g).name : " " + (why || "doesn't modify " + gemData(g).name))));
        });
      });
      if (glyphs.length && !runes.length && sockNos.length > 1) card.appendChild(h("p", { class: "pl-note" }, "No runes linked yet."));
      out.appendChild(card);
    });
    return out;
  }
  function relink(it, i, link) {
    // sockets are groups in order: linking i to i-1 joins their groups; unlinking starts a new group at i
    var links = it.sockets.map(function (s, k) { return k > 0 && s.g === it.sockets[k - 1].g; });
    links[i] = link;
    var g = 0;
    it.sockets.forEach(function (s, k) { if (k > 0 && !links[k]) g++; s.g = g; });
  }


  // ---------------------------------------------------------------- skills
  function skillsTab(ctx) {
    var box = h("div", { class: "pl-skills" });
    if (!ctx.skills.length) { box.appendChild(h("section", { class: "pl-card" }, h("p", null, "No skill glyph is socketed yet. Put one in a socket on the Gear tab, and link support runes to it."))); return box; }
    var sit = hasSituation();
    ctx.skills.forEach(function (x) {
      var s = x.s, e = x.e, it = S.eq[e.slot];
      if (!s) return;
      var pv = s.preview, rate = 1 / Math.max(s.use_time, 0.05);
      var card = h("section", { class: "pl-card pl-skill" });
      card.appendChild(h("div", { class: "pl-skill-head" }, icon("glyph_" + s.id, "pl-glyph"),
        h("div", null, h("h3", null, s.name, h("span", { class: "pl-lvl" }, " level " + s.level)),
          h("div", { class: "pl-sub" }, "In " + itemName(it) + " (" + SLOTS.find(function (z) { return z[0] === e.slot; })[1].toLowerCase() + "), socket " + (e.index + 1) + " · " + s.tags.join(", ").replace(/_/g, " ")))));
      if (s.missing) card.appendChild(h("p", { class: "pl-badge bad" }, "Needs a" + ("aeiou".indexOf(s.missing[0]) >= 0 ? "n " : " ") + s.missing.replace("_", " ") + " equipped"));
      var big = h("div", { class: "pl-big" });
      if (pv.total > 0) {
        big.appendChild(stat("Average hit", num(pv.total), sit ? num(s.situational.total) : null));
        big.appendChild(stat("Damage per second", num(pv.total * rate), sit ? num(s.situational.total * rate) : null));
      }
      big.appendChild(stat(s.tags.indexOf("attack") >= 0 ? "Attacks per second" : "Uses per second", num2(rate)));
      big.appendChild(stat("Mana cost", num(s.mana_cost), null, num1(s.mana_cost * rate) + " a second"));
      card.appendChild(big);
      var rows = [];
      if (pv.total > 0) {
        Object.keys(pv.dmg).forEach(function (t) { rows.push([cap(t) + " damage", num(pv.dmg[t]) + " average before crits"]); });
        rows.push(["Critical strike", num1(pv.crit_chance) + "% for " + num(pv.crit_multi) + "%"]);
      }
      if (s.cooldown > 0) rows.push(["Cooldown", num2(s.cooldown) + " s" + (s.cooldown > s.use_time ? " (at most " + num2(1 / s.cooldown) + " a second)" : "")]);
      rows.push(["Use time", num2(s.use_time) + " s"]);
      if (s.count > 1) rows.push(["Projectiles", s.count]);
      if (s.pierce > 0) rows.push(["Pierces", s.pierce]);
      if (s.chain > 0) rows.push(["Chains", s.chain]);
      if (s.repeat > 1) rows.push(["Repeats", s.repeat]);
      if (Math.abs(s.area_mult - 1) > 0.001) rows.push(["Area", (s.area_mult >= 1 ? "+" : "") + Math.round((s.area_mult - 1) * 100) + "% radius" + (s.radius ? " (" + num1(s.radius) + " m)" : "")]);
      else if (s.radius) rows.push(["Radius", num1(s.radius) + " m"]);
      if (s.duration) rows.push(["Duration", num2(s.duration) + " s"]);
      Object.keys(s.ailments).forEach(function (a) { if (s.ailments[a] > 0) rows.push([cap(a) + " chance", num1(Math.min(100, s.ailments[a])) + "%"]); });
      Object.keys(s.pen).forEach(function (t) { rows.push([cap(t) + " penetration", num1(s.pen[t]) + "%"]); });
      if (s.on_hit.life_leech > 0) rows.push(["Life leech", num1(s.on_hit.life_leech) + "% of damage"]);
      if (s.on_hit.mana_leech > 0) rows.push(["Mana leech", num1(s.on_hit.mana_leech) + "% of damage"]);
      if (s.on_hit.life_on_hit > 0) rows.push(["Life on hit", num(s.on_hit.life_on_hit)]);
      if (s.tags.indexOf("attack") >= 0) rows.push(["Accuracy", num(s.accuracy)]);
      card.appendChild(h("dl", { class: "pl-dl" }, rows.map(function (r) { return [h("dt", null, r[0]), h("dd", null, String(r[1]))]; })));
      var sups = e.supports.map(function (g) { var sp = I.supports[g.gem]; var on = s.supports.indexOf(sp.id) >= 0;
        return h("li", { class: on ? "" : "off" }, icon("glyph_" + sp.id, "pl-ico sm"), sp.name + " (level " + g.level + ")", on ? null : h("span", { class: "pl-badge" }, "does not support " + s.name)); });
      card.appendChild(h("div", { class: "pl-sups" }, h("h4", null, "Linked runes"), sups.length ? h("ul", null, sups) : h("p", { class: "muted" }, "None. Link support runes in the same socket group.")));
      card.appendChild(h("p", { class: "pl-desc" }, (I.skills[s.id] || {}).desc || ""));
      box.appendChild(card);
    });
    box.appendChild(h("p", { class: "pl-note" }, "Damage per second is the average hit over the use time, as the game's character window works it out: burning, bleeding, poison, extra projectiles and repeats come on top. " +
      (sit ? "The second figure is with the situation from the Character tab." : "Set a situation on the Character tab to see conditional bonuses.")));
    return box;
  }
  function stat(label, value, alt, sub) {
    return h("div", { class: "pl-stat" }, h("span", { class: "pl-stat-l" }, label), h("span", { class: "pl-stat-v" }, value),
      alt != null && alt !== value ? h("span", { class: "pl-stat-alt" }, alt + " in this situation") : null, sub ? h("span", { class: "pl-stat-sub" }, sub) : null);
  }

  // ---------------------------------------------------------------- character
  function characterTab(ctx) {
    var box = h("div", { class: "pl-char" });
    var c1 = h("section", { class: "pl-card" }, h("h3", null, "Class"));
    c1.appendChild(h("div", { class: "pl-classes" }, D.classes.map(function (c) {
      return h("button", { class: "pl-class" + (S.cls === c.id ? " on" : ""), onclick: function () {
        if (S.cls === c.id) return;
        S.cls = c.id; S.passives = E.mended(S.passives, c.id); if (S.spec && I.specs[S.spec].class !== c.id) { S.spec = ""; S.specNodes = []; }
        changed(); } }, h("b", null, c.name), h("small", null, c.role || ""), h("small", { class: "muted" }, "Str " + c.attributes.str + " · Dex " + c.attributes.dex + " · Int " + c.attributes.int));
    })));
    c1.appendChild(h("p", { class: "pl-desc" }, I.classes[S.cls].desc));
    box.appendChild(c1);
    var c2 = h("section", { class: "pl-card" }, h("h3", null, "Hero"));
    var f = h("div", { class: "pl-fields" });
    f.appendChild(field("Ancestry", select(D.ancestries.map(function (a) { return [a.id, a.name]; }), S.anc, function (v) { S.anc = v; changed(); }),
      E.describeAll((I.ancestries[S.anc].mods || []).map(function (m) { return E.fromDict(m); })).join(", ")));
    f.appendChild(field("Level", h("input", { id: "pl-level", type: "number", min: "1", max: "60", value: S.level, onchange: function () { S.level = Math.max(1, Math.min(60, this.value | 0)); changed(); } })));
    f.appendChild(field("Passive points from quests", h("input", { id: "pl-qp", type: "number", min: "0", max: String(QUEST_POINTS), value: S.qp, onchange: function () { S.qp = Math.max(0, Math.min(QUEST_POINTS, this.value | 0)); changed(); } }),
      "Quests give " + QUEST_POINTS + " in all, on top of one a level"));
    c2.appendChild(f);
    c2.appendChild(h("input", { type: "range", min: "1", max: "60", value: S.level, "aria-label": "Level", class: "pl-wide-range", oninput: function () { S.level = this.value | 0; document.getElementById("pl-level").value = S.level; }, onchange: function () { changed(); } }));
    box.appendChild(c2);
    var c3 = h("section", { class: "pl-card" }, h("h3", null, "Specialisation"));
    c3.appendChild(h("label", { class: "pl-check" }, h("input", { type: "checkbox", checked: S.trial, onchange: function () { S.trial = this.checked; changed(); } }), " Trial of the Lattice completed (" + SPEC_POINTS + " specialisation points)"));
    if (S.trial) {
      var specs = D.specs.filter(function (s) { return s.class === S.cls; });
      c3.appendChild(h("div", { class: "pl-fields" }, field("Specialisation", select([["", "None"]].concat(specs.map(function (s) { return [s.id, s.name]; })), S.spec, function (v) { S.spec = v; S.specNodes = []; changed(); }))));
      if (S.spec) {
        var sp = I.specs[S.spec];
        c3.appendChild(h("p", { class: "pl-desc" }, sp.desc));
        c3.appendChild(h("div", { class: "pl-specnodes" }, sp.nodes.map(function (n) {
          var on = S.specNodes.indexOf(n.id) >= 0;
          return h("label", { class: "pl-specnode" + (on ? " on" : "") }, h("input", { type: "checkbox", checked: on, onchange: function () {
            if (this.checked) { if (S.specNodes.length >= SPEC_POINTS) { this.checked = false; flash("All " + SPEC_POINTS + " points are spent."); return; } S.specNodes.push(n.id); }
            else S.specNodes = S.specNodes.filter(function (x) { return x !== n.id; });
            changed(); } }), h("b", null, n.name), h("small", null, E.describeAll(n.mods.map(function (m) { return E.fromDict(m); })).join(". ")));
        })));
      }
    }
    box.appendChild(c3);
    var c4 = h("section", { class: "pl-card" }, h("h3", null, "Situation"),
      h("p", { class: "pl-note" }, "Some bonuses only count in a situation (\"while moving\", \"if you've killed recently\"). The game's own character window shows the numbers with none of them; tick what to try and the sheet shows both."));
    c4.appendChild(h("div", { class: "pl-conds" }, SITUATIONS.map(function (sc) {
      return h("label", { class: "pl-check" }, h("input", { type: "checkbox", checked: !!S.cond[sc[0]], onchange: function () { S.cond[sc[0]] = this.checked; changed(); } }), " " + sc[1]);
    })));
    box.appendChild(c4);
    return box;
  }

  // ---------------------------------------------------------------- the sheet (right): headline first, detail on demand, every number explained
  var openSecs = { attrs: false, defence: true, offence: false, skills: true, points: false, issues: false, craft: false };
  try { Object.assign(openSecs, JSON.parse(localStorage.getItem("av-planner-ui") || "{}")); } catch (e) { /* storage off */ }
  function saveUi() { try { localStorage.setItem("av-planner-ui", JSON.stringify(openSecs)); } catch (e) { /* storage off */ } }
  var lastCtx = null;
  function sheetPanel(ctx) {
    lastCtx = ctx;
    var d = ctx.d, ds = ctx.ds, m = ctx.m, box = h("div", { class: "pl-sheet" });
    box.appendChild(impactCard(ctx));
    var card = h("section", { class: "pl-card pl-sheet-card" }, h("h2", { class: "pl-ptitle" }, "Character"));
    if (ds) card.appendChild(h("p", { class: "pl-note" }, "In blue: in the situation set on the Character tab."));
    // the headline: what the build is about
    var tiles = h("div", { class: "pl-tiles" },
      tile("life", "Life", num(d.life), ds ? num(ds.life) : null, "life"),
      tile("mana", d.ward > 0 ? "Mana · Ward" : "Mana", num(d.mana) + (d.ward > 0 ? " · " + num(d.ward) : ""), null, "mana"),
      tile("dps", "DPS", m.dps > 0 ? num1(m.dps) : "–", null, "dps", m.dpsName || "No skill socketed"),
      tile(d.armor >= d.evasion ? "armor" : "evasion", d.armor >= d.evasion ? "Armour" : "Evasion", num(Math.max(d.armor, d.evasion)), null, "def",
        d.armor >= d.evasion ? "Evasion " + num(d.evasion) : "Armour " + num(d.armor)));
    card.appendChild(tiles);
    card.appendChild(h("div", { class: "pl-break-slot", id: "pl-break-tiles" }));
    // resistances as bars against their cap
    var res = h("div", { class: "pl-resbars" }), short = [];
    [["fire", "Fire"], ["cold", "Cold"], ["lightning", "Lightning"], ["chaos", "Chaos"]].forEach(function (t) {
      var r = d["res_" + t[0]], mx = d["max_res_" + t[0]], eff = Math.min(r, mx), key = "res_" + t[0];
      if (t[0] !== "chaos" && r < mx) short.push(t[1] + " " + Math.round(mx - r) + "%");
      var b = h("button", { class: "pl-resbar res-" + t[0] + (r >= mx ? " capped" : r < 0 ? " neg" : ""), "aria-label": t[1] + " resistance " + Math.round(eff) + "% of " + Math.round(mx) + "%",
        onclick: function () { toggleBreak(this, key); } },
        h("span", { class: "pl-resbar-l" }, t[1]),
        h("span", { class: "pl-resbar-track" }, h("span", { class: "fill", style: "width:" + Math.max(0, Math.min(100, eff)) + "%" }), h("span", { class: "capmark", style: "left:" + Math.min(100, mx) + "%" })),
        h("b", null, pct(eff), delta(key)), r > mx ? h("small", null, "+" + Math.round(r - mx) + " over") : null);
      res.appendChild(b);
    });
    card.appendChild(h("h4", null, "Resistances"));
    card.appendChild(res);
    if (short.length) card.appendChild(h("p", { class: "pl-hint bad" }, "Below the cap: " + short.join(", ") + "."));
    // the rest, grouped and folded
    card.appendChild(section("defence", "Defence", [
      row("armor", "Armour", num), row("evasion", "Evasion", num), row("ward", "Ward", num),
      row("block", "Block", function (v) { return pct(Math.min(75, v)); }), row("spell_block", "Spell block", function (v) { return pct(Math.min(75, v)); }),
      row("dodge", "Dodge", function (v) { return pct(Math.min(75, v)); }),
      row("life_regen", "Life regeneration", function (v) { return num1(v) + "/s"; }), row("mana_regen", "Mana regeneration", function (v) { return num1(v) + "/s"; })], ctx));
    card.appendChild(section("offence", "Offence", [
      row("attack_speed", "Attack speed", signed), row("cast_speed", "Cast speed", signed), row("accuracy", "Accuracy", num),
      row("crit_multi", "Critical multiplier", pct), row("move_speed", "Movement speed", function (v) { return num1(v) + " m/s"; }),
      row("item_rarity", "Item rarity", signed), row("item_quantity", "Item quantity", signed)], ctx));
    card.appendChild(section("attrs", "Attributes", [row("str", "Strength", num), row("dex", "Dexterity", num), row("int", "Intelligence", num),
      h("p", { class: "pl-note" }, "Strength: +1 life per 2 and 1% melee physical damage per 5. Dexterity: +2 accuracy each and 1% evasion per 5. Intelligence: +1 mana per 2 and 1% ward per 5.")], ctx));
    if (ctx.skills.length) {
      card.appendChild(section("skills", "Skills", ctx.skills.filter(function (x) { return x.s && x.s.preview.total > 0; }).map(function (x) {
        var rate = 1 / Math.max(x.s.use_time, 0.05), key = "skill:" + x.e.slot + ":" + x.e.index;
        return h("button", { class: "pl-row", onclick: function () { toggleBreak(this, key); } }, h("span", null, x.s.name), h("b", null, num1(x.s.preview.total * rate) + "/s"),
          ds ? h("em", null, num1(x.s.situational.total * rate) + "/s") : null, x.s.missing ? h("small", { class: "bad" }, " unusable") : null);
      }), ctx));
    }
    var sets = Object.keys(ctx.sheet.set_counts);
    card.appendChild(section("points", "Points and sets", [
      h("div", { class: "pl-row" + (d.passive_points < 0 ? " bad" : "") }, h("span", null, "Passive points left"), h("b", null, String(d.passive_points), delta("passive_points"))),
      S.trial ? h("div", { class: "pl-row" }, h("span", null, "Specialisation points left"), h("b", null, String(d.spec_points))) : null]
      .concat(sets.map(function (sid) { return h("div", { class: "pl-row" }, h("span", null, I.sets[sid].name), h("b", null, ctx.sheet.set_counts[sid] + " of " + I.sets[sid].pieces.length)); })), ctx));
    var iss = section("issues", "Rule check", ctx.warn.length ? [h("ul", { class: "pl-warns" }, ctx.warn.map(function (w) {
      var slot = SLOTS.find(function (s) { return s[0] === w[0]; });
      return h("li", null, slot ? h("button", { class: "pl-linkish", onclick: function () { openSlot = w[0]; tab = "gear"; render(); } }, slot[1] + ": ") : null, w[1]);
    }))] : [h("p", { class: "pl-note good" }, S.free ? "Nothing here breaks the game's rules, even in hypothetical mode." : "Everything here can be made and worn in the game.")], ctx,
      ctx.warn.length ? ctx.warn.length + " to look at" : "all clear");
    iss.classList.add("pl-issues");
    if (ctx.warn.length) iss.classList.add("warn");
    card.appendChild(iss);
    box.appendChild(card);
    return box;

    function row(key, label, f) {
      var a = f(d[key]), b = ds ? f(ds[key]) : null;
      return h("button", { class: "pl-row", "data-k": key, title: "Where this comes from", onclick: function () { toggleBreak(this, key); } },
        h("span", null, label), h("b", null, a, delta(key)), b != null && b !== a ? h("em", null, b) : null);
    }
    function tile(key, label, value, alt, cls, sub) {
      return h("button", { class: "pl-tile " + cls, title: "Where this comes from", onclick: function () { toggleBreak(document.getElementById("pl-break-tiles"), key, true); } },
        h("span", { class: "pl-tile-l" }, label), h("b", null, value), alt && alt !== value ? h("em", null, alt) : null,
        key === "dps" ? dpsDelta() : delta(key), sub ? h("small", null, sub) : null);
    }
  }
  function section(id, title, kids, ctx, summary) {
    var det = h("details", { class: "pl-fold", open: openSecs[id] ? true : null, ontoggle: function () { openSecs[id] = this.open; saveUi(); } },
      h("summary", null, h("span", null, title), summary ? h("small", null, summary) : null));
    kids.forEach(function (k) { add(det, k); });
    return det;
  }
  function delta(key) {
    if (!impact) return null;
    var k = IMPACT.find(function (x) { return x[0] === key; });
    if (!k || !differs(impact.a, impact.b, key)) return null;
    var dv = impact.b[key] - impact.a[key], good = key === "passive_points" ? dv >= 0 : dv > 0;
    return h("small", { class: "pl-delta " + (good ? "up" : "down"), title: "From the last change" }, " " + fmtDelta(k[2], dv));
  }
  function dpsDelta() {
    if (!impact || !differs(impact.a, impact.b, "dps")) return null;
    var p = dpsChange(impact);
    return h("small", { class: "pl-delta " + (p >= 0 ? "up" : "down") }, " " + (isFinite(p) ? (p >= 0 ? "+" : "−") + num1(Math.abs(p)) + "%" : "new"));
  }
  function impactCard(ctx) {
    var box = h("section", { class: "pl-card pl-impact" }, h("div", { class: "pl-sec-head" }, h("h2", { class: "pl-ptitle" }, "Build impact"), h("span", { class: "pl-pill" }, "Last change")));
    if (!impact) { box.appendChild(h("p", { class: "pl-note" }, "Change something and what it does to damage, life and defences shows here.")); return box; }
    var a = impact.a, b = impact.b;
    if (differs(a, b, "dps")) {
      var p = dpsChange(impact);
      box.appendChild(h("div", { class: "pl-impact-dps" },
        h("div", null, h("span", null, "DPS before"), h("b", null, a.dps > 0 ? num1(a.dps) : "–")),
        h("div", null, h("span", null, "DPS after"), h("b", null, b.dps > 0 ? num1(b.dps) : "–")),
        h("div", { class: p >= 0 ? "up" : "down" }, h("span", null, "Difference"), h("b", null, isFinite(p) ? (p >= 0 ? "+" : "−") + num1(Math.abs(p)) + "%" : "new"))));
      if (a.dpsName && b.dpsName && a.dpsName !== b.dpsName) box.appendChild(h("p", { class: "pl-note" }, "Strongest skill: " + a.dpsName + " → " + b.dpsName));
    }
    var cs = changes(impact);
    if (cs.length) box.appendChild(h("ul", { class: "pl-impact-list" }, cs.slice(0, 8).map(function (c) {
      return h("li", null, h("span", null, c.label), h("span", { class: "pl-impact-v" }, fmt(c.kind, c.a) + " → " + fmt(c.kind, c.b)), h("b", { class: c.good ? "up" : "down" }, fmtDelta(c.kind, c.d)));
    })));
    if (cs.length > 8) box.appendChild(h("p", { class: "pl-note" }, (cs.length - 8) + " more changed."));
    return box;
  }
  // click a number: where it comes from opens under it
  function toggleBreak(anchor, key, inSlot) {
    var ctx = lastCtx; if (!ctx) return;
    if (inSlot) {
      var was = anchor.getAttribute("data-k") === key;
      anchor.textContent = ""; anchor.removeAttribute("data-k");
      if (!was) { anchor.setAttribute("data-k", key); anchor.appendChild(explain(key, ctx)); }
      return;
    }
    var next = anchor.nextElementSibling;
    if (next && next.classList.contains("pl-break")) { next.remove(); anchor.classList.remove("open"); return; }
    anchor.classList.add("open");
    anchor.insertAdjacentElement("afterend", explain(key, ctx));
  }
  function openBreakdown(key) {
    var slot = app.querySelector(".pl-right #pl-break-tiles");
    if (!slot || !slot.offsetParent) { tab = "sheet"; render(); slot = app.querySelector(".pl-main #pl-break-tiles"); }
    if (slot) { if (slot.getAttribute("data-k") !== key) toggleBreak(slot, key, true); slot.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
  function srcName(src) {
    if (src === "base") return "Class and level";
    if (src === "ancestry") return (I.ancestries[S.anc] || {}).name || "Ancestry";
    if (src === "passive") return "Passive web";
    if (src === "spec") return S.spec ? I.specs[S.spec].name : "Specialisation";
    if (src === "set") return "Set bonuses";
    if (src === "attr") return "Attributes";
    if (src.indexOf("item:") === 0) {
      var uid_ = src.slice(5), slot = Object.keys(S.eq).find(function (k) { return S.eq[k] && S.eq[k].uid === uid_; });
      return slot ? itemName(S.eq[slot]) : "Gear";
    }
    return src || "Other";
  }
  function appl(m, tags, cond) {
    for (var i = 0; i < m.tags.length; i++) if (tags.indexOf(m.tags[i]) < 0) return false;
    return !(m.cond !== "" && !(cond && cond[m.cond]));
  }
  function bySource(st, stat, tags, cond) {
    var rows = {}, order = [];
    (st.by[stat] || []).forEach(function (m) {
      if (!appl(m, tags || [], cond || {})) return;
      var k = srcName(m.source), r = rows[k];
      if (!r) { r = rows[k] = { name: k, flat: 0, inc: 0, more: 1, gear: m.source.indexOf("item:") === 0 }; order.push(k); }
      if (m.kind === 0 || m.kind === 3) r.flat += m.value; else if (m.kind === 1) r.inc += m.value; else if (m.kind === 2) r.more *= 1 + m.value / 100;
    });
    return order.map(function (k) { return rows[k]; });
  }
  function bl(label, value, cls) { return h("div", { class: "pl-bl " + (cls || "") }, h("span", null, label), h("b", null, value)); }
  function sumLines(rows, field_, f) {
    var out = [], gear = rows.filter(function (r) { return r.gear && Math.abs(field_ === "more" ? r.more - 1 : r[field_]) > 1e-9; });
    rows.forEach(function (r) {
      var v = field_ === "more" ? r.more - 1 : r[field_];
      if (Math.abs(v) < 1e-9 || r.gear) return;
      out.push(bl(r.name, f(field_ === "more" ? r.more : v)));
    });
    if (gear.length) {
      var tot = field_ === "more" ? gear.reduce(function (p, r) { return p * r.more; }, 1) : gear.reduce(function (p, r) { return p + r[field_]; }, 0);
      out.push(bl("Gear", f(tot), "sub-head"));
      gear.forEach(function (r) { out.push(bl(r.name, f(field_ === "more" ? r.more : r[field_]), "sub")); });
    }
    return out;
  }
  function plusN(v) { return (v >= 0 ? "+" : "−") + num1(Math.abs(v)); }
  function plusP(v) { return (v >= 0 ? "+" : "−") + num1(Math.abs(v)) + "%"; }
  function timesM(v) { return "×" + num2(v); }
  function statExplain(st, stat, title, finalText, opts) {
    opts = opts || {};
    var rows = bySource(st, stat, opts.tags, opts.cond), box = h("div", { class: "pl-break", role: "note" }, h("div", { class: "pl-break-h" }, title, h("b", null, finalText)));
    var flat = rows.reduce(function (p, r) { return p + r.flat; }, 0), inc = rows.reduce(function (p, r) { return p + r.inc; }, 0), more = rows.reduce(function (p, r) { return p * r.more; }, 1);
    if (!opts.noFlat && Math.abs(flat) > 1e-9) { box.appendChild(h("div", { class: "pl-break-g" }, (opts.flatLabel || "Added") + ": " + (opts.flatFmt || plusN)(flat))); sumLines(rows, "flat", opts.flatFmt || plusN).forEach(function (x) { box.appendChild(x); }); }
    if (Math.abs(inc) > 1e-9) { box.appendChild(h("div", { class: "pl-break-g" }, "Increased: " + plusP(inc))); sumLines(rows, "inc", plusP).forEach(function (x) { box.appendChild(x); }); }
    if (Math.abs(more - 1) > 1e-9) { box.appendChild(h("div", { class: "pl-break-g" }, "More: " + timesM(more))); sumLines(rows, "more", timesM).forEach(function (x) { box.appendChild(x); }); }
    if (!rows.length) box.appendChild(h("p", { class: "pl-note" }, "Nothing adds to this yet."));
    else if (opts.formula !== false && !opts.noFlat && (Math.abs(inc) > 1e-9 || Math.abs(more - 1) > 1e-9)) box.appendChild(h("div", { class: "pl-break-f" }, num1(flat) + (Math.abs(inc) > 1e-9 ? " × (1 " + (inc >= 0 ? "+ " : "− ") + num1(Math.abs(inc)) + "%)" : "") + (Math.abs(more - 1) > 1e-9 ? " × " + num2(more) : "") + " = " + finalText));
    if (opts.note) box.appendChild(h("p", { class: "pl-note" }, opts.note));
    return box;
  }
  function explain(key, ctx) {
    var st = ctx.sheet.stats, d = ctx.d;
    var simple = { life: "Life", mana: "Mana", ward: "Ward", armor: "Armour", evasion: "Evasion", accuracy: "Accuracy", str: "Strength", dex: "Dexterity", int: "Intelligence", item_rarity: "Item rarity", item_quantity: "Item quantity" };
    if (simple[key]) return statExplain(st, key, simple[key], key === "item_rarity" || key === "item_quantity" ? signed(d[key]) : num(d[key]),
      key === "item_rarity" || key === "item_quantity" ? { flatFmt: plusP, formula: false } : key === "ward" && d.ward <= 0 ? { note: "Ward comes from ward on armour, increased by Intelligence." } : null);
    if (key === "block" || key === "spell_block" || key === "dodge") return statExplain(st, key, { block: "Block", spell_block: "Spell block", dodge: "Dodge" }[key], pct(Math.min(75, d[key])), { flatFmt: plusP, formula: false, note: "Capped at 75%." });
    if (key === "attack_speed" || key === "cast_speed") return statExplain(st, key, key === "attack_speed" ? "Attack speed" : "Cast speed", signed(d[key]), { noFlat: true, note: "On top of each skill's own use time and the weapon's attacks per second." });
    if (key === "move_speed") return statExplain(st, "move_speed", "Movement speed", num1(d.move_speed) + " m/s", { noFlat: true, note: "Applied to the base speed, then any action speed." });
    if (key === "crit_multi") {
      var bx = statExplain(st, "crit_multi", "Critical multiplier", pct(d.crit_multi), { flatFmt: plusP, formula: false });
      bx.insertBefore(bl("Base", "150%"), bx.children[1] || null);
      return bx;
    }
    if (key.indexOf("res_") === 0) {
      var t = key.slice(4), box = h("div", { class: "pl-break" }, h("div", { class: "pl-break-h" }, cap(t) + " resistance", h("b", null, pct(Math.min(d[key], d["max_res_" + t])) + " of " + pct(d["max_res_" + t]))));
      var own = bySource(st, key), all = ["fire", "cold", "lightning"].indexOf(t) >= 0 ? bySource(st, "res_elemental") : [];
      if (own.length) { box.appendChild(h("div", { class: "pl-break-g" }, cap(t) + ": " + plusP(own.reduce(function (p, r) { return p + r.flat; }, 0)))); sumLines(own, "flat", plusP).forEach(function (x) { box.appendChild(x); }); }
      if (all.length) { box.appendChild(h("div", { class: "pl-break-g" }, "All elemental: " + plusP(all.reduce(function (p, r) { return p + r.flat; }, 0)))); sumLines(all, "flat", plusP).forEach(function (x) { box.appendChild(x); }); }
      var mx = bySource(st, "max_res_" + t);
      box.appendChild(h("div", { class: "pl-break-g" }, "Maximum: " + pct(d["max_res_" + t])));
      box.appendChild(bl("Base maximum", "75%"));
      sumLines(mx, "flat", plusP).forEach(function (x) { box.appendChild(x); });
      box.appendChild(h("p", { class: "pl-note" }, "Total " + pct(d[key]) + (d[key] > d["max_res_" + t] ? ", so " + Math.round(d[key] - d["max_res_" + t]) + "% is over the cap" : d[key] < d["max_res_" + t] ? ", " + Math.round(d["max_res_" + t] - d[key]) + "% short of the cap" : ", right at the cap") + "."));
      return box;
    }
    if (key === "life_regen") {
      var lb = statExplain(st, "life_regen", "Life regeneration", num1(d.life_regen) + "/s", { flatLabel: "Per second", formula: false });
      var lp = st.value("life_regen_pct", [], {});
      if (lp) lb.appendChild(bl(num1(lp) + "% of " + num(d.life) + " life", "+" + num1(d.life * lp / 100) + "/s"));
      return lb;
    }
    if (key === "mana_regen") {
      var mb = h("div", { class: "pl-break" }, h("div", { class: "pl-break-h" }, "Mana regeneration", h("b", null, num1(d.mana_regen) + "/s")));
      mb.appendChild(bl("3% of " + num(d.mana) + " mana", num1(d.mana * 0.03) + "/s"));
      var rr = bySource(st, "mana_regen");
      if (rr.length) { mb.appendChild(h("div", { class: "pl-break-g" }, "Increased")); sumLines(rr, "inc", plusP).forEach(function (x) { mb.appendChild(x); }); }
      var fl = st.flat("mana_regen_flat");
      if (fl) mb.appendChild(bl("Flat", "+" + num1(fl) + "/s"));
      return mb;
    }
    if (key === "dps" || key.indexOf("skill:") === 0) {
      var x = key === "dps" ? ctx.m.best : ctx.skills.find(function (y) { return "skill:" + y.e.slot + ":" + y.e.index === key; });
      if (!x || !x.s) return h("div", { class: "pl-break" }, h("p", { class: "pl-note" }, "Socket a skill glyph to see its damage."));
      var s = x.s, pv = s.preview, rate = 1 / Math.max(s.use_time, 0.05);
      var db = h("div", { class: "pl-break" }, h("div", { class: "pl-break-h" }, s.name + (key === "dps" ? " (strongest skill)" : ""), h("b", null, num1(pv.total * rate) + " DPS")));
      db.appendChild(h("div", { class: "pl-break-g" }, "Average hit before crits"));
      Object.keys(pv.dmg).forEach(function (t) { db.appendChild(bl(cap(t), num1(pv.dmg[t]))); });
      db.appendChild(bl("Critical strikes", num1(pv.crit_chance) + "% for " + num(pv.crit_multi) + "%"));
      db.appendChild(bl("Average hit with crits", num1(pv.total), "sub-head"));
      db.appendChild(bl((s.tags.indexOf("attack") >= 0 ? "Attacks" : "Uses") + " per second", num2(rate) + " (" + num2(s.use_time) + " s each)"));
      db.appendChild(h("div", { class: "pl-break-f" }, num1(pv.total) + " × " + num2(rate) + " = " + num1(pv.total * rate) + " a second"));
      if (s.missing) db.appendChild(h("p", { class: "pl-note bad" }, "Unusable without " + aOr(s.missing.replace(/_/g, " ")) + " equipped."));
      db.appendChild(h("p", { class: "pl-note" }, "Burning, bleeding, poison, extra projectiles and repeats come on top. The Skills tab has the full detail."));
      return db;
    }
    return h("div", { class: "pl-break" }, h("p", { class: "pl-note" }, "No breakdown for this one yet."));
  }

  // ---------------------------------------------------------------- the passive web
  var NODE_R = { start: 30, keystone: 24, notable: 16, small: 10, path: 8 };
  function nodeText(n) { return E.describeAll((n.mods || []).map(function (m) { return E.fromDict(m); })); }
  function passivesTab(ctx) {
    var box = h("div", { class: "pl-web" });
    var used = S.passives.length, total = S.level - 1 + S.qp;
    box.appendChild(h("div", { class: "pl-web-bar" },
      h("span", { class: used > total ? "bad" : "" }, used + " of " + total + " points"),
      h("input", { id: "pl-search", type: "search", placeholder: "Find a node (life, fire, crit...)", value: search, "aria-label": "Find a passive node",
        oninput: function () { search = this.value; paintWeb(); } }),
      h("button", { class: "pl-mini", onclick: function () { view = null; paintWeb(); } }, "Centre"),
      h("button", { class: "pl-mini", onclick: function () { if (confirm("Take off every passive point?")) { S.passives = []; changed(); } } }, "Refund all")));
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pl-svg"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "The passive web");
    box.appendChild(h("div", { class: "pl-web-wrap" }, svg));
    box.appendChild(h("div", { id: "pl-node", class: "pl-node-card" }));
    box.appendChild(h("p", { class: "pl-note" }, "Click a node to take it and every node on the way to it; click a taken node to give it back (only if nothing else hangs on it). Drag to move, scroll or pinch to zoom."));
    var taken = S.passives.filter(function (id) { var k = I.nodes[id].kind; return k === "notable" || k === "keystone"; });
    if (taken.length) box.appendChild(h("section", { class: "pl-card" }, h("h4", null, "Notables and keystones taken"), h("ul", { class: "pl-taken" }, taken.map(function (id) {
      var n = I.nodes[id]; return h("li", null, h("b", null, n.name), " ", h("small", null, nodeText(n).join(". ")));
    }))));
    setTimeout(function () { buildWeb(svg); }, 0);
    return box;
  }
  var webEls = null;
  function buildWeb(svg) {
    var NS = "http://www.w3.org/2000/svg";
    var gLinks = document.createElementNS(NS, "g"), gNodes = document.createElementNS(NS, "g"), gLabels = document.createElementNS(NS, "g");
    svg.appendChild(gLinks); svg.appendChild(gNodes); svg.appendChild(gLabels);
    webEls = { svg: svg, links: [], nodes: [] };
    I.nodes.forEach(function (n) {
      n.links.forEach(function (o) {
        if (o < n.id) return;
        var m = I.nodes[o], l = document.createElementNS(NS, "line");
        l.setAttribute("x1", n.x); l.setAttribute("y1", n.y); l.setAttribute("x2", m.x); l.setAttribute("y2", m.y);
        gLinks.appendChild(l); webEls.links.push([l, n.id, o]);
      });
    });
    I.nodes.forEach(function (n) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", NODE_R[n.kind] || 8);
      c.setAttribute("class", "k-" + n.kind);
      c.dataset.id = n.id;
      gNodes.appendChild(c); webEls.nodes[n.id] = c;
      if (n.kind === "start") {
        var t = document.createElementNS(NS, "text");
        t.setAttribute("x", n.x); t.setAttribute("y", n.y + 52); t.setAttribute("text-anchor", "middle"); t.textContent = n.name;
        gLabels.appendChild(t);
      }
    });
    // pan and zoom
    var pts = {}, last = null, moved = 0;
    function vb() { return view || (view = fitView()); }
    function toWorld(ev) { var r = svg.getBoundingClientRect(), v = vb(); return [v[0] + (ev.clientX - r.left) / r.width * v[2], v[1] + (ev.clientY - r.top) / r.height * v[3]]; }
    function zoom(f, cx, cy) {
      var v = vb(), w = Math.max(250, Math.min(3600, v[2] * f)), k = w / v[2], hgt = v[3] * k;
      view = [cx - (cx - v[0]) * k, cy - (cy - v[1]) * k, w, hgt]; setVB();
    }
    svg.addEventListener("wheel", function (ev) { ev.preventDefault(); var p = toWorld(ev); zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, p[0], p[1]); }, { passive: false });
    svg.addEventListener("pointerdown", function (ev) { svg.setPointerCapture(ev.pointerId); pts[ev.pointerId] = [ev.clientX, ev.clientY]; last = null; moved = 0; });
    svg.addEventListener("pointermove", function (ev) {
      if (!pts[ev.pointerId]) { hover(ev); return; }
      var ids = Object.keys(pts), r = svg.getBoundingClientRect(), v = vb();
      if (ids.length === 1) {
        var p = pts[ev.pointerId], dx = ev.clientX - p[0], dy = ev.clientY - p[1];
        moved += Math.abs(dx) + Math.abs(dy);
        view = [v[0] - dx / r.width * v[2], v[1] - dy / r.height * v[3], v[2], v[3]]; setVB();
      } else if (ids.length === 2) {
        var o = pts[ids[0] === String(ev.pointerId) ? ids[1] : ids[0]], p2 = pts[ev.pointerId];
        var d0 = Math.hypot(p2[0] - o[0], p2[1] - o[1]), d1 = Math.hypot(ev.clientX - o[0], ev.clientY - o[1]);
        moved += 10;
        if (d0 > 0 && d1 > 0) { var mid = toWorld({ clientX: (o[0] + ev.clientX) / 2, clientY: (o[1] + ev.clientY) / 2 }); zoom(d0 / d1, mid[0], mid[1]); }
      }
      pts[ev.pointerId] = [ev.clientX, ev.clientY];
    });
    function up(ev) {
      var was = pts[ev.pointerId]; delete pts[ev.pointerId];
      if (!was || moved > 8 || Object.keys(pts).length) return;
      var t = ev.target;
      if (t && t.dataset && t.dataset.id != null) clickNode(t.dataset.id | 0, ev.pointerType);
    }
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", function (ev) { delete pts[ev.pointerId]; });
    svg.addEventListener("pointerleave", function () { if (!Object.keys(pts).length) { hoverPath = []; paintWeb(); } });
    function hover(ev) {
      var t = ev.target;
      if (ev.pointerType !== "mouse") return;
      if (t && t.dataset && t.dataset.id != null) {
        var id = t.dataset.id | 0;
        if (selNode !== id) { selNode = id; hoverPath = S.passives.indexOf(id) >= 0 ? [] : (E.pathTo(S.passives, id, S.cls) || []); paintWeb(); nodeCard(); }
      }
    }
    setVB(); paintWeb(); nodeCard();
  }
  function fitView() {
    var r = webEls.svg.getBoundingClientRect(), aspect = r.height > 0 ? r.width / r.height : 1;
    var st = I.nodes[I.starts[S.cls]], w = 1500, hgt = w / aspect;
    if (S.passives.length > 30) { w = 3000; hgt = w / aspect; return [-w / 2, -hgt / 2, w, hgt]; }
    return [st.x * 2 - w / 2, st.y * 2 - hgt / 2, w, hgt];
  }
  function setVB() { if (!webEls) return; var v = view || (view = fitView()); webEls.svg.setAttribute("viewBox", v.join(" ")); }
  function paintWeb() {
    if (!webEls || !webEls.svg.isConnected) return;
    var have = {}; S.passives.forEach(function (a) { have[a] = true; }); have[I.starts[S.cls]] = true;
    var hp = {}; hoverPath.forEach(function (a) { hp[a] = true; });
    var q = search.trim().toLowerCase(), match = {};
    if (q.length >= 2) I.nodes.forEach(function (n) { if (n.name.toLowerCase().indexOf(q) >= 0 || nodeText(n).join(" ").toLowerCase().indexOf(q) >= 0) match[n.id] = true; });
    webEls.nodes.forEach(function (c, id) {
      var n = I.nodes[id], cl = "k-" + n.kind;
      if (have[id]) cl += " on"; else if (hp[id]) cl += " path"; else if (E.canAllocate(S.passives, id, S.cls)) cl += " can";
      if (n.kind === "start" && n.class_id !== S.cls) cl += " other";
      if (match[id]) cl += " hit";
      if (id === selNode) cl += " sel";
      c.setAttribute("class", cl);
    });
    webEls.links.forEach(function (x) {
      var a = x[1], b = x[2], cl = "";
      if (have[a] && have[b]) cl = "on"; else if ((hp[a] || have[a]) && (hp[b] || have[b])) cl = "path";
      x[0].setAttribute("class", cl);
    });
    var bar = document.querySelector(".pl-web-bar span");
    if (bar) { var total = S.level - 1 + S.qp; bar.textContent = S.passives.length + " of " + total + " points"; bar.className = S.passives.length > total ? "bad" : ""; }
  }
  function clickNode(id, ptype) {
    if (ptype !== "mouse" && selNode !== id) { selNode = id; hoverPath = S.passives.indexOf(id) >= 0 ? [] : (E.pathTo(S.passives, id, S.cls) || []); paintWeb(); nodeCard(); return; }
    toggleNode(id);
  }
  function toggleNode(id) {
    var n = I.nodes[id];
    if (n.kind === "start") return;
    if (S.passives.indexOf(id) >= 0) {
      if (!E.canRefund(S.passives, id, S.cls)) { flash("Other points hang on this one: give those back first."); return; }
      S.passives = S.passives.filter(function (x) { return x !== id; });
    } else {
      var p = E.pathTo(S.passives, id, S.cls);
      if (!p) { flash("That node can't be reached from your class's start."); return; }
      S.passives = S.passives.concat(p);
      var left = E.derived(ch(), E.build(ch()), {}).passive_points;
      if (left < 0) flash("That's " + (-left) + " more point" + (left === -1 ? "" : "s") + " than this build has: raise its level or quest points to keep it.");
    }
    hoverPath = [];
    commit(); save(); refreshAfterWeb();
  }
  function refreshAfterWeb() {
    // keep the web as it is (its view and listeners) and redraw the rest
    var ctx = context();
    var hd = app.querySelector(".pl-head"); if (hd) hd.replaceWith(header(ctx));
    var R = app.querySelector(".pl-right");
    if (R) { var t = R.scrollTop; R.textContent = ""; R.appendChild(sheetPanel(ctx)); R.scrollTop = t; }
    var cnt = app.querySelector(".pl-tab .pl-count.pts");
    if (cnt) { cnt.textContent = String(ctx.d.passive_points); cnt.className = "pl-count pts" + (ctx.d.passive_points < 0 ? " bad" : ""); }
    paintWeb(); nodeCard();
  }
  function nodeCard() {
    var el = document.getElementById("pl-node");
    if (!el) return;
    el.textContent = "";
    if (selNode < 0) { el.appendChild(h("p", { class: "muted" }, "Point at a node to read it.")); return; }
    var n = I.nodes[selNode], has = S.passives.indexOf(selNode) >= 0;
    var kind = { start: "Class start", keystone: "Keystone", notable: "Notable", small: "Passive", path: "Passive" }[n.kind];
    el.appendChild(h("div", { class: "pl-node-head" }, h("b", { class: "k-" + n.kind }, n.name), h("small", null, kind)));
    nodeText(n).forEach(function (t) { el.appendChild(h("div", { class: "pl-node-mod" }, t)); });
    if (n.desc) el.appendChild(h("p", { class: "pl-desc" }, n.desc));
    if (n.kind !== "start") {
      var p = has ? null : E.pathTo(S.passives, selNode, S.cls);
      el.appendChild(h("button", { class: "pl-mini", onclick: function () { toggleNode(selNode); } },
        has ? "Give it back" : p ? "Take it" + (p.length > 1 ? " (" + p.length + " points on the way)" : "") : "Out of reach"));
    }
  }

  // ---------------------------------------------------------------- start
  function start() {
    var hash = location.hash.match(/[#&]b=([A-Za-z0-9_-]+)/) || location.hash.match(/^#(p[A-Za-z0-9_-]*)$/);
    var p = hash ? readCode(hash[1]) : Promise.resolve(null);
    p.then(function (b) {
      if (!b) { try { b = decodeState(JSON.parse(localStorage.getItem("av-planner") || "null")); } catch (e) { b = null; } }
      S = b || freshBuild(D.classes[0].id);
      committed = snap();
      render();
      if (hash && !b) flash("That link didn't hold a build this planner can read.");
      document.addEventListener("keydown", function (ev) {
        if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
        var t = ev.target, tag = t && t.tagName;
        if (tag === "TEXTAREA" || (tag === "INPUT" && /^(text|search|number)$/.test(t.type)) || tag === "SELECT") return;
        var k = ev.key.toLowerCase();
        if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
        else if ((k === "z" && ev.shiftKey) || k === "y") { ev.preventDefault(); redo(); }
      });
      window.addEventListener("resize", function () { if (tab === "passives") { view = null; setVB(); } });
    });
  }
  app.textContent = "Loading the game's data…";
  fetch(ROOT + "planner-data.json?v=" + (app.getAttribute("data-v") || "")).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (data) {
    D = data; I = E.init(data);
    var vEl = document.getElementById("pl-ver"); if (vEl) vEl.textContent = data.version;
    start();
  }).catch(function () { app.textContent = "The planner's data could not be loaded. Try reloading the page."; });
})();
