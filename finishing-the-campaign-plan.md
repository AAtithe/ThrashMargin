# Finishing the campaign — Chapters 7 and 8, and what has to be true first

Companion to `banco-di-niccolo-design.md`. Written 2026-08-15, in response to: *"please can you draw up
a plan that includes finishing off all chapters of the books? before we push on with warehousing etc."*

**Status.** Nothing here is built. This is a plan for the four phases that take the game from
six-eighths of a campaign to a complete one, plus the three deferred systems re-sequenced around them.

---

## 1. Where the campaign actually stands

| | | |
|---|---|---|
| Chapters playable | 0–6 | 181 scripted events |
| Chapters unbuilt | 7 (*Caprice and Rondo*), 8 (*Gemini*) | — |
| Cities | 26 | Bruges to Timbuktu, Reykjavik to St Catherine's |
| Currencies | 10 | florin through dinar |
| Houses | 6 | Medici, St Pol, Genoese, Doria, Vatachino, Hanse |
| Systems shipped | credit, information/couriers, characters, events, agents, secrets, estates, insurance, expedition/disease, quality grades, evidence board, divining, convoys/escorts, objectives, advisors | |
| Systems specced but unbuilt | warehousing, cycling market events, free-play + AI rivals, fleet growth | `freeplay-and-trading-design.md` |

The campaign freeze currently sits on `chapter6_complete`. Chapter 8 is where it finally *stops*
being a freeze and becomes an ending.

---

## 2. Four debts Chapters 1–6 left owing

These are not polish. Chapter 8's ending reads wrong, or cannot be reached honestly, until each is
settled — so they belong **before** Chapter 7, not after.

### 2.1 Marian de Charetty never dies — and §7 says she must

§7 is explicit: *"Deaths and departures are scripted where the novels script them and are not
preventable. Marian, Katelina, Godscalc, Umar: the game does not allow the player to save them."*

Three of those four are handled. Marian is not: she is still `status: 'active'` in
`content/characters/chapter1.json`, on a salary of 0, and **no event anywhere sets
`characterDeparts: "marian"`**. She was the only one of the four who is a real `Character` record and
was never scripted out — Katelina and Umar were narrative-only because neither was on the roster, and
Godscalc's death shipped in Chapter 6.

This matters concretely for the ending, not just for fidelity. Chapter 8's *"family restored"* and the
epilogue's *"people kept"* tally both read absurdly with the founder of the house still drawing
counsel in the Household panel fifty years on. It also means she is currently the only advisor who can
never fall silent, which quietly makes her the loudest voice in the game.

**Fix:** script her death in Chapter 2's own window (where the novels place it), using the
`characterDeparts` path Godscalc's death established. Small, and it makes every later chapter's
household read correctly.

### 2.2 Every piece of the parentage dossier is optional — a player can reach the resolution holding nothing

Four parentage items exist, all authored in Chapters 5 and 6:

| id | chapter | how it's obtained |
|---|---|---|
| `par_adorne_papers` | 5 | a choice at Kathi's introduction |
| `par_cairo_bearing` | 5 | **only** if the player spends a divining use on `person` at Cairo |
| `par_sinai_deposit` | 5 | a choice, and only on the Sinai success branch |
| `par_godscalc_letter` | 6 | a choice at Godscalc's death |

**Every single one sits behind an optional branch.** A player who declines four times — or who simply
never divines, or fails the Sinai delivery — arrives at Chapter 8 with an empty board and no way to
resolve the mystery the whole campaign has been assembling. §8 promises *"a hidden dossier the player
assembles across all 8 chapters… the resolution follows the novels' answer and fires in Chapter 8."*

**Fix, two parts:**
1. **A guaranteed floor.** Chapters 7 and 8 each put at least one piece on their *spine* (an unavoidable
   event), not on a branch, so the board can never be empty at the resolution.
2. **The resolution scales rather than gates.** Chapter 8 should resolve at any dossier size, but
   resolve *differently*: a full board names the answer outright and closes the St Pol endgame on the
   player's terms; a thin board gets a partial, unprovable answer that Jordan can still deny. This is
   better than a threshold gate — it turns fifty hours of optional diligence into a visible payoff, and
   it cannot soft-lock. It is also the same "outcome flags, not a pass/fail" shape every chapter finale
   already uses.

### 2.3 `vesselIdAt` is pinned to `ship_1`, which fleet growth would break

Phase 20 retargeted Chapters 4 and 5's homecoming triggers to `vesselIdAt: { vesselId: 'ship_1' }` —
correct today, because `ship_1` is the only ship those chapters can possibly have used. If Part 4 of
`freeplay-and-trading-design.md` ever ships `SELL_VESSEL`, a player who sells `ship_1` breaks two
chapters' homecomings. Not urgent, but it must be settled **in the same change as fleet growth**, and
the plan below keeps fleet growth after the campaign is finished partly for that reason.

### 2.4 The Vatachino were unmasked in Chapter 5 and nothing downstream knows

`vatachino_named` / `vatachino_masked_still` are set in Chapter 5 and read by nothing since. §8 puts
the St Pol endgame in Chapter 8, and the Vatachino's third signature is *already authored as Jordan de
Ribérac's*. Chapter 8 must branch on it — a player who did the intelligence work should reach the
endgame holding a weapon; one who didn't should have to find out the hard way.

---

## 3. Chapter 7 — *Caprice and Rondo* (1474–1477)

> §9: *"Exile winter in Danzig/Poland, the Caffa mission as the Black Sea closes, Persia and Uzum
> Hasan, the Ochoa gold thread, Jordan revelations, and the slow turn home. Charles the Bold dies on
> schedule January 1477 and the Burgundian financial world convulses: every player position in
> Flanders reprices."*

**Historical spine, verified rather than guessed** (§13):

| Beat | Date | Note |
|---|---|---|
| Ottomans take Caffa | **June 1475**, Gedik Ahmed Pasha | ends the Genoese Black Sea in one campaign |
| Uzun Hasan already broken | Otlukbeli, **late summer 1473**; dies **6 Jan 1478** | Venice's embassies (Barbaro 1473–78, Contarini reached Tabriz Aug 1474) kept promising aid that never came |
| Charles the Bold killed at Nancy | **5 January 1477** | the Burgundian convulsion |

That is an unusually good fit: the chapter opens with the house in exile, sends it to a Black Sea that
is about to shut, then to a Persian court being strung along by Venice, and ends by detonating the
player's home market.

**New content**
- **Cities (2):** Caffa (Black Sea, doomed) and Tabriz (Persia, inland). Both are already in §3's own
  city list. Danzig already exists from Chapter 6 — the exile winter reuses it, which is exactly why
  Chapter 6 added it.
- **Currency (1):** `akce` or `tanga` for Tabriz. Caffa can stay on `ducat` (Genoese) until it falls.
- **Goods:** none new needed — Caffa trades furs and salt (both exist), Tabriz silk and spices (both
  exist). Continues Chapter 5's precedent of no new goods where existing ones are historically right.
- **Character (1):** John le Grant is already recruited; the natural Chapter 7 joiner is **Moriz**
  (§7's own roster). Optional — the chapter works without one.
- **House:** none new. The Ottomans are a *historical event*, not a trading rival — the same call
  Chapter 3 made about the Famagusta siege.

**The new system: a market shock.** *"Every player position in Flanders reprices"* is the chapter's
headline and there is currently no machinery for it. See §5 below — this is the one place the plan
recommends deviating from the owner's stated ordering, because **cycling market events (already
specced) is exactly this machinery**, and building a bespoke one-off shock would mean building it
twice.

**Second mechanic: exile.** The player is barred from Bruges for the opening arc — a flag checked in
`dispatchVessel`, lifting on a later event. Cheap, and it makes the whole chapter feel different
without a new subsystem. It also finally gives the courier network a reason to exist defensively:
cut off from home, information is all the house has.

**Threads (5, the established finale shape):** the exile winter at Danzig → the Caffa mission (**the
set piece** — get in, trade, and get people and capital out before June 1475, the same extraction
shape as Trebizond but with the lesson already learned) → Persia and Uzun Hasan (a court that promises
and never delivers — the house lends against an alliance that will not happen) → the Ochoa gold thread
→ Jordan's revelations (**this is where a spine-guaranteed parentage piece goes**). Finale gated on
all five, plus Charles's death repricing Flanders as the chapter's closing shock.

**Secrets (2):** what Venice has actually promised Uzun Hasan and has no intention of sending; and the
date the Ottoman fleet sails for Caffa.

---

## 4. Chapter 8 — *Gemini* (1477–1483)

> §9: *"Scotland. The full parentage resolution from the assembled dossier, the St Pol endgame, family
> restored, the bank's final shape chosen by the player: Scottish landed house, Venetian bank, or
> dissolution into legacy. Epilogue screen prices the whole campaign: net worth, people kept,
> Conscience, secrets never sold."*

**Historical spine, verified:**

| Beat | Date |
|---|---|
| Treaty of Fotheringhay — Albany declares himself king, swears to Edward IV | **11 June 1482** |
| Lauder Bridge coup — James III seized, Cochrane and five advisors hanged | **22 July 1482** |
| Gloucester crosses the border | late July 1482 |
| Berwick castle surrenders — English ever since | **24 August 1482** |

A Scottish political collapse is the right ground for the endgame: the house holds a burgh customs
contract and Scottish deposits from Chapters 5 and 6, and the crisis reprices all of it while the
personal plot resolves. The player's own Scottish standing — earned with a counterweighted angel in
Chapter 6 — is what is at stake.

**No new cities.** Edinburgh exists. This chapter is resolution, not expansion, and adding map is the
wrong instinct for a finale.

**Three pieces of genuinely new machinery**, and they are the reason Chapter 8 is a bigger build than
Chapter 7 despite having less content:

1. **The dossier resolution.** `sim/dossier.ts` gains a resolution read: given the parentage track's
   contents, produce the answer at the confidence the evidence supports. Scales, never gates (§2.2).
2. **The bank's final shape.** A three-way terminal choice — Scottish landed house / Venetian bank /
   dissolution into legacy — each with its own epilogue text and its own reading of the same numbers.
   Mechanically a flag, but it is the first choice in the game that closes rather than opens.
3. **The epilogue screen.** *"Prices the whole campaign: net worth, people kept, Conscience, secrets
   never sold."* This is the one place a net-worth figure belongs — Phase 15 explicitly rejected an
   ambient wealth readout on the grounds that a permanently visible number becomes a de facto score,
   and explicitly deferred the real number **to this screen**. Building it here honours that decision
   rather than reversing it. `aiNetWorth`'s valuation logic in `sim/aiTrader.ts` can be reused for the
   assets half.

**Threads (5):** the return to Scotland and the crisis of 1482 → the St Pol endgame (branching on
`vatachino_named`, per §2.4) → the parentage resolution → family restored → the bank's final shape.
The finale is not a flag that unfreezes the next chapter; it is the end of the campaign.

---

## 5. The one deviation this plan recommends

The owner's stated order was: **finish the chapters, then warehousing / market events / AI.** This plan
follows that with a single exception, and it is worth being explicit about why.

**Cycling market events should be built before Chapter 7, not after.** Chapter 7's headline beat —
Charles the Bold's death repricing every Flanders position — needs a demand layer over `priceAt` that
persists rather than being mean-reverted away by `driftScarcity` within a few weeks. That is precisely
what Part 3 of `freeplay-and-trading-design.md` already specs, down to the `PriceCauseKind:
'demand_shift'` hook that makes the existing Phase 16 narration explain it for free.

The alternative is a bespoke one-off shock effect for Chapter 7, then building the general system
afterwards anyway — the same machinery twice, with the chapter's own version left as a special case.

It also happens to deliver the "more dynamic gameplay" ask early rather than last.

**If you'd rather keep chapters strictly first**, say so and Chapter 7's shock becomes a scripted
`EventEffects.marketShock` — perhaps a day's work, at the cost of a special case to retire later.

---

## 6. Recommended sequence

| Phase | What | Size | Why here |
|---|---|---|---|
| **22** | **Remediation** — Marian's scripted death; guarantee dossier pieces on the Ch7/Ch8 spine; wire `vatachino_named` forward | small | Chapter 8's ending reads wrong without it, and it is cheapest before more content lands on top |
| **23** | **Cycling market events** | medium | Chapter 7 needs the demand layer (§5); also the "dynamic gameplay" ask |
| **24** | **Chapter 7 — Caprice and Rondo** | large | 2 cities, 1 currency, exile, the Caffa extraction, the Burgundy shock |
| **25** | **Chapter 8 — Gemini** + epilogue | large | dossier resolution, three endings, the campaign's actual end |
| — | *campaign complete — all eight novels playable* | | |
| **26** | **City warehousing** | medium | no longer blocking anything; a pure trading improvement |
| **27** | **Free-play mode + AI rivals**, then the campaign rival toggle | medium | engine already built and driver-verified; mostly wiring, lobby and standings |
| **28** | **Fleet growth** (shipyards, vessel classes) — *optional* | medium | must settle the `vesselIdAt` question (§2.3) in the same change |

**Rough shape:** four phases to a finished campaign, then three to finish the systems backlog. Each
phase ends playable and committed, as every phase since Phase 0 has.

---

## 7. Risks worth naming now

- **Chapter 8 is a different kind of build.** Chapters 1–7 add content to a running game; Chapter 8
  has to *close* one. Endings expose every loose thread at once — expect the verification pass to find
  more than a normal chapter's worth, and budget for it.
- **The dossier scaling must be play-tested, not just driver-tested.** "Resolves differently at
  different evidence levels" is easy to assert and hard to make *feel* different. Worth a live pass at
  both extremes: empty board and full board.
- **The 1482 Scottish crisis is a lot of history for one chapter.** Fotheringhay, Lauder Bridge,
  Berwick and the personal plot all landing together risks the finale reading as a history lecture.
  Prefer fewer beats carrying more weight.
- **Relative deadlines everywhere.** Both chapters must use `weeksAfterFlag`, never `dateAfter` — the
  clock is continuous and by Chapter 7 a campaign could be anywhere between week 150 and week 600.
  This is a solved problem as of Phase 19; it just has to be remembered.
- **The other workstream.** A concurrent session owns `freeplay-and-trading-design.md`'s Parts 1–4 and
  has been actively committing (admin panel, portal work, the world-chart map rewrite). Phases 23, 26
  and 27 all touch its territory — worth confirming who builds what before starting 23.
