/* MOPR Desktop – Plattenkiste (Doppelfach) aus Bild-Ebenen (26.11.2026, Designsprache 2.1)
   Zwei Kisten nebeneinander mit gemeinsamer Mittelwand. Ebenen: kiste/doppel-hinten · Cover · Trennkarten ·
   kiste/doppel-vorne (Innenraum + Grifflöcher durchsichtig) · Etiketten/Regler.
   Bedienung: Mausrad/Trackpad = blättern (Finger), ↑/↓ blättern, ←/→ Kiste wechseln, Buchstabe = springen,
   Enter = Platte öffnen, Regler im Griffloch = Position, Trennkarte anklicken = Sprung.
   Nur lesen – nichts wird gespeichert. Cover nur als Link von Discogs (live, nie kopiert). */
(function () {
  "use strict";

  // Maße im 800er-Raster des Originalbilds, Zuschnitt x 40–768, y 175–562 (README im Repo mopr: docs/design/bilder/ebenen)
  var W = 728, H = 387, X0 = 40, Y0 = 175;
  // Innenraum je Kiste, gemessen im Bild: vorn (Oberkante Frontblende) und hinten (Rückwand).
  // Wegen der Perspektive ist der Innenraum vorn breiter und liegt bei jeder Kiste anders –
  // darum rechnet jede Kiste ihre Platten aus ihren eigenen Maßen (Georges 26.11.: „rechts wandern die Platten ins Holz“).
  var CRATES = [
    { front: [63, 392], back: [121, 392], hole: [168, 479, 298, 502], label: [306, 516] },
    { front: [411, 747], back: [411, 684], hole: [510, 479, 640, 502], label: [648, 516] }
  ];
  var FRONT_TOP = 449, BACK_FLOOR = 445;   // Oberkante Frontblende, Boden an der Rückwand
  var FILL = 0.97, VISIBLE = 0.72;         // LP füllt die Kiste fast ganz (31,4 cm in ~33 cm), ~¾ ragen heraus
  var BEHIND = 3, F0 = 0.04, F_STEP = 0.035;  // vordere Platte knapp hinter der Front, jede weitere ein Stück tiefer
  var TILT = 0;                            // keine künstliche Neigung (Georges: „schief“)

  var K = { pair: 0, side: 0, pos: {}, wheel: 0, crates: [], api: null, box: null };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pctX(v) { return ((v - X0) / W * 100).toFixed(3) + "%"; }
  function pctY(v) { return ((v - Y0) / H * 100).toFixed(3) + "%"; }
  function pctW(v) { return (v / W * 100).toFixed(3) + "%"; }
  function pctH(v) { return (v / H * 100).toFixed(3) + "%"; }

  function letterOf(api, i) {
    var c = api.sortName(i.artist).trim().charAt(0).toUpperCase();
    c = c.normalize ? c.normalize("NFD").charAt(0) : c;
    return /[A-Z]/.test(c) ? c : "#";
  }

  // Kisten bilden: Neuzugänge (ohne Ort) zuerst, dann je Ort in der Reihenfolge des Lagers
  function build(list, api) {
    var groups = {}, order = [];
    list.forEach(function (i) {
      var k = i.location_id || "_neu";
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(i);
    });
    function rank(id) {
      if (id === "_neu") return [-1];
      var chain = [], loc = api.locations[id], n = 0;
      while (loc && n++ < 10) {
        chain.unshift(loc.sort_order == null ? 9999 : loc.sort_order, loc.grid_row == null ? 0 : loc.grid_row, loc.grid_col == null ? 0 : loc.grid_col);
        loc = api.locations[loc.parent_id];
      }
      return chain;
    }
    order.sort(function (a, b) {
      var x = rank(a), y = rank(b);
      for (var j = 0; j < Math.max(x.length, y.length); j++) {
        var d = (x[j] == null ? -1 : x[j]) - (y[j] == null ? -1 : y[j]);
        if (d) return d;
      }
      return api.collator.compare(api.path(a) || "", api.path(b) || "");
    });
    return order.map(function (k) {
      var items = groups[k].slice().sort(function (a, b) {
        return api.collator.compare(api.sortName(a.artist), api.sortName(b.artist)) || api.collator.compare(a.title || "", b.title || "");
      });
      var loc = api.locations[k];
      return {
        key: k, items: items,
        short: k === "_neu" ? api.inboxName() : (loc ? loc.name : "?"),
        long: k === "_neu" ? api.inboxName() : api.path(k)
      };
    });
  }

  function crateAt(side) { return K.crates[K.pair + side]; }
  function posOf(c) { var p = K.pos[c.key] || 0; return Math.max(0, Math.min(p, c.items.length - 1)); }

  // Lage einer Platte in Tiefe f (0 = vorn, 1 = Rückwand): Breite, Mitte und Boden wandern perspektivisch nach hinten
  function geo(g, depth) {
    var f = F0 + depth * F_STEP;
    var fw = (g.front[1] - g.front[0]) * FILL, bw = (g.back[1] - g.back[0]) * FILL;
    var w = fw + (bw - fw) * f;
    var cx = (g.front[0] + g.front[1]) / 2 + ((g.back[0] + g.back[1]) / 2 - (g.front[0] + g.front[1]) / 2) * f;
    var floor0 = FRONT_TOP + fw * (1 - VISIBLE);           // Boden vorn: so, dass ~¾ der LP über die Front ragen
    var floor = floor0 + (BACK_FLOOR - floor0) * f;
    return { w: w, cx: cx, top: floor - w };
  }

  function coverHtml(api, i, depth, g) {
    var q = geo(g, depth), w = q.w, top = q.top;
    var dim = depth ? " d" + depth : "";
    var face = i.cover_url
      ? '<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + api.esc(i.cover_url) + '">'
      : '<span class="kraft"><b>' + api.esc(api.cleanArtist(i.artist)) + "</b>" + api.esc(i.title || "") + "</span>";
    return { w: w, top: top, cx: q.cx, html: face, cls: "kcover" + dim };
  }

  function render(box, list, api) {
    K.api = api; K.box = box;
    K.crates = build(list, api);
    if (!K.crates.length) { box.innerHTML = '<div class="empty">Keine Platte passt zu Suche und Filter.</div>'; return; }
    if (K.pair > K.crates.length - 1) K.pair = Math.max(0, K.crates.length - 2);
    if (K.pair + K.side > K.crates.length - 1) K.side = 0;

    var opts = K.crates.map(function (c, n) {
      return '<option value="' + n + '">' + api.esc(c.long) + " · " + c.items.length + "</option>";
    }).join("");

    box.innerHTML =
      '<div class="kiste-wrap">' +
      '<div class="kiste-kopf">' +
      '<button class="btn" id="k-prev" aria-label="Vorherige Kiste">‹</button>' +
      '<select id="k-jump" aria-label="Kiste wählen">' + opts + "</select>" +
      '<button class="btn" id="k-next" aria-label="Nächste Kiste">›</button>' +
      '<span class="kiste-hilfe">Mausrad oder ↑ ↓ blättern · ← → Kiste · Buchstabe springt · Enter öffnet</span></div>' +
      '<div class="kiste-buehne" id="k-stage" role="group" aria-label="Plattenkiste">' +
      '<img class="k-hinten" src="kiste/doppel-hinten.webp" alt="">' +
      '<div class="k-fach" data-side="0"></div><div class="k-fach" data-side="1"></div>' +
      '<img class="k-vorne" src="kiste/doppel-vorne.webp" alt="">' +
      CRATES.map(function (g, s) {
        return '<input type="range" class="k-regler" data-side="' + s + '" min="0" max="0" value="0" aria-label="Position in der Kiste" ' +
          'style="left:' + pctX(g.hole[0]) + ";top:" + pctY(g.hole[1]) + ";width:" + pctW(g.hole[2] - g.hole[0]) + ";height:" + pctH(g.hole[3] - g.hole[1]) + '">' +
          '<div class="k-etikett" data-side="' + s + '" style="left:' + pctX(g.label[0]) + ";top:" + pctY(g.label[1]) + '"></div>';
      }).join("") +
      "</div>" +
      '<div class="kiste-info"><div data-side="0"></div><div data-side="1"></div></div>' +
      '<div class="sr" aria-live="polite" id="k-live"></div>' +
      "</div>";

    var stage = box.querySelector("#k-stage");
    stage.addEventListener("wheel", onWheel, { passive: false });
    box.querySelector("#k-prev").onclick = function () { move(-1); };
    box.querySelector("#k-next").onclick = function () { move(1); };
    box.querySelector("#k-jump").onchange = function (e) { goto(+e.target.value); };
    box.querySelectorAll(".k-regler").forEach(function (r) {
      r.oninput = function () { var s = +r.dataset.side; K.side = s; var c = crateAt(s); if (c) { K.pos[c.key] = +r.value; draw(); } };
    });
    box.querySelectorAll(".k-fach").forEach(function (f) {
      f.onclick = function (e) {
        var s = +f.dataset.side;
        var tab = e.target.closest(".ktab");
        if (tab) { K.side = s; K.pos[crateAt(s).key] = +tab.dataset.idx; draw(); return; }
        if (K.side !== s) { K.side = s; draw(); return; }
        var c = crateAt(s); if (c) api.select(c.items[posOf(c)].id);
      };
    });
    draw();
  }

  function goto(n) {
    n = Math.max(0, Math.min(n, K.crates.length - 1));
    K.pair = Math.max(0, Math.min(n, K.crates.length - 2)); K.side = n - K.pair; draw();
  }
  // Kiste wechseln: die aktive Kiste wandert; das Paar rückt nur nach, wenn sie aus dem Bild liefe
  function move(d) {
    var n = K.pair + K.side + d;
    if (n < 0 || n > K.crates.length - 1) return bump();
    if (n > K.pair + 1) K.pair = n - 1;
    if (n < K.pair) K.pair = n;
    K.side = n - K.pair;
    draw();
  }
  function bump() {
    var st = K.box && K.box.querySelector("#k-stage");
    if (!st || reduce) return;
    st.classList.remove("anschlag"); void st.offsetWidth; st.classList.add("anschlag");
  }

  function flip(d) {
    var c = crateAt(K.side); if (!c) return;
    var p = posOf(c), n = p + d;
    if (n < 0 || n > c.items.length - 1) return bump();
    var fach = K.box.querySelector('.k-fach[data-side="' + K.side + '"]');
    var front = fach && fach.querySelector(".kcover.front");
    // vorwärts: die vordere Platte kippt nach vorn weg; zurück: die neue vordere kommt von vorn (Klasse in draw)
    var ghost = d > 0 && front && !reduce ? front.cloneNode(true) : null;
    K.pos[c.key] = n;
    draw(d < 0 && !reduce);
    if (ghost) {
      ghost.classList.remove("front"); ghost.classList.add("kippt"); ghost.removeAttribute("role");
      fach.appendChild(ghost);   // nach dem Neuzeichnen obenauf, kippt weg und verschwindet
      setTimeout(function () { ghost.remove(); }, 220);
    }
  }

  function draw(backAnim) {
    var api = K.api, box = K.box;
    box.querySelector("#k-jump").value = String(K.pair + K.side);
    [0, 1].forEach(function (s) {
      var c = crateAt(s), g = CRATES[s];
      var fach = box.querySelector('.k-fach[data-side="' + s + '"]');
      var info = box.querySelector('.kiste-info [data-side="' + s + '"]');
      var lab = box.querySelector('.k-etikett[data-side="' + s + '"]');
      var reg = box.querySelector('.k-regler[data-side="' + s + '"]');
      fach.classList.toggle("aus", s !== K.side);
      if (!c) { fach.innerHTML = ""; info.innerHTML = ""; lab.textContent = ""; reg.hidden = true; return; }
      reg.hidden = false;
      var p = posOf(c), html = "";
      for (var d = Math.min(BEHIND, c.items.length - 1 - p); d >= 0; d--) {
        var i = c.items[p + d], cv = coverHtml(api, i, d, g);
        var prev = c.items[p + d - 1];
        var tab = "";
        var L = letterOf(api, i);
        if (!prev || letterOf(api, prev) !== L) {
          var off = (L === "#" ? 0 : (L.charCodeAt(0) - 65) / 25) * (cv.w - cv.w * 0.26);
          tab = '<button class="ktab" tabindex="-1" data-idx="' + (p + d) + '" style="left:' + (off / cv.w * 100).toFixed(2) + '%" aria-label="Trennkarte ' + L + '">' + L + "</button>";
        }
        html += '<div class="' + cv.cls + (d === 0 ? " front" + (backAnim ? " kommt" : "") : "") + '" style="left:' + pctX(cv.cx - cv.w / 2) +
          ";top:" + pctY(cv.top) + ";width:" + pctW(cv.w) + ";height:" + pctH(cv.w) + ";transform:perspective(900px) rotateX(" + TILT + "deg)" +
          '"' + (d === 0 ? ' role="button" tabindex="-1" aria-label="' + api.esc(api.cleanArtist(i.artist) + " – " + i.title + ", öffnen") + '"' : ' aria-hidden="true"') + ">" +
          tab + cv.html + "</div>";
      }
      fach.innerHTML = html;
      var front = c.items[p];
      info.innerHTML = '<div class="k-t">' + api.esc(front.title || "") + '</div><div class="k-a">' + api.esc(api.cleanArtist(front.artist)) + "</div>";
      info.classList.toggle("aus", s !== K.side);
      lab.textContent = c.short + " · " + (p + 1) + "/" + c.items.length;
      lab.title = c.long;
      reg.max = String(c.items.length - 1); reg.value = String(p);
    });
    var a = crateAt(K.side);
    if (a) {
      var f = a.items[posOf(a)];
      box.querySelector("#k-live").textContent = a.short + ": Platte " + (posOf(a) + 1) + " von " + a.items.length + ": " + api.cleanArtist(f.artist) + " – " + f.title;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var fach = e.target.closest && e.target.closest(".k-fach");
    if (fach && +fach.dataset.side !== K.side) { K.side = +fach.dataset.side; }
    var dy = e.deltaMode === 1 ? e.deltaY * 38 : e.deltaY;  // Zeilen → Pixel
    // Mausrad: ein Raster = eine Platte; Trackpad: ~38 px = eine Platte
    if (Math.abs(dy) >= 50 && e.deltaMode !== 0 || Math.abs(dy) >= 100) { flip(dy > 0 ? 1 : -1); K.wheel = 0; return; }
    K.wheel += dy;
    while (Math.abs(K.wheel) >= 38) { var d = K.wheel > 0 ? 1 : -1; K.wheel -= d * 38; flip(d); }
  }

  // Tastatur (von app.js weitergereicht, nur wenn die Kiste sichtbar ist)
  function key(e) {
    if (!K.box || !K.box.isConnected) return false;
    var t = document.activeElement && document.activeElement.tagName;
    if (t === "INPUT" && document.activeElement.type !== "range" || t === "SELECT" || t === "TEXTAREA") return false;
    if (e.key === "ArrowDown") { flip(1); return true; }
    if (e.key === "ArrowUp") { flip(-1); return true; }
    if (e.key === "ArrowRight") { move(1); return true; }
    if (e.key === "ArrowLeft") { move(-1); return true; }
    if (e.key === "Enter") { var c = crateAt(K.side); if (c) K.api.select(c.items[posOf(c)].id); return true; }
    if (/^[a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var cr = crateAt(K.side); if (!cr) return false;
      var L = e.key.toUpperCase(), idx = cr.items.findIndex(function (i) { return letterOf(K.api, i) >= L; });
      if (idx < 0) idx = cr.items.length - 1;
      K.pos[cr.key] = idx; draw(); return true;
    }
    return false;
  }

  window.MOPRKiste = { render: render, key: key };
})();
