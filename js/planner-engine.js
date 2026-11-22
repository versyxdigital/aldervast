/* Aldervast build planner: the game's own stat maths, ported line for line from the game's code
   (core/stats/mod.gd, stat_block.gd, mod_text.gd; core/items/items.gd; core/character/character_sheet.gd;
   core/combat/damage_calc.gd, combatant.gd; core/skills/skill_resolver.gd; server/world_server.gd me_of).
   tools/planner_check (website generator) runs random builds through this and through the game itself and
   fails on any difference. Works in the browser (window.AVPlan) and in Node (module.exports). */
(function (root) {
  "use strict";
  var D = null, IDX = {};
  var TYPES = ["physical", "lightning", "cold", "fire", "chaos"];
  var ELEMENTAL = ["fire", "cold", "lightning"];
  var MAX_RES_DEFAULT = 75, BASE_RES = 25, BASE_MOVE_SPEED = 5.2;
  var KIND = { flat: 0, inc: 1, more: 2, flag: 3, override: 4 };
  var KIND_NAME = ["flat", "inc", "more", "flag", "override"];

  function byId(arr) { var o = {}; (arr || []).forEach(function (x) { o[x.id] = x; }); return o; }
  function init(data) {
    D = data;
    IDX = { classes: byId(data.classes), ancestries: byId(data.ancestries), bases: byId(data.bases), affixes: byId(data.affixes),
      uniques: byId(data.uniques), sets: byId(data.sets), skills: byId(data.skills), supports: byId(data.supports), specs: byId(data.specs),
      imbues: byId(data.imbues), weaves: byId(data.weaves), nodes: data.tree.nodes, starts: data.tree.starts };
    return IDX;
  }

  // ---- Godot number helpers
  function snapped(v, step) { return Math.floor(v / step + 0.5) * step; }
  function roundf(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }   // half away from zero, as Godot's roundf
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function trunc(v) { return v < 0 ? Math.ceil(v) : Math.floor(v); }   // int(float)

  // ---- Mod
  function mod(stat, kind, value, tags, cond, source) {
    return { stat: stat, kind: kind, value: value, tags: tags || [], cond: cond || "", source: source || "" };
  }
  function fromDict(d, source) {
    var k = KIND[String(d.kind == null ? "flat" : d.kind)];
    return mod(String(d.stat == null ? "" : d.stat), k == null ? 0 : k, Number(d.value == null ? 0 : d.value), (d.tags || []).slice(), String(d.cond || ""), source);
  }
  function applies(m, tags, cond) {
    for (var i = 0; i < m.tags.length; i++) if (tags.indexOf(m.tags[i]) < 0) return false;
    if (m.cond !== "" && !(cond && cond[m.cond])) return false;
    return true;
  }

  // ---- StatBlock
  function Stats() { this.by = {}; }
  Stats.prototype.add = function (m) { (this.by[m.stat] || (this.by[m.stat] = [])).push(m); };
  Stats.prototype.addMany = function (ms) { for (var i = 0; i < ms.length; i++) this.add(ms[i]); };
  Stats.prototype.all = function () { var o = []; for (var k in this.by) o = o.concat(this.by[k]); return o; };
  Stats.prototype.copy = function () { var s = new Stats(); for (var k in this.by) s.by[k] = this.by[k].slice(); return s; };
  Stats.prototype.parts = function (stat, tags, cond) {
    var flat = 0, inc = 0, more = 1, ovr = NaN, arr = this.by[stat] || [];
    tags = tags || [];
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!applies(m, tags, cond)) continue;
      if (m.kind === 0 || m.kind === 3) flat += m.value;
      else if (m.kind === 1) inc += m.value;
      else if (m.kind === 2) more *= (1 + m.value / 100);
      else if (m.kind === 4) ovr = m.value;
    }
    return [flat, inc, more, ovr];
  };
  Stats.prototype.value = function (stat, tags, cond) {
    var p = this.parts(stat, tags, cond);
    if (!isNaN(p[3])) return p[3];
    return p[0] * Math.max(0, 1 + p[1] / 100) * p[2];
  };
  Stats.prototype.flat = function (stat, tags, cond) { return this.parts(stat, tags, cond)[0]; };
  Stats.prototype.inc = function (stat, tags, cond) { return this.parts(stat, tags, cond)[1]; };
  Stats.prototype.mult = function (stat, tags, cond) { var p = this.parts(stat, tags, cond); return Math.max(0, 1 + p[1] / 100) * p[2]; };
  Stats.prototype.flag = function (stat) {
    var arr = this.by[stat] || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].value !== 0 && arr[i].cond === "") return true;
    return false;
  };

  // ---- Items
  function base(item) { return IDX.bases[item.base] || {}; }
  function itemTags(item) { var b = base(item); var t = (b.tags || []).slice(); t.push(String(b.class || "")); t.push(String(b.slot || "")); return t; }
  function affixMods(entry, src) {
    var a = IDX.affixes[entry.id];
    if (!a) return [];
    var tier = a.tiers[clamp(entry.tier | 0, 0, a.tiers.length - 1)];
    var out = [];
    for (var i = 0; i < tier.mods.length; i++) {
      var md = tier.mods[i];
      var d = { stat: md.stat, kind: md.kind, value: i < (entry.rolls || []).length ? Number(entry.rolls[i]) : Number(md.min) };
      if (md.tags) d.tags = md.tags;
      out.push(fromDict(d, src));
    }
    return out;
  }
  function allMods(item) {
    var src = "item:" + (item.uid || "");
    var out = [], b = base(item);
    (b.implicit || []).forEach(function (md) { out.push(fromDict(md, src)); });
    (item.prefixes || []).concat(item.suffixes || []).forEach(function (e) { out = out.concat(affixMods(e, src)); });
    if (item.unique) {
      var u = IDX.uniques[item.unique] || {}, rolls = item.unique_rolls || [];
      (u.mods || []).forEach(function (md, i) {
        var d = Object.assign({}, md);
        if (i < rolls.length) d.value = rolls[i];
        out.push(fromDict(d, src));
      });
      (u.flags || []).forEach(function (f) { out.push(mod("flag_" + f, 3, 1, [], "", src)); });
    }
    (item.corrupt_mods || []).forEach(function (md) { out.push(fromDict(md, src)); });
    if (item.crafted) (item.crafted.mods || []).forEach(function (md) { out.push(fromDict(md, src)); });
    if (item.woven) (item.woven.mods || []).forEach(function (md) { out.push(fromDict(md, src)); });
    return out;
  }
  function isLocal(m) { return m.stat.indexOf("local_") === 0; }
  function globalMods(item) { return allMods(item).filter(function (m) { return !isLocal(m); }); }
  function localSum(mods, stat, kind) { var s = 0; mods.forEach(function (m) { if (m.stat === stat && m.kind === kind) s += m.value; }); return s; }
  function weaponStats(item) {
    var b = base(item);
    if (!b.phys) return null;
    var mods = allMods(item), q = Number(item.quality || 0);
    var pinc = localSum(mods, "local_phys", 1) + q;
    var pmin = (Number(b.phys[0]) + localSum(mods, "local_phys_min", 0)) * (1 + pinc / 100);
    var pmax = (Number(b.phys[1]) + localSum(mods, "local_phys_max", 0)) * (1 + pinc / 100);
    var dmg = { physical: [roundf(pmin), roundf(pmax)] };
    ["fire", "cold", "lightning", "chaos"].forEach(function (t) {
      var mn = localSum(mods, "local_" + t + "_min", 0), mx = localSum(mods, "local_" + t + "_max", 0);
      if (mx > 0) dmg[t] = [mn, mx];
    });
    var aps = Number(b.aps) * (1 + localSum(mods, "local_aps", 1) / 100);
    var crit = Number(b.crit) * (1 + localSum(mods, "local_crit", 1) / 100);
    return { damage: dmg, aps: snapped(aps, 0.01), crit: snapped(crit, 0.01) };
  }
  function defenseStats(item) {
    var b = base(item), d = b.defense || {}, out = {};
    var keys = Object.keys(d);
    if (!keys.length) return out;
    var mods = allMods(item), q = Number(item.quality || 0);
    keys.forEach(function (k) {
      var flat = Number(d[k]) + localSum(mods, "local_" + k, 0);
      var inc = localSum(mods, "local_" + k, 1) + q;
      out[k] = roundf(flat * (1 + inc / 100));
    });
    return out;
  }
  function avg(r) { return (Number(r[0]) + Number(r[1])) * 0.5; }
  function itemDps(item) {
    var w = weaponStats(item);
    if (!w) return 0;
    var tot = 0;
    for (var t in w.damage) tot += avg(w.damage[t]);
    return tot * w.aps;
  }
  function gemLevelReq(sk, level) { return (sk.level_req || 1) + trunc((level - 1) * 2.6); }
  function requirements(item) {
    if (item.kind === "gem") {
      var sk = IDX.skills[item.gem] || IDX.supports[item.gem] || {};
      var lvl = gemLevelReq(sk, item.level || 1);
      var r = { level: Math.min(lvl, 60) };
      r[sk.attr || "int"] = trunc(8 + lvl * 1.4);
      return r;
    }
    if (item.starter) return { level: 1 };
    var b = base(item);
    var req = Object.assign({}, b.req || {});
    req.level = b.level || 1;
    if (item.unique) req.level = Math.max(req.level, (IDX.uniques[item.unique] || {}).level || 1);
    (item.prefixes || []).concat(item.suffixes || []).forEach(function (e) {
      var a = IDX.affixes[e.id];
      if (a) req.level = Math.max(req.level, trunc(Number(a.tiers[e.tier | 0].ilvl) * 0.8));
    });
    return req;
  }
  function meets(item, level, attrs) {
    var req = requirements(item);
    if (level < (req.level || 1)) return false;
    return ["str", "dex", "int"].every(function (a) { return (attrs[a] || 0) >= (req[a] || 0); });
  }
  function supportAttr(gemId) { var s = IDX.supports[gemId]; return s ? (s.sock_attr || s.attr || "int") : "int"; }
  function gemAttr(gem) { return gem.support ? supportAttr(gem.gem) : ((IDX.skills[gem.gem] || IDX.supports[gem.gem] || {}).attr || "int"); }
  var SOCKET_ATTR = { r: "str", g: "dex", b: "int" };
  function gemFits(gem, colour) { return colour === "w" || SOCKET_ATTR[colour] === gemAttr(gem); }
  function maxAffixes(rarity) { return rarity === 1 ? 1 : (rarity === 2 ? 3 : 0); }
  function affixWeight(a, tags) {
    var w = 0, ws = a.weights || {};
    for (var i = 0; i < tags.length; i++) if (ws.hasOwnProperty(tags[i])) { var v = ws[tags[i]] | 0; if (v === 0) return 0; w = Math.max(w, v); }
    return w;
  }
  // affixes that can roll on this base at this item level (what Items.add_random_affix chooses among)
  function affixOptions(item, type) {
    var tags = itemTags(item), ilvl = item.ilvl || 1;
    return D.affixes.filter(function (a) { return a.type === type && affixWeight(a, tags) > 0 && a.tiers[0].ilvl <= ilvl; });
  }
  function maxSocketsFor(b, ilvl) {
    var mx = b.max_sockets || 0;
    if (ilvl < 10) mx = Math.min(mx, 2); else if (ilvl < 25) mx = Math.min(mx, 3); else if (ilvl < 35) mx = Math.min(mx, 4); else if (ilvl < 50) mx = Math.min(mx, 5);
    return mx;
  }

  // ---- Character sheet
  function weaponTags(ch) {
    var out = [], eq = ch.equipment || {};
    var mh = eq.main_hand, oh = eq.off_hand;
    if (mh) (base(mh).tags || []).forEach(function (t) { if (["sword", "axe", "mace", "dagger", "wand", "staff", "crossbow", "one_hand", "two_hand"].indexOf(t) >= 0) out.push(t); });
    if (oh) { var ot = base(oh).tags || []; if (ot.indexOf("shield") >= 0) out.push("shield"); else if (ot.indexOf("weapon") >= 0) out.push("dual_wield"); }
    return out;
  }
  function missingWeapon(ch, sk) {
    var req = sk.requires || [];
    if (!req.length) return "";
    var wt = weaponTags(ch);
    for (var i = 0; i < req.length; i++) if (wt.indexOf(String(req[i])) < 0) return String(req[i]);
    return "";
  }
  function build(ch) {
    var s = new Stats();
    var cls = IDX.classes[ch.class] || {}, anc = IDX.ancestries[ch.ancestry] || {};
    var lvl = ch.level || 1;
    s.add(mod("life", 0, Number(cls.base_life == null ? 50 : cls.base_life) + 20 + 12 * (lvl - 1), [], "", "base"));
    s.add(mod("mana", 0, Number(cls.base_mana == null ? 40 : cls.base_mana) + 6 * (lvl - 1), [], "", "base"));
    s.add(mod("evasion", 0, 20 + 3 * lvl, [], "", "base"));
    s.add(mod("accuracy", 0, 20 + 2 * lvl, [], "", "base"));
    if (lvl >= 2) s.add(mod("res_elemental", 0, Math.min(BASE_RES, Math.floor(lvl * 0.5)), [], "", "base"));
    ["str", "dex", "int"].forEach(function (a) { var v = (cls.attributes || {})[a]; s.add(mod(a, 0, Number(v == null ? 10 : v), [], "", "base")); });
    (anc.mods || []).forEach(function (md) { s.add(fromDict(md, "ancestry")); });
    (ch.passives || []).forEach(function (id) { (IDX.nodes[id | 0].mods || []).forEach(function (md) { s.add(fromDict(md, "passive")); }); });
    var spec = IDX.specs[ch.spec || ""] || {};
    (ch.spec_nodes || []).forEach(function (nid) { (spec.nodes || []).forEach(function (n) { if (String(n.id) === String(nid)) (n.mods || []).forEach(function (md) { s.add(fromDict(md, "spec")); }); }); });
    var setCounts = {}, eq = ch.equipment || {};
    Object.keys(eq).forEach(function (slot) {
      var it = eq[slot];
      if (!it) return;
      s.addMany(globalMods(it));
      var ds = defenseStats(it);
      for (var k in ds) s.add(mod(k, 0, ds[k], [], "", "item:" + (it.uid || "")));
      if (it.set) setCounts[it.set] = (setCounts[it.set] || 0) + 1;
    });
    Object.keys(setCounts).forEach(function (sid) {
      var sd = IDX.sets[sid] || {};
      Object.keys(sd.bonuses || {}).forEach(function (k) {
        if (setCounts[sid] >= (k | 0)) sd.bonuses[k].forEach(function (md) { s.add(fromDict(md, "set")); });
      });
    });
    var attrs = { str: s.value("str"), dex: s.value("dex"), int: s.value("int") };
    s.add(mod("life", 0, Math.floor(attrs.str * 0.5), [], "", "attr"));
    s.add(mod("damage", 1, Math.floor(attrs.str / 5), ["melee", "physical"], "", "attr"));
    s.add(mod("accuracy", 0, attrs.dex * 2, [], "", "attr"));
    s.add(mod("evasion", 1, Math.floor(attrs.dex / 5), [], "", "attr"));
    s.add(mod("mana", 0, Math.floor(attrs.int * 0.5), [], "", "attr"));
    s.add(mod("ward", 1, Math.floor(attrs.int / 5), [], "", "attr"));
    var flags = {};
    s.all().forEach(function (m) { if (m.stat.indexOf("flag_") === 0) flags[m.stat.substr(5)] = true; });
    return { stats: s, attrs: attrs, set_counts: setCounts, flags: flags };
  }
  function socketedSkills(ch) {
    var out = [], eq = ch.equipment || {};
    Object.keys(eq).forEach(function (slot) {
      var item = eq[slot];
      if (!item) return;
      var socks = item.sockets || [], gems = item.gems || [];
      for (var i = 0; i < socks.length; i++) {
        if (i >= gems.length || !gems[i]) continue;
        var g = gems[i];
        if (g.support) continue;
        var sups = [];
        for (var j = 0; j < socks.length; j++)
          if (j !== i && j < gems.length && gems[j] && (socks[j].g | 0) === (socks[i].g | 0) && gems[j].support) sups.push(gems[j]);
        out.push({ gem: g, slot: slot, index: i, group: socks[i].g | 0, supports: sups });
      }
    });
    return out;
  }

  // ---- Combatant (a hero standing in the world with the sheet's stats and no statuses)
  function resist(st, t, c) { var r = st.value("res_" + t, [], c); if (ELEMENTAL.indexOf(t) >= 0) r += st.value("res_elemental", [], c); return r; }
  function maxRes(st, t) { return MAX_RES_DEFAULT + st.flat("max_res_" + t); }
  function actionSpeed(st) { return clamp(st.mult("action_speed"), 0.3, 2.0); }
  function moveSpeed(st, c) {
    var cond = (st.by.move_speed || []).some(function (m) { return m.cond !== ""; });
    return Math.max(0.5, BASE_MOVE_SPEED * st.mult("move_speed", [], cond ? c : {}) * actionSpeed(st));
  }
  function useSpeed(st, tags, c, fervor) {
    var stat = tags.indexOf("attack") >= 0 ? "attack_speed" : "cast_speed";
    var m = st.mult(stat, tags, c) * actionSpeed(st);
    m *= 1 + 0.04 * (fervor || 0);
    return clamp(m, 0.1, 5.0);
  }
  function critMulti(st, tags, c) { return 150 + st.flat("crit_multi", tags, c) * st.mult("crit_multi_scale", tags, c); }
  // what the game's character window shows (WorldServer.me_of "derived"); c: the situation (Combatant.conditions)
  // the state a hero is in when nothing has happened to them (Combatant.conditions at full life and mana, standing)
  function restConds(ward) { return { full_life: true, low_life: false, full_mana: true, moving: false, stationary: true, killed_recently: false,
    crit_recently: false, damaged_recently: false, has_ward: ward > 0, has_bulwark: false, has_fervor: false, has_insight: false }; }
  // c: the conditions the sheet's numbers are read with (the game's window: none); live: the hero's state for the speeds the
  // game reads off its Combatant (move and use speed; the rest state when not given)
  function derived(ch, sheet, c, live) {
    c = c || {};
    var st = sheet.stats;
    var life = Math.max(1, st.value("life", [], c)), mana = Math.max(0, st.value("mana", [], c)), ward = Math.max(0, st.value("ward", [], c));
    live = live || restConds(ward);
    var d = { life: life, mana: mana, ward: ward, armor: st.value("armor", [], c), evasion: st.value("evasion", [], c),
      block: st.flat("block", [], c), spell_block: st.flat("spell_block", [], c), dodge: st.flat("dodge", [], c), phys_reduction: st.flat("phys_reduction", [], c),
      move_speed: moveSpeed(st, live), attack_speed: st.mult("attack_speed", [], c) * 100 - 100, cast_speed: st.mult("cast_speed", [], c) * 100 - 100,
      crit_multi: critMulti(st, [], c), life_regen: st.value("life_regen", [], c) + life * st.value("life_regen_pct", [], c) / 100,
      mana_regen: mana * 0.03 * st.mult("mana_regen", [], live) + st.flat("mana_regen_flat"),
      accuracy: st.value("accuracy", [], c), item_rarity: st.value("item_rarity", [], c), item_quantity: st.value("item_quantity", [], c),
      str: sheet.attrs.str, dex: sheet.attrs.dex, int: sheet.attrs.int,
      passive_points: (ch.level || 1) - 1 + (ch.bonus_points || 0) - (ch.passives || []).length,
      spec_points: (ch.spec_points || 0) - (ch.spec_nodes || []).length };
    ["fire", "cold", "lightning", "chaos"].forEach(function (t) { d["res_" + t] = resist(st, t, c); d["max_res_" + t] = maxRes(st, t); });
    return d;
  }

  // ---- DamageCalc
  function withAdded(src, baseD, tags, cond, eff) {
    var out = {};
    TYPES.forEach(function (t) {
      var r = baseD[t] || [0, 0];
      var mn = Number(r[0]) + src.flat("added_" + t + "_min", tags, cond) * eff;
      var mx = Number(r[1]) + src.flat("added_" + t + "_max", tags, cond) * eff;
      if (mx > 0) out[t] = [mn, Math.max(mn, mx)];
    });
    return out;
  }
  function convertPortions(src, rolled, tags, cond) {
    var pending = {};
    TYPES.forEach(function (t) { pending[t] = []; if (rolled[t] > 0) pending[t].push({ type: t, amount: rolled[t], hist: [t] }); });
    var fin = [];
    for (var i = 0; i < TYPES.length; i++) {
      var t = TYPES[i], later = TYPES.slice(i + 1), conv = {}, convKeys = [], convTotal = 0;
      later.forEach(function (d) { var c = src.flat("conv_" + t + "_" + d, tags, cond); if (c > 0) { conv[d] = c; convKeys.push(d); convTotal += c; } });
      var scale = 1;
      if (convTotal > 100) { scale = 100 / convTotal; convTotal = 100; }
      pending[t].forEach(function (p) {
        later.forEach(function (d) {
          var ex = src.flat("extra_" + t + "_" + d, tags, cond);
          if (ex > 0) { var h = p.hist.slice(); if (h.indexOf(d) < 0) h.push(d); pending[d].push({ type: d, amount: p.amount * ex / 100, hist: h }); }
        });
        convKeys.forEach(function (d) { var h2 = p.hist.slice(); if (h2.indexOf(d) < 0) h2.push(d); pending[d].push({ type: d, amount: p.amount * conv[d] * scale / 100, hist: h2 }); });
        var remain = p.amount * (1 - convTotal / 100);
        if (remain > 0.0001) fin.push({ type: t, amount: remain, hist: p.hist });
      });
    }
    return fin;
  }
  function contextTags(tags, hist) {
    var ctx = tags.slice();
    hist.forEach(function (h) { if (ctx.indexOf(h) < 0) ctx.push(h); if (ELEMENTAL.indexOf(h) >= 0 && ctx.indexOf("elemental") < 0) ctx.push("elemental"); });
    return ctx;
  }
  function critChance(src, tags, critBase, cond) { return clamp((critBase + src.flat("crit_chance", tags, cond)) * src.mult("crit_chance", tags, cond), 0, 100); }
  function expectedHit(src, skill, cond) {
    var tags = skill.tags, ranges = withAdded(src, skill.base, tags, cond, skill.effectiveness), rolled = {};
    for (var t in ranges) rolled[t] = avg(ranges[t]);
    var portions = convertPortions(src, rolled, tags, cond), out = {}, total = 0;
    portions.forEach(function (p) { var a = p.amount * src.mult("damage", contextTags(tags, p.hist), cond); out[p.type] = (out[p.type] || 0) + a; total += a; });
    var cc = critChance(src, tags, skill.crit, cond) / 100, cm = critMulti(src, tags, cond) / 100;
    return { dmg: out, total: total * (1 + cc * (cm - 1)), crit_chance: cc * 100, crit_multi: cm * 100, ranges: ranges };
  }

  // ---- SkillResolver
  function supportApplies(sup, skill, tags) {
    var req = sup.requires || [];
    for (var i = 0; i < req.length; i++) {
      var ok = String(req[i]).split("|").some(function (alt) { return tags.indexOf(alt) >= 0 || skill.kind === alt; });
      if (!ok) return false;
    }
    return !(sup.excludes || []).some(function (ex) { return tags.indexOf(ex) >= 0 || skill.kind === ex; });
  }
  function runeRatio(s, bs, stat, tags) { return clamp(s.mult(stat, tags) / Math.max(0.01, bs.mult(stat, tags)), 0.2, 5.0); }
  // c: the situation for the planner's own figures ({} for the game's); live: the hero's state for its use speed
  function resolve(ch, sheet, entry, c, live) {
    c = c || {};
    live = live || restConds(Math.max(0, sheet.stats.value("ward")));
    var gem = entry.gem, sk = IDX.skills[gem.gem];
    if (!sk) return null;
    var bs = sheet.stats, s = bs.copy();
    var tags = (sk.tags || []).slice(), wtags = weaponTags(ch), usesWeapon = !!sk.weapon;
    wtags.forEach(function (t) { if ((usesWeapon || t === "shield" || t === "dual_wield") && tags.indexOf(t) < 0) tags.push(t); });
    var costMult = 1, transform = "", applied = [], skipped = [];
    (entry.supports || []).forEach(function (sg) {
      var sup = IDX.supports[sg.gem];
      if (!sup) return;
      if (!supportApplies(sup, sk, tags)) { skipped.push(sup.id); return; }
      applied.push(sup.id);
      costMult *= Number(sup.cost_mult == null ? 1 : sup.cost_mult);
      var slvl = sg.level || 1;
      (sup.mods || []).forEach(function (md) {
        var m = fromDict(md, "support:" + sup.id);
        if (sup.level_scale_added && m.stat.indexOf("added_") === 0) m.value *= 1 + 0.18 * (slvl - 1);
        else if (m.kind === 2 && m.value > 0) m.value += 0.5 * (slvl - 1);
        s.add(m);
      });
      if (sup.transform) transform = String(sup.transform);
    });
    if (transform === "trap" && tags.indexOf("trap") < 0) tags.push("trap");
    if (transform === "totem" && tags.indexOf("totem") < 0) tags.push("totem");
    var conv = sk.conv || {};
    Object.keys(conv).forEach(function (a) { Object.keys(conv[a]).forEach(function (b) { s.add(mod("conv_" + a + "_" + b, 0, Number(conv[a][b]), [], "", "skill")); }); });
    var level = clamp((gem.level || 1) + trunc(s.value("skill_level", tags)), 1, 30);
    var quality = gem.quality || 0;
    if (quality > 0) s.add(mod("damage", 1, quality, [], "", "quality"));
    var baseD = {}, crit = Number(sk.crit == null ? 5 : sk.crit), useTime = Number(sk.cast_time == null ? 0.8 : sk.cast_time);
    if (usesWeapon) {
      var mh = (ch.equipment || {}).main_hand, ws = mh ? weaponStats(mh) : null;
      var pct = (Number(sk.weapon_pct == null ? 100 : sk.weapon_pct) + 2 * (level - 1)) / 100;
      if (!ws) { baseD = { physical: [2 * pct, 6 * pct] }; useTime = 1 / 1.2; }
      else {
        for (var t in ws.damage) baseD[t] = [ws.damage[t][0] * pct, ws.damage[t][1] * pct];
        crit = ws.crit; useTime = 1 / ws.aps;
        if (wtags.indexOf("dual_wield") >= 0) useTime *= 0.85;
      }
    } else {
      var growth = Math.pow(Number(sk.growth == null ? 1.1 : sk.growth), level - 1);
      for (var t2 in (sk.base || {})) baseD[t2] = [sk.base[t2][0] * growth, sk.base[t2][1] * growth];
    }
    var eff = Number(sk.effectiveness == null ? 1 : sk.effectiveness);
    var supSpeed = runeRatio(s, bs, tags.indexOf("attack") >= 0 ? "attack_speed" : "cast_speed", tags);
    useTime /= supSpeed;
    var manaBase = Number(sk.mana || 0) * (1 + 0.06 * (level - 1)) * costMult;
    var snap = { id: sk.id, name: sk.name, kind: sk.kind, level: level, tags: tags, supports: applied, skipped: skipped, transform: transform,
      base: baseD, crit: crit, effectiveness: eff, support_speed: supSpeed, use_time_base: useTime,
      mana_cost: roundf(manaBase * s.mult("mana_cost", tags)),
      cooldown: Number(sk.cooldown || 0) / runeRatio(s, bs, "cooldown_recovery", tags),
      count: (sk.count == null ? 1 : sk.count) + trunc(s.value("projectile_count", tags)),
      pierce: (sk.pierce || 0) + trunc(s.value("pierce", tags)), chain: (sk.chain || 0) + trunc(s.value("chain", tags)),
      repeat: (sk.repeat == null ? 1 : sk.repeat) + trunc(s.value("repeat", tags)),
      area_mult: Math.sqrt(Math.max(0.1, s.mult("area", tags))), stats: s };
    if (sk.radius != null) snap.radius = sk.radius * snap.area_mult;
    if (sk.duration != null) snap.duration = sk.duration * s.mult("duration", tags);
    var ail = {};
    ["ignite", "bleed", "poison", "freeze", "shock"].forEach(function (a) { ail[a] = Number((sk.ailments || {})[a] || 0) + s.value(a + "_chance", tags); });
    snap.ailments = ail;
    var pen = {};
    ["fire", "cold", "lightning", "chaos"].forEach(function (t) { var p = s.value("pen_" + t, tags); if (p !== 0) pen[t] = p; });
    snap.pen = pen;
    snap.accuracy = s.value("accuracy", tags);
    snap.on_hit = { life_leech: s.flat("life_leech", tags), mana_leech: s.flat("mana_leech", tags), life_on_hit: s.flat("life_on_hit", tags) };
    snap.preview = expectedHit(s, { tags: tags, base: baseD, effectiveness: eff, crit: crit }, {});
    // the use time the game's window shows (WorldServer.me_of): the snapshot's over the hero's own speed
    snap.use_time = snap.use_time_base / Math.max(0.1, useSpeed(bs, tags, live, live._fervor || 0));
    snap.missing = missingWeapon(ch, sk);
    // with the situation on (the planner's own: the game's preview is worked out with none)
    snap.situational = Object.keys(c).some(function (k) { return c[k] && k[0] !== "_"; }) ? expectedHit(s, { tags: tags, base: baseD, effectiveness: eff, crit: crit }, c) : snap.preview;
    return snap;
  }

  // ---- ModText
  var NAMES = {"life":"maximum Life","mana":"maximum Mana","ward":"maximum Ward","armor":"Armour","evasion":"Evasion Rating","str":"Strength","dex":"Dexterity","int":"Intelligence","damage":"Damage","attack_speed":"Attack Speed","cast_speed":"Cast Speed","crit_chance":"Critical Strike Chance","crit_multi":"Critical Strike Multiplier","accuracy":"Accuracy Rating","projectile_speed":"Projectile Speed","projectile_count":"additional Projectiles","pierce":"additional Pierces","chain":"additional Chains","area":"Area of Effect","duration":"Skill Effect Duration","cooldown_recovery":"Cooldown Recovery Rate","mana_cost":"Mana Cost of Skills","move_speed":"Movement Speed","res_fire":"Fire Resistance","res_cold":"Cold Resistance","res_lightning":"Lightning Resistance","res_chaos":"Chaos Resistance","res_elemental":"all Elemental Resistances","max_res_fire":"maximum Fire Resistance","max_res_cold":"maximum Cold Resistance","max_res_lightning":"maximum Lightning Resistance","life_regen":"Life Regenerated per second","life_regen_pct":"of Life Regenerated per second","mana_regen":"Mana Regeneration Rate","ward_recharge":"Ward Recharge Rate","block":"Chance to Block Attack Damage","spell_block":"Chance to Block Spell Damage","dodge":"Chance to Dodge Hits","phys_reduction":"additional Physical Damage Reduction","damage_taken":"Damage taken","life_leech":"of Damage Leeched as Life","mana_leech":"of Damage Leeched as Mana","life_on_hit":"Life gained for each Enemy hit","life_on_kill":"Life gained on Kill","mana_on_kill":"Mana gained on Kill","ignite_chance":"chance to Ignite","bleed_chance":"chance to cause Bleeding","poison_chance":"chance to Poison","freeze_chance":"chance to Freeze","shock_chance":"chance to Shock","ailment_duration":"Duration of Ailments","ailment_avoid":"chance to Avoid Ailments and Stuns","minion_life":"Minion maximum Life","minion_count":"maximum number of Minions","minion_speed":"Minion Movement Speed","totem_life":"Totem Life","totem_limit":"additional Totem allowed","trap_limit":"additional Trap allowed","aura_effect":"effect of Auras from your Skills","curse_effect":"effect of your Curses","buff_effect":"effect of Buffs","bulwark_on_kill":"chance to gain a Bulwark Charge on Kill","fervor_on_kill":"chance to gain a Fervor Charge on Kill","insight_on_crit":"chance to gain an Insight Charge on Critical Strike","max_bulwark":"maximum Bulwark Charges","max_fervor":"maximum Fervor Charges","max_insight":"maximum Insight Charges","skill_level":"to Level of Skill Glyphs","item_rarity":"Rarity of Items found","item_quantity":"Quantity of Items found","xp_gain":"Experience gained","healing_received":"Healing received","stun_bonus":"Stun Duration on enemies","action_speed":"Action Speed","repeat":"additional repeats","dot_taken":"Damage over Time taken","pen_fire":"Fire Penetration","pen_cold":"Cold Penetration","pen_lightning":"Lightning Penetration","pen_chaos":"Chaos Penetration","ward_delay":"Ward Recharge Delay","local_armor":"Armour","local_evasion":"Evasion Rating","local_ward":"Ward","local_phys":"Physical Damage","local_aps":"Attack Speed","local_crit":"Critical Strike Chance","mana_regen_flat":"Mana Regenerated per second"};
  var PERCENT_FLAT = ["block","spell_block","dodge","phys_reduction","life_leech","mana_leech","ignite_chance","bleed_chance","poison_chance","freeze_chance","shock_chance","ailment_avoid","bulwark_on_kill","fervor_on_kill","insight_on_crit","res_fire","res_cold","res_lightning","res_chaos","res_elemental","max_res_fire","max_res_cold","max_res_lightning","life_regen_pct","crit_multi","pen_fire","pen_cold","pen_lightning","pen_chaos","crit_chance"];
  var TAG_WORDS = {"fire":"Fire","cold":"Cold","lightning":"Lightning","chaos":"Chaos","physical":"Physical","elemental":"Elemental","spell":"Spell","attack":"Attack","melee":"Melee","projectile":"Projectile","area":"Area","minion":"Minion","dot":"over Time","trap":"Trap","totem":"Totem","warcry":"Warcry","curse":"Curse","aura":"Aura","axe":"with Axes","sword":"with Swords","mace":"with Maces","dagger":"with Daggers","wand":"with Wands","staff":"with Staves","crossbow":"with Crossbows","two_hand":"with Two Handed Weapons","one_hand":"with One Handed Weapons","dual_wield":"while Dual Wielding","shield":"while holding a Shield"};
  var COND_WORDS = {"full_life":"while on Full Life","low_life":"while on Low Life","stationary":"while Stationary","moving":"while Moving","killed_recently":"if you've Killed Recently","crit_recently":"if you've Crit Recently","target_low_life":"against enemies on Low Life","has_ward":"while you have Ward","has_fervor":"while you have a Fervor Charge"};
  var FLAG_WORDS = {"cannot_be_stunned":"Cannot be Stunned","cost_life":"Skills cost Life instead of Mana","fork":"Projectiles Fork","immune_chilled":"Cannot be Chilled","immune_frozen":"Cannot be Frozen","no_life_regen":"You cannot Regenerate Life"};
  // Godot's String.capitalize(): words split at "_", spaces and case changes, each capitalised
  function capitalize(s) {
    s = String(s).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return s.split(" ").map(function (w) { return w ? w.charAt(0).toUpperCase() + w.substr(1).toLowerCase() : w; }).join(" ");
  }
  function numStr(v) { var x = snapped(Math.abs(v), 0.1); var t = String(Number(x.toPrecision(14))); return t; }
  function tagPhrase(m) {
    var pre = [], post = [];
    m.tags.forEach(function (t) { var w = TAG_WORDS[t] || capitalize(t); if (w.indexOf("with ") === 0 || w.indexOf("while ") === 0 || w === "over Time") post.push(w); else pre.push(w); });
    return [pre.join(" "), post.join(" ")];
  }
  function describe(m) {
    var s = m.stat;
    if (s.indexOf("flag_") === 0) return capitalize(s.substr(5));
    if (m.kind === 3) return FLAG_WORDS[s] || capitalize(s);
    var name = NAMES[s] || capitalize(s.replace(/_/g, " "));
    if (s.indexOf("added_") === 0) { var parts = s.split("_"); name = (parts[2] === "min" ? "minimum" : "maximum") + " " + capitalize(parts[1]) + " Damage"; }
    else if (s.indexOf("conv_") === 0) { var p = s.split("_"); return trunc(m.value) + "% of " + capitalize(p[1]) + " Damage Converted to " + capitalize(p[2]) + " Damage"; }
    else if (s.indexOf("extra_") === 0) { var p2 = s.split("_"); return "Gain " + trunc(m.value) + "% of " + capitalize(p2[1]) + " Damage as Extra " + capitalize(p2[2]) + " Damage"; }
    var tp = tagPhrase(m), full = name;
    if (["damage", "attack_speed", "cast_speed", "crit_chance", "crit_multi"].indexOf(s) >= 0) {
      full = (tp[0] + " " + name).trim();
      if (tp[1] !== "") full += " " + tp[1];
    } else if (tp[0] !== "" || tp[1] !== "") full = (tp[0] + " " + name + " " + tp[1]).trim();
    var cond = m.cond !== "" ? " " + (COND_WORDS[m.cond] || m.cond.replace(/_/g, " ")) : "";
    var v = m.value, vs = numStr(v);
    if (m.kind === 0) {
      if (PERCENT_FLAT.indexOf(s) >= 0) return (v >= 0 ? "+" : "-") + vs + "% " + full + cond;
      return (v >= 0 ? "+" : "-") + vs + " " + full + cond;
    }
    if (m.kind === 1) return vs + "% " + (v >= 0 ? "increased" : "reduced") + " " + full + cond;
    if (m.kind === 2) return vs + "% " + (v >= 0 ? "more" : "less") + " " + full + cond;
    if (m.kind === 4) return full + " is " + vs + cond;
    return full;
  }
  function describeRange(lo, hi) {
    var a = lo.stat, b = hi.stat;
    if (!/_min$/.test(a) || b !== a.replace(/_min$/, "") + "_max" || lo.kind !== 0 || hi.kind !== 0) return "";
    if (!(a.indexOf("local_") === 0 || a.indexOf("added_") === 0)) return "";
    var t = a.replace(/_min$/, "").split("_")[1] || "";
    var word = (t === "phys" || t === "physical") ? "Physical" : capitalize(t);
    var out = "Adds " + trunc(lo.value) + " to " + trunc(hi.value) + " " + word + " Damage";
    if (a.indexOf("added_") === 0) { if (lo.tags.indexOf("attack") >= 0) out += " to Attacks"; else if (lo.tags.indexOf("spell") >= 0) out += " to Spells"; }
    if (lo.cond !== "") out += " " + (COND_WORDS[lo.cond] || lo.cond.replace(/_/g, " "));
    return out;
  }
  function describeAll(mods) {
    var out = [], i = 0;
    while (i < mods.length) {
      if (i + 1 < mods.length) { var r = describeRange(mods[i], mods[i + 1]); if (r !== "") { out.push(r); i += 2; continue; } }
      out.push(describe(mods[i])); i += 1;
    }
    return out;
  }

  // ---- the passive web's rules (core/passive/passive_tree.gd)
  function canAllocate(alloc, nid, classId) {
    var n = IDX.nodes[nid];
    if (!n || n.kind === "start" || alloc.indexOf(nid) >= 0) return false;
    var st = IDX.starts[classId];
    return n.links.some(function (nb) { return nb === st || alloc.indexOf(nb) >= 0; });
  }
  function reachable(set, start) {
    var seen = {}; seen[start] = true;
    var stack = [start];
    while (stack.length) { var cur = stack.pop(); IDX.nodes[cur].links.forEach(function (nb) { if (set[nb] && !seen[nb]) { seen[nb] = true; stack.push(nb); } }); }
    for (var a in set) if (!seen[a]) return false;
    return true;
  }
  function canRefund(alloc, nid, classId) {
    if (alloc.indexOf(nid) < 0) return false;
    var s = {}; alloc.forEach(function (a) { if (a !== nid) s[a] = true; });
    return reachable(s, IDX.starts[classId]);
  }
  // the nodes kept when the class changes or a node is taken off: those still joined to the start
  function mended(alloc, classId) {
    var have = {}; alloc.forEach(function (a) { have[a] = true; });
    var st = IDX.starts[classId], seen = {}; seen[st] = true;
    var stack = [st];
    while (stack.length) { var cur = stack.pop(); IDX.nodes[cur].links.forEach(function (nb) { if (have[nb] && !seen[nb]) { seen[nb] = true; stack.push(nb); } }); }
    return alloc.filter(function (a) { return seen[a]; });
  }
  // shortest way of untaken nodes to nid from what is taken (or the class's start)
  function pathTo(alloc, nid, classId) {
    var st = IDX.starts[classId], have = {}; alloc.forEach(function (a) { have[a] = true; }); have[st] = true;
    if (have[nid]) return [];
    var prev = {}, q = [], seen = {};
    Object.keys(have).forEach(function (k) { q.push(k | 0); seen[k] = true; });
    while (q.length) {
      var cur = q.shift();
      if (cur === nid) break;
      var links = IDX.nodes[cur].links;
      for (var i = 0; i < links.length; i++) {
        var nb = links[i];
        if (seen[nb] || IDX.nodes[nb].kind === "start") continue;
        seen[nb] = true; prev[nb] = cur; q.push(nb);
      }
    }
    if (!seen[nid]) return null;
    var path = [], c = nid;
    while (!have[c]) { path.unshift(c); c = prev[c]; }
    return path;
  }

  var API = { init: init, Stats: Stats, mod: mod, fromDict: fromDict, KIND: KIND, KIND_NAME: KIND_NAME, base: base, itemTags: itemTags, allMods: allMods,
    globalMods: globalMods, affixMods: affixMods, weaponStats: weaponStats, defenseStats: defenseStats, itemDps: itemDps, requirements: requirements,
    meets: meets, gemAttr: gemAttr, gemFits: gemFits, maxAffixes: maxAffixes, affixOptions: affixOptions, affixWeight: affixWeight, maxSocketsFor: maxSocketsFor,
    weaponTags: weaponTags, restConds: restConds, moveSpeed: moveSpeed, build: build, socketedSkills: socketedSkills, derived: derived, resolve: resolve, expectedHit: expectedHit, useSpeed: useSpeed,
    describe: describe, describeAll: describeAll, capitalize: capitalize, canAllocate: canAllocate, canRefund: canRefund, mended: mended, pathTo: pathTo,
    supportApplies: supportApplies, gemLevelReq: gemLevelReq, snapped: snapped, roundf: roundf, idx: function () { return IDX; }, data: function () { return D; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.AVPlan = API;
})(this);
