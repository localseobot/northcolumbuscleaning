#!/usr/bin/env python3
"""Generate location and service pages for northcolumbuscleaning.com.

Run from the project root: python3 scripts/generate-pages.py
"""
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent

# Public click-to-call fallback baked into generated HTML. Runtime overlay
# in /script.js replaces this when TRACKING_NUMBER is set in Vercel.
PHONE_E164 = "+16143522588"
PHONE_DISPLAY = "(614) 352-2588"
PHONE_SCHEMA = "+1-614-352-2588"

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
        "kw": "house cleaning",
        "short": "Standard house cleans for occupied homes.",
        "hero_img": "/images/residential.jpg",
        "intro": (
            "Reliable, consistent house cleaning so you get your weekends back. We follow a "
            "room-by-room checklist that leaves kitchens, bathrooms, bedrooms, and living "
            "spaces looking the way they should."
        ),
        "local_hook": lambda n: (
            f"Residential cleaning in {n['name']} by a local team that knows the difference "
            f"between a drywall-and-builder-grade new build and a century home with plaster "
            f"walls and original woodwork. Same room-by-room checklist, different tools, "
            f"predictable results."
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
        "kw": "commercial cleaning",
        "short": "Offices, salons, retail, and medical.",
        "hero_img": "/images/commercial.jpg",
        "intro": (
            "Your space is the first thing clients notice. We clean offices, retail shops, "
            "salons, and medical suites on a schedule that fits your operation — usually "
            "evenings or weekends so we don't interrupt your day."
        ),
        "local_hook": lambda n: (
            f"Commercial cleaning for {n['name']} businesses &mdash; offices, salons, "
            f"retail shops, and medical suites. We work evenings or weekends so your "
            f"customers and staff aren't watching us vacuum at 10am."
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
        "kw": "deep cleaning",
        "short": "Top-to-bottom detail cleans.",
        "hero_img": "/images/deep-cleaning.jpg",
        "intro": (
            "A deep clean is for spaces that need more than a standard visit — a first-time "
            "clean, a seasonal refresh, or prep for a party or holiday. We get behind, "
            "under, and inside things most cleans skip."
        ),
        "local_hook": lambda n: (
            f"Deep cleaning in {n['name']} for homes that need more than a weekly tidy. "
            f"We go after the places a regular visit misses &mdash; inside the oven, "
            f"behind the fridge, grout lines in the tile shower, baseboards and door "
            f"frames that have collected dust since last spring."
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
        "kw": "recurring cleaning service",
        "short": "Weekly, bi-weekly, or monthly plans.",
        "hero_img": "/images/recurring.jpg",
        "intro": (
            "The same crew on the same schedule, cleaning to the same standard every visit. "
            "Most of our customers settle into bi-weekly — it keeps the house in rhythm "
            "without overkill."
        ),
        "local_hook": lambda n: (
            f"Recurring cleaning service in {n['name']} &mdash; weekly, bi-weekly, or monthly. "
            f"Same crew, same day, every visit, so the house stays in rhythm without you "
            f"having to think about it."
        ),
        "included": [
            "Every standard-clean item on every visit",
            "The same crew each time, once your schedule is set",
            "Better value than booking one-time visits",
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
        "kw": "move-out cleaning",
        "short": "Empty-property deep cleans.",
        "hero_img": "/images/move-out.jpg",
        "intro": (
            "Whether you want your deposit back or you're handing keys to a buyer, an "
            "empty-property clean is the last thing standing between you and done. We handle "
            "inside cabinets, appliances, and every surface a new occupant will see."
        ),
        "local_hook": lambda n: (
            f"Move-in and move-out cleaning in {n['name']} for renters trying to get deposits "
            f"back, sellers closing on a house, and buyers who want to walk into a genuinely "
            f"clean place. We handle every cabinet, every appliance interior, every closet."
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
        "kw": "Airbnb cleaning",
        "short": "Airbnb and VRBO turnovers.",
        "hero_img": "/images/short-term.jpg",
        "intro": (
            "Back-to-back guests, five-star expectations, and a narrow window between "
            "check-out and check-in. We turn rentals fast and consistently so your "
            "calendar keeps booking."
        ),
        "local_hook": lambda n: (
            f"Airbnb and short-term rental cleaning in {n['name']} &mdash; fast turnovers "
            f"between guests, fresh linens, and photo-ready staging so your next booking "
            f"walks into a five-star review."
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

def local_business_jsonld(canonical_path, area_served=None, service_name=None):
    """LocalBusiness schema. area_served: None (all 12), a city name str, or list."""
    canonical = f"https://northcolumbuscleaning.com{canonical_path}"
    if area_served is None:
        area_served_json = "[" + ",".join(
            f'{{"@type":"City","name":"{x["name"]}, OH"}}' for x in NEIGHBORHOODS
        ) + "]"
    elif isinstance(area_served, str):
        area_served_json = f'{{"@type":"City","name":"{area_served}"}}'
    else:
        area_served_json = "[" + ",".join(
            f'{{"@type":"City","name":"{x}"}}' for x in area_served
        ) + "]"
    offer_block = ""
    if service_name:
        offer_block = f""","makesOffer":{{"@type":"Offer","itemOffered":{{"@type":"Service","name":"{service_name}"}}}}"""
    return f"""  <script type="application/ld+json">
  {{"@context":"https://schema.org","@type":"HouseholdCleaningService","name":"North Columbus Cleaning Company","image":"https://northcolumbuscleaning.com/images/logo.svg","url":"{canonical}","telephone":"{PHONE_SCHEMA}","email":"admin@northcolumbuscleaning.com","priceRange":"$$","address":{{"@type":"PostalAddress","addressLocality":"Columbus","addressRegion":"OH","addressCountry":"US"}},"areaServed":{area_served_json},"openingHours":"Mo-Sa 07:00-19:00"{offer_block}}}
  </script>"""


def head(title, description, canonical_path, og_image="/images/hero.jpg"):
    canonical = f"https://northcolumbuscleaning.com{canonical_path}"
    og_img_full = f"https://northcolumbuscleaning.com{og_image}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="{canonical}" />
  <meta name="theme-color" content="#1a4d2e" />
  <link rel="icon" href="/images/favicon.ico" sizes="any" />
  <link rel="icon" type="image/svg+xml" href="/images/logo.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:image" content="{og_img_full}" />
  <meta property="og:site_name" content="North Columbus Cleaning | House Cleaning Services" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{og_img_full}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>"""


TOPBAR = f"""  <div class="topbar">
    <div class="container topbar-inner">
      <span class="topbar-item">Serving Columbus, OH and surrounding neighborhoods</span>
      <span class="topbar-item"><a href="tel:{PHONE_E164}">{PHONE_DISPLAY}</a></span>
    </div>
  </div>"""


PHONE_ICON_SVG = """<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
            <path d="M6.6 10.8c1.4 2.8 3.7 5.1 6.5 6.5l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1l-2.4 2.4z"/>
          </svg>"""


# Click-to-call sits in the header on mobile, where most of this traffic
# lands, so the number is one tap away before the visitor scrolls at all.
HEADER = f"""  <header class="site-header">
    <div class="container header-inner">
      <a href="/" class="logo-link" aria-label="North Columbus Cleaning Company home">
        <img src="/images/logo-horizontal.svg" alt="North Columbus Cleaning Company" />
      </a>

      <div class="header-mobile-actions">
        <a href="tel:{PHONE_E164}" class="header-call-btn" aria-label="Call {PHONE_DISPLAY}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M6.6 10.8c1.4 2.8 3.7 5.1 6.5 6.5l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1l-2.4 2.4z"/>
          </svg>
        </a>
        <button class="nav-toggle" id="nav-toggle" aria-label="Open menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>

      <nav class="nav" id="nav" aria-label="Primary">
        <a href="/services">Services</a>
        <a href="/locations">Areas</a>
        <a href="/#owner">About</a>
        <a href="/#faq">FAQ</a>
        <a href="tel:{PHONE_E164}" class="nav-call">{PHONE_DISPLAY}</a>
        <a href="#quote" class="btn btn-primary nav-cta">Get a free quote</a>
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
    <section class="footer-location">
      <div class="container footer-location-inner">
        <div class="footer-location-info" itemscope itemtype="https://schema.org/LocalBusiness">
          <span class="eyebrow light">Visit us</span>
          <p class="footer-location-name" itemprop="name">North Columbus Cleaning | House Cleaning Services</p>
          <address itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
            <span itemprop="streetAddress">832 Callaway Lane</span>,
            <span itemprop="addressLocality">Sunbury</span>,
            <span itemprop="addressRegion">OH</span>
            <span itemprop="postalCode">43074</span>
          </address>
          <p><strong>Phone</strong> <a href="tel:{PHONE_E164}" itemprop="telephone">{PHONE_DISPLAY}</a></p>
          <p><strong>Web</strong> <a href="https://www.northcolumbuscleaning.com/" itemprop="url">northcolumbuscleaning.com</a></p>
          <p class="footer-location-description" itemprop="description">Residential and commercial cleaning services in Worthington, Clintonville, Westerville, Dublin, Powell, Upper Arlington, New Albany, Gahanna, Polaris, Lewis Center, Delaware &amp; Hilliard, OH.</p>
          <meta itemprop="foundingDate" content="2026-04-23" />
          <meta itemprop="priceRange" content="$$" />
        </div>
        <div class="footer-location-map">
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3045.3662451718956!2d-82.8825419!3d40.2453912!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x26dc59d42367e577%3A0x8a98bb9156f9b65a!2sNorth%20Columbus%20Cleaning%20%7C%20House%20Cleaning%20Services!5e0!3m2!1sen!2sus!4v1776984116067!5m2!1sen!2sus"
            title="North Columbus Cleaning location on Google Maps"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    </section>
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
        <h5>Contact &amp; legal</h5>
        <ul>
          <li><a href="tel:{PHONE_E164}">{PHONE_DISPLAY}</a></li>
          <li><a href="mailto:admin@northcolumbuscleaning.com">admin@northcolumbuscleaning.com</a></li>
          <li>Mon&ndash;Sat, 7am&ndash;7pm</li>
          <li><a href="/privacy">Privacy policy</a></li>
          <li><a href="/sms-terms">SMS terms</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="container">
        <p>&copy; <span id="year"></span> North Columbus Cleaning Company &middot; <a href="/privacy">Privacy</a> &middot; <a href="/sms-terms">SMS terms</a></p>
      </div>
    </div>
  </footer>
  <script src="/script.js" defer></script>
  <div class="sticky-cta" id="sticky-cta" aria-label="Quick actions"><a class="sticky-cta-call" href="tel:{PHONE_E164}">&#128222; Call {PHONE_DISPLAY}</a><a class="sticky-cta-quote" href="#quote">Get a free quote</a></div>
</body>
</html>
"""


# The lead form's service list, and which option each service page presets.
FORM_OPTION_BY_SLUG = {
    "residential-cleaning": "Residential cleaning",
    "commercial-cleaning": "Commercial cleaning",
    "deep-cleaning": "Deep cleaning",
    "recurring-service": "Recurring service",
    "move-in-move-out-cleaning": "Move-in / Move-out",
    "short-term-rental-cleaning": "Short-term rental",
}


def service_options(selected=None):
    """<option> list for the lead form, pre-picking the page's own service."""
    opts = [
        "Residential cleaning",
        "Commercial cleaning",
        "Deep cleaning",
        "Recurring service",
        "Move-in / Move-out",
        "Short-term rental",
        "Not sure yet",
    ]
    out = ['            <option value="">Select a service</option>']
    for o in opts:
        mark = " selected" if selected and o.lower() == selected.lower() else ""
        out.append(f"            <option{mark}>{o}</option>")
    return "\n".join(out)


def cta_block(where="", service=None, source="Page"):
    """The one conversion block every generated page ends on.

    Previously this pointed at the homepage form, which meant a visitor who
    had read a Dublin deep-clean page had to load another page before they
    could tell us anything. The form lives here instead, and the phone number
    sits above it because a call is the fastest lead of all.
    """
    place = f" in {where}" if where else ""
    return f"""  <section id="quote" class="section section-cta">
    <div class="container quote-inner">
      <div class="quote-copy">
        <span class="eyebrow light">Fastest way to get started</span>
        <h2>Call now or get a free quote</h2>
        <p class="lead">One short call is all it takes &mdash; tell us about the space{place} and we&rsquo;ll talk through what it needs and when we can be there. Free, and no obligation.</p>
        <a class="call-cta" href="tel:{PHONE_E164}">
          {PHONE_ICON_SVG}
          <span>
            <span class="call-cta-label">Call now</span>
            <span class="call-cta-number">{PHONE_DISPLAY}</span>
          </span>
        </a>
        <p class="call-meta">A real local person answers, Mon&ndash;Sat 7am&ndash;7pm.</p>
      </div>

      <form class="quote-form lead-form" data-source="{source}" novalidate>
        <p class="form-lede">Can&rsquo;t talk right now? Leave your details and we&rsquo;ll call you back.</p>
        <div class="form-row">
          <label for="lf-name">Name</label>
          <input type="text" id="lf-name" name="name" required autocomplete="name" />
        </div>
        <div class="form-row">
          <label for="lf-phone">Phone</label>
          <input type="tel" id="lf-phone" name="phone" required autocomplete="tel" />
        </div>
        <div class="form-row">
          <label for="lf-service">What do you need cleaned?</label>
          <select id="lf-service" name="service" required>
{service_options(service)}
          </select>
        </div>
        <div class="form-row">
          <label for="lf-email">Email <span class="opt">(optional)</span></label>
          <input type="email" id="lf-email" name="email" autocomplete="email" />
        </div>
        <div class="hp-field" aria-hidden="true">
          <label for="lf-website">Website</label>
          <input type="text" id="lf-website" name="website" tabindex="-1" autocomplete="off" />
        </div>
        <button type="submit" class="btn btn-secondary btn-block">Request my free quote</button>
        <p class="form-note" role="status" aria-live="polite"></p>
        <p class="form-fine">No obligation. We only use your number to talk about your clean.</p>
      </form>
    </div>
  </section>"""



TRUST_LIST = """      <ul class="hero-trust">
        <li><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg> Fully insured and bonded</li>
        <li><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg> Background-checked crews</li>
        <li><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg> Satisfaction guarantee</li>
      </ul>"""


# ============ COMBO PAGE (service × location) ============

def combo_page(s, n):
    # Smart title: include brand only if total stays <= 60 chars
    base = f"{s['name']} in {n['name']}, OH"
    brand = " | North Columbus Cleaning"
    title = base + brand if len(base + brand) <= 60 else base
    desc = (
        f"{s['name']} in {n['name']}, OH by a local, insured, bonded crew. Free quotes, "
        f"satisfaction guarantee. Call {PHONE_DISPLAY} or request a call back."
    )
    canonical = f"/services/{s['slug']}/{n['slug']}"

    # Custom intro paragraph: service's local_hook + location's blurb
    lead = f"{s['local_hook'](n)}"
    sub = n['blurb']
    zips_line = ", ".join(n['zips'])

    included_items = "\n".join(f"        <li>{item}</li>" for item in s['included'])

    # Other services offered in this SAME location (links to other combos)
    others_here = [x for x in SERVICES if x['slug'] != s['slug']]
    others_here_cards = "\n".join(f"""        <a class="service-card service-card-link" href="/services/{x['slug']}/{n['slug']}">
          <div class="service-img"><img src="{x['hero_img']}" alt="{x['name']} in {n['name']}" loading="lazy" /></div>
          <div class="service-body">
            <h3>{x['name']} in {n['name']}</h3>
            <p>{x['short']}</p>
          </div>
        </a>""" for x in others_here)

    # Same service in OTHER locations (sibling combos)
    others_elsewhere = [x for x in NEIGHBORHOODS if x['slug'] != n['slug']]
    other_area_links = "\n".join(
        f'        <li><a href="/services/{s["slug"]}/{x["slug"]}">{s["name"]} in {x["name"]}</a></li>'
        for x in others_elsewhere
    )

    # JSON-LD: LocalBusiness with service area (boosts local SEO)
    jsonld = f"""  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "HouseholdCleaningService",
    "name": "North Columbus Cleaning Company",
    "image": "https://northcolumbuscleaning.com/images/logo.svg",
    "url": "https://northcolumbuscleaning.com{canonical}",
    "telephone": "{PHONE_SCHEMA}",
    "areaServed": {{
      "@type": "City",
      "name": "{n['name']}, OH"
    }},
    "address": {{
      "@type": "PostalAddress",
      "addressLocality": "Columbus",
      "addressRegion": "OH",
      "addressCountry": "US"
    }},
    "makesOffer": {{
      "@type": "Offer",
      "itemOffered": {{
        "@type": "Service",
        "name": "{s['name']} in {n['name']}, OH",
        "areaServed": "{n['name']}, OH"
      }}
    }}
  }}
  </script>"""

    cta = cta_block(
        where=n["name"],
        service=FORM_OPTION_BY_SLUG.get(s["slug"]),
        source=f"{s['name']} in {n['name']} page",
    )

    return f"""{head(title, desc, canonical, og_image=s['hero_img'])}
{jsonld}
{TOPBAR}
{HEADER}

  <nav class="breadcrumb" aria-label="Breadcrumb">
    <div class="container">
      <a href="/">Home</a> &rsaquo;
      <a href="/services">Services</a> &rsaquo;
      <a href="/services/{s['slug']}">{s['name']}</a> &rsaquo;
      <span>{n['name']}</span>
    </div>
  </nav>

  <section class="hero hero-compact">
    <div class="container hero-inner">
      <div class="hero-text">
        <span class="eyebrow">{n['county']} &middot; {zips_line}</span>
        <h1>{s['name']} in {n['name']}, OH</h1>
        <p class="lead">{lead}</p>
        <p>{sub}</p>
        <div class="hero-cta">
          <a href="tel:{PHONE_E164}" class="btn btn-primary">Call {PHONE_DISPLAY}</a>
          <a href="#quote" class="btn btn-outline">Get a free quote</a>
        </div>
{TRUST_LIST}
      </div>
      <div class="hero-visual">
        <img src="{s['hero_img']}" alt="{s['name']} by North Columbus Cleaning Company in {n['name']}, OH" />
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">What&rsquo;s included</span>
        <h2>What&rsquo;s included in our {s['name'].lower()} in {n['name']}</h2>
        <p class="section-sub">{s['intro']}</p>
      </div>
      <ul class="included-list">
{included_items}
      </ul>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Why {n['name']} picks us</span>
        <h2>Why {n['name']} homes and businesses choose us for {s['name'].lower()}</h2>
      </div>
      <div class="grid benefits-grid">
        <div class="benefit"><h4>We clean here weekly</h4><p>Our crews are in {n['name']} regularly &mdash; we know the area, the home styles, and the traffic patterns.</p></div>
        <div class="benefit"><h4>Insured and bonded</h4><p>Every cleaner in your {n['name']} home or business is background-checked, bonded, and fully insured.</p></div>
        <div class="benefit"><h4>Free, no-obligation quotes</h4><p>One short call and {n['name']} customers know exactly what the job involves &mdash; before anything is booked.</p></div>
        <div class="benefit"><h4>Same crew each time</h4><p>Recurring {s['name'].lower()} clients in {n['name']} get the same team every visit.</p></div>
        <div class="benefit"><h4>Flexible scheduling</h4><p>Evenings, weekends, and short-notice availability across {n['name']} and nearby zips ({zips_line}).</p></div>
        <div class="benefit"><h4>Satisfaction guarantee</h4><p>If something in your {n['name']} clean isn't right, we come back and fix it &mdash; at no charge.</p></div>
      </div>
    </div>
  </section>

{cta}

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Other services in {n['name']}</span>
        <h2>Other cleaning services in {n['name']}, OH</h2>
      </div>
      <div class="grid services-grid">
{others_here_cards}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">{s['name']} elsewhere</span>
        <h2>{s['name']} in nearby neighborhoods</h2>
      </div>
      <ul class="areas-list areas-list-wide">
{other_area_links}
      </ul>
    </div>
  </section>

{footer()}"""


# ============ LOCATION PAGE ============

def location_page(n):
    base = f"House Cleaning in {n['name']}, OH"
    brand = " | North Columbus Cleaning"
    title = base + brand if len(base + brand) <= 60 else base
    desc = (
        f"Residential and commercial cleaning in {n['name']}, OH by a local, insured, bonded crew. "
        f"Free quotes, satisfaction guarantee. Call {PHONE_DISPLAY} or request a call back."
    )
    zips_line = ", ".join(n['zips'])

    service_cards = "\n".join(f"""        <a class="service-card service-card-link" href="/services/{s['slug']}/{n['slug']}">
          <div class="service-img"><img src="{s['hero_img']}" alt="{s['name']} in {n['name']}" loading="lazy" /></div>
          <div class="service-body">
            <h3>{s['name']} in {n['name']}</h3>
            <p>{s['short']}</p>
          </div>
        </a>""" for s in SERVICES)

    other_areas = [x for x in NEIGHBORHOODS if x['slug'] != n['slug']]
    other_links = "\n".join(
        f'        <li><a href="/locations/{x["slug"]}">{x["name"]}</a></li>'
        for x in other_areas
    )

    cta = cta_block(where=n["name"], source=f"{n['name']} location page")

    return f"""{head(title, desc, f"/locations/{n['slug']}")}
{local_business_jsonld(f"/locations/{n['slug']}", area_served=f"{n['name']}, OH")}
{TOPBAR}
{HEADER}

  <section class="hero hero-compact">
    <div class="container hero-inner">
      <div class="hero-text">
        <span class="eyebrow">{n['county']} &middot; {zips_line}</span>
        <h1>House and office cleaning in {n['name']}, OH</h1>
        <p class="lead">{n['blurb']}</p>
        <div class="hero-cta">
          <a href="tel:{PHONE_E164}" class="btn btn-primary">Call {PHONE_DISPLAY}</a>
          <a href="#quote" class="btn btn-outline">Get a free quote</a>
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
        <h2>Cleaning services in {n['name']}, OH</h2>
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
        <h2>Why {n['name']} homes and businesses choose us</h2>
      </div>
      <div class="grid benefits-grid">
        <div class="benefit"><h4>We know the area</h4><p>From older homes with original woodwork to newer builds with modern finishes, our crews clean across {n['name']} every week.</p></div>
        <div class="benefit"><h4>Same crew every time</h4><p>Recurring customers get the same team each visit. They learn your space, your preferences, and your pets.</p></div>
        <div class="benefit"><h4>Fully insured</h4><p>Every cleaner is background-checked, bonded, and insured. Nothing in your {n['name']} home is unprotected.</p></div>
        <div class="benefit"><h4>Flexible scheduling</h4><p>Evenings, weekends, and short-notice openings. We work around your calendar, not ours.</p></div>
        <div class="benefit"><h4>Free, no-obligation quotes</h4><p>One short call and you know exactly what the job involves. Nothing is booked until you say so.</p></div>
        <div class="benefit"><h4>100% satisfaction</h4><p>If anything in your {n['name']} home isn't right, we come back and fix it &mdash; no charge.</p></div>
      </div>
    </div>
  </section>

{cta}

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Other areas we serve</span>
        <h2>Cleaning services in nearby neighborhoods</h2>
      </div>
      <ul class="areas-list">
{other_links}
      </ul>
    </div>
  </section>

{footer()}"""


# ============ SERVICE PAGE ============

def service_page(s):
    base = f"{s['name']} in Columbus, OH"
    brand = " | North Columbus Cleaning"
    title = base + brand if len(base + brand) <= 60 else base
    desc = (
        f"{s['name']} services in Columbus, OH by a local, insured, bonded crew. {s['short']} "
        f"Free quotes. Call {PHONE_DISPLAY} or request a call back."
    )

    included_items = "\n".join(f"        <li>{item}</li>" for item in s['included'])
    area_links = "\n".join(
        f'        <li><a href="/services/{s["slug"]}/{n["slug"]}">{n["name"]}</a></li>'
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

    cta = cta_block(
        service=FORM_OPTION_BY_SLUG.get(s["slug"]),
        source=f"{s['name']} page",
    )

    return f"""{head(title, desc, f"/services/{s['slug']}", og_image=s['hero_img'])}
{local_business_jsonld(f"/services/{s['slug']}", service_name=s['name'])}
{TOPBAR}
{HEADER}

  <section class="hero hero-compact">
    <div class="container hero-inner">
      <div class="hero-text">
        <span class="eyebrow">Our services</span>
        <h1>{s['name']} in Columbus, OH</h1>
        <p class="lead">{s['intro']}</p>
        <div class="hero-cta">
          <a href="tel:{PHONE_E164}" class="btn btn-primary">Call {PHONE_DISPLAY}</a>
          <a href="#quote" class="btn btn-outline">Get a free quote</a>
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
        <h2>What&rsquo;s included in our {s['name'].lower()}</h2>
      </div>
      <ul class="included-list">
{included_items}
      </ul>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Who it&rsquo;s for</span>
        <h2>Who {s['name'].lower()} is right for</h2>
        <p class="section-sub">{s['good_fit']}</p>
      </div>
    </div>
  </section>

{cta}

  <section class="section section-alt">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Service area</span>
        <h2>{s['name']} service areas in North Columbus</h2>
        <p class="section-sub">All across Franklin and Delaware counties and the surrounding neighborhoods.</p>
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
        <h2>Other cleaning services we offer</h2>
      </div>
      <div class="grid services-grid services-grid-3">
{other_service_cards}
      </div>
    </div>
  </section>

{footer()}"""


# ============ HUB PAGES ============

def locations_hub():
    title = "Cleaning Service Areas in North Columbus, OH"
    desc = (
        "Cleaning services across 12 North Columbus, OH neighborhoods &mdash; Worthington, "
        f"Dublin, Westerville, New Albany, Powell, and more. Call {PHONE_DISPLAY}."
    )
    cards = "\n".join(f"""        <a class="area-card" href="/locations/{n['slug']}">
          <h3>{n['name']}</h3>
          <p class="area-meta">{n['county']}</p>
          <p>{n['blurb'][:120]}&hellip;</p>
          <span class="area-link">See details &rarr;</span>
        </a>""" for n in NEIGHBORHOODS)

    cta = cta_block(source="Locations hub")

    return f"""{head(title, desc, "/locations")}
{local_business_jsonld("/locations")}
{TOPBAR}
{HEADER}

  <section class="section hero-compact section-head-hero">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">Where we work</span>
        <h1>Cleaning service areas in North Columbus, OH</h1>
        <p class="section-sub">Twelve neighborhoods across Franklin and Delaware counties. Don&rsquo;t see yours? Give us a call &mdash; we&rsquo;re expanding every month.</p>
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

{cta}

{footer()}"""


def services_hub():
    title = "Cleaning Services in Columbus, OH | North Columbus Cleaning"
    desc = (
        "Residential, commercial, deep, recurring, move-in/out, and Airbnb cleaning "
        f"services in North Columbus, OH. Free quotes. Call {PHONE_DISPLAY}."
    )
    cards = "\n".join(f"""        <a class="service-card service-card-link" href="/services/{s['slug']}">
          <div class="service-img"><img src="{s['hero_img']}" alt="{s['name']}" loading="lazy" /></div>
          <div class="service-body">
            <h3>{s['name']}</h3>
            <p>{s['short']}</p>
            <span class="area-link">See details &rarr;</span>
          </div>
        </a>""" for s in SERVICES)

    cta = cta_block(source="Services hub")

    return f"""{head(title, desc, "/services")}
{local_business_jsonld("/services")}
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

{cta}

{footer()}"""


# ============ SITEMAP ============

def sitemap():
    """Generate sitemap.xml covering every page."""
    base = "https://northcolumbuscleaning.com"
    urls = [
        (base + "/", "1.0", "weekly"),
        (base + "/quote", "0.9", "weekly"),
        (base + "/services", "0.9", "weekly"),
        (base + "/locations", "0.9", "weekly"),
        (base + "/privacy", "0.3", "yearly"),
        (base + "/sms-terms", "0.3", "yearly"),
    ]
    for s in SERVICES:
        urls.append((f"{base}/services/{s['slug']}", "0.8", "monthly"))
    for n in NEIGHBORHOODS:
        urls.append((f"{base}/locations/{n['slug']}", "0.8", "monthly"))
    for s in SERVICES:
        for n in NEIGHBORHOODS:
            urls.append((f"{base}/services/{s['slug']}/{n['slug']}", "0.7", "monthly"))

    url_blocks = "\n".join(
        f"  <url>\n    <loc>{u}</loc>\n    <changefreq>{freq}</changefreq>\n    <priority>{p}</priority>\n  </url>"
        for u, p, freq in urls
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{url_blocks}
</urlset>
"""


def robots():
    return """User-agent: *
Allow: /

# The buyer's dashboard and its API are private — the signed link is the
# credential, and none of it should ever appear in a search result.
Disallow: /dashboard
Disallow: /api/buyer/

Sitemap: https://northcolumbuscleaning.com/sitemap.xml
"""


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

    # Combo pages (service × location)
    combo_count = 0
    for s in SERVICES:
        for n in NEIGHBORHOODS:
            write(f"services/{s['slug']}/{n['slug']}.html", combo_page(s, n))
            combo_count += 1

    # Sitemap + robots.txt
    write("sitemap.xml", sitemap())
    write("robots.txt", robots())

    print(f"\nGenerated {len(NEIGHBORHOODS)} location pages, {len(SERVICES)} service pages, "
          f"2 hubs, {combo_count} combo pages, sitemap.xml, robots.txt.")


if __name__ == "__main__":
    main()
