// ============ Mobile nav toggle ============
(function () {
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Close mobile nav when a link is tapped
  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
})();

// ============ Before / after sliders ============
(function () {
  var sliders = document.querySelectorAll('[data-ba]');
  sliders.forEach(function (slider) {
    var after = slider.querySelector('.ba-after');
    var handle = slider.querySelector('.ba-handle');
    var dragging = false;

    function setPos(clientX) {
      var rect = slider.getBoundingClientRect();
      var x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      var pct = (x / rect.width) * 100;
      after.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
      handle.style.left = pct + '%';
    }

    function start(e) {
      dragging = true;
      var x = e.touches ? e.touches[0].clientX : e.clientX;
      setPos(x);
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      var x = e.touches ? e.touches[0].clientX : e.clientX;
      setPos(x);
    }
    function end() { dragging = false; }

    slider.addEventListener('mousedown', start);
    slider.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
  });
})();

// ============ Quote form submission ============
(function () {
  var form = document.getElementById('quote-form');
  if (!form) return;
  var note = document.getElementById('form-note');

  form.addEventListener('submit', function (e) {
    // If Formspree endpoint is still the placeholder, fall back to mailto.
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
      window.location.href = 'mailto:hello@northcolumbuscleaning.com?subject=' + subject + '&body=' + body;
      note.textContent = 'Opening your email client…';
      note.className = 'form-note success';
      return;
    }

    // Otherwise, submit to Formspree via fetch for a nicer UX.
    e.preventDefault();
    var data = new FormData(form);
    note.textContent = 'Sending…';
    note.className = 'form-note';

    fetch(form.action, {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        if (res.ok) {
          note.textContent = 'Thanks! We\'ll be in touch within one business day.';
          note.className = 'form-note success';
          form.reset();
        } else {
          throw new Error('Bad response');
        }
      })
      .catch(function () {
        note.textContent = 'Something went wrong. Please call us at (614) 555-0100.';
        note.className = 'form-note error';
      });
  });
})();

// ============ Footer year ============
(function () {
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

// ============ Header shadow on scroll ============
(function () {
  var header = document.getElementById('site-header');
  if (!header) return;
  function update() {
    if (window.scrollY > 8) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  }
  update();
  window.addEventListener('scroll', update, { passive: true });
})();
