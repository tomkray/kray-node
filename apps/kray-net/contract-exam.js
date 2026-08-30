/* CONTRACT EXAM — paint a dry-run on the write studio / star desk.
   Talks to POST /api/kraynet/contract-exam. Never signs. Never journals. */
(function (w) {
  "use strict";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function paint(host, exam) {
    if (!host) return;
    if (!exam) { host.innerHTML = ""; return; }
    var checks = exam.checks || [];
    var rows = checks.map(function (c) {
      var mark = c.kind === "fail" ? "✗" : c.kind === "quiet" ? "·" : "✓";
      var cls = c.kind === "fail" ? "fail" : c.kind === "quiet" ? "quiet" : "pass";
      return '<li class="' + cls + '"><span class="mk">' + mark + "</span><span><b>" + esc(c.label) + "</b>"
        + (c.detail ? '<br><span class="dt">' + esc(c.detail) + "</span>" : "") + "</span></li>";
    }).join("");
    var head = exam.ready
      ? "ready — this paper can be sealed"
      : "not ready — do not sign a broken paper";
    host.innerHTML = '<p class="examhead ' + (exam.ready ? 'ok' : 'bad') + '">' + esc(head) + '</p><ul class="examlist">' + rows + '</ul>';
  }
  function run(body) {
    return fetch("/api/kraynet/contract-exam", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("no file"));
      if (file.size > 200000) return reject(new Error("file is too large for IR (200 KB cap on the exam)"));
      var rd = new FileReader();
      rd.onload = function () { resolve(String(rd.result || "")); };
      rd.onerror = function () { reject(new Error("could not read the file")); };
      rd.readAsText(file);
    });
  }
  w.KrayContractExam = { paint: paint, run: run, readFile: readFile };
})(window);

/* PAPER CATALOG — the proven desks. A click pastes knobs; the user edits them.
   Same IR the reducer already runs. Not a new language. */
(function (w) {
  "use strict";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }
  var LIVING = {
    being: [
      { name: "alive", on: true, motion: "toggle" },
      { name: "open", on: true, motion: "toggle" },
      { name: "agent", on: false, motion: "toggle" },
    ],
    pass: [
      { name: "alive", on: true, motion: "toggle" },
      { name: "valid", on: true, motion: "once" },
    ],
    times3: [
      { name: "use_1", on: true, motion: "once" },
      { name: "use_2", on: true, motion: "once" },
      { name: "use_3", on: true, motion: "once" },
    ],
  };
  var MARK = {
    vars: { hit: "0" },
    rules: [{ name: "mark", when: { lit: "1" }, then: [{ set: { var: "hit", to: { lit: "1" } } }] }],
  };
  var LIST = [
    { id: "being", title: "Being", kind: "living", tag: "alive · open · agent", blurb: "The default mouth. Toggle forever. Pulse is public breath. Collect follows the living owner." },
    { id: "pass", title: "Pass", kind: "living", tag: "once valid", blurb: "A ticket. valid starts true and can be spent once — never back. The star stays as the souvenir." },
    { id: "times3", title: "3-use", kind: "living", tag: "three latches", blurb: "Three once clauses. Three calls, then mute. Same paper as a concert pass — not a new kind." },
    { id: "escrow", title: "Escrow", kind: "form", tag: "buyer · seller", blurb: "Two sealed keys. Buyer accepts and the seller is paid; after the journal deadline anyone may refund." },
    { id: "tunnel", title: "Tunnel", kind: "form", tag: "punch ₭", blurb: "A pipe. Anyone funds it. You punch an amount through — to a dest, or it follows the face." },
    { id: "vest", title: "Vest", kind: "form", tag: "release over acts", blurb: "Vesting on journal height, not a clock. Anyone may call release; ₭ goes only to the beneficiary." },
    { id: "scroll", title: "Scroll", kind: "form", tag: "open claim", blurb: "Open scroll. Anyone claims each until max. The 1 ₭ fee is the sybil tax. Locked: ₭ leaves only through claim." },
    { id: "raffle", title: "Raffle", kind: "form", tag: "enter · settle · draw", blurb: "A looping pot on this face. People buy a seat. After the wait, Bitcoin's seal names the winner. You never pick who. No collect." },
    { id: "mint", title: "Mint", kind: "form", tag: "mint now · inscribe", blurb: "Not a prelist. One click: price to the seller now, eternal burn to write the star, art bytes as the child. Same content cannot mint twice." },
    { id: "cut", title: "KRC-77", kind: "form", tag: "luz ✧", blurb: "The token law on this star. Pick a max supply or infinite. Anyone may deposit ₭ into the pot. No collect — the owner cannot drain it. Shares live on the book, not in this paper." },
    { id: "stamp", title: "Stamp", kind: "form", tag: "you name winner", blurb: "Stamp scroll. The living owner writes the next claimant. No secret key — the journal sees the claim." },
    { id: "list", title: "List", kind: "form", tag: "allowlist", blurb: "List scroll. Sealed addresses, one claim each. Same paper as a guest list or airdrop." },
    { id: "code", title: "Code", kind: "code", tag: "vars + rules", blurb: "Your own law. Paste the JSON paper. Draft in Solidity if you like — an AI translates it. The exam refuses raw Solidity because this chain cannot run a Turing VM. Run test, then seal." },
  ];
  var PLACE = {
    buyer: "KRAYEXAMBUYER",
    seller: "KRAYEXAMSELLER",
    bene: "KRAYEXAMBENE",
    one: "KRAYEXAMONE",
    two: "KRAYEXAMTWO",
  };
  function seed(id, extra) {
    extra = extra || {};
    var me = extra.me || "";
    var star = extra.star || "0";
    if (id === "being" || id === "pass" || id === "times3") {
      return { living: { flags: cloneFlags(id) }, from: me || undefined };
    }
    if (id === "escrow") {
      return { form: { kind: "escrow", buyer: PLACE.buyer, seller: me || PLACE.seller, lock: "64" } };
    }
    if (id === "tunnel") return { form: { kind: "tunnel" }, star: star };
    if (id === "vest") {
      return { form: { kind: "vest", beneficiary: me || PLACE.bene, total: "100", duration: "64", start: "0" } };
    }
    if (id === "scroll") {
      return { form: { kind: "scroll", each: "1", max: "10", locked: true, gate: "open" } };
    }
    if (id === "stamp") {
      return { form: { kind: "scroll", each: "1", max: "10", locked: true, gate: "stamp" }, star: star };
    }
    if (id === "list") {
      return { form: { kind: "scroll", each: "1", max: "2", locked: true, gate: "list", allow: [PLACE.one, PLACE.two] } };
    }
    if (id === "raffle") {
      return { form: { kind: "raffle", price: "5", period: "100", seats: "8" }, star: star };
    }
    if (id === "mint") {
      return { form: { kind: "mint", price: "5", max: "8", shelf: "" }, star: star };
    }
    if (id === "cut") {
      return { form: { kind: "cut", supply: "100000", infinite: false }, star: star };
    }
    return { source: JSON.stringify(MARK) };
  }
  function cloneFlags(id) {
    return (LIVING[id] || LIVING.being).map(function (f) {
      return { name: f.name, on: !!f.on, motion: f.motion === "once" ? "once" : "toggle" };
    });
  }
  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }
  function field(id, ph, v, mode) {
    return '<input class="input" id="' + id + '" placeholder="' + esc(ph) + '" value="' + esc(v || "") + '"'
      + (mode ? ' inputmode="' + mode + '"' : "") + ' autocomplete="off" style="min-height:44px">';
  }
  function labeled(id, title, hint, ph, v) {
    return '<div class="lawknob">'
      + '<label for="' + id + '">' + esc(title) + "</label>"
      + '<p class="hint">' + esc(hint) + "</p>"
      + field(id, ph, v, "numeric")
      + "</div>";
  }
  function paintLiving(host, onChange) {
    var flags = host._flags || [];
    host.innerHTML = '<div class="lawflags">' + flags.map(function (f, i) {
      return '<div class="lawflag"><span class="fn">' + esc(f.name) + "</span><span>"
        + '<button type="button" class="btn" data-flip="' + i + '" style="min-height:44px">' + (f.on ? "true" : "false") + "</button> "
        + '<button type="button" class="btn" data-motion="' + i + '" style="min-height:44px">' + (f.motion === "once" ? "once" : "toggle") + "</button>"
        + "</span></div>";
    }).join("") + "</div>"
      + '<div class="lawadd"><input class="input" id="lawnew" placeholder="add clause (a–z)" maxlength="24" style="min-height:44px">'
      + '<button type="button" class="btn" id="lawaddbtn" style="min-height:44px">add</button></div>';
    function bump() { paintLiving(host, onChange); if (onChange) onChange(); }
    host.querySelectorAll("[data-flip]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = host._flags[+b.getAttribute("data-flip")];
        if (f.motion === "once") return;
        f.on = !f.on;
        bump();
      });
    });
    host.querySelectorAll("[data-motion]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = host._flags[+b.getAttribute("data-motion")];
        f.motion = f.motion === "once" ? "toggle" : "once";
        if (f.motion === "once") f.on = true;
        bump();
      });
    });
    var add = host.querySelector("#lawaddbtn");
    if (add) add.addEventListener("click", function () {
      var n = String((host.querySelector("#lawnew") || {}).value || "").trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,23}$/.test(n) || n === "owner") return;
      if (host._flags.some(function (f) { return f.name === n; })) return;
      host._flags.push({ name: n, on: false, motion: "toggle" });
      bump();
    });
  }
  function paint(host, id, opts) {
    opts = opts || {};
    if (!host) return;
    var me = opts.me || "";
    host._id = id;
    if (id === "code") {
      host._kind = "code";
      host.innerHTML = "";
      return;
    }
    if (LIVING[id]) {
      host._kind = "living";
      host._flags = cloneFlags(id);
      paintLiving(host, opts.onChange);
      return;
    }
    host._kind = "form";
    var html = "";
    if (id === "escrow") {
      html = field("f-buyer", "buyer address (bc1p / bcrt1p…)", "")
        + field("f-seller", "seller address", me)
        + field("f-lock", "lock (acts from now, default 64)", "64", "numeric");
    } else if (id === "tunnel") {
      html = field("f-dest", "dest address — empty = living owner", "");
    } else if (id === "vest") {
      html = field("f-ben", "beneficiary address", me)
        + field("f-total", "total ₭", "100", "numeric")
        + field("f-dur", "duration in acts", "64", "numeric");
    } else if (id === "scroll") {
      html = field("f-each", "each ₭ per claim", "1", "numeric")
        + field("f-max", "max claims", "10", "numeric")
        + '<select class="input" id="f-gate" style="min-height:44px">'
        + '<option value="open">open — anyone claims</option>'
        + '<option value="stamp">stamp — you name the winner</option>'
        + '<option value="list">list — sealed addresses</option></select>'
        + field("f-allow", "list addresses, comma-separated (list gate)", "")
        + '<label class="note" style="display:flex;align-items:center;gap:8px;min-height:44px">'
        + '<input type="checkbox" id="f-locked" checked> locked — no collect, ₭ leaves only through claim</label>';
    } else if (id === "raffle") {
      html = labeled("f-price", "Ticket · ₭", "How much each person puts in the pot. Example: 5 means every seat costs 5 ₭ (they also pay the eternal 1 ₭ network fee). The pot is the prize.", "e.g. 5", "5")
        + labeled("f-period", "Wait · Bitcoin seals", "How many Bitcoin seals after the first ticket before a draw is due. 100 is a long window. 2 is a quick lab round. Nobody can take the prize before this.", "e.g. 100", "100")
        + labeled("f-seats", "Seats · 2 to 8", "How many tickets this window accepts. When it is full, enter closes until someone delivers the prize. After a pay-out the seats empty and the next window opens.", "e.g. 8", "8");
    } else if (id === "mint") {
      html = labeled("f-price", "Price · ₭", "Service payment in the same act as the birth — not only 1 ₭. 0 is an airdrop. The minter also burns to write the bytes. No extra contract-call fee.", "e.g. 5", "5")
        + labeled("f-max", "Editions · 1 to 256", "How many children this face will father. When taken equals max the blessing dies. The family tree is the collection.", "e.g. 8", "8")
        + labeled("f-pay", "Pay mint price to", "Empty = living owner of the face. Or any address on this network — a normal service payment sealed in the paper.", "empty = living owner", "")
        + '<div class="lawknob"><label for="f-shelf">Art URL · secret · this node only</label><p class="hint">Run test compiles the paper without this. Seal needs a real https URL — the grey hint is not a value. Never published. Unguessable paths.</p>'
        + '<input class="input" id="f-shelf" placeholder="paste https://…" autocomplete="off" style="min-height:44px"></div>';
    } else if (id === "cut") {
      html = labeled("f-supply", "Supply · max units", "How many luz ✧ this star will ever have. 100000 is Radiola's default (one percent = 1000). Empty + infinite = no cap.", "e.g. 100000", "100000")
        + '<label class="note" style="display:flex;align-items:center;gap:8px;min-height:44px">'
        + '<input type="checkbox" id="f-infinite"> infinite — no max, supply stays open</label>';
    }
    host.innerHTML = '<div class="lawfields">' + html + "</div>";
    if (opts.onChange) {
      host.oninput = opts.onChange;
      var locked = host.querySelector("#f-locked");
      var gate = host.querySelector("#f-gate");
      var inf = host.querySelector("#f-infinite");
      if (locked) locked.addEventListener("change", opts.onChange);
      if (gate) gate.addEventListener("change", opts.onChange);
      if (inf) inf.addEventListener("change", opts.onChange);
    }
  }
  function read(host, id, extra) {
    extra = extra || {};
    if (id === "code") return { source: String(extra.source == null ? "" : extra.source) };
    if (host && host._flags) return { living: { flags: host._flags.map(function (f) { return { name: f.name, on: !!f.on, motion: f.motion }; }) } };
    if (id === "escrow") return { form: { kind: "escrow", buyer: val("f-buyer"), seller: val("f-seller"), lock: val("f-lock") } };
    if (id === "tunnel") return { form: { kind: "tunnel", dest: val("f-dest") } };
    if (id === "vest") return { form: { kind: "vest", beneficiary: val("f-ben"), total: val("f-total"), duration: val("f-dur") } };
    if (id === "scroll") {
      var allow = val("f-allow").split(/[\s,]+/).filter(Boolean);
      var box = document.getElementById("f-locked");
      return {
        form: {
          kind: "scroll",
          each: val("f-each"),
          max: val("f-max"),
          gate: val("f-gate") || "open",
          locked: !!(box && box.checked),
          allow: allow,
        },
      };
    }
    if (id === "raffle") {
      return { form: { kind: "raffle", price: val("f-price"), period: val("f-period"), seats: val("f-seats") } };
    }
    if (id === "mint") {
      return { form: { kind: "mint", price: val("f-price"), max: val("f-max"), payTo: val("f-pay"), shelf: val("f-shelf") } };
    }
    if (id === "cut") {
      var infBox = document.getElementById("f-infinite");
      return { form: { kind: "cut", supply: val("f-supply"), infinite: !!(infBox && infBox.checked) } };
    }
    return { living: { flags: cloneFlags("being") } };
  }
  function fingerprint(host, id, extra) {
    return id + "|" + JSON.stringify(read(host, id, extra));
  }
  function ready(host, id, extra) {
    var p = read(host, id, extra);
    if (p.source != null) {
      var raw = String(p.source).trim();
      if (!raw) return false;
      try { var j = JSON.parse(raw); return !!(j && j.rules); } catch (e) { return false; }
    }
    if (p.living) return !!(p.living.flags && p.living.flags.length);
    var f = p.form || {};
    if (f.kind === "escrow") return !!(f.buyer && f.seller);
    if (f.kind === "tunnel") return true;
    if (f.kind === "vest") return !!(f.beneficiary && f.total && f.duration);
    if (f.kind === "scroll") {
      if (f.gate === "list") return !!(f.allow && f.allow.length);
      return !!(f.each && f.max);
    }
    if (f.kind === "raffle") {
      var seats = Number(f.seats);
      return !!(f.price && Number(f.price) > 0 && f.period && Number(f.period) > 0 && seats >= 2 && seats <= 8);
    }
    if (f.kind === "mint") {
      var max = Number(f.max);
      var price = Number(f.price);
      return f.price !== "" && Number.isFinite(price) && price >= 0 && max >= 1 && max <= 256;
    }
    if (f.kind === "cut") {
      if (f.infinite) return true;
      var sup = Number(f.supply);
      return f.supply !== "" && Number.isInteger(sup) && sup >= 1 && sup <= 10000000;
    }
    return false;
  }
  function sealReady(host, id, extra) {
    if (!ready(host, id, extra)) return false;
    if (id !== "mint") return true;
    var f = read(host, id, extra).form || {};
    var shelf = String(f.shelf || "").trim();
    var max = Number(f.max);
    return /^https?:\/\//i.test(shelf) && (max <= 1 || /\{n\}|\{i\}/.test(shelf));
  }
  w.KrayContractPapers = {
    list: LIST,
    living: LIVING,
    mark: MARK,
    byId: byId,
    cloneFlags: cloneFlags,
    seed: seed,
    paint: paint,
    read: read,
    fingerprint: fingerprint,
    ready: ready,
    sealReady: sealReady,
  };
})(window);
