/* Factari CoOp — ABA Business Assessment. One question per screen, branching, immediate results. */
window.CoopInitAssessment = function () {
  'use strict';

  var DATA = window.COOP_ASSESSMENT;
  if (!DATA) return;
  var Q = DATA.questions.questions;
  var META = DATA.questions.meta;
  var SCORING = DATA.scoring;
  var RESULTS = DATA.results;
  var SITE = DATA.site || {};
  var track = window.CoopTrack || function () {};
  var STORE_KEY = 'coop_assessment_v1';

  var STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  var root = document.getElementById('assessment-root');
  if (!root) return;

  var state = { answers: {}, index: 0, started: false, done: false, result: null, deepest: 0 };

  /* ------------------------------------------------------------ storage */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ answers: state.answers, index: state.index, ts: Date.now() })); } catch (e) {}
  }
  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.answers || !Object.keys(parsed.answers).length) return null;
      if (Date.now() - (parsed.ts || 0) > 1000 * 60 * 60 * 24 * 30) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  /* ------------------------------------------------------------ helpers */
  function scrollTop() {
    var el = document.documentElement;
    var prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    el.style.scrollBehavior = prev;
  }

  /* Uses the shared helper from site.js when present so both call sites agree
     about no-cors (Apps Script) endpoints; falls back to a plain JSON POST. */
  function postPayload(payload) {
    if (window.CoopPost) return window.CoopPost(payload);
    return fetch(window.COOP_SUBMIT_ENDPOINT || '/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }).then(function (r) { if (!r.ok) throw new Error('submit failed'); return { ok: true }; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function arr(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

  function conditionMet(cond, answers) {
    if (!cond) return true;
    if (cond.all) return cond.all.every(function (c) { return conditionMet(c, answers); });
    if (cond.any) return cond.any.some(function (c) { return conditionMet(c, answers); });
    if (cond.not) return !conditionMet(cond.not, answers);
    var v = answers[cond.q];
    if (cond.in) return arr(v).some(function (x) { return cond.in.indexOf(x) !== -1; });
    if (cond.eq !== undefined) return v === cond.eq;
    return true;
  }

  function visibleQuestions() {
    return Q.filter(function (q) { return conditionMet(q.showIf, state.answers); });
  }

  function isAnswered(q) {
    if (q.type === 'group' || q.type === 'contact') {
      return (q.fields || []).every(function (f) {
        if (!f.required) return true;
        var v = state.answers[f.id];
        return v !== undefined && v !== null && String(v).trim() !== '';
      });
    }
    var v = state.answers[q.id];
    if (q.required === false) return true;
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  /* --------------------------------------------------------------- views */
  function renderIntro() {
    var saved = loadSaved();
    root.innerHTML =
      '<div class="wrap"><div class="asmt__stage"><div class="asmt-intro">' +
        '<span class="eyebrow">' + esc(META.intro.eyebrow) + '</span>' +
        '<h1>' + esc(META.intro.headline) + '</h1>' +
        '<p class="lede" style="margin-inline:auto">' + esc(META.intro.sub) + '</p>' +
        '<ul>' + META.intro.points.map(function (p) {
          return '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg><span>' + esc(p) + '</span></li>';
        }).join('') + '</ul>' +
        '<button class="btn btn--amber btn--lg btn--block" id="asmt-begin">' + esc(META.intro.start) + '</button>' +
        (saved ? '<button class="btn btn--ghost btn--block" style="margin-top:10px" id="asmt-resume">' + esc(META.intro.resume) + '</button>' : '') +
        '<p style="margin-top:18px;font-size:.85rem;color:var(--muted)">Your answers stay on this device until you choose to send them.</p>' +
      '</div></div></div>';

    document.getElementById('asmt-begin').addEventListener('click', function () {
      clearSaved();
      state.answers = {}; state.index = 0; state.started = true;
      track('assessment_start', { resumed: false });
      render();
    });
    var r = document.getElementById('asmt-resume');
    if (r) r.addEventListener('click', function () {
      var s = loadSaved();
      state.answers = s.answers; state.index = Math.min(s.index || 0, visibleQuestions().length - 1); state.started = true;
      track('assessment_start', { resumed: true });
      render();
    });
  }

  function optionMarkup(q, opt, selected, idx) {
    var multi = q.type === 'multi';
    return '<button type="button" class="opt ' + (multi ? '' : 'opt--radio') + (selected ? ' is-selected' : '') +
      '" data-value="' + esc(opt.value) + '" role="' + (multi ? 'checkbox' : 'radio') + '" aria-checked="' + (selected ? 'true' : 'false') + '">' +
      '<span class="opt__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></span>' +
      '<span class="opt__label">' + esc(opt.label) + (opt.help ? '<span class="opt__help">' + esc(opt.help) + '</span>' : '') + '</span>' +
      (idx < 9 ? '<span class="asmt__hintkeys" aria-hidden="true"><kbd>' + (idx + 1) + '</kbd></span>' : '') +
      '</button>';
  }

  function fieldMarkup(f) {
    var v = state.answers[f.id] || '';
    if (f.options) {
      return '<div class="field"><label>' + esc(f.label) + '</label><div class="opts" data-subfield="' + esc(f.id) + '">' +
        f.options.map(function (o) {
          return '<button type="button" class="opt opt--radio' + (v === o.value ? ' is-selected' : '') + '" data-value="' + esc(o.value) + '">' +
            '<span class="opt__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></span>' +
            '<span class="opt__label">' + esc(o.label) + '</span></button>';
        }).join('') + '</div></div>';
    }
    return '<div class="field"><label for="f_' + esc(f.id) + '">' + esc(f.label) + (f.required ? '' : ' <span style="font-weight:450;color:var(--muted)">(optional)</span>') + '</label>' +
      '<input id="f_' + esc(f.id) + '" data-subfield="' + esc(f.id) + '" type="' + esc(f.type === 'text' ? 'text' : f.type) + '" value="' + esc(v) + '"' +
      (f.autocomplete ? ' autocomplete="' + esc(f.autocomplete) + '"' : '') +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '></div>';
  }

  function bodyForQuestion(q) {
    var v = state.answers[q.id];
    if (q.type === 'single' || q.type === 'multi') {
      return '<div class="opts" role="' + (q.type === 'multi' ? 'group' : 'radiogroup') + '">' +
        q.options.map(function (o, i) {
          var sel = q.type === 'multi' ? arr(v).indexOf(o.value) !== -1 : v === o.value;
          return optionMarkup(q, o, sel, i);
        }).join('') + '</div>';
    }
    if (q.type === 'text') {
      return '<div class="field"><input id="q_input" type="text" value="' + esc(v || '') + '" placeholder="' + esc(q.placeholder || '') + '"></div>';
    }
    if (q.type === 'state' || q.type === 'multistate') {
      var sel = q.type === 'multistate' ? arr(v) : (v ? [v] : []);
      return '<div class="state-search field"><input id="state-filter" type="text" placeholder="Type to filter…" autocomplete="off"></div>' +
        '<div class="state-grid" id="state-grid">' + STATES.map(function (s) {
          return '<button type="button" class="state-chip' + (sel.indexOf(s) !== -1 ? ' is-selected' : '') + '" data-value="' + s + '">' + s + '</button>';
        }).join('') + '</div>';
    }
    if (q.type === 'group' || q.type === 'contact') {
      var two = (q.fields || []).length > 2;
      return '<div class="form-grid ' + (two ? 'form-grid--2' : '') + '">' + q.fields.map(fieldMarkup).join('') + '</div>' +
        (q.consent ? '<p style="font-size:.83rem;color:var(--muted);margin-top:4px">' + esc(q.consent) + '</p>' : '');
    }
    return '';
  }

  function render() {
    if (state.done) return renderResults();
    if (!state.started) return renderIntro();

    var list = visibleQuestions();
    if (state.index >= list.length) return submit();
    var q = list[state.index];
    state.deepest = Math.max(state.deepest, state.index);
    var pct = Math.round((state.index / list.length) * 100);
    var autoAdvance = q.type === 'single' || q.type === 'state';

    root.innerHTML =
      '<div class="asmt__bar"><div class="wrap"><div class="asmt__bar-inner">' +
        '<span class="asmt__section">' + esc(q.section || '') + '</span>' +
        '<span class="asmt__progress"><i style="width:' + pct + '%"></i></span>' +
        '<span class="asmt__count">' + (state.index + 1) + ' / ' + list.length + '</span>' +
      '</div></div></div>' +
      '<div class="wrap"><div class="asmt__stage"><div class="asmt__q" data-qtype="' + q.type + '" data-qid="' + q.id + '">' +
        '<h2>' + esc(q.title) + '</h2>' +
        (q.help ? '<p class="help">' + esc(q.help) + '</p>' : '') +
        bodyForQuestion(q) +
        '<div class="asmt__nav">' +
          (state.index > 0 ? '<button class="asmt__back" id="asmt-back">&larr; Back</button>' : '<span></span>') +
          '<span class="spacer"></span>' +
          (autoAdvance
            ? (q.type === 'single' ? '<span class="asmt__hintkeys">Press <kbd>1</kbd>–<kbd>9</kbd> to answer</span>' : '<span class="asmt__hintkeys">Pick your state to continue</span>')
            : '<button class="btn btn--amber" id="asmt-next">Continue</button>') +
        '</div>' +
      '</div></div></div>';

    track('assessment_question_view', { question_id: q.id, index: state.index + 1, total: list.length });
    wireQuestion(q);
    var first = root.querySelector('.opt, input');
    if (first && first.tagName === 'INPUT' && window.innerWidth > 820) first.focus();
    scrollTop();
  }

  function next() {
    var list = visibleQuestions();
    var q = list[state.index];
    if (q && !isAnswered(q)) {
      flash('Pick an answer to keep going.');
      return;
    }
    state.index += 1;
    save();
    render();
  }

  function flash(msg) {
    var nav = root.querySelector('.asmt__nav');
    if (!nav) return;
    var existing = nav.querySelector('.asmt-flash');
    if (existing) existing.remove();
    var el = document.createElement('span');
    el.className = 'asmt-flash';
    el.style.cssText = 'color:var(--clay);font-size:.88rem;font-weight:600';
    el.textContent = msg;
    nav.insertBefore(el, nav.querySelector('.spacer'));
    setTimeout(function () { el.remove(); }, 2600);
  }

  function wireQuestion(q) {
    var back = document.getElementById('asmt-back');
    if (back) back.addEventListener('click', function () { state.index = Math.max(0, state.index - 1); save(); render(); });
    var nextBtn = document.getElementById('asmt-next');
    if (nextBtn) nextBtn.addEventListener('click', next);

    if (q.type === 'single' || q.type === 'multi') {
      root.querySelectorAll('.opts .opt').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var val = btn.getAttribute('data-value');
          if (q.type === 'single') {
            state.answers[q.id] = val;
            save();
            setTimeout(next, 130);
          } else {
            var cur = arr(state.answers[q.id]).slice();
            var at = cur.indexOf(val);
            if (at === -1) {
              if (q.exclusive && val === q.exclusive) cur = [val];
              else {
                if (q.exclusive) cur = cur.filter(function (x) { return x !== q.exclusive; });
                if (q.maxSelections && cur.length >= q.maxSelections) { flash('Pick up to ' + q.maxSelections + '.'); return; }
                cur.push(val);
              }
            } else cur.splice(at, 1);
            state.answers[q.id] = cur;
            save();
            root.querySelectorAll('.opts .opt').forEach(function (b) {
              var on = cur.indexOf(b.getAttribute('data-value')) !== -1;
              b.classList.toggle('is-selected', on);
              b.setAttribute('aria-checked', String(on));
            });
          }
        });
      });
    }

    if (q.type === 'text') {
      var input = document.getElementById('q_input');
      input.addEventListener('input', function () { state.answers[q.id] = input.value; save(); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    }

    if (q.type === 'state' || q.type === 'multistate') {
      var filter = document.getElementById('state-filter');
      var grid = document.getElementById('state-grid');
      filter.addEventListener('input', function () {
        var t = filter.value.trim().toUpperCase();
        grid.querySelectorAll('.state-chip').forEach(function (c) {
          c.style.display = !t || c.getAttribute('data-value').indexOf(t) === 0 ? '' : 'none';
        });
      });
      grid.querySelectorAll('.state-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var val = chip.getAttribute('data-value');
          if (q.type === 'state') {
            state.answers[q.id] = val;
            save();
            setTimeout(next, 130);
          } else {
            var cur = arr(state.answers[q.id]).slice();
            var at = cur.indexOf(val);
            if (at === -1) cur.push(val); else cur.splice(at, 1);
            state.answers[q.id] = cur;
            chip.classList.toggle('is-selected', at === -1);
            save();
          }
        });
      });
    }

    if (q.type === 'group' || q.type === 'contact') {
      root.querySelectorAll('input[data-subfield]').forEach(function (input) {
        input.addEventListener('input', function () { state.answers[input.getAttribute('data-subfield')] = input.value; save(); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
      });
      root.querySelectorAll('[data-subfield] .opt').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var group = btn.closest('[data-subfield]');
          var id = group.getAttribute('data-subfield');
          state.answers[id] = btn.getAttribute('data-value');
          group.querySelectorAll('.opt').forEach(function (b) { b.classList.toggle('is-selected', b === btn); });
          save();
        });
      });
    }
  }

  /* -------------------------------------------------------- keyboard */
  var keyHandler = function (e) {
    if (!state.started || state.done) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var list = visibleQuestions();
    var q = list[state.index];
    if (!q) return;
    if (/^[1-9]$/.test(e.key) && (q.type === 'single' || q.type === 'multi')) {
      var opts = root.querySelectorAll('.opts .opt');
      var target = opts[parseInt(e.key, 10) - 1];
      if (target) { e.preventDefault(); target.click(); }
    } else if (e.key === 'Enter') {
      e.preventDefault(); next();
    } else if (e.key === 'Backspace' && state.index > 0) {
      e.preventDefault(); state.index -= 1; render();
    }
  };
  if (window.__coopKeyHandler) document.removeEventListener('keydown', window.__coopKeyHandler);
  window.__coopKeyHandler = keyHandler;
  document.addEventListener('keydown', keyHandler);

  /* ---------------------------------------------------------- drop-off */
  window.addEventListener('beforeunload', function () {
    if (state.started && !state.done) {
      var list = visibleQuestions();
      var q = list[state.index];
      track('assessment_dropoff', { question_id: q ? q.id : 'unknown', index: state.index + 1, total: list.length });
    }
  });

  /* ------------------------------------------------------------ submit */
  function submit() {
    var result = window.CoopScoring.evaluate(state.answers, SCORING, RESULTS);
    state.result = result;
    state.done = true;
    clearSaved();

    var attribution = {};
    try { attribution = JSON.parse(sessionStorage.getItem('coop_attribution') || '{}'); } catch (e) {}

    var payload = {
      kind: 'assessment',
      submittedAt: new Date().toISOString(),
      answers: state.answers,
      result: result,
      attribution: attribution,
      lead: buildLead(state.answers, result, attribution),
    };

    root.innerHTML = '<div class="wrap"><div class="asmt__stage center"><div class="asmt-intro">' +
      '<h2>Reading your answers…</h2><p class="lede" style="margin-inline:auto">One moment.</p>' +
      '<div class="asmt__progress" style="margin-top:22px"><i style="width:100%"></i></div></div></div></div>';

    track('assessment_complete', {
      classification: result.classification,
      result_category: result.resultCategory,
      track: result.track,
      health_band: band(result.businessHealthScore),
      coop_band: band(result.coopOpportunityScore),
    });

    var done = false;
    var finish = function () { if (!done) { done = true; renderResults(); } };
    setTimeout(finish, 2500);
    postPayload(payload)
      .then(function () { state.submitted = true; })
      .catch(function () { state.submitted = false; })
      .finally(function () { setTimeout(finish, 350); });
  }

  function labelFor(qid, value) {
    for (var i = 0; i < Q.length; i++) {
      var q = Q[i];
      var pool = q.id === qid ? q.options : null;
      if (!pool && q.fields) {
        for (var j = 0; j < q.fields.length; j++) if (q.fields[j].id === qid) pool = q.fields[j].options;
      }
      if (pool) {
        for (var k = 0; k < pool.length; k++) if (pool[k].value === value) return pool[k].label;
      }
    }
    return value;
  }

  function buildLead(a, r, attribution) {
    return {
      first_name: a.first_name || '', last_name: a.last_name || '',
      name: ((a.first_name || '') + ' ' + (a.last_name || '')).trim(),
      email: a.email || '', phone: a.phone || '',
      company: a.co_name || '', website: a.co_website || '',
      states: r.track === 'launch' ? arr(a.launch_state) : arr(a.co_states),
      lead_source: attribution.utm_source || (attribution.referrer ? 'referral' : 'direct'),
      utm_campaign: attribution.utm_campaign || '', utm_medium: attribution.utm_medium || '',
      landing_page: attribution.landing_page || '',
      company_type: r.track === 'launch' ? 'launch' : 'existing',
      years_operating: a.co_years || '', locations: a.co_locations || '',
      revenue_range: a.fin_revenue || '', revenue_trend: a.fin_growth || '',
      client_count: a.co_clients || '', employee_count: a.co_employees || '', bcba_count: a.co_bcbas || '',
      payers: r.track === 'launch' ? arr(a.launch_payers) : arr(a.co_payers),
      profitability: a.fin_profit || '', cash_status: a.fin_cash || '', ar_status: a.fin_ar || '',
      pain_points: arr(a.ops_challenges), owner_dependence: a.owner_dependence || '',
      owner_experience: a.owner_experience || '', growth_intent: arr(a.strategic_intent),
      shared_services_interest: arr(a.coop_interest), transaction_interest: a.transaction_interest || '',
      launch_stage: a.segment || '', launch_timing: a.launch_timing || '', launch_capital: a.launch_capital || '',
      launch_credentialing: a.launch_credentialing || '', launch_market: a.launch_market || '',
      launch_background: a.launch_background || '', launch_help: arr(a.launch_help),
      business_health_score: r.businessHealthScore, coop_opportunity_score: r.coopOpportunityScore,
      lead_classification: r.classification, secondary_classifications: r.secondaryClassifications,
      tags: r.tags, result_category: r.resultCategory,
      alerts: r.alerts.map(function (x) { return x.key; }),
      submitted_at: new Date().toISOString(),
    };
  }

  function band(score) {
    if (score >= 78) return 'strong';
    if (score >= 62) return 'solid';
    if (score >= 45) return 'strained';
    return 'fragile';
  }
  var HEALTH_WORDS = {
    strong: 'Strong', solid: 'Solid, with room to tighten',
    strained: 'Under strain', fragile: 'Fragile right now',
  };
  var LAUNCH_WORDS = {
    strong: 'Ready to move', solid: 'Nearly ready',
    strained: 'Foundation still forming', fragile: 'Early — plenty to build',
  };
  var COOP_WORDS = {
    strong: 'High — shared scale would do real work here',
    solid: 'Moderate — a few functions would carry well',
    strained: 'Selective — one or two areas',
    fragile: 'Limited for now',
  };

  function renderResults() {
    var r = state.result;
    var a = state.answers;
    var cat = RESULTS.categories[r.resultCategory];
    var healthWords = r.track === 'launch' ? LAUNCH_WORDS : HEALTH_WORDS;
    var healthLabel = r.track === 'launch' ? 'Launch readiness' : 'Business health';

    var snapshot = [];
    if (r.track === 'launch') {
      snapshot.push(['Stage', labelFor('segment', a.segment)]);
      snapshot.push(['Target market', a.launch_market || 'Not yet chosen']);
      snapshot.push(['Timeline', labelFor('launch_timing', a.launch_timing)]);
    } else {
      snapshot.push(['Company', a.co_name || 'Your company']);
      snapshot.push(['Scale', labelFor('fin_revenue', a.fin_revenue) + ' · ' + labelFor('co_clients', a.co_clients).toLowerCase() + ' clients']);
      snapshot.push(['Operating in', arr(a.co_states).join(', ') || '—']);
    }

    var scheduleUrl = (SITE.brand && SITE.brand.schedulingUrl) || '#';

    root.innerHTML =
      '<div class="wrap"><div class="asmt__stage">' +
        '<div class="result-hero">' +
          '<span class="eyebrow">' + esc(cat.kicker) + '</span>' +
          '<h1>' + esc(cat.headline) + '</h1>' +
          '<p class="lede">' + esc(cat.lede) + '</p>' +
          '<div class="meters">' +
            meter(healthLabel, healthWords[band(r.businessHealthScore)], r.businessHealthScore) +
            meter('Fit with shared infrastructure', COOP_WORDS[band(r.coopOpportunityScore)], r.coopOpportunityScore) +
          '</div>' +
        '</div>' +

        '<div class="result-section"><dl class="snapshot">' +
          snapshot.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('') +
        '</dl></div>' +

        '<div class="result-section narrow" style="margin-inline:0">' +
          cat.body.map(function (p) { return '<p style="font-size:1.05rem;color:var(--muted);max-width:70ch">' + esc(p) + '</p>'; }).join('') +
        '</div>' +

        '<div class="result-section">' +
          '<h2 style="font-size:clamp(1.4rem,2.8vw,2rem)">' + esc(cat.focusHeading) + '</h2>' +
          '<div class="focus-list">' + r.insights.map(function (i) {
            return '<div class="focus-item"><div><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></div></div>';
          }).join('') + '</div>' +
        '</div>' +

        '<div class="result-cta">' +
          '<div><h2>Talk through your results.</h2>' +
          '<p>Thirty minutes with someone who has run these companies. We\'ll go through what the assessment surfaced and what we\'d do about it — whether or not you ever work with us.</p></div>' +
          '<div class="btn-row">' +
            '<a class="btn btn--primary btn--lg" href="' + esc(scheduleUrl) + '" id="result-schedule" rel="noopener">Talk Through My Results</a>' +
            '<button class="btn btn--ghost btn--lg" id="result-email">Email Me My Results</button>' +
          '</div>' +
          '<p class="sent-note" id="email-sent">Sent — check your inbox at ' + esc(a.email || '') + '.</p>' +
        '</div>' +

        '<div class="result-section center" style="padding-bottom:20px">' +
          '<button class="btn btn--ghost btn--sm" id="result-restart">Start over</button>' +
        '</div>' +
      '</div></div>';

    requestAnimationFrame(function () {
      root.querySelectorAll('.meter__track i').forEach(function (el) {
        el.style.width = el.getAttribute('data-w') + '%';
      });
    });

    document.getElementById('result-schedule').addEventListener('click', function () {
      track('schedule_click', { source: 'results', classification: r.classification, result_category: r.resultCategory });
    });
    document.getElementById('result-email').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sending…';
      postPayload({ kind: 'email_results', email: a.email, result: r, answers: a })
        .catch(function () {}).finally(function () {
        btn.textContent = 'Email Me My Results';
        btn.disabled = false;
        document.getElementById('email-sent').classList.add('is-visible');
        track('results_emailed', { classification: r.classification });
      });
    });
    document.getElementById('result-restart').addEventListener('click', function () {
      clearSaved();
      state = { answers: {}, index: 0, started: false, done: false, result: null, deepest: 0 };
      render();
    });

    track('results_view', { classification: r.classification, result_category: r.resultCategory });
    scrollTop();
  }

  function meter(label, value, score) {
    return '<div class="meter"><div class="meter__label">' + esc(label) + '</div>' +
      '<div class="meter__value">' + esc(value) + '</div>' +
      '<div class="meter__track"><i data-w="' + Math.max(8, Math.min(100, score)) + '" style="width:0%"></i></div></div>';
  }

  render();
};
if (document.getElementById('assessment-root')) window.CoopInitAssessment();
