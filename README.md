# Chichang.ai Design System

## Overview

**Chichang.ai** is an Influencer Intelligence Platform — a web app that helps brands find and track the right Instagram influencers. Users enter their brand's Instagram handle; the AI analyzes the brand story, surfaces the top 3 matching influencers scored on niche fit, audience match, and engagement quality, then tracks ROI and delivery from confirmed partnerships.

**Source:** GitHub repo `paripatiai/chichang-ai` (branch: `main`)
- Primary product file: `index.html` — full single-page React-free app (~81 KB)
- Backend (Vercel serverless): `api/analyze.js`, `api/brand.js`, `api/influencers.js`
- Live URL: deployed on Vercel

---

## Products

| Surface | Description |
|---|---|
| **Web App** | Single-page app, responsive (mobile + desktop). Four screens: Brand Entry → Loading → Brand Story → Influencer Matches → ROI Tracking |

---

## CONTENT FUNDAMENTALS

**Voice & Tone**
- Confident, editorial, and data-forward. Feels like a smart analyst talking to a marketing director.
- First-person implied ("Chichang analyzes...") — the product speaks as an expert tool.
- Copy uses "you/your" to address the brand directly: "Find influencers who actually move *your* brand."
- Sentence case everywhere (not title case). Labels are ALL CAPS SMALL with letter-spacing.
- No emoji in UI chrome. Emoji used *only* in loading/progress states as functional icons (🔍 🧠 ⭐ 📊) — they feel playful but purposeful, not decorative.
- Numbers and stats used liberally in copy to establish credibility: "60% higher engagement", "10–30 seconds".

**Writing Style**
- Short, punchy headlines. Hero: "Find influencers who actually *move* your brand."
- Subheads are calm and factual: "Scored across niche match, audience fit, engagement quality & collaboration openness."
- CTAs are directional with arrows: "Analyze →", "Find Influencers →", "Set Up Tracking →"
- Section labels are always UPPERCASE with wide letter-spacing, e.g. "BRAND ANALYSIS", "ROI TRACKING"
- Loading copy is human and conversational: "This usually takes 10–30 seconds"
- Fun facts in loading states add educational value, never fluff.

**Casing rules**
- Page titles: Sentence case (Playfair Display serif)
- Eyebrows/labels: ALL CAPS with letter-spacing
- Button CTAs: Sentence case, bold
- Data labels: ALL CAPS small, muted

---

## VISUAL FOUNDATIONS

### Colors
| Token | Value | Use |
|---|---|---|
| `--ink` | `#1a1a2e` | Primary text, headings (deep navy-black) |
| `--ink-soft` | `#4a4a6a` | Secondary text, body |
| `--ink-muted` | `#8a8aaa` | Captions, placeholders, labels |
| `--paper` | `#ffffff` | Primary background |
| `--paper-warm` | `#f6f6f7` | Secondary background, card fills |
| `--gold` (brand green) | `#008060` | Primary brand/accent — buttons, highlights, links |
| `--gold-light` | `#d4edda` | Tinted backgrounds (badges, avatars) |
| `--gold-dark` | `#004c3f` | Hover state for brand green |
| `--line` | `#e3e5e8` | Dividers, borders |
| `--purple` | `#5c6ac4` | Secondary accent (eyebrows, AI state indicators) |
| `--purple-light` | `#f0f1ff` | Purple tinted backgrounds |
| `--red` | `#d82c0d` | Error, destructive |
| `--red-light` | `#fff4f4` | Error backgrounds |
| `--instagram` | `#e1306c` | Instagram brand color (used for pulse indicator) |

**Color vibe:** Light, editorial, white-dominant. The brand green (#008060) was aliased as "gold" in the codebase — it's actually a rich teal-green. Imagery color tone not specified — the app is data-UI, no photography.

### Typography
- **Display/Headings:** Playfair Display (serif), 700 weight, italic available. Used for page titles, card names, hero headlines, metric values in larger contexts.
- **Body/UI:** Inter, weights 300–700. Used for all body copy, labels, buttons, nav.
- **Inputs/Pills:** DM Sans (referenced in CSS but not loaded via Google Fonts — falls back to system sans-serif). Use for form inputs, pill chips.

**Type Scale**
- Hero title: `clamp(38px, 5vw, 64px)` Playfair, weight 700
- Page title: 36px Playfair
- Section title: 22px Playfair
- Card title: 18–24px Playfair
- Metric value: 28–32px Playfair
- Body: 15–17px Inter 300
- UI label: 12–14px Inter 500–600
- Eyebrow: 11px Inter 600, 2px letter-spacing, ALL CAPS
- Caption: 11–12px Inter 400, muted

### Spacing
- Base unit: 4px. Common spacings: 8, 12, 16, 20, 24, 32, 48, 60px
- Page container max-width: 900px, padding 24px horizontal
- Nav: 48px horizontal padding (desktop), 16px (mobile)

### Borders & Radius
- Cards: `border-radius: 12px`, `border: 1px solid var(--line)`
- Buttons: `border-radius: 6px`
- Pills/chips: `border-radius: 100px`
- Inputs: `border-radius: 6–8px`
- No heavy shadow system — cards are defined by border + rare shadow on hover

### Shadows
- Default: no shadow (border-only cards)
- Hover on influencer cards: `box-shadow: 0 8px 32px rgba(0,0,0,0.08)`
- Focus-within input: `box-shadow: 0 4px 32px rgba(200,169,81,0.15)` (brand green glow)
- Rank-1 card: `box-shadow: 0 4px 20px rgba(0,128,96,0.1)` (brand green glow)

### Backgrounds & Surfaces
- White + warm white (`#f6f6f7`) are the only backgrounds used.
- No gradients on backgrounds. Progress/fill elements use a subtle `linear-gradient(90deg, var(--gold), #00a67e)` or `linear-gradient(180deg, var(--gold), var(--purple))`.
- No textures, patterns, or images — pure data UI.
- Nav uses `backdrop-filter: blur(12px)` for glass effect on scroll.

### Animations
- Page transitions: `fadeUp` — opacity 0→1 + translateY 16px→0, 0.5s ease
- Spinners: CSS `rotate` animation
- Pulse: opacity 1→0.4→1, 1.5s infinite (for live status dots)
- iconPulse: box-shadow grows/shrinks, 1.5s infinite (active progress step)
- Score bars: `width` transition 1s ease
- General: all transitions 0.2s–0.4s. No bounces. Easing: `ease` or linear.

### Hover/Press States
- Buttons: `background: var(--gold-dark)` on hover (darken). No scale transform on buttons.
- Cards: `translateY(-2px)` + shadow on hover — subtle lift
- Links: underline with `text-underline-offset: 3px`
- Secondary buttons: border darkens to `var(--ink-soft)`

### Layout Rules
- Fixed nav at top, 100px height, z-index 100
- `main` has `padding-top: 100px` to clear nav
- Single-column reading flow, max-width 900px centered
- Metrics/stats displayed in grid rows (2–4 columns)
- Influencer cards: 3-col grid → 2-col (tablet) → 1-col (mobile)

### Component Patterns
- **Progress stepper** in nav: step number circles + divider lines
- **Vertical progress tracker** in loading: icon circles connected by vertical line fill
- **Score bars**: label + thin 4px progress bar + numeric score
- **Rank indicators**: colored top border (gold/silver/bronze) on top-ranked cards
- **Badges/chips**: `border-radius: 100px`, small padding, tinted background matching semantic color

---

## ICONOGRAPHY

- **Emoji as icons:** Used selectively in loading states and "how it works" steps. NOT used decoratively in data UI.
  - 🔍 Search/analyze, 🧠 AI thinking, ⭐ scoring, 📊 tracking, 📸 content, 🎯 targeting, 🔑 keywords, 📱 social, ✓ completion
- **No icon font** or SVG icon system found in the codebase. The product relies on emoji for functional icons in loading/wizard states, and uses CSS/unicode for UI elements (arrows →, checkmarks ✓).
- **Brand logo** is typographic only: "Chichang" in Playfair Display + "AI" in small uppercase green text.
- No external icon library (Lucide, Heroicons, etc.) referenced in the codebase.
- Avatars: displayed as initials or emoji inside a colored circle.

---

## FILE INDEX

```
/
├── README.md                    ← This file
├── colors_and_type.css          ← CSS vars: colors, type, spacing tokens
├── SKILL.md                     ← Agent skill definition
├── assets/
│   └── (no binary assets — product is purely typographic/emoji)
├── preview/
│   ├── colors-brand.html        ← Brand color swatches
│   ├── colors-semantic.html     ← Semantic/state colors
│   ├── type-scale.html          ← Typography specimens
│   ├── type-specimens.html      ← Heading + body combinations
│   ├── spacing-tokens.html      ← Spacing, radius, shadow tokens
│   ├── components-buttons.html  ← Button states
│   ├── components-badges.html   ← Badges, chips, status pills
│   ├── components-cards.html    ← Brand card + influencer card
│   ├── components-inputs.html   ← Input + criteria bar
│   └── components-progress.html ← Progress stepper + score bars
└── ui_kits/
    └── app/
        ├── README.md
        └── index.html           ← Full click-thru prototype of the web app
```
