# Pounce Agent Guide

This file gives coding agents brand and styling direction for the Pounce website.

## Product Summary

Pounce is a price and stock monitoring product with Telegram alerts. The UI should feel:

- fast
- sharp
- watchful
- trustworthy
- slightly predatory in attitude, but never gimmicky

Think "quiet hunter" more than "generic SaaS dashboard".

## Brand Positioning

- Pounce helps users track products and act quickly when price or stock changes.
- The product is about vigilance, timing, and clear signal.
- The brand should feel decisive and alive, not corporate, soft, or ornamental.

## Visual Direction

- Prefer a high-contrast, editorial-feeling interface over a default startup dashboard.
- Use strong typography, deliberate spacing, and obvious visual hierarchy.
- Favor tension between calm structure and urgent highlights.
- Avoid making the app feel playful, cute, or meme-driven.
- Avoid "AI SaaS" styling: soft purple gradients, vague glassmorphism, floating blobs, and interchangeable landing-page patterns.

## Color System

Use color to communicate signal and urgency.

- Base neutrals should be warm or slightly inked, not sterile blue-gray.
- Accent color should feel energetic and alert. Good directions:
  - ember
  - signal orange
  - electric red-orange
  - acidic yellow used sparingly
- Success color should indicate "in stock" or "recovered" clearly.
- Destructive color should indicate drops, failures, or "out of stock" states with conviction.

Guidelines:

- Keep the palette tight. One primary accent plus semantic colors is enough.
- Reserve the brightest color for actions, alerts, and important deltas.
- Do not flood the whole UI with accent color.
- If gradients are used, keep them intentional and directional, not decorative wallpaper.

## Typography

- Do not default to `Inter` for new branded surfaces unless preserving an existing area.
- Prefer type with more character for headings while keeping body text highly readable.
- Headlines should feel compressed, bold, and decisive.
- Body copy should stay plain and functional.
- Use large numeric treatments for prices, stock state, and timing data.

Typography rules:

- Strong page titles
- Dense metric styling
- Short labels
- Minimal paragraph copy

## Layout

- Prioritize dashboards that scan quickly.
- Lead with the most actionable information:
  - item name
  - current price
  - price movement
  - stock state
  - last check time
- Use cards and panels, but give them personality through contrast, spacing, and hierarchy.
- Important surfaces can feel slightly compressed and tactical rather than airy and soft.
- On mobile, preserve urgency and hierarchy instead of collapsing everything into bland stacked boxes.

## Components

### Buttons

- Primary buttons should feel assertive and high-contrast.
- Secondary buttons should still look intentional, not like disabled placeholders.
- Avoid overly rounded "pill for everything" styling unless there is a clear reason.

### Cards

- Cards should frame data clearly and support quick comparison.
- Use borders, tonal fills, or accent edges to show state.
- Avoid generic white cards on gray backgrounds with no differentiation.

### Status Treatments

- `In stock` should feel positive and active.
- `Out of stock` should feel urgent and obvious.
- `Unknown` should look intentionally neutral, not broken.
- Price changes should be easy to parse in one glance.

### Forms

- Inputs should feel operational, like tools.
- Labels must be clear and direct.
- Helper text should be short and practical.
- Avoid overly soft form styling.

## Motion

- Use motion to reinforce responsiveness and state change.
- Favor fast transitions, subtle reveals, and purposeful emphasis.
- Good uses:
  - watch list items updating
  - status changes
  - loading states
  - newly triggered alerts
- Avoid decorative animation loops and slow floaty motion.

## Imagery And Graphics

- If graphics are introduced, they should support the "tracking" and "signal" metaphor.
- Good motifs:
  - grids
  - scan lines
  - directional highlights
  - alert pulses
  - charts used as texture very sparingly
- Avoid generic 3D illustrations, abstract SaaS blobs, or cartoon mascots.

## Copy Tone

- Keep copy short, direct, and operational.
- Prefer verbs like:
  - track
  - monitor
  - watch
  - alert
  - catch
- Avoid inflated marketing language.
- Avoid cute microcopy that reduces trust.

Examples:

- Good: `Track price drops before they disappear.`
- Good: `Watch stock status and get alerted instantly.`
- Bad: `Never miss a magical shopping moment again.`

## Implementation Guidance For This Repo

- Preserve the existing Next.js + shared `@pounce/ui` structure.
- Put reusable brand tokens in [packages/ui/src/styles/globals.css](/Users/dc/git/pounce/packages/ui/src/styles/globals.css).
- Keep app-specific composition in [apps/web/app/layout.tsx](/Users/dc/git/pounce/apps/web/app/layout.tsx) and route-level files under [apps/web/app](/Users/dc/git/pounce/apps/web/app).
- When introducing new visual language, do it systematically:
  - update tokens first
  - update shared primitives second
  - update page compositions last
- Prefer semantic tokens over hard-coded per-component colors.
- When using status colors, keep semantics consistent across dashboard, detail pages, and alerts.

## Non-Negotiables

- Do not ship default-looking shadcn styling unchanged on major user-facing surfaces.
- Do not introduce purple-first branding.
- Do not make the product feel like a crypto app.
- Do not sacrifice readability for style.
- Do not hide key metrics behind weak contrast or oversized decorative elements.

## Decision Rule

When choosing between two UI directions, prefer the one that makes Pounce feel:

1. faster to scan
2. more decisive
3. more alert-driven
4. less generic
