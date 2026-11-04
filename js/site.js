/* Aldervast website: navigation, hero slideshow, reveal, lightbox, gallery filters, audio, map, wiki search. No dependencies. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ROOT = document.documentElement.getAttribute("data-root") || "";

  /* Navigation */
  var nav = $(".nav");
  function onScroll() { if (nav) nav.classList.toggle("solid", window.scrollY > 30 || document.body.classList.contains("solid-nav")); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  var toggle = $(".nav-toggle");
  if (toggle) toggle.addEventListener("click", function () {
    var open = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  $$(".nav-links a").forEach(function (a) { a.addEventListener("click", function () { document.body.classList.remove("nav-open"); }); });

  /* Reveal on scroll */
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    $$(".reveal").forEach(function (el) { io.observe(el); });
  } else { $$(".reveal").forEach(function (el) { el.classList.add("in"); }); }

  /* Hero slideshow */
  var slides = $$(".hero-slides img");
  if (slides.length > 1) {
    var cur = 0, timer = null, cap = $(".hero-caption"), dots = $$(".hero-dots button");
    var show = function (i) {
      slides[cur].classList.remove("on"); if (dots[cur]) dots[cur].classList.remove("on");
      cur = (i + slides.length) % slides.length;
      var img = slides[cur];
      if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute("data-src"); }
      img.classList.add("on"); if (dots[cur]) dots[cur].classList.add("on");
      if (cap) cap.textContent = img.alt;
    };
    var start = function () { if (!reduced) { clearInterval(timer); timer = setInterval(function () { show(cur + 1); }, 6500); } };
    dots.forEach(function (d, i) { d.addEventListener("click", function () { show(i); start(); }); });
    // Preload the next slide after the page settles.
    window.addEventListener("load", function () { slides.forEach(function (s, i) { if (i > 0 && s.dataset.src) setTimeout(function () { s.src = s.dataset.src; s.removeAttribute("data-src"); }, 800 * i); }); });
    start();
  }

  /* Lightbox for any [data-full] figure */
  var figs = $$("[data-full]");
  if (figs.length) {
    var lb = document.createElement("div");
    lb.className = "lightbox"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Screenshot viewer");
    lb.innerHTML = '<button class="x" aria-label="Close">&#x2715;</button><button class="prev" aria-label="Previous">&#x2039;</button><img alt=""><div class="cap"></div><button class="next" aria-label="Next">&#x203A;</button>';
    document.body.appendChild(lb);
    var lbImg = $("img", lb), lbCap = $(".cap", lb), idx = 0, list = figs, lastFocus = null;
    var visible = function () { return figs.filter(function (f) { return !f.classList.contains("hide"); }); };
    var open = function (f) {
      list = visible(); idx = list.indexOf(f); lastFocus = document.activeElement;
      render(); lb.classList.add("on"); document.body.style.overflow = "hidden"; $(".x", lb).focus();
    };
    var render = function () {
      var f = list[idx]; lbImg.src = f.getAttribute("data-full"); lbImg.alt = f.getAttribute("data-title") || "";
      lbCap.innerHTML = "<b></b><span></span>"; $("b", lbCap).textContent = f.getAttribute("data-title") || ""; $("span", lbCap).textContent = f.getAttribute("data-caption") || "";
    };
    var close = function () { lb.classList.remove("on"); document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); };
    var step = function (d) { idx = (idx + d + list.length) % list.length; render(); };
    figs.forEach(function (f) {
      f.setAttribute("tabindex", "0"); f.setAttribute("role", "button");
      f.addEventListener("click", function () { open(f); });
      f.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(f); } });
    });
    $(".x", lb).addEventListener("click", close);
    $(".prev", lb).addEventListener("click", function () { step(-1); });
    $(".next", lb).addEventListener("click", function () { step(1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("on")) return;
      if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
    });
    var tx = null;
    lb.addEventListener("touchstart", function (e) { tx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) { if (tx === null) return; var dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); tx = null; });
  }

  /* Gallery filters */
  $$(".filters").forEach(function (bar) {
    var target = $(bar.getAttribute("data-target"));
    $$("button", bar).forEach(function (b) {
      b.addEventListener("click", function () {
        $$("button", bar).forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        var c = b.getAttribute("data-cat");
        $$("figure", target).forEach(function (f) { f.classList.toggle("hide", c !== "all" && f.getAttribute("data-cat") !== c); });
      });
    });
  });

  /* Videos: play only when on screen */
  var vids = $$("video[data-auto]");
  if (vids.length && "IntersectionObserver" in window) {
    var vio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { var v = e.target; if (e.isIntersecting && !reduced) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); });
    }, { threshold: 0.25 });
    vids.forEach(function (v) { vio.observe(v); });
  }

  /* Audio tracks: one plays at a time */
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var current = null;
  $$(".track").forEach(function (t) {
    var btn = $("button", t), prog = $(".prog i", t), bar = $(".prog", t), audio = null;
    btn.innerHTML = PLAY;
    var ensure = function () {
      if (audio) return audio;
      audio = new Audio(t.getAttribute("data-src")); audio.preload = "none";
      audio.addEventListener("timeupdate", function () { if (audio.duration) prog.style.width = (100 * audio.currentTime / audio.duration) + "%"; });
      audio.addEventListener("ended", function () { btn.innerHTML = PLAY; btn.setAttribute("aria-label", "Play " + t.dataset.name); prog.style.width = "0"; });
      return audio;
    };
    btn.addEventListener("click", function () {
      var a = ensure();
      if (a.paused) {
        if (current && current !== a) { current.pause(); }
        $$(".track button").forEach(function (b) { if (b !== btn) b.innerHTML = PLAY; });
        a.play(); current = a; btn.innerHTML = PAUSE; btn.setAttribute("aria-label", "Pause " + t.dataset.name);
      } else { a.pause(); btn.innerHTML = PLAY; btn.setAttribute("aria-label", "Play " + t.dataset.name); }
    });
    bar.addEventListener("click", function (e) { var a = ensure(); var r = bar.getBoundingClientRect(); if (a.duration) a.currentTime = a.duration * (e.clientX - r.left) / r.width; });
  });

  /* World map pins */
  var map = $(".map-wrap");
  if (map) {
    var tip = $(".map-tip", map), svg = $("svg", map), sel = null;
    var place = function (pin) {
      var c = $("circle.dot", pin), r = map.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      var x = (+c.getAttribute("cx")) / vb.width * r.width, y = (+c.getAttribute("cy")) / vb.height * r.height;
      tip.innerHTML = "<b></b><span></span>"; $("b", tip).textContent = pin.dataset.name; $("span", tip).textContent = pin.dataset.info;
      var w = Math.min(260, r.width - 20); tip.style.maxWidth = w + "px";
      var left = Math.max(w / 2 + 6, Math.min(r.width - w / 2 - 6, x));
      tip.style.left = left + "px"; tip.style.top = y + "px";
      tip.style.transform = y < 110 ? "translate(-50%, 18px)" : "translate(-50%, calc(-100% - 16px))";
      tip.classList.add("on");
    };
    $$(".pin", svg).forEach(function (p) {
      p.addEventListener("mouseenter", function () { place(p); });
      p.addEventListener("mouseleave", function () { if (sel !== p) tip.classList.remove("on"); });
      p.addEventListener("click", function (e) {
        e.stopPropagation();
        if (sel === p && p.dataset.href) { location.href = p.dataset.href; return; }
        if (sel) sel.classList.remove("on"); sel = p; p.classList.add("on"); place(p);
      });
      p.addEventListener("keydown", function (e) { if (e.key === "Enter" && p.dataset.href) location.href = p.dataset.href; });
      p.addEventListener("focus", function () { place(p); });
    });
    document.addEventListener("click", function () { if (sel) sel.classList.remove("on"); sel = null; tip.classList.remove("on"); });
  }

  /* Wiki sidebar on phones */
  var side = $(".wiki-side");
  if (side) {
    var st = $(".wiki-side-toggle", side);
    if (st) st.addEventListener("click", function () { var o = side.classList.toggle("open"); st.setAttribute("aria-expanded", o ? "true" : "false"); });
  }

  /* Filter entries on a wiki page */
  $$(".filter-line input").forEach(function (inp) {
    var scope = $(inp.getAttribute("data-scope")), count = $(".filter-line span");
    var items = $$(".entry, tbody tr[data-q]", scope);
    var run = function () {
      var q = inp.value.trim().toLowerCase(), n = 0;
      items.forEach(function (el) {
        var hit = !q || (el.getAttribute("data-q") || el.textContent).toLowerCase().indexOf(q) >= 0;
        el.classList.toggle("hide", !hit); if (el.tagName === "TR") el.style.display = hit ? "" : "none";
        if (hit) n++;
      });
      $$(".group-block", scope).forEach(function (g) {
        var any = $$(".entry:not(.hide), tbody tr[data-q]", g).some(function (el) { return el.style.display !== "none" && !el.classList.contains("hide"); });
        g.style.display = any ? "" : "none";
      });
      if (count) count.textContent = q ? n + " shown" : items.length + " entries";
    };
    inp.addEventListener("input", run); run();
  });

  /* Wiki search */
  var sb = $("#wiki-search");
  if (sb) {
    var res = $("#wiki-results"), data = null, selIdx = -1;
    var load = function () {
      if (data) return Promise.resolve(data);
      return fetch(ROOT + "wiki/search.json").then(function (r) { return r.json(); }).then(function (d) { data = d; return d; });
    };
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var score = function (e, words) {
      var n = e.n.toLowerCase(), t = (e.n + " " + e.c + " " + e.s + " " + (e.k || "")).toLowerCase(), s = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (t.indexOf(w) < 0) return -1;
        if (n === w) s += 100; else if (n.indexOf(w) === 0) s += 40; else if (n.indexOf(w) >= 0) s += 20; else s += 2;
      }
      return s;
    };
    var run2 = function () {
      var q = sb.value.trim().toLowerCase();
      if (!q) { res.classList.remove("on"); res.innerHTML = ""; return; }
      load().then(function (d) {
        var words = q.split(/\s+/), hits = [];
        d.forEach(function (e) { var s = score(e, words); if (s >= 0) hits.push([s, e]); });
        hits.sort(function (a, b) { return b[0] - a[0] || a[1].n.localeCompare(b[1].n); });
        hits = hits.slice(0, 30); selIdx = -1;
        res.innerHTML = hits.length ? hits.map(function (h) {
          var e = h[1]; return '<li><a href="' + ROOT + esc(e.u) + '">' + esc(e.n) + "<em>" + esc(e.c) + "</em><small>" + esc(e.s) + "</small></a></li>";
        }).join("") : '<li class="none">Nothing matches that yet.</li>';
        res.classList.add("on");
      });
    };
    sb.addEventListener("input", run2);
    sb.addEventListener("focus", load);
    sb.addEventListener("keydown", function (e) {
      var links = $$("a", res); if (!links.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); selIdx = (selIdx + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links.forEach(function (l, i) { l.classList.toggle("sel", i === selIdx); }); links[selIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") { e.preventDefault(); location.href = links[Math.max(0, selIdx)].href; }
    });
    var qs = new URLSearchParams(location.search).get("q"); if (qs) { sb.value = qs; run2(); }
  }
})();
