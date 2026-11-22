// Aldervast build planner: a build packed into as few bits as it needs, for share links.
// Every number is written in a self-delimiting code, so a release that changes a table (a new base, a reworked tier) changes
// what a link means at worst, never how it reads. Things are named by their place in the append-only registry (reg) that
// build_site.py keeps, never by their place in this release's tables.
(function (root) {
  "use strict";
  var FORMAT = 0;
  var A64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var NAME64 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '";

  function Writer() { this.bits = []; }
  Writer.prototype.bit = function (b) { this.bits.push(b ? 1 : 0); };
  Writer.prototype.n = function (w, v) { for (var i = w - 1; i >= 0; i--) this.bits.push((v >>> i) & 1); };
  // exp-Golomb of order k: small numbers cost about k+1 bits and nothing has an upper bound
  Writer.prototype.eg = function (k, v) {
    v = Math.max(0, Math.round(v)) + (1 << k);
    var len = 0; while ((v >>> len) > 1) len++;
    for (var i = 0; i < len - k; i++) this.bits.push(0);
    this.n(len + 1, v);
  };
  Writer.prototype.seg = function (k, v) { v = Math.round(v); this.eg(k, v >= 0 ? 2 * v : -2 * v - 1); };
  Writer.prototype.text = function () {
    var b = this.bits.slice(); while (b.length % 6) b.push(0);
    var s = ""; for (var i = 0; i < b.length; i += 6) s += A64[b[i] << 5 | b[i + 1] << 4 | b[i + 2] << 3 | b[i + 3] << 2 | b[i + 4] << 1 | b[i + 5]];
    return s.replace(/A+$/, ""); // trailing zero bits read back as zero anyway
  };
  function Reader(s) {
    this.bits = []; this.i = 0;
    for (var j = 0; j < s.length; j++) { var v = A64.indexOf(s[j]); if (v < 0) throw new Error("bad code"); for (var b = 5; b >= 0; b--) this.bits.push((v >> b) & 1); }
  }
  Reader.prototype.bit = function () { if (this.i > this.bits.length + 64) throw new Error("code ran out"); return this.bits[this.i++] || 0; };
  Reader.prototype.n = function (w) { var v = 0; for (var i = 0; i < w; i++) v = v * 2 + this.bit(); return v; };
  Reader.prototype.eg = function (k) {
    var z = 0; while (this.bit() === 0) { if (++z > 40) throw new Error("bad code"); }
    var v = 1; for (var i = 0; i < z + k; i++) v = v * 2 + this.bit();
    return v - (1 << k);
  };
  Reader.prototype.seg = function (k) { var v = this.eg(k); return v % 2 ? -(v + 1) / 2 : v / 2; };

  function idx(reg, t, id) { var i = (reg[t] || []).indexOf(id); if (i < 0) throw new Error("not in registry: " + t + " " + id); return i; }
  function at(reg, t, i) { return (reg[t] || [])[i]; }
  function stepOf(lo, hi) { return (hi - lo < 3 && hi < 5) ? 0.1 : 1; } // as the planner's sliders step
  function rnd(v, st) { return st < 1 ? Math.round(v * 10) / 10 : Math.round(v); }

  // o is the planner's plain build object (planner.js encodeState); D the planner data, with D.reg
  function pack(o, D, opts) {
    var reg = D.reg, w = new Writer(), I = opts.index;
    w.n(4, FORMAT);
    w.eg(2, idx(reg, "classes", o.c));
    w.eg(1, idx(reg, "ancestries", o.a));
    w.eg(4, (o.l | 0) - 1);
    w.eg(4, o.qp | 0);
    // the name: a short alphabet when it fits, UTF-8 when it doesn't
    var name = String(o.n || "");
    w.eg(3, name.length);
    if (name.length) {
      var simple = name.split("").every(function (ch) { return NAME64.indexOf(ch) >= 0; });
      w.bit(!simple);
      if (simple) name.split("").forEach(function (ch) { w.n(6, NAME64.indexOf(ch)); });
      else { var u = new TextEncoder().encode(name); w.eg(3, u.length); u.forEach(function (b) { w.n(8, b); }); }
    }
    w.bit(o.t);
    if (o.t) {
      w.bit(!!o.sp);
      if (o.sp) {
        w.eg(2, idx(reg, "specs", o.sp));
        w.eg(0, (o.sn || []).length);
        (o.sn || []).forEach(function (n) { w.eg(4, idx(reg, "spec_nodes", o.sp + ":" + n)); });
      }
    }
    var conds = opts.situations;
    var cd = (o.cd || []).map(function (k) { return conds.indexOf(k); }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
    w.eg(0, cd.length); var prev = -1;
    cd.forEach(function (i) { w.eg(1, i - prev - 1); prev = i; });
    // passives: node ids are the game's own and stable; sorted, then each gap from the last
    var ps = (o.p || []).map(function (x) { return x | 0; }).sort(function (a, b) { return a - b; });
    w.eg(4, ps.length); prev = -1;
    ps.forEach(function (x) { w.eg(2, x - prev - 1); prev = x; });
    opts.slots.forEach(function (slot) {
      var x = (o.e || {})[slot];
      w.bit(!!x);
      if (x) item(w, x, D, I);
    });
    w.bit(o.f); // added after the first links: a link without it reads 0 here
    return w.text();
  }
  function item(w, x, D, I) {
    var reg = D.reg;
    w.n(3, x.r | 0);
    if (x.r === 3) { w.eg(5, idx(reg, "uniques", x.u)); }
    else w.eg(7, idx(reg, "bases", x.b));
    if (x.r === 4) w.eg(4, idx(reg, "sets", x.set));
    w.n(7, Math.min(127, x.l | 0));
    w.eg(0, Math.round((x.q | 0) / 5));
    w.bit(x.st);
    if (x.r === 3) {
      // rolls: off the listed value, in slider steps
      var u = I.uniques[x.u], ur = x.ur || [];
      var def = u.mods.every(function (md, i) { return i >= ur.length || +ur[i] === +md.value; });
      w.bit(!def);
      if (!def) {
        w.eg(1, ur.length);
        ur.forEach(function (v, i) { var md = u.mods[i], base = md ? +md.value : 0, st = Math.abs(base) < 5 ? 0.1 : 1; w.seg(1, (v - base) / st); });
      }
    } else {
      [x.p || [], x.s || []].forEach(function (list) {
        w.eg(0, list.length);
        list.forEach(function (a) {
          var af = I.affixes[a[0]], tier = af.tiers[a[1]] || af.tiers[af.tiers.length - 1], rolls = a[2] || [];
          w.eg(5, idx(reg, "affixes", a[0]));
          w.eg(1, af.tiers.length - 1 - a[1]); // tiers count from the best, which a fresh roll takes
          var top = tier.mods.every(function (md, i) { return i >= rolls.length || +rolls[i] === +md.max; });
          w.bit(!top);
          if (!top) {
            w.eg(0, rolls.length);
            rolls.forEach(function (v, i) { var md = tier.mods[i] || { min: v, max: v }; w.seg(1, (+md.max - v) / stepOf(+md.min, +md.max)); });
          }
        });
      });
    }
    w.bit(!!x.im); if (x.im) w.eg(3, idx(reg, "imbues", x.im));
    w.bit(!!x.wv); if (x.wv) w.eg(3, idx(reg, "weaves", x.wv));
    var co = x.co == null ? -2 : x.co;
    w.bit(co !== -2);
    if (co !== -2) { w.bit(co >= 0); if (co >= 0) w.eg(3, idx(reg, "corrupt", D.corrupt_keys[co])); }
    var k = x.k || [];
    w.eg(1, k.length);
    k.forEach(function (s, i) {
      w.n(2, "rgbw".indexOf(s[0]) < 0 ? 3 : "rgbw".indexOf(s[0]));
      if (i > 0) w.bit(s[1] === k[i - 1][1]);
      var has = s.length > 2;
      w.bit(has);
      if (has) {
        w.bit(s[3]);
        w.eg(4, idx(reg, s[3] ? "supports" : "skills", s[2]));
        w.eg(2, (s[4] | 0) - 1);
        if (!s[3]) w.eg(1, s[5] | 0);
      }
    });
  }

  function unpack(code, D, opts) {
    var reg = D.reg, r = new Reader(code);
    if (r.n(4) !== FORMAT) return null;
    var o = { v: 1, c: at(reg, "classes", r.eg(2)), a: at(reg, "ancestries", r.eg(1)), l: r.eg(4) + 1, qp: r.eg(4), n: "", e: {}, cd: [], p: [] };
    var len = r.eg(3);
    if (len) {
      if (!r.bit()) { for (var i = 0; i < len; i++) o.n += NAME64[r.n(6)]; }
      else { var ul = r.eg(3), u = new Uint8Array(ul); for (var j = 0; j < ul; j++) u[j] = r.n(8); o.n = new TextDecoder().decode(u); }
    }
    o.t = r.bit();
    if (o.t && r.bit()) {
      o.sp = at(reg, "specs", r.eg(2));
      var sn = r.eg(0); o.sn = [];
      for (var q = 0; q < sn; q++) { var key = at(reg, "spec_nodes", r.eg(4)) || ""; if (key.indexOf(o.sp + ":") === 0) o.sn.push(key.slice(o.sp.length + 1)); }
    }
    var nc = r.eg(0), prev = -1;
    for (var c = 0; c < nc; c++) { prev += r.eg(1) + 1; if (opts.situations[prev]) o.cd.push(opts.situations[prev]); }
    var np = r.eg(4); prev = -1;
    for (var p = 0; p < np; p++) { prev += r.eg(2) + 1; o.p.push(prev); }
    opts.slots.forEach(function (slot) { if (r.bit()) { var x = readItem(r, D, opts.index); if (x) o.e[slot] = x; } });
    o.f = r.bit();
    return o;
  }
  function readItem(r, D, I) {
    var reg = D.reg, x = { r: r.n(3) };
    if (x.r === 3) { x.u = at(reg, "uniques", r.eg(5)); x.b = I.uniques[x.u] ? I.uniques[x.u].base : ""; }
    else x.b = at(reg, "bases", r.eg(7));
    if (x.r === 4) x.set = at(reg, "sets", r.eg(4));
    x.l = r.n(7); x.q = r.eg(0) * 5; if (r.bit()) x.st = 1;
    if (x.r === 3) {
      var u = I.uniques[x.u];
      x.ur = u ? u.mods.map(function (md) { return +md.value; }) : [];
      if (r.bit()) {
        var n = r.eg(1); x.ur = [];
        for (var i = 0; i < n; i++) { var md = u && u.mods[i], base = md ? +md.value : 0, st = Math.abs(base) < 5 ? 0.1 : 1; x.ur.push(rnd(base + r.seg(1) * st, st)); }
      }
    } else {
      x.p = []; x.s = [];
      [x.p, x.s].forEach(function (list) {
        var n = r.eg(0);
        for (var i = 0; i < n; i++) {
          var id = at(reg, "affixes", r.eg(5)), af = I.affixes[id], back = r.eg(1);
          var tierI = af ? Math.max(0, af.tiers.length - 1 - back) : 0, tier = af ? af.tiers[tierI] : { mods: [] };
          var rolls = tier.mods.map(function (md) { return +md.max; });
          if (r.bit()) {
            var m = r.eg(0); rolls = [];
            for (var j = 0; j < m; j++) { var md = tier.mods[j] || { min: 0, max: 0 }, st = stepOf(+md.min, +md.max); rolls.push(rnd(+md.max - r.seg(1) * st, st)); }
          }
          if (af) list.push([id, tierI, rolls]);
        }
      });
    }
    if (r.bit()) x.im = at(reg, "imbues", r.eg(3));
    if (r.bit()) x.wv = at(reg, "weaves", r.eg(3));
    if (r.bit()) { if (r.bit()) { var key = at(reg, "corrupt", r.eg(3)); x.co = D.corrupt_keys.indexOf(key); } else x.co = -1; }
    var ns = r.eg(1); x.k = []; var g = 0;
    for (var s = 0; s < ns; s++) {
      var col = "rgbw"[r.n(2)];
      if (s > 0 && !r.bit()) g++;
      var k = [col, g];
      if (r.bit()) {
        var sup = r.bit(), gid = at(reg, sup ? "supports" : "skills", r.eg(4)), lv = r.eg(2) + 1, gq = sup ? 0 : r.eg(1);
        k.push(gid, sup ? 1 : 0, lv, gq);
      }
      x.k.push(k);
    }
    return x;
  }

  var api = { pack: pack, unpack: unpack };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AVCode = api;
})(this);
