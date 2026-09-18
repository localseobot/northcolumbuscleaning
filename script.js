// Click-to-call tracking number. HTML is baked with a fallback; if Vercel
// has TRACKING_NUMBER (or GHL_FROM_NUMBER) set, rewrite every tel: link so
// a number change does not require regenerating pages.
window.__NCC_TRACKING_DISPLAY = '(614) 352-2588';
window.__NCC_TRACKING_HREF = 'tel:+16143522588';
(function () {
  function applyTracking(href, display) {
    if (!href || !display) return;
    window.__NCC_TRACKING_DISPLAY = display;
    window.__NCC_TRACKING_HREF = href;
    var phoneLike = /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
    document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
      a.setAttribute('href', href);
      if (phoneLike.test(a.textContent)) {
        a.textContent = a.textContent.replace(phoneLike, display);
      }
      var label = a.getAttribute('aria-label');
      if (label && phoneLike.test(label)) {
        a.setAttribute('aria-label', label.replace(phoneLike, display));
      }
    });
  }

  fetch('/api/site-config')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.trackingHref || !cfg.trackingDisplay) return;
      applyTracking(cfg.trackingHref, cfg.trackingDisplay);
    })
    .catch(function () {});
})();

// Mobile nav toggle + backdrop overlay
(function () {
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('nav');
  if (!toggle || !nav) return;

  // Lazily create the backdrop on first open so we don't pollute every page
  // with a dead element.
  var backdrop = null;
  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function open() {
    nav.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    ensureBackdrop().classList.add('is-visible');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    if (backdrop) backdrop.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', function () {
    if (nav.classList.contains('open')) close();
    else open();
  });

  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', close);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) close();
  });
})();

// ---------------------------------------------------------------------------
// Lead forms
// ---------------------------------------------------------------------------
// Posts to /api/lead, which records the lead and routes it straight to the
// cleaner who works these. Every submission has to reach the server: a lost
// form fill is a lost lead.
//
// Every short form on the site carries class="lead-form", so a page can have
// as many as it needs (hero card, bottom CTA, callback modal) and they all
// behave identically. Name plus a way to reach them is all we insist on —
// everything else is detail the buyer collects on the call back.
window.__nccWireLeadForm = (function () {
  function val(form, field) {
    var el = form.elements[field];
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  // Replace the form with a confirmation that still puts the phone number in
  // front of someone who has just told us they want to be contacted.
  function successPanel(form, phone) {
    var display = window.__NCC_TRACKING_DISPLAY || '(614) 352-2588';
    var href = window.__NCC_TRACKING_HREF || 'tel:+16143522588';
    var wrap = document.createElement('div');
    wrap.className = 'lead-success';
    wrap.setAttribute('role', 'status');
    wrap.innerHTML =
      '<h3>Got it — talk soon.</h3>' +
      '<p>We&rsquo;ll call you' + (phone ? ' on ' + phone : '') +
      ' shortly to go over your clean. Need it sorted right now?</p>' +
      '<a class="call-cta" href="' + href + '">' +
        '<span><span class="call-cta-label">Call now</span>' +
        '<span class="call-cta-number">' + display + '</span></span>' +
      '</a>';
    form.parentNode.replaceChild(wrap, form);
  }

  return function wire(form) {
    if (!form || form.__nccWired) return;
    form.__nccWired = true;

    var button = form.querySelector('button[type="submit"]');
    var note = form.querySelector('.form-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'form-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      form.appendChild(note);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var name = val(form, 'name');
      var phone = val(form, 'phone');
      var email = val(form, 'email');

      if (!name || (!phone && !email)) {
        note.textContent = 'Please give us your name and a phone number so we can call you back.';
        note.className = 'form-note error';
        return;
      }

      note.textContent = 'Sending…';
      note.className = 'form-note';
      if (button) button.disabled = true;

      var message = val(form, 'message');
      var source = form.getAttribute('data-source');
      if (source) message = message ? message + '\n(' + source + ')' : source;

      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          service: val(form, 'service'),
          message: message,
          bedrooms: val(form, 'bedrooms'),
          bathrooms: val(form, 'bathrooms'),
          page: window.location.pathname,
          website: val(form, 'website')
        })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error(data.error || 'Bad response');
            return data;
          });
        })
        .then(function () {
          successPanel(form, phone);
        })
        .catch(function (err) {
          note.textContent = (err && err.message && err.message !== 'Bad response')
            ? err.message
            : 'Something went wrong. Please call us at ' + (window.__NCC_TRACKING_DISPLAY || '(614) 352-2588') + '.';
          note.className = 'form-note error';
          if (button) button.disabled = false;
        });
    });
  };
})();

document.querySelectorAll('form.lead-form').forEach(function (f) {
  window.__nccWireLeadForm(f);
});

// Footer year
(function () {
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

// ---------------------------------------------------------------------------
// Call-back modal
// ---------------------------------------------------------------------------
// Catches visitors who are about to leave without calling or filling anything
// in. It asks for a name and a number only — the shortest ask on the site —
// and posts to the same /api/lead endpoint as every other form.
(function () {
  // Skip where it would interfere with conversion or be redundant
  var path = window.location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
  var SKIP = ['/quote', '/login', '/privacy', '/sms-terms', '/data-deletion', '/lead-offer'];
  if (SKIP.indexOf(path) !== -1) return;

  // Skip if the visitor already converted or already said no
  var STATE_KEY = 'ncc_callback_state';
  var state = null;
  try { state = localStorage.getItem(STATE_KEY); } catch (_) {}
  if (state === 'submitted') return;

  // Respect dismissal — wait 3 days before asking a dismisser again
  var DISMISS_KEY = 'ncc_callback_dismissed_at';
  try {
    var lastDismiss = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (lastDismiss && Date.now() - lastDismiss < 3 * 24 * 60 * 60 * 1000) return;
  } catch (_) {}

  var MODAL_HTML =
    '<div class="callback-backdrop" id="callback-backdrop" role="dialog" aria-modal="true" aria-labelledby="callback-title">' +
      '<div class="callback-modal">' +
        '<button class="callback-close" type="button" aria-label="Close" id="callback-close">&times;</button>' +
        '<h2 id="callback-title">Want us to call you?</h2>' +
        '<p class="form-lede">Leave your name and number and a local team member calls you straight back with a free quote. No obligation.</p>' +
        '<a class="call-cta" href="tel:+16143522588" style="width:100%;justify-content:center;">' +
          '<span><span class="call-cta-label">Or call now</span>' +
          '<span class="call-cta-number">(614) 352-2588</span></span>' +
        '</a>' +
        '<div class="leadbox-divider">or</div>' +
        '<form class="lead-form" id="callback-form" data-source="Call-back popup" novalidate>' +
          '<div class="form-row">' +
            '<label for="cb-name">Name</label>' +
            '<input type="text" id="cb-name" name="name" required autocomplete="name" />' +
          '</div>' +
          '<div class="form-row">' +
            '<label for="cb-phone">Phone</label>' +
            '<input type="tel" id="cb-phone" name="phone" required autocomplete="tel" />' +
          '</div>' +
          '<div class="hp-field" aria-hidden="true">' +
            '<label for="cb-website">Website</label>' +
            '<input type="text" id="cb-website" name="website" tabindex="-1" autocomplete="off" />' +
          '</div>' +
          '<button type="submit" class="btn btn-primary btn-block">Call me back</button>' +
          '<p class="form-note" role="status" aria-live="polite"></p>' +
        '</form>' +
      '</div>' +
    '</div>';

  var backdrop = null;

  function close(reason) {
    if (!backdrop) return;
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (reason === 'dismissed') {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) {}
    }
  }

  function inject() {
    var wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML;
    backdrop = wrap.firstChild;
    document.body.appendChild(backdrop);

    document.getElementById('callback-close')
      .addEventListener('click', function () { close('dismissed'); });
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close('dismissed');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && backdrop.classList.contains('open')) close('dismissed');
    });

    var form = document.getElementById('callback-form');
    window.__nccWireLeadForm(form);
    // Remember a conversion so we never interrupt this visitor again.
    form.addEventListener('submit', function () {
      try { localStorage.setItem(STATE_KEY, 'submitted'); } catch (_) {}
    });
  }

  function open() {
    if (!backdrop) inject();
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    var first = backdrop.querySelector('input');
    if (first) setTimeout(function () { first.focus(); }, 180);
  }

  // Triggers: 25 seconds on page, or exit intent on desktop. Deliberately
  // later than the old popup — someone reading the page is already engaged,
  // and the sticky call bar is there the whole time anyway.
  var triggered = false;
  function trigger() {
    if (triggered) return;
    // Don't interrupt someone already typing into a form on the page.
    var active = document.activeElement;
    if (active && active.closest && active.closest('form.lead-form')) return;
    triggered = true;
    open();
  }

  setTimeout(trigger, 25000);

  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && e.clientY <= 0) trigger();
  });
})();

// Sticky mobile CTA: show after user scrolls past hero
(function () {
  var bar = document.getElementById('sticky-cta');
  if (!bar) return;
  function update() {
    if (window.scrollY > 480) bar.classList.add('is-visible');
    else bar.classList.remove('is-visible');
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();
