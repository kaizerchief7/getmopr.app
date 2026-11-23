/* MOPR Desktop – W1 Grundgerüst (18.11.2026, Entwurf)
   Nur lesen: Anmeldung mit dem MOPR-Konto, Sammlung als Tabelle oder Cover-Wand, Suche, Filter, Details.
   Dieselbe Datenbank wie die iPhone-App. Der öffentliche Schlüssel unten ist für Browser gedacht;
   geschützt wird über die Zeilenregeln in der Datenbank (jede Person sieht nur ihre eigenen Daten). */
(function () {
  "use strict";

  var SUPABASE_URL = "https://nazewbepsrjmvpkycymg.supabase.co";
  var SUPABASE_KEY = "sb_publishable_LmplLiX7PI3s5lvzhEL0xw_jw5P-pjt";
  var COLUMNS = "id, discogs_release_id, artist, title, label, catno, year, country, format, cover_url, location_id, position, " +
    "condition_media, condition_sleeve, notes, created_at, genres, styles, favorite, tag_ids, matrix, purchased_at, purchase_price, " +
    "purchased_from, last_played_at, is_new, size_override, rpm_override, sort_genre";

  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, storageKey: "mopr.web.auth", autoRefreshToken: true }
  });
  var app = document.getElementById("app");
  var collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

  var S = {
    user: null, items: [], locations: {}, tags: {}, releases: {},
    view: load("view") || "table", q: "", sort: { key: "artist", dir: 1 },
    filter: { place: "", genre: "", style: "", size: "", tag: "" }, selected: null,
    login: { step: "mail", email: "", busy: false, error: "" }
  };

  // ---------- kleine Helfer ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function store(k, v) { try { localStorage.setItem("mopr.web." + k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem("mopr.web." + k); } catch (e) { return null; } }
  function $(sel) { return app.querySelector(sel); }
  function sortName(artist) {
    return String(artist || "").replace(/\s*\(\d+\)$/, "").replace(/^(the|die|der|das|les|la|le)\s+/i, "");
  }
  function cleanArtist(a) { return String(a || "").replace(/\s*\(\d+\)/g, ""); }
  function euro(n) { return n == null ? "" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }); }
  function date(d) { if (!d) return ""; var x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString("de-DE"); }

  function size(item) {
    if (item.size_override) return item.size_override === "12" ? "LP" : item.size_override + "″";
    var f = item.format || "";
    if (/7"/.test(f)) return "7″";
    if (/10"/.test(f)) return "10″";
    if (/12"|LP/i.test(f)) return "LP";
    if (/CD/.test(f)) return "CD";
    if (/Cass/i.test(f)) return "MC";
    return f.split(",")[0] || "–";
  }
  function genreOf(item) {
    var g = item.genres || [];
    if (item.sort_genre && g.indexOf(item.sort_genre) >= 0) return item.sort_genre;
    return g[0] || "";
  }
  function styleOf(item) { return item.sort_genre || (item.styles || [])[0] || genreOf(item); }

  // Ort: Pfad „Wohnzimmer › Kallax › B3“ und grobe Gruppe für den Filter
  function path(id) {
    var parts = [], seen = 0, loc = S.locations[id];
    while (loc && seen++ < 10) { parts.unshift(loc.name); loc = S.locations[loc.parent_id]; }
    return parts.join(" › ");
  }
  function placeGroup(item) {
    if (!item.location_id) return "Ohne Ort";
    var loc = S.locations[item.location_id], top = loc, seen = 0;
    while (top && top.parent_id && S.locations[top.parent_id] && seen++ < 10) top = S.locations[top.parent_id];
    if (!top) return "Ohne Ort";
    if (top.kind === "loan") return "Verliehen";
    if (top.kind === "room") return top.name;
    return "Kisten & Koffer";
  }

  // ---------- Anmeldung ----------
  function renderLogin() {
    var L = S.login, body;
    if (L.step === "code") {
      body = '<label for="code">Code aus der Mail an ' + esc(L.email) + '</label>' +
        '<input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456">' +
        '<button class="btn primary" id="go"' + (L.busy ? " disabled" : "") + '>Anmelden</button>' +
        '<p class="note"><button class="link" id="back">Andere E-Mail</button></p>';
    } else if (L.step === "password") {
      body = '<label for="mail">E-Mail</label><input id="mail" type="email" autocomplete="username" value="' + esc(L.email) + '">' +
        '<label for="pw" style="margin-top:12px">Passwort</label><input id="pw" type="password" autocomplete="current-password">' +
        '<button class="btn primary" id="go"' + (L.busy ? " disabled" : "") + '>Anmelden</button>' +
        '<p class="note"><button class="link" id="back">Lieber mit Code per Mail</button></p>';
    } else {
      body = '<label for="mail">E-Mail deines MOPR-Kontos</label>' +
        '<input id="mail" type="email" autocomplete="email" placeholder="du@beispiel.de" value="' + esc(L.email) + '">' +
        '<button class="btn primary" id="go"' + (L.busy ? " disabled" : "") + '>Code schicken</button>' +
        '<p class="note">Dieselbe Anmeldung wie in der iPhone-App. Neue Konten gibt es nur mit Einladung. ' +
        '<button class="link" id="pwmode">Mit Passwort anmelden</button></p>';
    }
    app.innerHTML = '<div class="login"><div class="logo">M<span class="o"></span>PR</div>' +
      '<div class="claim">Von Vinyl-Sammlern für Vinyl-Sammler.</div><div class="card">' + body +
      (L.error ? '<p class="error">' + esc(L.error) + "</p>" : "") + "</div>" +
      '<p class="note">Entwurf der Desktop-Version · <a href="../datenschutz.html">Datenschutz</a></p></div>';

    var input = $("#code") || $("#mail");
    if (input) input.focus();
    $("#go").onclick = submitLogin;
    app.querySelectorAll("input").forEach(function (el) {
      el.onkeydown = function (e) { if (e.key === "Enter") submitLogin(); };
    });
    if ($("#back")) $("#back").onclick = function () { L.step = "mail"; L.error = ""; renderLogin(); };
    if ($("#pwmode")) $("#pwmode").onclick = function () { L.email = $("#mail").value.trim(); L.step = "password"; L.error = ""; renderLogin(); };
  }

  async function submitLogin() {
    var L = S.login;
    L.error = ""; L.busy = true;
    try {
      if (L.step === "mail") {
        L.email = $("#mail").value.trim();
        if (!L.email) throw new Error("Bitte E-Mail eingeben.");
        var r = await sb.auth.signInWithOtp({ email: L.email, options: { shouldCreateUser: false } });
        if (r.error) throw r.error;
        L.step = "code";
      } else if (L.step === "code") {
        var token = $("#code").value.replace(/\s/g, "");
        var v = await sb.auth.verifyOtp({ email: L.email, token: token, type: "email" });
        if (v.error) throw v.error;
      } else {
        L.email = $("#mail").value.trim();
        var p = await sb.auth.signInWithPassword({ email: L.email, password: $("#pw").value });
        if (p.error) throw p.error;
      }
    } catch (e) {
      var m = (e && e.message) || "";
      if (/not allowed|signup|not found|Signups/i.test(m)) L.error = "Zu dieser E-Mail gibt es kein MOPR-Konto. MOPR ist gerade nur mit Einladung nutzbar.";
      else if (/expired|invalid/i.test(m) && L.step === "code") L.error = "Der Code stimmt nicht oder ist abgelaufen.";
      else if (/invalid/i.test(m)) L.error = "E-Mail oder Passwort stimmt nicht.";
      else if (/rate|seconds/i.test(m)) L.error = "Bitte einen Moment warten und dann noch einmal versuchen.";
      else L.error = "Das hat nicht geklappt: " + m;
    }
    L.busy = false;
    if (!S.user) renderLogin();
  }

  // ---------- Daten laden ----------
  async function loadAll() {
    app.innerHTML = '<div class="boot"><span class="logo">M<span class="o"></span>PR</span></div>';
    var items = [], from = 0, page = 1000;
    for (;;) {
      var r = await sb.from("collection").select(COLUMNS).order("created_at", { ascending: true }).range(from, from + page - 1);
      if (r.error) { showError(r.error); return; }
      items = items.concat(r.data);
      if (r.data.length < page) break;
      from += page;
    }
    var locs = await sb.from("locations").select("id, parent_id, name, kind, sort_order");
    var tags = await sb.from("tags").select("id, name, sort_order").order("sort_order");
    S.locations = {}; (locs.data || []).forEach(function (l) { S.locations[l.id] = l; });
    S.tags = {}; (tags.data || []).forEach(function (t) { S.tags[t.id] = t; });
    S.items = items;
    renderShell();
  }

  function showError(e) {
    app.innerHTML = '<div class="login"><div class="logo">M<span class="o"></span>PR</div><div class="card">' +
      '<p>Die Sammlung konnte nicht geladen werden.</p><p class="muted">' + esc(e.message || e) + '</p>' +
      '<button class="btn primary" id="retry">Noch einmal</button></div></div>';
    $("#retry").onclick = loadAll;
  }

  // ---------- Rahmen ----------
  function renderShell() {
    var places = {}, genres = {}, sizes = {};
    S.items.forEach(function (i) { places[placeGroup(i)] = 1; var g = genreOf(i); if (g) genres[g] = 1; sizes[size(i)] = 1; });
    function opts(obj, first) {
      return '<option value="">' + first + "</option>" + Object.keys(obj).sort(collator.compare).map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(k) + "</option>";
      }).join("");
    }
    var tagOpts = '<option value="">Alle Tags</option>' + Object.values(S.tags).map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>";
    }).join("");

    app.innerHTML =
      '<div class="shell">' +
      '<header class="top"><span class="logo">M<span class="o"></span>PR</span>' +
      '<nav class="tabs"><button class="tab on">Sammlung</button><button class="tab" disabled title="kommt">Lager</button>' +
      '<button class="tab" disabled title="kommt">Wunschliste</button><button class="tab" disabled title="kommt">Plattenzimmer</button></nav>' +
      '<div class="who">' + esc(S.user.email || "") + ' <button class="btn" id="logout">Abmelden</button></div></header>' +
      '<div class="toolbar">' +
      '<input type="search" id="q" placeholder="Suchen: Künstler, Titel, Label, Kat.-Nr., Notiz" value="' + esc(S.q) + '">' +
      '<select id="f-place" aria-label="Ort">' + opts(places, "Alle Orte") + "</select>" +
      '<select id="f-genre" aria-label="Genre">' + opts(genres, "Alle Genres") + "</select>" +
      '<select id="f-style" aria-label="Stil"></select>' +
      '<select id="f-size" aria-label="Format">' + opts(sizes, "Alle Formate") + "</select>" +
      (Object.keys(S.tags).length ? '<select id="f-tag" aria-label="Tag">' + tagOpts + "</select>" : "") +
      '<div class="seg"><button data-view="table">Tabelle</button><button data-view="wall">Cover-Wand</button></div>' +
      '<span class="count" id="count"></span></div>' +
      '<div class="main nodetail" id="main"><div class="list" id="list"></div><aside class="detail" id="detail" hidden></aside></div>' +
      // Pflichtsatz Discogs (#173), wörtlich wie in der App unter Einstellungen › Discogs
      '<footer class="legal">This application uses Discogs\' API but is not affiliated with, sponsored or endorsed by Discogs. \'Discogs\' is a trademark of Zink Media, LLC.</footer>' +
      "</div>";

    $("#f-place").value = S.filter.place; $("#f-genre").value = S.filter.genre; $("#f-size").value = S.filter.size;
    if ($("#f-tag")) $("#f-tag").value = S.filter.tag;
    // Stil wie in der App: „Sortiert unter“ zählt, sonst erster Discogs-Stil; Auswahl passend zum gewählten Genre
    function fillStyles() {
      var st = {};
      S.items.forEach(function (i) { if (!S.filter.genre || genreOf(i) === S.filter.genre) { var v = styleOf(i); if (v) st[v] = 1; } });
      if (S.filter.style && !st[S.filter.style]) S.filter.style = "";
      $("#f-style").innerHTML = opts(st, "Alle Stile");
      $("#f-style").value = S.filter.style;
    }
    fillStyles();
    $("#logout").onclick = function () { sb.auth.signOut(); };
    var t;
    $("#q").oninput = function (e) { clearTimeout(t); t = setTimeout(function () { S.q = e.target.value; renderList(); }, 150); };
    ["place", "genre", "style", "size", "tag"].forEach(function (k) {
      var el = $("#f-" + k); if (el) el.onchange = function () { S.filter[k] = el.value; if (k === "genre") fillStyles(); renderList(); };
    });
    app.querySelectorAll(".seg button").forEach(function (b) {
      b.onclick = function () { S.view = b.dataset.view; store("view", S.view); renderList(); };
    });
    document.onkeydown = function (e) {
      if (e.key === "Escape" && S.selected) { select(null); }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && S.selected && document.activeElement.tagName !== "INPUT") {
        var list = visible(), i = list.findIndex(function (x) { return x.id === S.selected; });
        var n = list[i + (e.key === "ArrowDown" ? 1 : -1)];
        if (n) { e.preventDefault(); select(n.id, true); }
      }
    };
    renderList();
  }

  // ---------- Liste ----------
  var COLS = [
    { key: "cover", label: "", sort: null },
    { key: "artist", label: "Künstler", sort: function (i) { return sortName(i.artist); } },
    { key: "title", label: "Titel", sort: function (i) { return i.title; } },
    { key: "label", label: "Label", sort: function (i) { return i.label || "~"; } },
    { key: "catno", label: "Kat.-Nr.", sort: function (i) { return i.catno || "~"; } },
    { key: "year", label: "Jahr", sort: function (i) { return i.year || 9999; } },
    { key: "size", label: "Format", sort: size },
    { key: "genre", label: "Genre · Stil", sort: function (i) { return genreOf(i) + " " + styleOf(i); } },
    { key: "place", label: "Ort", sort: function (i) { return i.location_id ? path(i.location_id) : "~"; } },
    { key: "cond", label: "Zustand", sort: function (i) { return i.condition_media || "~"; } },
    { key: "price", label: "Kaufpreis", sort: function (i) { return i.purchase_price == null ? -1 : i.purchase_price; } },
    { key: "added", label: "Erfasst", sort: function (i) { return i.created_at; } }
  ];

  function visible() {
    var q = S.q.trim().toLowerCase(), F = S.filter;
    var list = S.items.filter(function (i) {
      if (F.place && placeGroup(i) !== F.place) return false;
      if (F.genre && genreOf(i) !== F.genre) return false;
      if (F.style && styleOf(i) !== F.style) return false;
      if (F.size && size(i) !== F.size) return false;
      if (F.tag && (i.tag_ids || []).indexOf(F.tag) < 0) return false;
      if (!q) return true;
      return [i.artist, i.title, i.label, i.catno, i.notes].some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; });
    });
    var col = COLS.find(function (c) { return c.key === S.sort.key; }) || COLS[1], dir = S.sort.dir;
    list.sort(function (a, b) {
      var x = col.sort(a), y = col.sort(b), c;
      c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
      if (c === 0) c = collator.compare(sortName(a.artist), sortName(b.artist)) || collator.compare(a.title, b.title);
      return c * dir;
    });
    return list;
  }

  function renderList() {
    var list = visible(), box = $("#list");
    $("#count").textContent = list.length === S.items.length ? S.items.length + " Platten" : list.length + " von " + S.items.length + " Platten";
    app.querySelectorAll(".seg button").forEach(function (b) { b.classList.toggle("on", b.dataset.view === S.view); });
    if (!list.length) { box.innerHTML = '<div class="empty">Keine Platte passt zu Suche und Filter.</div>'; return; }

    if (S.view === "wall") {
      box.innerHTML = '<div class="wall">' + list.map(function (i) {
        return '<div class="tile' + (i.id === S.selected ? " sel" : "") + '" data-id="' + esc(i.id) + '"><div class="img">' +
          (i.cover_url ? '<img loading="lazy" alt="" src="' + esc(i.cover_url) + '">' : "") + "</div>" +
          '<div class="t">' + esc(i.title) + '</div><div class="a">' + esc(cleanArtist(i.artist)) + "</div></div>";
      }).join("") + "</div>";
    } else {
      box.innerHTML = "<table><thead><tr>" + COLS.map(function (c) {
        return "<th" + (c.sort ? ' data-sort="' + c.key + '"' : "") + (S.sort.key === c.key ? ' class="sorted"' : "") + ">" +
          esc(c.label) + (S.sort.key === c.key ? (S.sort.dir > 0 ? " ▴" : " ▾") : "") + "</th>";
      }).join("") + "</tr></thead><tbody>" + list.map(row).join("") + "</tbody></table>";
      box.querySelectorAll("th[data-sort]").forEach(function (th) {
        th.onclick = function () {
          var k = th.dataset.sort;
          S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 };
          renderList();
        };
      });
    }
    box.querySelectorAll("[data-id]").forEach(function (el) { el.onclick = function () { select(el.dataset.id); }; });
  }

  function row(i) {
    var g = genreOf(i), s = styleOf(i);
    return '<tr data-id="' + esc(i.id) + '"' + (i.id === S.selected ? ' class="sel"' : "") + ">" +
      '<td class="cover">' + (i.cover_url ? '<img loading="lazy" alt="" src="' + esc(i.cover_url) + '">' : '<span class="ph"></span>') + "</td>" +
      '<td class="artist">' + esc(cleanArtist(i.artist)) + "</td>" +
      "<td>" + esc(i.title) + (i.is_new ? ' <span class="pill new">neu</span>' : "") + "</td>" +
      '<td class="muted">' + esc(i.label || "") + "</td>" +
      '<td class="muted num">' + esc(i.catno || "") + "</td>" +
      '<td class="num">' + esc(i.year || "") + "</td>" +
      '<td><span class="pill">' + esc(size(i)) + "</span></td>" +
      '<td class="muted">' + esc(g) + (s && s !== g ? " · " + esc(s) : "") + "</td>" +
      "<td>" + (i.location_id ? esc(path(i.location_id)) + (i.position ? " · " + esc(i.position) : "") : '<span class="muted">ohne Ort</span>') + "</td>" +
      '<td class="muted">' + esc(i.condition_media || "") + "</td>" +
      '<td class="num">' + esc(euro(i.purchase_price)) + "</td>" +
      '<td class="muted num">' + esc(date(i.created_at)) + "</td></tr>";
  }

  // ---------- Details ----------
  function select(id, scroll) {
    S.selected = id;
    app.querySelectorAll("[data-id]").forEach(function (el) { el.classList.toggle("sel", el.dataset.id === id); });
    var main = $("#main"), aside = $("#detail");
    main.classList.toggle("nodetail", !id);
    aside.hidden = !id;
    if (!id) return;
    if (scroll) { var el = app.querySelector('[data-id="' + id + '"]'); if (el) el.scrollIntoView({ block: "nearest" }); }
    renderDetail();
  }

  async function renderDetail() {
    var i = S.items.find(function (x) { return x.id === S.selected; });
    if (!i) return;
    var aside = $("#detail");
    var tagNames = (i.tag_ids || []).map(function (t) { return S.tags[t] && S.tags[t].name; }).filter(Boolean);
    function line(k, v) { return v ? "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>" : ""; }
    aside.innerHTML = '<button class="btn close" id="close" aria-label="Schließen">✕</button>' +
      (i.cover_url ? '<img class="big" alt="" src="' + esc(i.cover_url) + '">' : '<div class="big"></div>') +
      "<h2>" + esc(i.title) + '</h2><div class="by">' + esc(cleanArtist(i.artist)) + "</div>" +
      '<div class="chips">' +
      '<span class="chip key">' + esc(i.location_id ? path(i.location_id) : "ohne Ort") + "</span>" +
      (i.condition_media ? '<span class="chip">' + esc(i.condition_media) + "</span>" : "") +
      '<span class="chip">' + esc(size(i)) + "</span>" +
      (i.favorite ? '<span class="chip">★ Liebling</span>' : "") +
      tagNames.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") + "</div>" +
      "<h3>Meine Platte</h3><dl>" +
      line("Fach-Position", i.position) + line("Sortiert unter", i.sort_genre) + line("Zustand Platte", i.condition_media) + line("Zustand Hülle", i.condition_sleeve) +
      line("Gekauft", [date(i.purchased_at), euro(i.purchase_price), i.purchased_from].filter(Boolean).join(" · ")) +
      line("Zuletzt gehört", date(i.last_played_at)) + line("Erfasst", date(i.created_at)) + line("Notiz", i.notes) + "</dl>" +
      "<h3>Pressung</h3><dl>" +
      line("Label", i.label) + line("Kat.-Nr.", i.catno) + line("Jahr", i.year) + line("Land", i.country) +
      line("Format", i.format) + line("Genre", (i.genres || []).join(", ")) + line("Stil", (i.styles || []).join(", ")) +
      line("Matrix", i.matrix) + "</dl>" +
      '<h3>Tracks</h3><div id="tracks" class="muted">Lade …</div>' +
      // Pflichthinweis Discogs (#173, wie App #168): direkt unter den Discogs-Daten, Link auf die Release-Seite
      '<p class="attr">Data provided by <a target="_blank" rel="noopener" href="https://www.discogs.com/release/' + encodeURIComponent(i.discogs_release_id) + '">Discogs</a>.</p>' +
      '<p class="hint">Entwurf der Desktop-Version: nur ansehen. Bearbeiten, Umräumen und Massenbearbeitung kommen als Nächstes.</p>';
    $("#close").onclick = function () { select(null); };

    var rid = i.discogs_release_id;
    if (!(rid in S.releases)) {
      var r = await sb.from("releases").select("tracklist").eq("discogs_id", rid).maybeSingle();
      S.releases[rid] = (r.data && r.data.tracklist) || [];
    }
    if (S.selected !== i.id) return;
    var tracks = S.releases[rid], box = $("#tracks");
    box.className = "";
    box.innerHTML = tracks.length ? '<ul class="tracks">' + tracks.map(function (t) {
      return '<li><span class="pos">' + esc(t.position || "") + "</span><span>" + esc(t.title || "") +
        (t.artists ? ' <span class="muted">– ' + esc(cleanArtist([].concat(t.artists).map(function (a) { return a.name || a; }).join(", "))) + "</span>" : "") +
        '</span><span class="dur">' + esc(t.duration || "") + "</span></li>";
    }).join("") + "</ul>" : '<span class="muted">Keine Trackliste gespeichert.</span>';
  }

  // ---------- Start ----------
  sb.auth.onAuthStateChange(function (event, session) {
    var before = S.user;
    S.user = session ? session.user : null;
    if (event === "SIGNED_OUT" || !S.user) { S.items = []; S.selected = null; S.login = { step: "mail", email: "", busy: false, error: "" }; renderLogin(); return; }
    if (!before || event === "SIGNED_IN" && before.id !== S.user.id) setTimeout(loadAll, 0);
  });
})();
