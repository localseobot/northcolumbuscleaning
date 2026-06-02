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

// Quote form submission (Formspree, with mailto fallback)
(function () {
  var form = document.getElementById('quote-form');
  if (!form) return;
  var note = document.getElementById('form-note');

  form.addEventListener('submit', function (e) {
    if (form.action.indexOf('YOUR_ID_HERE') !== -1) {
      e.preventDefault();
      var name = form.name.value.trim();
      var email = form.email.value.trim();
      var phone = form.phone.value.trim();
      var service = form.service.value;
      var message = form.message.value.trim();

      if (!name || !email || !service) {
        note.textContent = 'Please fill in your name, email, and service.';
        note.className = 'form-note error';
        return;
      }

      var subject = encodeURIComponent('Quote request from ' + name);
      var body = encodeURIComponent(
        'Name: ' + name + '\n' +
        'Email: ' + email + '\n' +
        'Phone: ' + phone + '\n' +
        'Service: ' + service + '\n\n' +
        'Message:\n' + message
      );
      window.location.href = 'mailto:admin@northcolumbuscleaning.com?subject=' + subject + '&body=' + body;
      note.textContent = 'Opening your email client.';
      note.className = 'form-note success';
      return;
    }

    e.preventDefault();
    var data = new FormData(form);
    note.textContent = 'Sending.';
    note.className = 'form-note';

    fetch(form.action, {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        if (res.ok) {
          note.textContent = 'Thanks. We get back to you within one business day.';
          note.className = 'form-note success';
          form.reset();
        } else {
          throw new Error('Bad response');
        }
      })
      .catch(function () {
        note.textContent = 'Something went wrong. Please call us at (614) 352-2588.';
        note.className = 'form-note error';
      });
  });
})();

// Footer year
(function () {
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

// Summer Shine email-capture popup
(function () {
  // Skip on pages where it would interfere with conversion / be redundant
  var path = window.location.pathname.replace(/\/$/, '');
  var SKIP = ['/book-now', '/login', '/privacy', '/sms-terms', '/data-deletion'];
  if (SKIP.indexOf(path) !== -1) return;

  // Skip if already dismissed or signed up
  var STATE_KEY = 'ncc_summer_shine_state';
  var state = null;
  try { state = localStorage.getItem(STATE_KEY); } catch (_) {}
  if (state === 'signed_up' || state === 'dismissed') return;

  // Respect dismissal cooldown — wait at least 3 days before re-prompting a dismisser
  var DISMISS_KEY = 'ncc_summer_shine_dismiss_at';
  try {
    var lastDismiss = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (lastDismiss && Date.now() - lastDismiss < 3 * 24 * 60 * 60 * 1000) return;
  } catch (_) {}

  var POPUP_HTML =
    '<div class="promo-backdrop" id="promo-backdrop" role="dialog" aria-modal="true" aria-labelledby="promo-title" hidden>' +
      '<div class="promo-modal" id="promo-modal">' +
        '<button class="promo-close" type="button" aria-label="Close" id="promo-close">&times;</button>' +
        '<span class="promo-tag">☀️ Summer Shine</span>' +
        '<h2 id="promo-title">30% off your first clean</h2>' +
        '<p>Get your home Summer-ready. Pop in your email and we&rsquo;ll send you the code.</p>' +
        '<form id="promo-form" novalidate>' +
          '<input type="text" name="firstName" id="promo-name" placeholder="First name" required autocomplete="given-name" />' +
          '<input type="email" name="email" id="promo-email" placeholder="you@example.com" required autocomplete="email" />' +
          '<button type="submit" id="promo-submit">Get my 30% off</button>' +
          '<div class="promo-error" id="promo-error" hidden></div>' +
          '<div class="promo-note">We only use your info to send the code and follow up if you have questions. No spam.</div>' +
        '</form>' +
        '<div class="promo-success">' +
          '<p id="promo-thanks" style="margin-bottom:6px;font-size:17px;">Use this code at checkout:</p>' +
          '<div class="promo-code" id="promo-code">SUMMER30</div>' +
          '<p style="margin-bottom:16px;font-size:14px;">Valid on your first cleaning. One per household.</p>' +
          '<a href="/book-now" class="promo-cta">Book now</a>' +
        '</div>' +
      '</div>' +
    '</div>';

  function inject() {
    if (document.getElementById('promo-backdrop')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = POPUP_HTML;
    document.body.appendChild(wrap.firstChild);
    wireUp();
  }

  function open() {
    var bd = document.getElementById('promo-backdrop');
    if (!bd) return;
    bd.classList.add('open');
    bd.hidden = false;
    var name = document.getElementById('promo-name');
    if (name) setTimeout(function () { name.focus(); }, 180);
  }

  function close(reason) {
    var bd = document.getElementById('promo-backdrop');
    if (!bd) return;
    bd.classList.remove('open');
    bd.hidden = true;
    if (reason === 'dismissed') {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) {}
    }
  }

  function showSuccess(code, firstName) {
    var modal = document.getElementById('promo-modal');
    var codeEl = document.getElementById('promo-code');
    var thanks = document.getElementById('promo-thanks');
    if (codeEl && code) codeEl.textContent = code;
    if (thanks && firstName) {
      thanks.textContent = 'Thanks, ' + firstName + '! Use this code at checkout:';
    }
    if (modal) modal.classList.add('is-success');
    try { localStorage.setItem(STATE_KEY, 'signed_up'); } catch (_) {}
  }

  function wireUp() {
    var bd = document.getElementById('promo-backdrop');
    var closeBtn = document.getElementById('promo-close');
    var form = document.getElementById('promo-form');
    var submit = document.getElementById('promo-submit');
    var error = document.getElementById('promo-error');

    closeBtn.addEventListener('click', function () { close('dismissed'); });
    bd.addEventListener('click', function (e) { if (e.target === bd) close('dismissed'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && bd.classList.contains('open')) close('dismissed');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      error.hidden = true;
      var firstName = (form.firstName.value || '').trim();
      var email = (form.email.value || '').trim();
      if (!firstName) {
        error.textContent = 'Please enter your first name.';
        error.hidden = false;
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        error.textContent = 'Please enter a valid email address.';
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Sending…';
      fetch('/api/promo-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, firstName: firstName })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (data) {
          submit.disabled = false;
          submit.textContent = 'Get my 30% off';
          if (data && data.code) {
            showSuccess(data.code, firstName);
          } else if (data && data.error) {
            error.textContent = data.error;
            error.hidden = false;
          } else {
            // Network or partial failure — still grant the code so visitor isn't stuck
            showSuccess('SUMMER30', firstName);
          }
        })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = 'Get my 30% off';
          // Network failure: still reveal the code, log captured email locally
          showSuccess('SUMMER30', firstName);
        });
    });
  }

  // Triggers: first scroll past 30% of viewport OR 12s on page, whichever first.
  // Also exit intent on desktop (mouse leaves top of viewport).
  var triggered = false;
  function trigger() {
    if (triggered) return;
    triggered = true;
    inject();
    // Give the inject a tick to land in DOM
    requestAnimationFrame(open);
  }

  setTimeout(trigger, 12000);

  window.addEventListener('scroll', function () {
    if (window.scrollY > window.innerHeight * 0.3) trigger();
  }, { passive: true });

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
