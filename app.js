(function(){
  "use strict";

  var STORAGE_KEY = "taka_tracker_v1";

  var MONTHS = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];

  /* ---------------- date helpers (all local-time, no UTC surprises) ---------------- */
  function pad2(n){ return n < 10 ? "0"+n : ""+n; }
  function fmtISO(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function parseISO(s){
    var parts = s.split("-");
    return new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
  }
  function todayStr(){ return fmtISO(new Date()); }
  function daysBetween(a,b){ return Math.round((b - a) / 86400000); }
  function clampDate(s, min, max){
    if(min && s < min) return min;
    if(max && s > max) return max;
    return s;
  }
  function fmtDateHuman(s){
    var d = parseISO(s);
    return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + d.getFullYear();
  }
  function fmtMoney(n){
    n = Math.round(Number(n) || 0);
    return "৳" + n.toLocaleString("en-IN");
  }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  /* ---------------- state ---------------- */
  var state = null;

  function defaultState(){
    return { setup: null, topups: [], entries: {}, quickNotes: {} };
  }

  function load(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      return {
        setup: parsed.setup || null,
        topups: parsed.topups || [],
        entries: parsed.entries || {},
        quickNotes: parsed.quickNotes || {}
      };
    }catch(e){
      console.error("লোড করতে সমস্যা হয়েছে", e);
      return defaultState();
    }
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getTotals(){
    var totalBalance = (state.setup ? Number(state.setup.initialBalance) : 0) +
      state.topups.reduce(function(s,t){ return s + Number(t.amount||0); }, 0);
    var totalSpent = Object.keys(state.entries).reduce(function(s,k){
      return s + Number(state.entries[k].amount || 0);
    }, 0);
    return { totalBalance: totalBalance, totalSpent: totalSpent, remaining: totalBalance - totalSpent };
  }

  function getDaysInfo(){
    if(!state.setup) return { daysTotal:0, daysPassed:0, daysLeft:0 };
    var start = state.setup.startDate, end = state.setup.endDate;
    var daysTotal = daysBetween(parseISO(start), parseISO(end)) + 1;
    var today = todayStr();
    var passed;
    if(today < start) passed = 0;
    else if(today > end) passed = daysTotal;
    else passed = daysBetween(parseISO(start), parseISO(today)) + 1;
    var left = Math.max(daysTotal - passed, 0);
    return { daysTotal: daysTotal, daysPassed: passed, daysLeft: left };
  }

  /* ---------------- DOM refs ---------------- */
  var $ = function(id){ return document.getElementById(id); };

  var onboarding = $("onboarding"), mainApp = $("mainApp");

  /* ---------------- dashboard ---------------- */
  function renderDashboard(){
    if(!state.setup) return;
    var t = getTotals(), d = getDaysInfo();

    $("periodLabel").textContent = fmtDateHuman(state.setup.startDate) + " – " + fmtDateHuman(state.setup.endDate);
    $("remainingAmount").textContent = fmtMoney(t.remaining);
    $("spentAmount").textContent = fmtMoney(t.totalSpent);
    $("daysPassedNum").textContent = d.daysPassed;
    $("daysLeftNum").textContent = d.daysLeft;

    var heroEl = document.querySelector(".hero-balance");
    heroEl.classList.toggle("over-budget", t.remaining < 0);

    var suggestEl = $("suggestBudget");
    if(d.daysLeft > 0){
      var perDay = Math.max(t.remaining, 0) / d.daysLeft;
      suggestEl.textContent = "প্রতিদিন গড়ে " + fmtMoney(perDay) + " করে খরচ করলে শেষ দিন পর্যন্ত চলবে";
    } else if(t.remaining < 0){
      suggestEl.textContent = "নির্ধারিত সময় শেষ, বরাদ্দের চেয়ে বেশি খরচ হয়ে গেছে";
    } else {
      suggestEl.textContent = "নির্ধারিত সময় শেষ হয়ে গেছে";
    }
  }

  /* ---------------- tabs ---------------- */
  var tabs = ["add","calendar","history","settings"];
  function switchTab(name){
    tabs.forEach(function(t){
      $("tab-"+t).classList.toggle("hidden", t !== name);
    });
    document.querySelectorAll(".nav-btn").forEach(function(b){
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll("#bottomTabs button").forEach(function(b){
      b.classList.toggle("active", b.dataset.tab === name);
    });
    if(name === "calendar") renderCalendar();
    if(name === "history") renderHistory();
    if(name === "settings") fillSettingsForm();
  }
  document.querySelectorAll(".nav-btn, #bottomTabs button").forEach(function(btn){
    btn.addEventListener("click", function(){ switchTab(btn.dataset.tab); });
  });

  /* ---------------- add / edit entry ---------------- */
  var entryDateInput = $("entryDate"), entryAmountInput = $("entryAmount"), entryNoteInput = $("entryNote");
  var noteToggle = document.querySelector(".note-toggle");
  var deleteEntryBtn = $("deleteEntryBtn"), addTitle = $("addTitle");

  function loadEntryForDate(dateStr){
    var existing = state.entries[dateStr];
    if(existing){
      entryAmountInput.value = existing.amount || "";
      entryNoteInput.value = existing.note || "";
      noteToggle.open = !!(existing.note && existing.note.trim());
      deleteEntryBtn.classList.remove("hidden");
      addTitle.textContent = fmtDateHuman(dateStr) + " তারিখের খরচ সম্পাদনা করুন";
    } else {
      entryAmountInput.value = "";
      entryNoteInput.value = "";
      noteToggle.open = false;
      deleteEntryBtn.classList.add("hidden");
      addTitle.textContent = fmtDateHuman(dateStr) + " তারিখের খরচ যোগ করুন";
    }
    $("calcOut").value = ""; $("calcIn").value = ""; $("calcResult").textContent = fmtMoney(0);
    renderTallyList(dateStr);
  }

  entryDateInput.addEventListener("change", function(){
    loadEntryForDate(entryDateInput.value);
  });

  $("entryForm").addEventListener("submit", function(e){
    e.preventDefault();
    var dateStr = entryDateInput.value;
    if(!dateStr) return;
    var amount = Number(entryAmountInput.value || 0);
    var note = entryNoteInput.value.trim();
    state.entries[dateStr] = { amount: amount, note: note };
    save();
    renderDashboard();
    loadEntryForDate(dateStr);
    renderCalendarIfVisible();
  });

  deleteEntryBtn.addEventListener("click", function(){
    var dateStr = entryDateInput.value;
    if(!state.entries[dateStr]) return;
    if(!confirm(fmtDateHuman(dateStr) + " তারিখের হিসাব মুছে ফেলতে চান?")) return;
    delete state.entries[dateStr];
    save();
    renderDashboard();
    loadEntryForDate(dateStr);
    renderCalendarIfVisible();
  });

  function renderCalendarIfVisible(){
    if(!$("tab-calendar").classList.contains("hidden")) renderCalendar();
  }

  /* ---------------- helper tools: calculator ---------------- */
  var helperTabBtns = document.querySelectorAll(".helper-tab-btn");
  helperTabBtns.forEach(function(btn){
    btn.addEventListener("click", function(){
      helperTabBtns.forEach(function(b){ b.classList.toggle("active", b === btn); });
      $("helper-calc").classList.toggle("hidden", btn.dataset.helper !== "calc");
      $("helper-tally").classList.toggle("hidden", btn.dataset.helper !== "tally");
    });
  });

  function recalcCalc(){
    var out = Number($("calcOut").value || 0), inn = Number($("calcIn").value || 0);
    var result = Math.max(out - inn, 0);
    $("calcResult").textContent = fmtMoney(result);
    return result;
  }
  $("calcOut").addEventListener("input", recalcCalc);
  $("calcIn").addEventListener("input", recalcCalc);
  $("useCalcBtn").addEventListener("click", function(){
    entryAmountInput.value = recalcCalc();
  });

  /* ---------------- helper tools: quick tally ---------------- */
  function renderTallyList(dateStr){
    var list = state.quickNotes[dateStr] || [];
    var container = $("tallyList");
    container.innerHTML = "";
    var total = 0;
    list.forEach(function(item){
      total += Number(item.amount || 0);
      var row = document.createElement("div");
      row.className = "tally-row";
      row.innerHTML =
        '<span class="t-desc">' + (item.desc ? escapeHtml(item.desc) : "খরচ") + '</span>' +
        '<span class="t-amt">' + fmtMoney(item.amount) + '</span>' +
        '<button type="button" class="t-del" aria-label="মুছুন">×</button>';
      row.querySelector(".t-del").addEventListener("click", function(){
        state.quickNotes[dateStr] = (state.quickNotes[dateStr]||[]).filter(function(x){ return x.id !== item.id; });
        save();
        renderTallyList(dateStr);
      });
      container.appendChild(row);
    });
    if(list.length === 0){
      container.innerHTML = '<p class="helper-hint" style="margin:0;">এখনো কিছু টোকা হয়নি</p>';
    }
    $("tallyTotal").textContent = fmtMoney(total);
  }

  function escapeHtml(s){
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  $("tallyAddBtn").addEventListener("click", function(){
    var dateStr = entryDateInput.value;
    var amount = Number($("tallyAmount").value || 0);
    if(!amount) return;
    var desc = $("tallyDesc").value.trim();
    if(!state.quickNotes[dateStr]) state.quickNotes[dateStr] = [];
    state.quickNotes[dateStr].push({ id: uid(), desc: desc, amount: amount });
    save();
    $("tallyDesc").value = ""; $("tallyAmount").value = "";
    renderTallyList(dateStr);
  });

  $("useTallyBtn").addEventListener("click", function(){
    var dateStr = entryDateInput.value;
    var list = state.quickNotes[dateStr] || [];
    var total = list.reduce(function(s,x){ return s + Number(x.amount||0); }, 0);
    entryAmountInput.value = total;
    if(!entryNoteInput.value.trim() && list.length){
      entryNoteInput.value = list.map(function(x){
        return (x.desc ? x.desc + " " : "") + fmtMoney(x.amount);
      }).join("\n");
      noteToggle.open = true;
    }
  });

  /* ---------------- calendar ---------------- */
  var calViewDate = new Date();
  function renderCalendar(){
    if(!state.setup) return;
    var y = calViewDate.getFullYear(), m = calViewDate.getMonth();
    $("calMonthLabel").textContent = MONTHS[m] + " " + y;

    var grid = $("calGrid");
    grid.innerHTML = "";
    var firstDay = new Date(y, m, 1);
    var startWeekday = firstDay.getDay();
    var daysInMonth = new Date(y, m+1, 0).getDate();
    var today = todayStr();

    for(var i=0; i<startWeekday; i++){
      var empty = document.createElement("div");
      empty.className = "cal-cell empty";
      grid.appendChild(empty);
    }
    for(var day=1; day<=daysInMonth; day++){
      var dateStr = y + "-" + pad2(m+1) + "-" + pad2(day);
      var cell = document.createElement("div");
      cell.className = "cal-cell";
      var entry = state.entries[dateStr];
      var amt = entry ? Number(entry.amount||0) : 0;

      if(dateStr < state.setup.startDate || dateStr > state.setup.endDate) cell.classList.add("out-of-range");
      if(dateStr === today) cell.classList.add("is-today");
      if(entry){
        cell.classList.add("has-spend");
        if(amt > 1000) cell.classList.add("high-spend");
      }
      cell.innerHTML = '<span class="cal-day-num">' + day + '</span>' +
        (entry ? '<span class="cal-amt">' + fmtMoney(amt) + '</span>' : '');
      cell.addEventListener("click", function(ds){
        return function(){
          switchTab("add");
          entryDateInput.value = ds;
          loadEntryForDate(ds);
        };
      }(dateStr));
      grid.appendChild(cell);
    }
  }
  $("calPrev").addEventListener("click", function(){
    calViewDate.setMonth(calViewDate.getMonth() - 1);
    renderCalendar();
  });
  $("calNext").addEventListener("click", function(){
    calViewDate.setMonth(calViewDate.getMonth() + 1);
    renderCalendar();
  });

  /* ---------------- history ---------------- */
  function renderHistory(){
    var container = $("historyList");
    var dates = Object.keys(state.entries).sort().reverse();
    if(dates.length === 0){
      container.innerHTML = '<p class="empty-state">এখনো কোনো খরচ যোগ করা হয়নি</p>';
      return;
    }
    container.innerHTML = "";
    dates.forEach(function(dateStr){
      var entry = state.entries[dateStr];
      var amt = Number(entry.amount||0);
      var item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML =
        '<div class="history-top">' +
          '<span class="history-date">' + fmtDateHuman(dateStr) + '</span>' +
          '<span class="history-amt' + (amt > 1000 ? ' high' : '') + '">' + fmtMoney(amt) + '</span>' +
        '</div>' +
        (entry.note ? '<div class="history-note">' + escapeHtml(entry.note) + '</div>' : '') +
        '<div class="history-actions">' +
          '<button type="button" class="edit">সম্পাদনা করুন</button>' +
          '<button type="button" class="del">মুছুন</button>' +
        '</div>';
      item.querySelector(".edit").addEventListener("click", function(){
        switchTab("add");
        entryDateInput.value = dateStr;
        loadEntryForDate(dateStr);
      });
      item.querySelector(".del").addEventListener("click", function(){
        if(!confirm(fmtDateHuman(dateStr) + " তারিখের হিসাব মুছে ফেলতে চান?")) return;
        delete state.entries[dateStr];
        save();
        renderDashboard();
        renderHistory();
        renderCalendarIfVisible();
      });
      container.appendChild(item);
    });
  }

  /* ---------------- settings: period / balance ---------------- */
  function fillSettingsForm(){
    if(!state.setup) return;
    $("set_balance").value = state.setup.initialBalance;
    $("set_start").value = state.setup.startDate;
    $("set_end").value = state.setup.endDate;
    $("topup_date").value = todayStr();
    renderTopupHistory();
  }

  $("setupEditForm").addEventListener("submit", function(e){
    e.preventDefault();
    state.setup = {
      initialBalance: Number($("set_balance").value || 0),
      startDate: $("set_start").value,
      endDate: $("set_end").value
    };
    save();
    renderDashboard();
    renderCalendarIfVisible();
    alert("আপডেট হয়ে গেছে");
  });

  $("topupForm").addEventListener("submit", function(e){
    e.preventDefault();
    var amount = Number($("topup_amount").value || 0);
    if(!amount) return;
    state.topups.push({
      id: uid(),
      amount: amount,
      date: $("topup_date").value || todayStr(),
      note: $("topup_note").value.trim()
    });
    save();
    $("topup_amount").value = "";
    $("topup_note").value = "";
    $("topup_date").value = todayStr();
    renderDashboard();
    renderTopupHistory();
  });

  function renderTopupHistory(){
    var container = $("topupHistory");
    if(state.topups.length === 0){
      container.innerHTML = '<p class="empty-state">এখনো কোনো টাকা যোগ করা হয়নি</p>';
      return;
    }
    container.innerHTML = "";
    state.topups.slice().sort(function(a,b){ return b.date.localeCompare(a.date); }).forEach(function(tu){
      var row = document.createElement("div");
      row.className = "topup-row";
      row.innerHTML =
        '<span class="tu-info">' + fmtDateHuman(tu.date) + (tu.note ? " — " + escapeHtml(tu.note) : "") + '</span>' +
        '<span class="tu-amt">' + fmtMoney(tu.amount) + '</span>' +
        '<button type="button" class="tu-del" aria-label="মুছুন">×</button>';
      row.querySelector(".tu-del").addEventListener("click", function(){
        if(!confirm("এই টাকা যোগ করাটা মুছে ফেলতে চান?")) return;
        state.topups = state.topups.filter(function(x){ return x.id !== tu.id; });
        save();
        renderDashboard();
        renderTopupHistory();
      });
      container.appendChild(row);
    });
  }

  /* ---------------- JSON backup ---------------- */
  $("exportJsonBtn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "taka-tracker-backup-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  $("importJsonInput").addEventListener("change", function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!confirm("বর্তমান সব ডেটা মুছে গিয়ে এই ব্যাকআপ ফাইলের ডেটা বসে যাবে। এগোতে চান?")) return;
        state = {
          setup: parsed.setup || null,
          topups: parsed.topups || [],
          entries: parsed.entries || {},
          quickNotes: parsed.quickNotes || {}
        };
        save();
        init();
      }catch(err){
        alert("ফাইলটি ঠিকভাবে পড়া যায়নি। এটা কি সঠিক ব্যাকআপ ফাইল?");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------------- PDF (via browser print) ---------------- */
  $("exportPdfBtn").addEventListener("click", function(){
    if(!state.setup){ alert("আগে হিসাব শুরু করুন"); return; }
    var t = getTotals(), d = getDaysInfo();
    var rows = Object.keys(state.entries).sort().map(function(dateStr){
      var e = state.entries[dateStr];
      return "<tr><td>" + fmtDateHuman(dateStr) + "</td><td>" + fmtMoney(e.amount) + "</td><td>" + (e.note ? escapeHtml(e.note) : "") + "</td></tr>";
    }).join("");
    if(!rows) rows = '<tr><td colspan="3">এখনো কোনো খরচ যোগ করা হয়নি</td></tr>';

    $("printArea").innerHTML =
      "<h1>টাকার হিসাব — রিপোর্ট</h1>" +
      '<p class="p-period">সময়কাল: ' + fmtDateHuman(state.setup.startDate) + " – " + fmtDateHuman(state.setup.endDate) + " · তৈরি হয়েছে: " + fmtDateHuman(todayStr()) + "</p>" +
      '<div class="p-summary">' +
        "<div>মোট ব্যালেন্স<strong>" + fmtMoney(t.totalBalance) + "</strong></div>" +
        "<div>মোট খরচ<strong>" + fmtMoney(t.totalSpent) + "</strong></div>" +
        "<div>বাকি আছে<strong>" + fmtMoney(t.remaining) + "</strong></div>" +
        "<div>দিন পার / বাকি<strong>" + d.daysPassed + " / " + d.daysLeft + "</strong></div>" +
      "</div>" +
      "<table><thead><tr><th>তারিখ</th><th>খরচ</th><th>নোট</th></tr></thead><tbody>" + rows + "</tbody></table>";

    window.print();
  });

  /* ---------------- reset ---------------- */
  $("resetAllBtn").addEventListener("click", function(){
    if(!confirm("সত্যিই সব ডেটা মুছে ফেলতে চান? এটা আর ফেরানো যাবে না।")) return;
    if(!confirm("একদম শেষবার জিজ্ঞেস করছি — সব মুছে ফেলি?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  /* ---------------- onboarding ---------------- */
  $("onboardingForm").addEventListener("submit", function(e){
    e.preventDefault();
    state = defaultState();
    state.setup = {
      initialBalance: Number($("ob_balance").value || 0),
      startDate: $("ob_start").value,
      endDate: $("ob_end").value
    };
    save();
    init();
  });

  /* ---------------- init ---------------- */
  function init(){
    state = load();
    if(!state.setup){
      onboarding.classList.remove("hidden");
      mainApp.classList.add("hidden");
      var t = todayStr();
      $("ob_start").value = t;
      var endDefault = new Date();
      endDefault.setDate(endDefault.getDate() + 29);
      $("ob_end").value = fmtISO(endDefault);
      return;
    }
    onboarding.classList.add("hidden");
    mainApp.classList.remove("hidden");

    var initialDate = clampDate(todayStr(), state.setup.startDate, state.setup.endDate);
    entryDateInput.value = initialDate;
    entryDateInput.min = state.setup.startDate;
    entryDateInput.max = state.setup.endDate;
    loadEntryForDate(initialDate);

    calViewDate = parseISO(initialDate);

    renderDashboard();
    switchTab("add");
  }

  init();
})();
