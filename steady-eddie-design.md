# Steady Eddie — design

A UK-haulage fork of **The Tea Race**, itself after *Ocean Trader* (Clipper Games Ltd, 1988). Fourth
game on the portal, alongside Thrash Margin, Banco di Niccolò and The Tea Race, sharing one
deployment, one `users` table and one JWT session.

- **Package:** `packages/steady-eddie/`
- **Path:** `/steady-eddie/`
- **DB discriminator:** `games.game = 'steady_eddie'`
- **Ruleset:** `standard` (the only one). A continuous "free-haulage" mode — the equivalent of The
  Tea Race's own deferred "Voyage mode" — is designed in spirit here (§6) and deliberately not built.
- **Name:** an Eddie Stobart pun, chosen by the owner from a shortlist over the alternatives
  Stobarter, Eddie's Round and Trunking Eddie — and one that happens to name exactly the trait a
  haulage business needs.

---

## 1. What this is a fork of, and why a fork rather than a fresh build

The owner asked for a fourth game: UK haulage, a lorry instead of a boat, "following and copying
what we have built for the tea race." Two Explore passes over `packages/tea-race/` before any code
was written confirmed that reading was achievable almost to the letter — nearly the whole engine is
generic simulation logic (movement along a graph, a contract deck, a share-majority endgame, an
AI scoring loop) wearing cosmetic ocean vocabulary, not logic that is actually about the sea.

So this is **a fork-and-reskin of the complete, currently-shipped Tea Race package** — all nine of
its build sessions' worth of depth systems, not a re-derived vertical slice. Re-deriving them from
scratch would have meant re-discovering bugs The Tea Race already paid to find and fix: the
source-lock bug (a card that only *read* as naming a seller), the payout inversion (cheapest quay
earning the least), the softlock/deadlock pair in the share market, and the shipping exchange that
could only ever rise. Steady Eddie starts from those fixes rather than re-earning them.

One system could not be forked this way: `weather.ts`'s directional wind, derived from real
lon/lat geography (doldrums at the equator, a reversing monsoon, the Roaring Forties). That is real
nautical climatology with no UK-road equivalent, and forcing it onto a country-sized network would
have been decoration, not a mechanic. It was redesigned, not reskinned — see §3.

## 2. The mechanical inheritance (unchanged from The Tea Race)

Carried over structurally intact, because it is this engine's own economic core rather than
anything specific to a clipper trade:

- **Five face-up contracts, paid 4x/2x to the first two haulage runs home.** A card names a buyer
  depot and a good, never a source — load the good at any depot that stocks it. (This "no source
  lock" rule was a real bug in The Tea Race's first pass; Steady Eddie inherits the fix, not the bug.)
- **Ten shares, a declared majority plus a cash bar, a twelve-turn sabotage countdown.** The
  share-market termination proof (forced sales only ever move to a holder with at least as many
  shares, which is what bounds the game) carries over unchanged, including the hostile-bid escape
  hatch for a haulier who has fallen behind and the sell-back-at-half escape hatch for one who has
  spent below the cheapest lot on the board.
- **Standing costs**: driver wages and diesel, a bank loan against the fleet, contract deadlines and
  cargo that loses freshness the longer it's carried.
- **AI rivals** (three temperaments: racer, speculator, financier) and **hotseat** play, both
  ported as-is; a difficulty dial (gentle/steady/hard) that handicaps knowledge and discipline, never
  the dice.
- **Four named presets** replacing eleven independent toggles as the front door — The Tea Race's own
  fix for "nobody wants to reason about ten booleans before a game."

## 3. What was redesigned, not ported: road & weather

The Tea Race's wind is directional and geography-derived: the same leg gives opposite modifiers
depending which way you sail it, because a clipper's whole routing puzzle is the outbound and
homeward passages being different problems. A UK road has no prevailing wind and a lorry doesn't
sail closer to or further from one — there is no honest way to keep the directionality.

What replaces it, in `sim/weather.ts` and `RoadLeg.weatherRisk` (`legs.json`): each leg carries an
**authored** fog/snow/flood-proneness rating, 1-3, the same way The Tea Race already authored
piracy per leg rather than deriving it from latitude. A season (spring/summer/autumn/winter, same
six-round cadence) multiplies that rating into worse odds — winter is worst, summer mildest — but a
leg with no authored risk is always clear, in every season. Route planning still differs by season
(a fog-prone Pennine crossing costs more in winter, so `planFastestRoute` will route around it), but
the directional "the way home differs from the way out" richness is gone along with the wind that
produced it. That loss was accepted deliberately rather than faked.

Piracy became **theft**, mechanically almost untouched: an authored per-leg rating, a tracker fitting
(was: guns) that halves the encounter chance and turns most seizures into a paid recovery (was:
ransom) rather than a total loss, and insurance priced off the cargo aboard and the route's own
theft rating. "Ransom" became "recovery" throughout — a tracked lorry gets found and returned for a
fee, which is the real-world equivalent of a boarded ship being bought off.

## 4. The world

14 depots (a deliberate fraction of The Tea Race's 26 ports — a UK-only map should read as small,
not as the same map redrawn smaller), real WGS84 lon/lat, spanning London/Ashford in the south-east
to Glasgow in the north: London (home depot), Ashford (Tesco RDC — the owner's own example),
Southampton, Bristol, Birmingham, Nottingham, Sheffield, Stoke-on-Trent, Manchester, Warrington
(IKEA — the owner's other example), Liverpool, Leeds, Newcastle, Glasgow.

12 goods (was 19): tomatoes, flat-pack furniture, steel coil, Scotch whisky, ceramics, chocolate,
cars & parts, textiles, fresh fish, ale, cheese, frozen food. 21 road legs (was 49) along the real
motorway skeleton — M1/M6/M62/M25/M4/A1 — scaled roughly one drive point per twelve real road miles
so a 2d6 roll still covers a short hop in one turn and a long haul in two or three, the pacing The
Tea Race tunes its own sail points to.

Two buyer contracts headline the set at the owner's explicit request: **tomatoes to Tesco's RDC at
Ashford**, and **flat-pack to IKEA at Warrington**. A handful of other real, well-known UK plants
(Nissan Sunderland, JLR Solihull, Amazon Darlington, Cadbury Bournville) appear as buyer flavour the
same way The Tea Race names real historical ports — scenery, not branding, and easy to swap for
invented names if that turns out to read wrong in play.

Vehicle classes replace ship classes, 2/2/3 load-bed slots (was 3/4/3) — a smaller spread for a
smaller map: the **7.5-tonner** (default, baseline), the **18-tonne rigid** (no roomier, a point
faster for a real premium), the **44-tonne artic** (a third slot over either, and markedly the
slowest and dearest for it). No class is cheaper AND roomier AND faster than another — the same
dominance property The Tea Race's harness checks, verified fresh against the new numbers.

The haulage exchange replaces the shipping exchange: three invented rival firms (Home Counties
Freight, Crossways Carriers, Northbound Haulage — avoiding any real competitor's name) mapped to
three UK region groups, same mean-reverting price mechanic.

## 5. The map

A GB-only chart (`scripts/build_chart.py`, adapted from The Tea Race's own), Natural Earth 110m
land cropped to a bounding box (lon -6.5..2.2, lat 49.8..59.0) rather than clipped only on latitude
the way a world chart is — a country box needs both axes cropped, and needs proper polygon clipping
(Sutherland-Hodgman) rather than the world chart's vertex-clamping: clamping a foreign landmass's
far-flung vertices to the box, as a first pass here did before it was caught by inspecting the
output, drags most of continental Europe onto the box edges and fills it in as false land. A world
chart never hits this because the one landmass that straddles its single clipped edge (Greenland)
has nothing on the far side of that edge to distort.

The antimeridian-wrap machinery The Tea Race's `geography.ts` needs for four Pacific-crossing legs
(`wrapDx`/`unwrapRun`/`wrapPanX`, and drawing the whole chart three times side by side) is dropped
outright, not ported — no leg on a country-sized map comes anywhere near half the sheet wide, so
plain straight lines and simple pan-clamping are correct. The map's own portrait aspect (900×1100
viewBox, was 1600×900) matches Britain's shape rather than reusing a wide world-chart box.

## 6. Things deliberately not built

- **Free-haulage mode** — a continuous simulation (real days instead of dice, prices moving on their
  own clock, standing costs running independent of turn structure) is the Steady Eddie equivalent of
  The Tea Race's own deferred "Voyage mode." Designed in spirit by inheritance, not built here.
- **Port agents** — The Tea Race's own still-open roadmap item; inherited as open, not started.
- Any further named preset beyond the four ported ones.

## 7. Verification

`scripts/drive.ts`, adapted from The Tea Race's own two-part harness (targeted `processAction`
assertions, then seeded AI-vs-AI simulations with invariant checks and a determinism replay), rather
than written from scratch — same reasoning as the fork itself: a fresh harness would re-discover
regression classes the original only found by accident. Bakes in from day one, rather than waiting
to rediscover them: the no-source-lock check, the payout-direction check (cheapest depot must net
strictly more), the no-two-in-a-row deck-fairness check, and the vehicle-class dominance check.

`npx tsc --noEmit -p tsconfig.json` is clean throughout this fork's build. `tsx` transpiles without
type-checking, so — per The Tea Race's own hard-won lesson — no drive-harness measurement should be
trusted mid-refactor without a clean `tsc` pass alongside it.

## 8. Portal integration

Same recipe as The Tea Race's own §"portal integration" note: `packages/steady-eddie/` mirroring the
sibling packages, a self-contained `api/_lib/{db,auth,cors}.ts` (duplicated on purpose — Vercel's
file tracing drops cross-package imports at runtime), a root `api/steady-eddie/game/[[...id]].ts`
shim, a `vercel.json` rewrite, a landing-page card, and a link in every other game's `PortalNav`.

One prerequisite this fork needed that earlier ones didn't: root `api/` was at 11 functions against
the Vercel Hobby plan's 12-function ceiling, and a fourth game's own list/item pair would have hit
13. Fixed by collapsing each existing game's separate `index.ts` + `[id].ts` pair into one optional
catch-all `[[...id]].ts` function apiece (thrash-margin, niccolo, tea-race first, verified, then
steady-eddie built the same way from day one) — 11 → 8 → 9 functions, with headroom for a fifth game
before this needs revisiting.

## 9. Attribution

After *Ocean Trader* (Clipper Games Ltd, 1988), by way of **The Tea Race** — see
`tea-race-design.md` for that game's own design history, which this one inherits rather than
repeats.
