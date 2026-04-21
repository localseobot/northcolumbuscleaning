# North Columbus Cleaning

Marketing website for [northcolumbuscleaning.com](https://northcolumbuscleaning.com) — a residential & commercial cleaning service in Columbus, OH.

## Stack

Plain static site: `index.html`, `styles.css`, `script.js`. No build step.

## Local dev

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy

Auto-deployed to Vercel on push to `main`.

## Configuration

- **Contact form** — replace `YOUR_ID_HERE` in `index.html` (`#quote-form` action) with a [Formspree](https://formspree.io) form ID, or swap for any form handler. Without it, the form falls back to opening the visitor's mail client.
- **Phone & email** — update `(740) 913-3693` and `hello@northcolumbuscleaning.com` throughout `index.html` + `script.js`.
