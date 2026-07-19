# BANCO DI NICCOLO
## Game design and build specification
### Personal project. Private use only. Never to be distributed, published, hosted publicly, or sold.

---

## 0. INSTRUCTIONS TO CLAUDE CODE

You are building a single-player strategy game adapting Dorothy Dunnett's House of Niccolo series (8 novels, 1460 to 1483). This is a private, non-commercial project for the owner's personal use. Character names, plot events, and story structure from the novels are used deliberately and knowingly.

Before writing any new code:

1. Audit the existing Thrash Margin codebase. Produce a report identifying:
   - The game loop / tick system and whether it is decoupled from Thrash Margin rules
   - The map representation (is it a node graph, grid, or region system)
   - The AI opponent framework and how decisions are evaluated
   - Save/load, settings, and UI shell code
   - Anything hard-coded to territory-control mechanics
2. Classify every module as REUSE (theme-agnostic), ADAPT (needs generalisation), or IGNORE (territory-specific).
3. If the simulation core and content are entangled, do not force reuse. Build this game as a sibling app in the same repo (monorepo layout below) sharing only the genuinely clean modules. Tell the owner which situation you found.

Proposed repo layout:

```
/packages
  /engine          shared: clock, event bus, save system, RNG, node-graph map, pathfinding
  /ui-kit          shared: panels, tables, tooltips, map renderer shell
  /thrash-margin   existing game
  /niccolo         this game
    /src
      /sim         economy, credit, information, characters
      /content     data files: cities, goods, characters, events, chapters
      /scenes      UI screens
```

Build in the same language and framework as Thrash Margin. If Thrash Margin is web-based (TypeScript/React or similar), stay there. All content lives in data files (JSON), never in code, so the owner can edit story events without touching logic.

Work through the build phases in Section 12 in order. Each phase must end with a playable state.

---

## 1. GAME OVERVIEW

Title: Banco di Niccolo
Genre: Single-player trading, banking and intelligence strategy with a scripted narrative campaign
Structure: 8 chapters, one per novel, playing 1460 to 1483
Player role: Nicholas (Claes vander Poele, later Nicholas de Fleury), from dyeworks apprentice in Bruges to head of an international bank
Session shape: Turn-based. One turn = one week. Roughly 40 to 80 turns per chapter.

Design pillars:

1. Money is mostly paper. Wealth lives in bills of exchange, loans, cargoes in transit and standing contracts, not in a gold counter. Cash-on-hand is a small, dangerous number.
2. Information is a commodity. Every fact has an age, a source and a reliability. The player who knows first, acts first.
3. Victories cost more than defeats. The scripted personal plot (the St Pol vendetta, the marriages, the parentage mystery) interrupts and wrecks commercial positions at fixed points, exactly as in the novels. The player cannot prevent these events, only position for them.
4. History is the deadline. Real events (fall of Trebizond 1461, Tolfa alum 1462, Cyprus war, death of Charles the Bold 1477) happen on schedule regardless of the player. Chapters are races against dates.

---

## 2. TIME AND CAMPAIGN STRUCTURE

- Clock: weekly turns, displayed as a real date (e.g. Week of 14 March 1460).
- Calendar drives everything: sailing seasons (Alpine passes close in winter, Atlantic convoys are seasonal), fair cycles (Geneva, Antwerp, Bruges), bill maturities, scripted events.
- Each chapter has: a start state, a set of commercial objectives (soft), a scripted narrative spine (hard, fires on date or trigger), and an exit event that transitions to the next chapter.
- Failure state: insolvency (unable to meet a matured obligation and no rescue option taken) or death of Nicholas. Chapter can be restarted.

---

## 3. THE MAP

Node graph, not territory. Reuse Thrash Margin's graph if its map is graph-shaped underneath.

Nodes (cities) minimum set, added progressively by chapter:

Bruges, Ghent, Antwerp, Calais, London, Edinburgh, Dean/Leith, Paris, Geneva, Lyon, Dijon, Milan, Genoa, Florence, Venice, Rome, Naples, Ancona, Ragusa, Constantinople (Pera), Trebizond, Modon, Rhodes, Chios, Famagusta, Nicosia, Kouklia, Alexandria, Cairo, Damietta, Sinai (St Catherine), Ceuta, Lagos (Portugal), Lisbon, Madeira, Arguim, The Gambia (river stations), Timbuktu, Reykjavik/Iceland stations, Danzig, Thorn, Cracow, Caffa, Tabriz.

Node data model:

```json
{
  "id": "bruges",
  "name": "Bruges",
  "region": "flanders",
  "power": "burgundy",
  "market": { "size": 5, "goods": {"dyes": {"base": 100}, "cloth": {"base": 80}} },
  "hasBranchSlot": true,
  "port": true
}
```

Edges: land or sea routes with distance in weeks, seasonal availability, and a risk profile (piracy, war, weather). Route risk is dynamic: war events raise it, escorts lower it.

---

## 4. TRADE SYSTEM

Goods (initial set): woad, madder, alum, kermes, cloth (Flemish), silk, wool (English/Scottish), sugar, wine, salt, spices, glass, paper, weapons/armour, horses, gold, ivory, malaguetta pepper, fish (stockfish), furs, slaves are present in the historical economy but are NOT tradeable by the player; scripted events reference the trade (Loppe/Umar storyline) without a market mechanic.

Price model per city per good:

```
price = base * scarcity * eventModifier * noise
```

- Scarcity drifts with simulated supply flows between nodes.
- Event modifiers come from the news system (war closes a route, a fleet arrives, Tolfa discovery collapses the value of Ottoman alum knowledge).
- Critical rule: the player sees the price a city had as of the newest information they hold about that city, not the live price. Acting on stale prices is the core risk.

> **Phase 3 implementation, confirmed 2026-07-19:** "simulated supply flows between nodes" is implemented as a small random weekly nudge (±0.08) to each city-good's scarcity, applied independently of the player's own trades (`applyBackgroundFlows` in `packages/niccolo/src/sim/market.ts`). This is what makes a stale report capable of being wrong — without it, nothing but the player's own buying and selling ever moved a price, so a report about a city the player hadn't traded in would always still be true on arrival. The magnitude is a placeholder pending a feel-check once Chapter 1's content pack (Phase 7) is in place.

Logistics:
- Ships (round ship, galley, caravel later) and land caravans. Capacity, speed, crew, escort.
- Cargo in transit is capital at risk. Insurance is purchasable in Bruges/Venice/Genoa at a premium that reflects the insurer's information, not the player's.

---

## 5. CREDIT AND BANKING

This is the heart of the game. Model these instruments:

1. Bill of exchange: pay X in currency A at city P now, receive Y in currency B at city Q on date D. Interest is hidden in the exchange spread (usury doctrine). Bills are the main way to move money and to lend.
2. Deposit accounts: powers and merchants deposit with the bank at a fixed discretion payment. Deposits are cheap capital and a loyalty mechanic; a run is possible if reputation collapses.
3. Loans out: to princes (high margin, may default politically), to merchants (secured on cargo), to the player's own ventures.
4. Condotta contracts: Astorre's mercenary company is an asset. Contracts pay a retainer plus campaign bonuses, and can be sub-brokered.
5. Branch network: opening a branch (Bruges, Venice, Florence, Milan, Cyprus, Alexandria, Edinburgh...) requires a licensed manager character, capital, and local goodwill. Branches enable local bills, deposits, and better information.

Balance sheet UI is a first-class screen: assets (cash by branch and currency, bills receivable, cargoes at last-known value, loans out, property, the company itself), liabilities (bills payable, deposits, loans in), and a maturity ladder showing every obligation by week. The maturity ladder is the tension instrument: the player must always see the next 12 weeks of cash demands.

Currencies: Flemish groot, Venetian ducat, Florentine florin, écu, Scottish/English pounds, Ottoman/Mamluk coin. Exchange rates drift; branches quote spreads.

> **Phase 4 implementation, confirmed 2026-07-19:** the currency set is 5, not 6 — florin (home ledger + Florence), groot (Burgundy/Flanders), pound (England), écu (Savoy/France/Milan/Genoa), ducat (Venice) — grouped by the existing `City.power` field rather than arbitrarily, since the Chapter-1 map has no city yet that would use Scottish pounds or Ottoman/Mamluk coin. Cash stays a single florin balance; multi-currency exposure lives in the credit instruments (a bill denominated in a foreign currency), not in a multi-wallet cash system, so Phase 2/3's trade code is untouched. Exchange rates peg near 1 (simplified money-of-account values, not literal mint weights) and random-walk weekly with mean reversion toward par, mirroring the existing scarcity-drift pattern — real FX risk on a bill's eventual florin cost, confirmed live when a bill's settlement rate differed from its issue rate. "Branches quote spreads" is deferred with the branch network itself (see below).
>
> Bills of exchange can be written or accepted at any city on the map right now — no branch gating — since the branch network below is Phase 5+ content gated behind a manager character; Phase 5 tightens this once branches exist, rather than removing a workaround later. Deposits and loans out are abstracted (no named depositors/princes/merchants) for the same reason — those are Phase 5 (characters) / Phase 8 (AI houses) content; the mechanics (cheap deposit capital, safe merchant loans vs. risky prince loans with a real default chance) are real now, the flavour text attaches names later.
>
> Insolvency sequence: missed obligation triggers a protest, reputation damage, forced asset sales at haircuts, then rescue options (Medici support if relationship is strong, marriage capital, selling a branch) before game over.
>
> **Phase 4 implementation, confirmed 2026-07-19:** the rescue-option roster above (Medici support, marriage capital, branch sale) all depend on systems that don't exist until Phase 5 (characters, branches) or Phase 8 (AI houses). Rather than invent a stand-in rescue lever, Phase 4's insolvency is binary: a missed obligation forces a sale of any *docked* vessel's cargo at a 70% haircut (cargo under way is illiquid — it can't be reached in time), and if that still doesn't cover the shortfall, the campaign ends and can be restarted. This matches the design doc's own stated failure state and the scope discipline already established in Phase 3 (no invented stand-ins for content that isn't built yet). The real rescue options arrive naturally as reputation, Medici relations, marriage, and branches land in later phases.

---

## 6. INFORMATION SYSTEM

Every remote fact reaches the player as a News Item:

```json
{
  "id": "n_1043",
  "subject": "trebizond",
  "content": "Ottoman fleet massing at Constantinople",
  "trueAsOf": "1461-05-02",
  "receivedOn": "1461-06-13",
  "source": "venetian_captain",
  "reliability": 0.7,
  "isTrue": true
}
```

- The world simulation runs on true state; the player interface renders only received news. Prices, wars, deaths, arrivals: all mediated.
- Couriers: the player builds a dispatch network (riders, pigeon posts on key legs, fast galleys). Investment shortens latency city by city. This is the Charetty courier business from Book 1 and remains the player's edge all game.

> **Phase 3 implementation, confirmed 2026-07-19:** report latency is shortest-path over *every* route from Bruges, land or sea — "fast galleys" above already implies correspondence rides sea legs too, not just land riders. This is deliberately broader than Phase 1's single dispatch-rider unit, which stays land-only for its own physical travel; the two are different things (a courier network sending letters vs. one vessel object moving on the map). Without sea legs counting, London would have no all-land path from Bruges at all (Calais–London is sea-only) and could never receive news. Courier investment (`INVEST_COURIER`) shaves one week off a city's latency per level, floored at 1 week — a report can never beat an actual courier's travel time.
- Agents: placed in cities or inside rival houses (Doria, Vatachino, St Pol interests). Agents raise reliability, surface secrets, and can plant false news. Counter-intelligence: rivals do the same to the player; some incoming news is planted.
- Secrets: a special asset class. The alum secret (knowledge that papal Tolfa deposits will destroy the value of the Ottoman alum trade, and earlier, the concealed Cyprus/Phocea positions) is held knowledge with an explicit value and a set of buyers, uses and expiry conditions. Selling, exploiting, or sitting on a secret are all moves. Chapter scripts create 2 to 3 secrets each.
- Ciphers: dispatches can be encrypted. Rival interception of unencrypted dispatches leaks player intentions to AI houses.

---

## 7. CHARACTERS AND HOUSEHOLD

Named characters are officers with skills, salary, loyalty, location and a personal arc. Core roster (join dates per chapter script):

- Marian de Charetty: owner, then wife, then the company's founding legacy. Chapter 1 anchor.
- Julius: notary. Legal, contracts, occasionally reckless.
- Tobias (Tobie) Beventini: physician. Crew health, plague response, insight into people.
- Father Godscalc: chaplain. Conscience mechanic: certain profitable actions (weapons to certain buyers, exploiting the vulnerable) cost Conscience, which affects Godscalc/Tobie loyalty and unlocks or locks story branches.
- Gregorio of Asti: lawyer, later Venice branch manager. Enables the bank's legal structures.
- Astorre (Syrus de Astariis): condottiere. The company of lances as an asset.
- Loppe (Lopez), later Umar: from Book 1 through the Timbuktu arc. Handled with the seriousness the novels give him; adviser and later scholar, with the Gambia chapter built around his story.
- Diniz Vasquez, Gelis van Borselen, Katelina van Borselen, Margot, Crackbene (shipmaster), John le Grant (engineer), Moriz, Govaerts, and chapter-specific cast (Pagano Doria, Zacco, Carlotta, Anselm Adorne and Kathi, Jordan de Ribérac, Simon de St Pol, Henry, Jodi, Kateřina/Contessina as needed).

Character data model:

```json
{
  "id": "julius",
  "name": "Julius",
  "role": "notary",
  "skills": {"law": 4, "trade": 2, "combat": 1, "intrigue": 2},
  "loyalty": 70,
  "location": "bruges",
  "status": "active",
  "arcFlags": []
}
```

Assignment loop: each turn, officers can be posted (manage branch, lead venture, negotiate, investigate). Story events check who is present; sending Tobie to Trebizond matters when plague hits.

Deaths and departures are scripted where the novels script them and are not preventable. Marian, Katelina, Godscalc, Umar: the game does not allow the player to save them. This is pillar 3.

> **Phase 5 implementation, confirmed 2026-07-19:** the Chapter 1 roster is seeded at campaign start — Marian, Julius, Tobie, Godscalc, Gregorio, Astorre — rather than waiting on the join-date scripting this paragraph describes, since that scripting is Phase 6 (event engine) content that doesn't exist yet. All six are already with the company in the earliest chapters of Book 1; the chapter-script arrival/departure dates for characters who join later are deferred to Phase 6/7 rather than approximated now.
>
> The assignment loop (§7's "manage branch, lead venture, negotiate, investigate") is implemented against systems that already exist, not invented ones: `manage branch` is skipped entirely (no branch network yet — that's still gated behind a manager character per §5, itself Phase 8+ content); `lead venture` became **aboard** a vessel (a trade-skill discount on that vessel's buy/sell prices); `negotiate` became a law-skill discount on the credit spread/rate for bills, deposits, and loans written at that city; `investigate` became an intrigue-skill cut to that city's news latency, stacking with paid courier investment (Phase 3). One assignment at a time, no travel time to take it up — this is an abstraction the rest of the sim is already pitched at (bills can be written anywhere, prices are known instantly at the vessel's own location).
>
> **Loyalty and departure**, confirmed as a new mechanic distinct from the scripted deaths in the paragraph above: officers draw a weekly salary from cash, resolved alongside the maturity ladder each `ADVANCE_WEEK`. If total wages are affordable, everyone active gets paid in full and loyalty ticks up; if not, nobody is paid (there is no partial pay and no back-pay debt added to the ladder) and loyalty drops hard for everyone active. A character whose loyalty reaches zero leaves the company for good. This is *not* the scripted, unpreventable death/departure this section describes for Marian/Katelina/Godscalc/Umar — it's a new, generic consequence of neglecting the household, the Phase 5 equivalent of Phase 4's insolvency check. The scripted departures remain untouched and arrive with the event engine (Phase 6) and Chapter content packs (Phase 7+).
>
> **Conscience**, confirmed as a single 0–100 meter starting clean at 100 (§8's "certain profitable actions ... cost Conscience"): the only wired trigger in Phase 5 is writing a prince loan (§5's "high margin, may default politically" already frames it as ethically fraught, and it's the one existing mechanic that fits without inventing new tradeable goods or events ahead of schedule). Writing one costs 5 Conscience and 3 loyalty each for Godscalc and Tobie specifically, matching this section's own sentence almost verbatim ("affects Godscalc/Tobie loyalty") rather than a broader role-based rule. Weapons-to-bad-buyers and similar triggers from §8 arrive with the goods and events that make them real (Phase 6/7+).

---

## 8. THE PERSONAL PLOT LAYER

Implemented as a scripted event system, data-driven:

```json
{
  "id": "ev_c1_014",
  "chapter": 1,
  "trigger": {"dateAfter": "1460-06-01", "location": "bruges", "flag": "met_simon"},
  "title": "The dog and the canal",
  "body": "...",
  "choices": [
    {"text": "Answer with a joke", "effects": {"flag": "simon_humiliated", "rep.stpol": -10}},
    {"text": "Stay silent", "effects": {"conscience": +1}}
  ]
}
```

Persistent tracks:

1. The St Pol vendetta. Simon de St Pol and Jordan de Ribérac as recurring antagonists. A Vendetta score rises with each exchange; certain thresholds fire ambushes, lawsuits, trade sabotage, and the scripted set pieces (the shipyard, Madeira, the African voyage collision, the Scotland confrontations, through to Gemini's resolution).
2. The parentage mystery. A hidden dossier the player assembles across all 8 chapters: documents, testimony, dates. UI is an evidence board. The resolution follows the novels' answer and fires in Chapter 8.
3. Marriages and family. Marian (Ch1), Katelina thread (Ch1 to 3), Gelis (Ch4 onward): the wager-marriage, the withheld child, Jodi. Gelis in Chapters 5 to 7 functions as the most capable rival intelligence operator in the game, run by the AI against the player's own bank, before the reconciliation arc.
4. The divining gift. Nicholas's dowsing/scrying from the novels is in: a limited-use ability (find water/ore, sense a person's direction) with a Conscience and health cost, unlocking specific story branches (Sinai, the mines, the search scenes).

Chapter transitions replicate the novels' pattern: each chapter ends with a commercial triumph immediately taxed by a personal catastrophe, and the next chapter opens with the player rebuilding.

> **Phase 6 implementation, confirmed 2026-07-19:** the event data model above is built almost verbatim — `id`, `chapter`, `trigger` (`dateAfter`/`location`/`flag`, AND-combined), `title`, `body`, `choices[].{text, effects}` — as `ScriptedEvent` in `packages/niccolo/src/sim/types.ts`, with content authored as JSON (`packages/niccolo/src/content/events/chapter1.json`), never in code, per §0's own rule. Two scope points not spelled out above:
>
> Effects are limited to what already exists in the sim — `flag` (sets a flag permanently), `cash` (delta to the florin balance), `conscience` (delta, clamped 0-100) — not the `rep.stpol`-style house-reputation effect this section's own example shows. Reputation-with-a-house has no home to live in until AI houses exist (Phase 8); inventing a `rep` bag now would mean either a dead stat or a second, competing reputation system once Phase 8 lands. The 10 test events (`ev_c1_001` through `ev_c1_010`) exercise `flag` and `cash` and `conscience` and two deliberate flag-gated chains (`refused_shortcut` → `reputation_probity`, `dockside_tip` → `tip_paid_off`) to prove chaining works, not to narrate Chapter 1 itself — that's Phase 7's content pack.
>
> Triggers are evaluated once per `ADVANCE_WEEK` (and once at campaign start, for anything satisfiable at week 0), not the instant a flag is set. A choice made this week that satisfies another event's `flag` trigger surfaces that event on the *next* week's tick, not immediately — turns are weekly, so this reads as the natural grain rather than a same-tick chain reaction. A fired event never fires again; only one event is ever mid-decision at a time (a queue, oldest first), and while one is pending, `processAction` blocks every other action except `RESOLVE_EVENT` — mirroring the existing `insolvent` short-circuit in `sim/actions.ts` and matching pillar 3 (personal events interrupt commercial play, not run alongside it).

---

## 9. CHAPTER OUTLINES

Chapter 1: Niccolo Rising (1460 to 1462). Start as apprentice with 0 capital and 3 friendships. Playable arcs: run dye jobs and pawnbroking for the Charetty widow, build the courier round (Bruges, Geneva, Milan), broker Astorre's Naples condotta, the cannon shipment, the ostrich errand as a light quest, the Medici relationship, discovery of the alum secret, marriage to Marian, first blood with Simon and Jordan, Felix's fate at the joust/war. Exit: partnership converted, company survives, personal cost paid.

Chapter 2: The Spring of the Ram (1461). The Florentine agency to Trebizond. Race Pagano Doria (AI house with its own ship, charm offensive and sabotage), the boy Diniz thread adapted, trade silk at the Trebizond market, navigate Emperor David's court, then the extraction under deadline: Mehmet's army arrives on the historical schedule; objective is people, capital and cargo out before the fall. Score is what survives.

Chapter 3: Race of Scorpions (1462 to 1464). Cyprus. Choose or be forced between Zacco and Carlotta; sugar estates at Kouklia as the first production asset (plant, harvest, refine, ship); the Mamluk siege of Famagusta; Katelina's end there as scripted. Exit with a Cyprus branch and a scar.

Chapter 4: Scales of Gold (1464 to 1468). Venice under debt pressure, then Lisbon, Madeira (the St Pol collision), and the Gambia voyage: river navigation, disease clock, Timbuktu, the gold and the learning, Umar's choice. Gelis wager and marriage closes the chapter with its trap.

Chapter 5: The Unicorn Hunt (1468 to 1471). Scotland (James III's court, the Boyd tangle), the hunt for the child, Egypt and Sinai, divining unlocked fully, the Vatachino emerge as the masked rival company (AI house whose backers are a mystery the intelligence system can unmask early or late).

Chapter 6: To Lie with Lions (1471 to 1473). The Iceland venture (stockfish, the volcano, the sea battle) as the great logistics set piece; the Nativity play in Scotland as a reputation set piece; the Burgundy trap tightens; ends with the catastrophe at Volterra-adjacent scale for the bank as scripted, and Godscalc's loss earlier honoured.

Chapter 7: Caprice and Rondo (1474 to 1477). Exile winter in Danzig/Poland, the Caffa mission as the Black Sea closes, Persia and Uzum Hasan, the Ochoa gold thread, Jordan revelations, and the slow turn home. Charles the Bold dies on schedule January 1477 and the Burgundian financial world convulses: every player position in Flanders reprices.

Chapter 8: Gemini (1477 to 1483). Scotland. The full parentage resolution from the assembled dossier, the St Pol endgame, family restored, the bank's final shape chosen by the player: Scottish landed house, Venetian bank, or dissolution into legacy. Epilogue screen prices the whole campaign: net worth, people kept, Conscience, secrets never sold.

Each chapter ships as a content pack: cities activated, goods, characters, 25 to 40 scripted events, 2 to 3 secrets, 1 extraction or logistics set piece, exit conditions.

---

## 10. AI OPPONENT HOUSES

Reuse or adapt Thrash Margin's AI evaluation framework. Houses: the Medici (mostly ally, sometimes rival), Doria interests, the Vatachino (hidden ownership), the St Pol/Ribérac trading interests, Anselm Adorne's house (rival-friend, the most humanly complicated), plus generic Venetian and Genoese houses. Each house runs the same systems as the player (trade, bills, agents) at reduced fidelity, plus scripted behaviours from chapter files.

---

## 11. UI SCREENS

1. Map (node graph, routes, own assets, fog by information age)
2. Ledger (balance sheet, maturity ladder, currency positions)
3. Counting house (bills: write, accept, discount, protest)
4. Dispatches (news feed with age/reliability, courier network management)
5. Household (characters, assignments, loyalty)
6. Venture planner (compose an expedition: ship, cargo, crew, route, insurance)
7. Evidence board (parentage dossier, Vatachino unmasking, chapter secrets)
8. Event overlay (scripted scenes with choices)

Aesthetic direction for later: manuscript and counting-house, ink on paper, red wax accents, no fantasy chrome. Read /mnt/skills/public/frontend-design/SKILL.md before building UI.

---

## 12. BUILD PHASES

Phase 0: Audit Thrash Margin, produce the REUSE/ADAPT/IGNORE report, set up monorepo, extract shared engine modules only if clean. Deliverable: report plus empty running niccolo app shell.

Phase 1: Clock, map graph with 12 Chapter-1 cities, movement of one ship and one courier, save/load. Playable: sail Bruges to Venice and watch weeks pass.

Phase 2: Trade core. Goods, local prices, buy/sell, cargo, price drift. Playable: profitable triangle run.

Phase 3: Information layer. News items, latency, stale prices, courier investment. This inverts Phase 2: hide live prices behind received news. Playable: lose money on stale information, then fix it with couriers.

Phase 4: Credit. Bills of exchange, maturity ladder, deposits, loans, insolvency sequence, multi-currency. Playable: leverage a venture and survive the ladder.

Phase 5: Characters and assignments. Roster, skills, postings, loyalty, Conscience.

Phase 6: Event engine. Data-driven triggers, choices, effects, flags. Author 10 test events.

Phase 7: Chapter 1 content pack complete: full Niccolo Rising arc, Bruges start to partnership end. First real playthrough.

Phase 8: AI houses v1 (Medici, St Pol interests, one Genoese) plus agents and counter-intelligence.

Phase 9 onward: one chapter content pack per phase, adding systems as chapters demand them (production assets in Ch3, expedition/disease clock in Ch4, evidence board full UI in Ch5, mass logistics in Ch6).

Rule for every phase: content in JSON, logic in code, and the owner must be able to open the game and play the new slice unaided.

---

## 13. CONTENT AUTHORING NOTES FOR CLAUDE CODE

- Write all scripted event prose in original words. Summarise and dramatise the novels' incidents; never reproduce Dunnett's sentences. The owner holds the books; the game should evoke, not transcribe.
- Historical events (Trebizond 1461, Tolfa 1462, Famagusta siege, Charles the Bold's death January 1477, Scottish court politics) should be dated accurately; check dates during authoring rather than guessing.
- Tone: dry, precise, adult. Humour through understatement. No modern idiom in event text.
- Numbers should feel period-real: prices in groots and ducats, a dyeworks job worth tens, a condotta worth thousands, the Trebizond cargo worth a fortune.

## 14. SCOPE CONTROL

Chapters 1 to 3 are the game. Build those to full quality before any Chapter 4+ content. If only Chapter 1 ever exists at high polish, the project has succeeded. Do not scaffold all 8 chapters thinly.
