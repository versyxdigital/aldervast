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
    var b = { v: 1, name: "", cls: c.id, anc: D.ancestries[0].id, level: 1, qp: 0, trial: false, spec: "", specNodes: [], passives: [], eq: {}, cond: {} };
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
    return { v: 1, n: S.name, c: S.cls, a: S.anc, l: S.level, qp: S.qp, t: S.trial ? 1 : 0, sp: S.spec, sn: S.specNodes, p: S.passives, e: eq, cd: Object.keys(situation()) };
  }
  function decodeState(o) {
    if (!o || o.v !== 1 || !I.classes[o.c]) return null;
    var b = { v: 1, name: String(o.n || "").slice(0, 60), cls: o.c, anc: I.ancestries[o.a] ? o.a : D.ancestries[0].id, level: Math.max(1, Math.min(60, o.l | 0)),
      qp: Math.max(0, Math.min(QUEST_POINTS, o.qp | 0)), trial: !!o.t, spec: I.specs[o.sp] ? o.sp : "", specNodes: (o.sn || []).map(String),
      passives: [], eq: {}, cond: {} };
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

  // ---------------------------------------------------------------- the whole page
  function changed() { save(); render(); }
  function render() {
    var c = ch(), sheet = E.build(c), live = liveConds(sheet);
    var d = E.derived(c, sheet, {}), ds = hasSituation() ? E.derived(c, sheet, situation(), live) : null;
    var skills = E.socketedSkills(c).map(function (e) { return { e: e, s: E.resolve(c, sheet, e, situation(), live) }; });
    var ctx = { c: c, sheet: sheet, d: d, ds: ds, skills: skills, warn: warnings(c, sheet, d) };
    var scrollY = window.scrollY;
    var keepFocus = document.activeElement && document.activeElement.id;
    app.textContent = "";
    app.appendChild(topBar());
    var tabs = [["gear", "Gear"], ["skills", "Skills"], ["passives", "Passive web"], ["character", "Character"], ["sheet", "Sheet"]];
    app.appendChild(h("nav", { class: "pl-tabs", role: "tablist" }, tabs.map(function (t) {
      return h("button", { role: "tab", class: "pl-tab" + (tab === t[0] ? " on" : "") + (t[0] === "sheet" ? " pl-only-narrow" : ""), "aria-selected": tab === t[0] ? "true" : "false",
        onclick: function () { tab = t[0]; render(); } }, t[1], t[0] === "skills" ? h("span", { class: "pl-count" }, String(skills.length)) : null,
        t[0] === "passives" ? h("span", { class: "pl-count" + (d.passive_points < 0 ? " bad" : "") }, String(d.passive_points)) : null);
    })));
    var main = h("div", { class: "pl-main" });
    if (tab === "gear") main.appendChild(gearTab(ctx));
    else if (tab === "skills") main.appendChild(skillsTab(ctx));
    else if (tab === "passives") main.appendChild(passivesTab(ctx));
    else if (tab === "character") main.appendChild(characterTab(ctx));
    else main.appendChild(sheetPanel(ctx, true));
    app.appendChild(h("div", { class: "pl-grid" + (tab === "passives" ? " wide" : "") }, main, tab !== "sheet" ? h("aside", { class: "pl-side" }, sheetPanel(ctx, false)) : null));
    app.appendChild(h("div", { id: "pl-msg", class: "pl-msg", role: "status" }));
    if (keepFocus) { var f = document.getElementById(keepFocus); if (f) { f.focus(); } }
    window.scrollTo(0, scrollY);
  }
  function topBar() {
    var cls = I.classes[S.cls];
    return h("div", { class: "pl-top" },
      h("div", { class: "pl-title" },
        h("input", { id: "pl-name", class: "pl-name", value: S.name, placeholder: "Name this build", maxlength: "60", "aria-label": "Build name",
          oninput: function () { S.name = this.value; save(); } }),
        h("span", { class: "pl-sub" }, "Level " + S.level + " " + (I.ancestries[S.anc] || {}).name + " " + cls.name + (S.trial && S.spec ? " · " + I.specs[S.spec].name : ""))),
      h("div", { class: "pl-actions" },
        h("button", { class: "btn", onclick: copyLink }, "Copy share link"),
        h("button", { class: "btn ghost", onclick: function () { if (confirm("Start a new build? The one here is replaced (copy its link first to keep it).")) { S = freshBuild(S.cls); openSlot = "main_hand"; changed(); } } }, "New build")));
  }

  // ---------------------------------------------------------------- warnings
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
  function fitAffixes(it) {
    // keep what can still roll on the piece at its level; drop the rest
    var mx = it.rarity === 4 ? 1 : E.maxAffixes(it.rarity);
    ["prefixes", "suffixes"].forEach(function (k) {
      var type = k === "prefixes" ? "prefix" : "suffix", ok = E.affixOptions(it, type).map(function (a) { return a.id; });
      it[k] = it[k].filter(function (e) { return ok.indexOf(e.id) >= 0; }).slice(0, mx);
      it[k].forEach(function (e) { var a = I.affixes[e.id]; if (a.tiers[e.tier].ilvl > it.ilvl) { e.tier = bestTier(a, it.ilvl); e.rolls = tierRolls(a.tiers[e.tier]); } });
    });
    var ms = E.maxSocketsFor(E.base(it), it.ilvl);
    if (it.sockets.length > ms) { it.sockets.length = ms; it.gems.length = ms; }
    var tags = E.itemTags(it);
    if (it.crafted && !I.imbues[it.crafted.id].tags.some(function (t) { return tags.indexOf(t) >= 0; })) delete it.crafted;
    if (it.woven && !I.weaves[it.woven.id].tags.some(function (t) { return tags.indexOf(t) >= 0; })) delete it.woven;
    if (!hasQuality(it)) it.quality = 0;
  }
  function hasQuality(it) { var t = E.base(it).tags || []; return t.indexOf("weapon") >= 0 || t.indexOf("armour") >= 0; }

  function gearTab(ctx) {
    var wrap = h("div", { class: "pl-gear" });
    var doll = h("div", { class: "pl-doll" });
    SLOTS.forEach(function (sl) {
      var it = S.eq[sl[0]], warn = ctx.warn.some(function (w) { return w[0] === sl[0]; });
      doll.appendChild(h("button", { class: "pl-slot" + (openSlot === sl[0] ? " on" : "") + (warn ? " warn" : ""), onclick: function () { openSlot = sl[0]; render(); } },
        it ? icon(it.base) : h("span", { class: "pl-ico pl-empty-ico" }),
        h("span", { class: "pl-slot-txt" }, h("span", { class: "pl-slot-name" }, sl[1]),
          it ? h("span", { class: "pl-slot-item " + RCLS[it.rarity] }, itemName(it)) : h("span", { class: "pl-slot-item muted" }, "Empty"),
          it && it.sockets.length ? h("span", { class: "pl-slot-socks" }, it.sockets.map(function (s, i) { return [i > 0 ? h("span", { class: "pl-link" + (s.g === it.sockets[i - 1].g ? " on" : "") }) : null, h("span", { class: "pl-sock s-" + s.c + (it.gems[i] ? " full" : "") })]; })) : null)));
    });
    var side = h("div", { class: "pl-gear-side" }, finder(), doll);
    wrap.appendChild(side);
    wrap.appendChild(itemEditor(openSlot, ctx));
    return wrap;
  }
  // find any base, unique or set piece by name and put it on in the slot it goes in
  var findQuery = "", findList = null;
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
      var it = newItem(e.base, MAX_ILVL);
      if (e.kind === "unique") setUnique(it, e.id);
      else if (e.kind === "set") setSetPiece(it, e.id, e.base);
      else it.rarity = 2;
      S.eq[slot] = it; openSlot = slot; findQuery = ""; fitAffixes(it); changed();
    }
    var inp = h("input", { type: "search", class: "pl-find-in", placeholder: "Find an item: base, unique or set piece", value: findQuery, "aria-label": "Find an item",
      oninput: function () { findQuery = this.value; show(); } });
    show();
    return h("div", { class: "pl-find" }, inp, list);
  }
  function itemEditor(slot, ctx) {
    var it = S.eq[slot], label = SLOTS.find(function (s) { return s[0] === slot; })[1];
    var box = h("section", { class: "pl-card pl-editor" });
    box.appendChild(h("div", { class: "pl-card-head" }, h("h3", null, label), it ? h("button", { class: "pl-mini", onclick: function () { delete S.eq[slot]; changed(); } }, "Take off") : null));
    // what kind of piece
    var mode = !it ? "" : it.unique ? "unique" : it.set ? "set" : "base";
    var kinds = [["base", "Base item"], ["unique", "Unique"], ["set", "Set piece"]];
    box.appendChild(h("div", { class: "pl-seg" }, kinds.map(function (k) {
      return h("button", { class: mode === k[0] ? "on" : "", onclick: function () { setMode(slot, k[0]); } }, k[1]);
    })));
    if (!it) { box.appendChild(h("p", { class: "muted" }, "Nothing worn here. Pick what kind of piece to put on.")); return box; }
    var b = E.base(it), grid = h("div", { class: "pl-fields" });
    if (mode === "base") {
      var groups = {};
      basesFor(slot).forEach(function (x) { var g = classLabel(x.class); (groups[g] || (groups[g] = [])).push([x.id, x.name + " (level " + x.level + ")"]); });
      grid.appendChild(field("Base", select(Object.keys(groups).map(function (g) { return { group: g, items: groups[g] }; }), it.base, function (v) { it.base = v; unstarter(it); fitAffixes(it); changed(); })));
      grid.appendChild(field("Rarity", select([[0, "Normal"], [1, "Magic"], [2, "Rare"]], it.rarity, function (v) { it.rarity = v | 0; unstarter(it); fitAffixes(it); changed(); })));
    } else if (mode === "unique") {
      var us = D.uniques.filter(function (u) { return basesFor(slot).some(function (x) { return x.id === u.base; }); });
      grid.appendChild(field("Unique", select(us.map(function (u) { return [u.id, u.name + " (" + I.bases[u.base].name + ")"]; }), it.unique, function (v) { setUnique(it, v); changed(); })));
    } else {
      var pcs = [];
      D.sets.forEach(function (st) { st.pieces.forEach(function (p) { if (basesFor(slot).some(function (x) { return x.id === p.base; })) pcs.push([st.id + "|" + p.base, p.name + " (" + st.name + ")"]); }); });
      grid.appendChild(field("Set piece", select(pcs, it.set + "|" + it.base, function (v) { var p = v.split("|"); setSetPiece(it, p[0], p[1]); changed(); })));
    }
    grid.appendChild(field("Item level", h("input", { type: "number", min: "1", max: String(MAX_ILVL), value: it.ilvl, onchange: function () { it.ilvl = Math.max(1, Math.min(MAX_ILVL, this.value | 0)); fitAffixes(it); changed(); } }),
      "Sets the best property tiers and the most sockets it can have"));
    if (hasQuality(it)) grid.appendChild(field("Quality", select([0, 5, 10, 15, 20].map(function (q) { return [q, q ? "+" + q + "%" : "None"]; }), it.quality, function (v) { it.quality = v | 0; changed(); })));
    box.appendChild(grid);
    // properties
    var mx = it.rarity === 4 ? 1 : E.maxAffixes(it.rarity);
    if (mx > 0) {
      box.appendChild(h("h4", null, "Properties"));
      if (it.rarity === 4) box.appendChild(h("p", { class: "pl-note" }, "A set piece drops as a magic item first, so it can carry one prefix and one suffix."));
      ["prefixes", "suffixes"].forEach(function (k) {
        var type = k === "prefixes" ? "prefix" : "suffix";
        // the properties it has, and one empty row to add another while there is room
        var n = Math.min(mx, it[k].length + 1);
        for (var i = 0; i < n; i++) box.appendChild(affixRow(it, k, type, i));
      });
    }
    if (it.unique) box.appendChild(uniqueRows(it));
    box.appendChild(h("h4", null, "Crafting"));
    var tags = E.itemTags(it), cg = h("div", { class: "pl-fields" });
    var ims = D.imbues.filter(function (im) { return im.tags.some(function (t) { return tags.indexOf(t) >= 0; }); });
    cg.appendChild(field("Imbue (Enchanting)", select([["", "None"]].concat(ims.map(function (im) { return [im.id, im.name + ": " + E.describeAll(im.mods.map(function (m) { return E.fromDict(m); })).join(", ") + " (Enchanting " + im.prof + ")"]; })),
      it.crafted ? it.crafted.id : "", function (v) { if (v) it.crafted = { id: v, mods: I.imbues[v].mods }; else delete it.crafted; changed(); })));
    var wvs = D.weaves.filter(function (w) { return w.tags.some(function (t) { return tags.indexOf(t) >= 0; }); });
    cg.appendChild(field("Weave (Warp Thread)", select([["", "None"]].concat(wvs.map(function (w) { return [w.id, w.name + ": " + E.describeAll(w.mods.map(function (m) { return E.fromDict(m); })).join(", ")]; })),
      it.woven ? it.woven.id : "", function (v) { if (v) it.woven = { id: v, mods: I.weaves[v].mods }; else delete it.woven; changed(); })));
    var co = it.corrupt_mods ? D.corrupt.findIndex(function (c) { return JSON.stringify(c) === JSON.stringify(it.corrupt_mods[0]); }) : -2;
    cg.appendChild(field("Corruption", select([[-2, "Not corrupted"], [-1, "Corrupted, nothing gained"]].concat(D.corrupt.map(function (c, i) { return [i, E.describe(E.fromDict(c))]; })), co,
      function (v) { v = v | 0; if (v === -2) { it.corrupted = false; delete it.corrupt_mods; } else if (v === -1) { it.corrupted = true; delete it.corrupt_mods; } else { it.corrupted = true; it.corrupt_mods = [D.corrupt[v]]; } changed(); })));
    box.appendChild(cg);
    box.appendChild(socketEditor(it));
    var warns = ctx.warn.filter(function (w) { return w[0] === slot; });
    if (warns.length) box.appendChild(h("ul", { class: "pl-warns" }, warns.map(function (w) { return h("li", null, w[1]); })));
    box.appendChild(h("div", { class: "pl-tipwrap" }, tooltip(it, ctx.sheet)));
    return box;
  }
  function setMode(slot, mode) {
    var it = S.eq[slot], ilvl = it ? it.ilvl : MAX_ILVL;
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
  function affixRow(it, k, type, i) {
    var e = it[k][i];
    var used = it.prefixes.concat(it.suffixes).filter(function (x) { return x !== e; }).map(function (x) { return I.affixes[x.id].group || x.id; });
    var opts = E.affixOptions(it, type).filter(function (a) { return used.indexOf(a.group || a.id) < 0; });
    var row = h("div", { class: "pl-affix" });
    var label = (type === "prefix" ? "Prefix " : "Suffix ") + (i + 1);
    row.appendChild(field(label, select([["", "None"]].concat(opts.map(function (a) { return [a.id, affixLabel(a)]; })), e ? e.id : "", function (v) {
      if (!v) { it[k].splice(i, 1); changed(); return; }
      var a = I.affixes[v], t = bestTier(a, it.ilvl), ne = { id: v, tier: t, rolls: tierRolls(a.tiers[t]) };
      if (e) it[k][i] = ne; else it[k].push(ne);
      changed();
    }, { disabled: !e && it[k].length < i ? true : null })));
    if (e) {
      var a = I.affixes[e.id];
      row.appendChild(field("Tier", select(a.tiers.map(function (t, ti) { return [ti, "T" + (a.tiers.length - ti) + " " + t.name + " (item level " + t.ilvl + ")"]; }).filter(function (o) { return a.tiers[o[0]].ilvl <= it.ilvl; }), e.tier,
        function (v) { e.tier = v | 0; e.rolls = tierRolls(a.tiers[e.tier]); changed(); })));
      var tier = a.tiers[e.tier];
      var lineOf = function () { return E.describeAll(tier.mods.map(function (md, mi) { return E.fromDict({ stat: md.stat, kind: md.kind, value: mi < e.rolls.length ? e.rolls[mi] : +md.min, tags: md.tags }); })).join(", "); };
      var txt = h("div", { class: "pl-roll-txt" }, lineOf());
      row.appendChild(txt);
      tier.mods.forEach(function (md, mi) {
        if (+md.min === +md.max) return;
        var step = rollStep(md), val = mi < e.rolls.length ? e.rolls[mi] : +md.min;
        var nm = /_min$/.test(md.stat) ? "Low end" : /_max$/.test(md.stat) ? "High end" : (tier.mods.length > 1 ? "Roll " + (mi + 1) : "Roll");
        var out = h("span", { class: "pl-roll-v" }, String(val));
        row.appendChild(h("label", { class: "pl-roll" }, h("span", { class: "pl-roll-n" }, nm + " (" + md.min + " to " + md.max + ")"),
          h("input", { type: "range", min: md.min, max: md.max, step: step, value: val, "aria-label": nm,
            oninput: function () { e.rolls[mi] = step < 1 ? E.snapped(+this.value, 0.1) : Math.round(+this.value); out.textContent = String(e.rolls[mi]); txt.textContent = lineOf(); },
            onchange: function () { changed(); } }), out));
      });
    }
    return row;
  }
  function affixLabel(a) {
    // the property as its best tier reads at its highest roll
    var t = a.tiers[a.tiers.length - 1];
    return E.describeAll(t.mods.map(function (md) { return E.fromDict({ stat: md.stat, kind: md.kind, value: +md.max, tags: md.tags }); })).join(", ") + " (best)";
  }
  function uniqueRows(it) {
    var u = I.uniques[it.unique], box = h("div", { class: "pl-affix" });
    box.appendChild(h("h4", null, "Rolls"));
    box.appendChild(h("p", { class: "pl-note" }, "A unique's properties roll within 15% either side of their listed value."));
    u.mods.forEach(function (md, i) {
      var v = +md.value, step = Math.abs(v) < 5 ? 0.1 : 1, lo = E.snapped(v * 0.85, step), hi = E.snapped(v * 1.15, step);
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      var cur = i < it.unique_rolls.length ? it.unique_rolls[i] : v;
      var line = E.describe(E.fromDict(Object.assign({}, md, { value: cur })));
      box.appendChild(h("label", { class: "pl-roll" }, h("span", { class: "pl-roll-txt" }, line),
        lo === hi ? null : h("input", { type: "range", min: lo, max: hi, step: step, value: cur, "aria-label": line,
          oninput: function () { it.unique_rolls[i] = E.snapped(+this.value, step); this.previousSibling.textContent = E.describe(E.fromDict(Object.assign({}, md, { value: it.unique_rolls[i] }))); },
          onchange: function () { changed(); } })));
    });
    return box;
  }
  function socketEditor(it) {
    var b = E.base(it), max = E.maxSocketsFor(b, it.ilvl);
    var box = h("div", { class: "pl-socket-ed" });
    box.appendChild(h("h4", null, "Sockets"));
    if (!b.max_sockets) { box.appendChild(h("p", { class: "muted" }, "This piece takes no sockets.")); return box; }
    var counts = []; for (var n = 0; n <= max; n++) counts.push([n, n === 0 ? "None" : String(n)]);
    box.appendChild(h("div", { class: "pl-fields" }, field("How many", select(counts, it.sockets.length, function (v) {
      v = v | 0;
      while (it.sockets.length < v) { it.sockets.push({ c: ATTR_COLOUR[Object.keys(b.sock_attr || {})[0]] || "w", g: it.sockets.length ? it.sockets[it.sockets.length - 1].g : 0 }); it.gems.push(null); }
      it.sockets.length = v; it.gems.length = v; changed();
    }), max < b.max_sockets ? "Up to " + b.max_sockets + " at a higher item level" : "Up to " + b.max_sockets + " on this base")));
    var list = h("div", { class: "pl-socks" });
    it.sockets.forEach(function (s, i) {
      var g = it.gems[i];
      if (i > 0) list.appendChild(h("button", { class: "pl-linkbtn" + (s.g === it.sockets[i - 1].g ? " on" : ""), title: "Link to the socket above", "aria-label": "Link socket " + (i + 1) + " to socket " + i,
        onclick: function () { relink(it, i, s.g !== it.sockets[i - 1].g); changed(); } }, s.g === it.sockets[i - 1].g ? "Linked" : "Not linked"));
      var row = h("div", { class: "pl-sockrow" });
      row.appendChild(h("button", { class: "pl-sock big s-" + s.c, title: "Colour: " + COLOUR_NAME[s.c] + ". Click to change.", "aria-label": "Socket " + (i + 1) + " colour " + COLOUR_NAME[s.c],
        onclick: function () { s.c = "rgbw"["rgbw".indexOf(s.c) + 1] || "r"; changed(); } }));
      var opts = [{ group: "Skill glyphs", items: D.skills.slice().sort(function (a, c) { return a.name < c.name ? -1 : 1; }).map(function (x) { return ["s:" + x.id, x.name + " (" + cap(x.attr) + ")"]; }) },
        { group: "Support runes", items: D.supports.slice().sort(function (a, c) { return a.name < c.name ? -1 : 1; }).map(function (x) { return ["r:" + x.id, x.name + " (" + cap(x.sock_attr) + ")"]; }) }];
      row.appendChild(select([["", "Empty"]].concat(opts), g ? (g.support ? "r:" : "s:") + g.gem : "", function (v) {
        if (!v) it.gems[i] = null;
        else { var sup = v[0] === "r", id = v.slice(2); it.gems[i] = gem(id, sup, g ? g.level : Math.max(1, Math.min(20, S.level))); }
        changed();
      }, { "aria-label": "Socket " + (i + 1) }));
      if (g) {
        var sk = I.skills[g.gem] || I.supports[g.gem], maxL = (sk.max_level || 20);
        var lv = []; for (var l = 1; l <= maxL; l++) lv.push([l, "Level " + l]);
        row.appendChild(select(lv, g.level, function (v) { g.level = v | 0; changed(); }, { "aria-label": "Level" }));
        if (!g.support) { var qs = []; for (var q = 0; q <= 20; q++) qs.push([q, q ? "Quality " + q + "%" : "No quality"]); row.appendChild(select(qs, g.quality || 0, function (v) { g.quality = v | 0; changed(); }, { "aria-label": "Quality" })); }
        if (!E.gemFits(g, s.c)) row.appendChild(h("span", { class: "pl-badge bad" }, "Wrong colour"));
      }
      list.appendChild(row);
    });
    box.appendChild(list);
    return box;
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
        return h("li", { class: on ? "" : "off" }, icon("support_" + sp.sock_attr, "pl-ico sm"), sp.name + " (level " + g.level + ")", on ? null : h("span", { class: "pl-badge" }, "does not support " + s.name)); });
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

  // ---------------------------------------------------------------- the sheet
  function sheetPanel(ctx, full) {
    var d = ctx.d, ds = ctx.ds, box = h("div", { class: "pl-sheet pl-card" });
    function row(label, v, fmt, cls) {
      var a = fmt(v(d)), b = ds ? fmt(v(ds)) : null;
      return h("div", { class: "pl-row " + (cls || "") }, h("span", null, label), h("b", null, a), b != null && b !== a ? h("em", null, b) : null);
    }
    box.appendChild(h("h3", null, "Character sheet"));
    if (ds) box.appendChild(h("p", { class: "pl-note" }, "In italics: in the situation you set."));
    box.appendChild(h("h4", null, "Attributes"));
    box.appendChild(row("Strength", function (x) { return x.str; }, num));
    box.appendChild(row("Dexterity", function (x) { return x.dex; }, num));
    box.appendChild(row("Intelligence", function (x) { return x.int; }, num));
    box.appendChild(h("h4", null, "Defence"));
    box.appendChild(row("Life", function (x) { return x.life; }, num, "life"));
    box.appendChild(row("Mana", function (x) { return x.mana; }, num, "mana"));
    box.appendChild(row("Ward", function (x) { return x.ward; }, num, "ward"));
    box.appendChild(row("Armour", function (x) { return x.armor; }, num));
    box.appendChild(row("Evasion", function (x) { return x.evasion; }, num));
    box.appendChild(row("Block", function (x) { return Math.min(75, x.block); }, pct));
    box.appendChild(row("Spell block", function (x) { return Math.min(75, x.spell_block); }, pct));
    box.appendChild(row("Dodge", function (x) { return Math.min(75, x.dodge); }, pct));
    box.appendChild(row("Life regeneration", function (x) { return x.life_regen; }, function (v) { return num1(v) + "/s"; }));
    box.appendChild(row("Mana regeneration", function (x) { return x.mana_regen; }, function (v) { return num1(v) + "/s"; }));
    var res = h("div", { class: "pl-res" });
    [["fire", "Fire"], ["cold", "Cold"], ["lightning", "Lightning"], ["chaos", "Chaos"]].forEach(function (t) {
      var r = d["res_" + t[0]], m = d["max_res_" + t[0]], eff = Math.min(r, m);
      res.appendChild(h("div", { class: "pl-resb res-" + t[0] + (r >= m ? " capped" : r < 0 ? " neg" : "") , title: t[1] + " resistance " + Math.round(r) + "% (maximum " + Math.round(m) + "%)" },
        h("span", null, t[1]), h("b", null, pct(eff)), r > m ? h("small", null, "(" + Math.round(r) + ")") : h("small", null, "max " + Math.round(m))));
    });
    box.appendChild(h("h4", null, "Resistances"));
    box.appendChild(res);
    box.appendChild(h("h4", null, "Offence"));
    box.appendChild(row("Attack speed", function (x) { return x.attack_speed; }, signed));
    box.appendChild(row("Cast speed", function (x) { return x.cast_speed; }, signed));
    box.appendChild(row("Accuracy", function (x) { return x.accuracy; }, num));
    box.appendChild(row("Critical multiplier", function (x) { return x.crit_multi; }, pct));
    box.appendChild(row("Movement speed", function (x) { return x.move_speed; }, function (v) { return num1(v) + " m/s"; }));
    box.appendChild(row("Item rarity", function (x) { return x.item_rarity; }, signed));
    box.appendChild(row("Item quantity", function (x) { return x.item_quantity; }, signed));
    if (ctx.skills.length) {
      box.appendChild(h("h4", null, "Skills"));
      ctx.skills.forEach(function (x) {
        if (!x.s || x.s.preview.total <= 0) return;
        var rate = 1 / Math.max(x.s.use_time, 0.05);
        box.appendChild(h("div", { class: "pl-row" }, h("span", null, x.s.name), h("b", null, num(x.s.preview.total * rate) + "/s"), ds ? h("em", null, num(x.s.situational.total * rate) + "/s") : null));
      });
    }
    box.appendChild(h("h4", null, "Points"));
    box.appendChild(h("div", { class: "pl-row" + (d.passive_points < 0 ? " bad" : "") }, h("span", null, "Passive points left"), h("b", null, String(d.passive_points))));
    var sets = Object.keys(ctx.sheet.set_counts);
    if (sets.length) {
      box.appendChild(h("h4", null, "Sets"));
      sets.forEach(function (sid) { box.appendChild(h("div", { class: "pl-row" }, h("span", null, I.sets[sid].name), h("b", null, ctx.sheet.set_counts[sid] + " of " + I.sets[sid].pieces.length))); });
    }
    if (ctx.warn.length) box.appendChild(h("div", { class: "pl-sheet-warn" }, h("h4", null, "To look at"), h("ul", { class: "pl-warns" }, ctx.warn.map(function (w) { return h("li", null, w[1]); }))));
    return box;
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
    save(); refreshAfterWeb();
  }
  function refreshAfterWeb() {
    // keep the web as it is (its view and listeners) and redraw the rest
    var side = document.querySelector(".pl-side"), c = ch(), sheet = E.build(c), live = liveConds(sheet);
    var d = E.derived(c, sheet, {}), ds = hasSituation() ? E.derived(c, sheet, situation(), live) : null;
    var skills = E.socketedSkills(c).map(function (e) { return { e: e, s: E.resolve(c, sheet, e, situation(), live) }; });
    var ctx = { c: c, sheet: sheet, d: d, ds: ds, skills: skills, warn: warnings(c, sheet, d) };
    if (side) { side.textContent = ""; side.appendChild(sheetPanel(ctx, false)); }
    var cnt = document.querySelectorAll(".pl-tab .pl-count")[1];
    if (cnt) { cnt.textContent = String(d.passive_points); cnt.className = "pl-count" + (d.passive_points < 0 ? " bad" : ""); }
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
      if (hash && !b) flash("That link didn't hold a build this planner can read.");
      render();
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
