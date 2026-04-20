#!/usr/bin/env python3
"""Generate location and service pages for northcolumbuscleaning.com.

Run from the project root: python3 scripts/generate-pages.py
"""
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent

# ============ DATA ============
NEIGHBORHOODS = [
    {
        "slug": "worthington",
        "name": "Worthington",
        "county": "Franklin County",
        "zips": ["43085", "43235"],
        "blurb": (
            "Historic Worthington sits directly north of Columbus along High Street, with "
            "Old Worthington's walkable core of 19th-century storefronts, a top-rated school "
            "district, and a mix of century homes and modern builds. We clean across "
            "Worthington Hills, Colonial Hills, Linworth, and Rush Creek Village."
        ),
    },
    {
        "slug": "clintonville",
        "name": "Clintonville",
        "county": "Franklin County",
        "zips": ["43202", "43214", "43224"],
        "blurb": (
            "Clintonville's tree-lined streets and pre-war bungalows stretch from the Ohio "
            "State campus up to Morse Road. It's a neighborhood of older homes with character "
            "— and with character comes crown molding, radiators, and hardwood floors that "
            "need someone who knows how to clean them properly."
        ),
    },
    {
        "slug": "westerville",
        "name": "Westerville",
        "county": "Franklin County",
        "zips": ["43081", "43082", "43086"],
        "blurb": (
            "Home to Otterbein University and Uptown Westerville's brick sidewalks, "
            "Westerville covers a wide mix of homes from historic uptown streets to newer "
            "subdivisions along Africa Road and State Route 3. Whatever kind of house you're "
            "in, we have a crew familiar with it."
        ),
    },
    {
        "slug": "dublin",
        "name": "Dublin",
        "county": "Franklin County",
        "zips": ["43016", "43017", "43054"],
        "blurb": (
            "Dublin runs from the Scioto River west past the Memorial Tournament grounds. "
            "Whether you're in Muirfield Village, Tartan Fields, Historic Dublin, or one of "
            "the newer developments near Bridge Street, we keep homes and offices looking "
            "sharp across the zip."
        ),
    },
    {
        "slug": "powell",
        "name": "Powell",
        "county": "Delaware County",
        "zips": ["43065"],
        "blurb": (
            "Powell's quick growth along Sawmill Parkway and Liberty Road means a lot of "
            "newer construction, big kitchens, and families juggling schedules. Recurring "
            "cleaning is popular here — same crew, same day, every other week."
        ),
    },
    {
        "slug": "upper-arlington",
        "name": "Upper Arlington",
        "county": "Franklin County",
        "zips": ["43220", "43221"],
        "blurb": (
            "Upper Arlington — UA to locals — sits just west of the Ohio State campus. The "
            "mix of 1920s English Tudors, mid-century ranches, and new builds in Tremont "
            "means no two cleans look the same. We bring the right products for stone, "
            "hardwood, and original tile."
        ),
    },
    {
        "slug": "new-albany",
        "name": "New Albany",
        "county": "Franklin County",
        "zips": ["43054"],
        "blurb": (
            "New Albany's planned Georgian architecture, white fences, and bluestone walks "
            "create a specific look — and the homes inside match. We handle estate-sized "
            "properties as well as the newer builds in the Country Club, Upland, and Edge "
            "neighborhoods."
        ),
    },
    {
        "slug": "gahanna",
        "name": "Gahanna",
        "county": "Franklin County",
        "zips": ["43230"],
        "blurb": (
            "Gahanna's Creekside District has brought new restaurants and businesses to the "
            "area, and the surrounding neighborhoods run the gamut from split-levels along "
            "Hamilton Road to newer homes in Academy Park and Royal Manor. Whatever kind of "
            "space you have, we clean it."
        ),
    },
    {
        "slug": "polaris",
        "name": "Polaris",
        "county": "Delaware County",
        "zips": ["43240"],
        "blurb": (
            "The Polaris area — around Polaris Parkway and I-71 — is a hub of newer homes, "
            "offices, and retail. With so much construction dust and drive-through traffic, "
            "deep cleans and recurring service are what most of our Polaris clients ask for."
        ),
    },
    {
        "slug": "lewis-center",
        "name": "Lewis Center",
        "county": "Delaware County",
        "zips": ["43035"],
        "blurb": (
            "Lewis Center sits between Polaris and Delaware along US-23, with rapid growth "
            "in the Cheshire, Olentangy, and Highbanks areas. New homes, young families, and "
            "full schedules — we're a short drive from anywhere in the township."
        ),
    },
    {
        "slug": "delaware",
        "name": "Delaware",
        "county": "Delaware County",
        "zips": ["43015"],
        "blurb": (
            "The city of Delaware — home to Ohio Wesleyan University — combines a historic "
            "downtown with a growing west side along Sawmill Parkway. We clean homes, "
            "student rentals, and offices throughout Delaware and out to the county edge."
        ),
    },
    {
        "slug": "hilliard",
        "name": "Hilliard",
        "county": "Franklin County",
        "zips": ["43026"],
        "blurb": (
            "Hilliard's Old Hilliard district and the newer Hilliard Station Park have "
            "turned this west-side suburb into a destination. We clean across Brookfield, "
            "Heritage, and the established neighborhoods around Hilliard Davidson and "
            "Bradley high schools."
        ),
    },
]

SERVICES = [
    {
        "slug": "residential-cleaning",
        "name": "Residential cleaning",
        "short": "Standard house cleans for occupied homes.",
        "hero_img": "/images/residential.jpg",
        "intro": (
            "Reliable, consistent house cleaning so you get your weekends back. We follow a "
            "room-by-room checklist that leaves kitchens, bathrooms, bedrooms, and living "
            "spaces looking the way they should."
        ),
        "included": [
            "All kitchen surfaces, appliances exterior, stovetop, and sink",
            "Bathrooms: tubs, showers, toilets, sinks, mirrors, and floors",
            "Dusting all horizontal surfaces, light fixtures, and baseboards",
            "Vacuuming carpets and rugs; mopping hard floors",
            "Making beds and tidying visible surfaces",
            "Emptying trash and replacing liners",
        ],
        "good_fit": (
            "Families, working professionals, and anyone who'd rather spend Saturday doing "
            "anything else."
        ),
    },
    {
        "slug": "commercial-cleaning",
        "name": "Commercial cleaning",
        "short": "Offices, retail, salons, and medical spaces.",
        "hero_img": "/images/commercial.jpg",
        "intro": (
            "Your space is the first thing clients notice. We clean offices, retail shops, "
            "salons, and medical suites on a schedule that fits your operation — usually "
            "evenings or weekends so we don't interrupt your day."
        ),
        "included": [
            "Breakrooms, lobbies, conference rooms, and private offices",
            "Restrooms stocked and sanitized daily or on schedule",
            "Waste removal and liner replacement",
            "Glass doors, interior windows, and high-touch surface disinfection",
            "Vacuuming, mopping, and floor maintenance",
            "Supply restocking (paper, soap) on request",
        ],
        "good_fit": (
            "Small and mid-sized businesses that need a dependable crew and a clear "
            "contract — not a big faceless national franchise."
        ),
    },
    {
        "slug": "deep-cleaning",
        "name": "Deep cleaning",
        "short": "Top-to-bottom detail cleans.",
        "hero_img": "/images/deep-cleaning.jpg",
        "intro": (
            "A deep clean is for spaces that need more than a standard visit — a first-time "
            "clean, a seasonal refresh, or prep for a party or holiday. We get behind, "
            "under, and inside things most cleans skip."
        ),
        "included": [
            "Inside the oven, microwave, and refrigerator",
            "Inside cabinets and drawers (on request)",
            "Baseboards, door frames, and trim hand-wiped",
            "Blinds and window sills dusted",
            "Grout scrubbing in tile showers and floors",
            "Ceiling fans, light fixtures, and vents",
            "Under and behind furniture you can move",
        ],
        "good_fit": (
            "Anyone whose home hasn't had professional attention in a while, or whose space "
            "needs to be photo-ready."
        ),
    },
    {
        "slug": "recurring-service",
        "name": "Recurring service",
        "short": "Weekly, bi-weekly, or monthly plans.",
        "hero_img": "/images/recurring.jpg",
        "intro": (
            "The same crew on the same schedule, cleaning to the same standard every visit. "
            "Most of our customers settle into bi-weekly — it keeps the house in rhythm "
            "without overkill."
        ),
        "included": [
            "Every standard-clean item on every visit",
            "The same crew each time, once your schedule is set",
            "Up to 20% off versus one-time pricing",
            "Priority scheduling for holidays and last-minute changes",
            "Easy rescheduling by phone or email (24 hours notice)",
            "Satisfaction guarantee on every visit",
        ],
        "good_fit": (
            "Busy households and businesses that want the job taken off their list "
            "entirely, not just handled once."
        ),
    },
    {
        "slug": "move-in-move-out-cleaning",
        "name": "Move-in and move-out cleaning",
        "short": "Empty-property deep cleans.",
        "hero_img": "/images/move-out.jpg",
        "intro": (
            "Whether you want your deposit back or you're handing keys to a buyer, an "
            "empty-property clean is the last thing standing between you and done. We handle "
            "inside cabinets, appliances, and every surface a new occupant will see."
        ),
        "included": [
            "Inside every cabinet and drawer",
            "Inside oven, microwave, refrigerator, and dishwasher",
            "Inside every closet and pantry",
            "All baseboards, door frames, and trim",
            "Windows and window tracks where reachable",
            "Complete bathroom sanitization",
            "Full floor care — vacuum, mop, polish as needed",
        ],
        "good_fit": (
            "Tenants getting deposits back, sellers closing on a house, landlords prepping "
            "a turnover, and buyers wanting a fresh start."
        ),
    },
    {
        "slug": "short-term-rental-cleaning",
        "name": "Short-term rental cleaning",
        "short": "Airbnb and VRBO turnovers.",
        "hero_img": "/images/short-term.jpg",
        "intro": (
            "Back-to-back guests, five-star expectations, and a narrow window between "
            "check-out and check-in. We turn rentals fast and consistently so your "
            "calendar keeps booking."
        ),
        "included": [
            "Full unit clean to hotel standard",
            "Linens stripped, laundered, and remade (or swap fresh sets)",
            "Towel and amenity restocking",
            "Kitchen reset — dishes, counters, appliances",
            "Bathroom sanitization and restock",
            "Staging — pillows, throws, welcome items back in place",
            "Photo confirmation after each turnover (on request)",
        ],
        "good_fit": (
            "Short-term rental hosts managing one property or a dozen, who need a reliable "
            "partner that doesn't ghost them mid-season."
        ),
    },
]

# ============ SHARED HTML PIECES ============

def head(title, description, canonical_path):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <link rel="canonical" href="https://northcolumbuscleaning.com{canonical_path}" />
  <meta name="theme-color" content="#1a4d2e" />
  <link rel="icon" type="image/svg+xml" href="/images/logo.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>"""


TOPBAR = """  <div class="topbar">
    <div class="container topbar-inner">
      <span class="topbar-item">Serving Columbus, OH and surrounding neighborhoods</span>
      <span class="topbar-item"><a href="tel:+16145550100">(614) 555-0100</a></span>
    </div>
  </div>"""


HEADER = """  <header class="site-header">
    <div class="container header-inner">
      <a href="/" class="logo-link" aria-label="North Columbus Cleaning Company home">
        <img src="/images/logo-horizontal.svg" alt="North Columbus Cleaning Company" />
      </a>
      <button class="nav-toggle" id="nav-toggle" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav" id="nav">
        <a href="/services">Services</a>
        <a href="/locations">Areas</a>
        <a href="/#why">Why us</a>
        <a href="/#gallery">Our work</a>
        <a href="/#faq">FAQ</a>
        <a href="/#quote" class="btn btn-primary nav-cta">Get a quote</a>
      </nav>
    </div>
  </header>"""


def footer():
    service_links = "\n".join(
        f'          <li><a href="/services/{s["slug"]}">{s["name"]}</a></li>'
        for s in SERVICES
    )
    area_links_top = NEIGHBORHOODS[:6]
    area_links_rest = NEIGHBORHOODS[6:]
    area_list = "\n".join(
        f'          <li><a href="/locations/{n["slug"]}">{n["name"]}</a></li>'
        for n in area_links_top
    )
    return f"""  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-col">
        <img src="/images/logo-horizontal.svg" alt="North Columbus Cleaning Company" />
        <p class="footer-tag">Residential and commercial cleaning serving North Columbus, Ohio.</p>
      </div>
      <div class="footer-col">
        <h5>Services</h5>
        <ul>
{service_links}
        </ul>
      </div>
      <div class="footer-col">
        <h5>Areas we serve</h5>
        <ul>
{area_list}
          <li><a href="/locations">All areas &rarr;</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h5>Contact</h5>
        <ul>
          <li><a href="tel:+16145550100">(614) 555-0100</a></li>
          <li><a href="mailto:hello@northcolumbuscleaning.com">hello@northcolumbuscleaning.com</a></li>
          <li>Mon&ndash;Sat, 7am&ndash;7pm</li>
          <li>Columbus, OH</li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="container">
        <p>&copy; <span id="year"></span> North Columbus Cleaning Company</p>
      </div>
    </div>
  </footer>
  <script src="/script.js"></script>
</body>
</html>
"""


CTA_BLOCK = """  <section class="section section-cta">
    <div class="container cta-inline">
      <div>
        <span class="eyebrow light">Ready to book</span>
        <h2>Get your free quote</h2>
        <p>Tell us about the space. We come back within one business day with a clear, up-front price.</p>
      </div>
      <div class="cta-buttons">
        <a href="/#quote" class="btn btn-secondary">Request a quote</a>
        <a href="tel:+16145550100" class="btn btn-outline-light">(614) 555-0100</a>
      </div>
    </div>
  </section>"""


TRUST_LIST = """      <ul class="hero-trust">
        <li><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg> Fully insured and bonded</li>
        <li><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg> Background-checked crews</li>
        <li><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg> Satisfaction guarantee</li>
      </ul>"""


# ============ LOCATION PAGE ============

def location_page(n):
    title = f"House Cleaning in {n['name']}, OH | North Columbus Cleaning Company"
    desc = f"Residential and commercial cleaning services in {n['name']}, Ohio. Insured, bonded, background-checked crews. Get a free quote."
    zips_line = ", ".join(n['zips'])

    service_cards = "\n".join(f"""        <a class="service-card service-card-link" href="/services/{s['slug']}">
          <div class="service-img"><img src="{s['hero_img']}" alt="{s['name']} in {n['name']}" loading="lazy" /></div>
          <div class="service-body">
            <h3>{s['name']}</h3>
            <p>{s['short']}</p>
          </div>
        </a>""" for s in SERVICES)

    other_areas = [x for x in NEIGHBORHOODS if x['slug'] != n['slug']]
    other_links = "\n".join(
        f'        <li><a href="/locations/{x["slug"]}">{x["name"]}</a></li>'
        for x in other_areas
    )

    return f"""{head(title, desc, f"/locations/{n['slug']}")}
{TOPBAR}
{HEADER}

  <section class="hero hero-compact">
    <div class="container hero-inner">
      <div class="hero-text">
        <span class="eyebrow">{n['county']} &middot; {zips_line}</span>
        <h1>House and office cleaning in {n['name']}, OH</h1>
        <p class="lead">{n['blurb']}</p>
        <div class="hero-cta">
          <a href="/#quote" class="btn btn-primary">Get a quote</a>
          <a href="tel:+16145550100" class="btn btn-outline">(614) 555-0100</a>
        </div>
{TRUST_LIST}
      </div>
      <div class="hero-visual">
        <img src="/images/hero.jpg" alt="A spotless kitchen cleaned in {n['name']}, OH" />
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">What we clean in {n['name']}</span>
        <h2>Services available here</h2>
        <p class="section-sub">Every service below is available to homes and businesses in {n['name']} and the surrounding area.</p>
      </div>
      <div class="grid services-grid">
{service_cards}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Local crews</span>
        <h2>Why {n['name']} neighbors choose us</h2>
      </div>
      <div class="grid benefits-grid">
        <div class="benefit"><h4>We know the area</h4><p>From older homes with original woodwork to newer builds with modern finishes, our crews clean across {n['name']} every week.</p></div>
        <div class="benefit"><h4>Same crew every time</h4><p>Recurring customers get the same team each visit. They learn your space, your preferences, and your pets.</p></div>
        <div class="benefit"><h4>Fully insured</h4><p>Every cleaner is background-checked, bonded, and insured. Nothing in your {n['name']} home is unprotected.</p></div>
        <div class="benefit"><h4>Flexible scheduling</h4><p>Evenings, weekends, and short-notice openings. We work around your calendar, not ours.</p></div>
        <div class="benefit"><h4>Transparent pricing</h4><p>One clear, up-front number after a quick call. No surprises, no hourly runs that balloon.</p></div>
        <div class="benefit"><h4>100% satisfaction</h4><p>If anything in your {n['name']} home isn't right, we come back and fix it &mdash; no charge.</p></div>
      </div>
    </div>
  </section>

{CTA_BLOCK}

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Other areas we serve</span>
        <h2>Nearby neighborhoods</h2>
      </div>
      <ul class="areas-list">
{other_links}
      </ul>
    </div>
  </section>

{footer()}"""


# ============ SERVICE PAGE ============

def service_page(s):
    title = f"{s['name']} in Columbus, OH | North Columbus Cleaning Company"
    desc = f"{s['name']} by a local, insured, background-checked crew. {s['short']} Get a free quote."

    included_items = "\n".join(f"        <li>{item}</li>" for item in s['included'])
    area_links = "\n".join(
        f'        <li><a href="/locations/{n["slug"]}">{n["name"]}</a></li>'
        for n in NEIGHBORHOODS
    )
    other_services = [x for x in SERVICES if x['slug'] != s['slug']]
    other_service_cards = "\n".join(f"""        <a class="service-card service-card-link" href="/services/{x['slug']}">
          <div class="service-img"><img src="{x['hero_img']}" alt="{x['name']}" loading="lazy" /></div>
          <div class="service-body">
            <h3>{x['name']}</h3>
            <p>{x['short']}</p>
          </div>
        </a>""" for x in other_services[:3])

    return f"""{head(title, desc, f"/services/{s['slug']}")}
{TOPBAR}
{HEADER}

  <section class="hero hero-compact">
    <div class="container hero-inner">
      <div class="hero-text">
        <span class="eyebrow">Our services</span>
        <h1>{s['name']}</h1>
        <p class="lead">{s['intro']}</p>
        <div class="hero-cta">
          <a href="/#quote" class="btn btn-primary">Get a quote</a>
          <a href="tel:+16145550100" class="btn btn-outline">(614) 555-0100</a>
        </div>
{TRUST_LIST}
      </div>
      <div class="hero-visual">
        <img src="{s['hero_img']}" alt="{s['name']} by North Columbus Cleaning Company" />
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">What's included</span>
        <h2>Every {s['name'].lower()} covers</h2>
      </div>
      <ul class="included-list">
{included_items}
      </ul>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Who it's for</span>
        <h2>Good fit</h2>
        <p class="section-sub">{s['good_fit']}</p>
      </div>
    </div>
  </section>

{CTA_BLOCK}

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Service area</span>
        <h2>We serve these neighborhoods</h2>
        <p class="section-sub">All across North Columbus and the surrounding suburbs.</p>
      </div>
      <ul class="areas-list">
{area_links}
      </ul>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Other services</span>
        <h2>See what else we do</h2>
      </div>
      <div class="grid services-grid services-grid-3">
{other_service_cards}
      </div>
    </div>
  </section>

{footer()}"""


# ============ HUB PAGES ============

def locations_hub():
    title = "Service Areas | North Columbus Cleaning Company"
    desc = "Cleaning services across North Columbus, Ohio. See every neighborhood we serve."
    cards = "\n".join(f"""        <a class="area-card" href="/locations/{n['slug']}">
          <h3>{n['name']}</h3>
          <p class="area-meta">{n['county']}</p>
          <p>{n['blurb'][:120]}&hellip;</p>
          <span class="area-link">See details &rarr;</span>
        </a>""" for n in NEIGHBORHOODS)

    return f"""{head(title, desc, "/locations")}
{TOPBAR}
{HEADER}

  <section class="section hero-compact section-head-hero">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Where we work</span>
        <h1>Serving North Columbus and beyond</h1>
        <p class="section-sub">Twelve neighborhoods across Franklin and Delaware counties. Don't see yours? Give us a call &mdash; we're expanding every month.</p>
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container">
      <div class="grid areas-grid">
{cards}
      </div>
    </div>
  </section>

{CTA_BLOCK}

{footer()}"""


def services_hub():
    title = "Cleaning Services in Columbus, OH | North Columbus Cleaning Company"
    desc = "Residential, commercial, deep, recurring, move-in/out, and short-term rental cleaning across North Columbus."
    cards = "\n".join(f"""        <a class="service-card service-card-link" href="/services/{s['slug']}">
          <div class="service-img"><img src="{s['hero_img']}" alt="{s['name']}" loading="lazy" /></div>
          <div class="service-body">
            <h3>{s['name']}</h3>
            <p>{s['short']}</p>
            <span class="area-link">See details &rarr;</span>
          </div>
        </a>""" for s in SERVICES)

    return f"""{head(title, desc, "/services")}
{TOPBAR}
{HEADER}

  <section class="section hero-compact section-head-hero">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Our services</span>
        <h1>Cleaning services in Columbus, OH</h1>
        <p class="section-sub">Pick the one that fits. Every service is delivered by the same insured, background-checked crew and backed by a satisfaction guarantee.</p>
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container">
      <div class="grid services-grid">
{cards}
      </div>
    </div>
  </section>

{CTA_BLOCK}

{footer()}"""


# ============ WRITE OUT ============

def write(path, content):
    full = ROOT / path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content)
    print(f"  wrote {path}")


def main():
    # Location pages
    for n in NEIGHBORHOODS:
        write(f"locations/{n['slug']}.html", location_page(n))
    write("locations/index.html", locations_hub())

    # Service pages
    for s in SERVICES:
        write(f"services/{s['slug']}.html", service_page(s))
    write("services/index.html", services_hub())

    print(f"\nGenerated {len(NEIGHBORHOODS)} location pages, {len(SERVICES)} service pages, 2 hubs.")


if __name__ == "__main__":
    main()
