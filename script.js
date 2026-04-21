// Mobile nav toggle
(function () {
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
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
      window.location.href = 'mailto:hello@northcolumbuscleaning.com?subject=' + subject + '&body=' + body;
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
        note.textContent = 'Something went wrong. Please call us at (740) 913-3693.';
        note.className = 'form-note error';
      });
  });
})();

// Footer year
(function () {
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
