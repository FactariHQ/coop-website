/* Factari CoOp — global site behaviour: nav, analytics, contact form. */
(function () {
  'use strict';

  /* ------------------------------------------------------------ analytics */
  var queued = [];
  function track(event, props) {
    props = props || {};
    try {
      if (window.plausible) window.plausible(event, { props: props });
      if (window.gtag) window.gtag('event', event, props);
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event: event }, props));
    } catch (e) { /* analytics must never break the page */ }
    queued.push({ event: event, props: props, t: Date.now() });
    if (queued.length > 100) queued.shift();
  }
  window.CoopTrack = track;
  window.CoopTrackLog = queued;

  /* ------------------------------------------------------------- submit */
  /* Apps Script web apps don't send CORS headers, so we post as a "simple
     request" (text/plain, no-cors). The response is opaque — the caller must
     treat a resolved promise as success rather than reading r.ok. */
  function post(payload) {
    var endpoint = window.COOP_SUBMIT_ENDPOINT || '/api/submit';
    var opaque = (window.COOP_SUBMIT_MODE || 'cors') === 'no-cors';
    var opts = { method: 'POST', body: JSON.stringify(payload) };
    if (opaque) {
      opts.mode = 'no-cors';
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
    }
    return fetch(endpoint, opts).then(function (r) {
      if (!opaque && !r.ok) throw new Error('submit failed: ' + r.status);
      return { ok: true, opaque: opaque };
    });
  }
  window.CoopPost = post;

  /* UTM + referrer capture, persisted for the session so the assessment can attach them */
  function captureAttribution() {
    try {
      var stored = JSON.parse(sessionStorage.getItem('coop_attribution') || 'null');
      var params = new URLSearchParams(location.search);
      var found = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) {
        if (params.get(k)) found[k] = params.get(k);
      });
      if (!stored || Object.keys(found).length) {
        var attribution = Object.assign({
          landing_page: location.pathname,
          referrer: document.referrer || '',
          first_seen: new Date().toISOString(),
        }, stored || {}, found);
        sessionStorage.setItem('coop_attribution', JSON.stringify(attribution));
      }
    } catch (e) {}
  }
  captureAttribution();

  if (window.plausible) window.plausible('pageview');
  track('page_view', { path: location.pathname });

  /* ------------------------------------------------------------------ nav */
  var toggle = document.getElementById('nav-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
  var header = document.getElementById('site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-stuck', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* -------------------------------------------------------- CTA tracking */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-track]');
    if (!el) return;
    var name = el.getAttribute('data-track');
    if (name === 'cta') track('cta_click', { label: el.getAttribute('data-cta') || el.textContent.trim(), path: location.pathname });
    else if (name === 'path') track('path_click', { path_key: el.getAttribute('data-path') });
    else if (name === 'schedule_click') track('schedule_click', { path: location.pathname });
    else track(name, { path: location.pathname });
  });

  /* ------------------------------------------------------- scheduler embed */
  var sched = document.getElementById('scheduler-embed');
  if (sched) {
    var url = sched.getAttribute('data-scheduling-url') || '';
    if (/calendly\.com|savvycal\.com|cal\.com|hubspot\.com\/meetings/.test(url) && !/example/.test(url)) {
      var frame = document.createElement('iframe');
      frame.src = url;
      frame.title = 'Schedule a conversation';
      frame.loading = 'lazy';
      frame.style.cssText = 'width:100%;height:660px;border:0;border-radius:14px';
      sched.innerHTML = '';
      sched.appendChild(frame);
      track('scheduler_loaded', {});
    }
  }

  /* --------------------------------------------------------- contact form */
  var form = document.getElementById('contact-form');
  if (form) {
    var topic = new URLSearchParams(location.search).get('topic');
    if (topic && form.topic) form.topic.value = topic;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('contact-status');
      var data = Object.fromEntries(new FormData(form).entries());
      if (!data.name || !data.email || !data.message) {
        status.textContent = 'Please add your name, email and a short message.';
        status.style.color = 'var(--clay)';
        return;
      }
      var submitBtn = form.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      var attribution = {};
      try { attribution = JSON.parse(sessionStorage.getItem('coop_attribution') || '{}'); } catch (err) {}
      post({ kind: 'contact', payload: data, attribution: attribution }).then(function () {
        status.textContent = 'Got it. We’ll be in touch within one business day.';
        status.style.color = 'var(--moss)';
        form.reset();
        track('contact_submitted', { topic: data.topic });
      }).catch(function () {
        status.innerHTML = 'Something went wrong sending that. Email us directly at <a href="mailto:' + (window.COOP_EMAIL || 'hello@thecoop.example.com') + '">' + (window.COOP_EMAIL || 'hello@thecoop.example.com') + '</a>.';
        status.style.color = 'var(--clay)';
      }).finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send it';
      });
    });
  }
})();
