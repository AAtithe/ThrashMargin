# NICCOLÒ RISING
## Game design and build specification
### Personal project. Private use only. Never to be distributed, published, hosted publicly, or sold.

---

## 0. What this is

A persistent, real-time, text-and-panel RPG in the shape of *Torn*, set in the world of Dorothy
Dunnett's House of Niccolò (Bruges, 1460 onwards). Where *Banco di Niccolò* puts the player at the
head of a bank and moves the world a week per turn, *Niccolò Rising* puts them in the street as a
nobody with a name, and moves the world in **real time**: bars refill while you are away, a course at
Louvain takes hours of wall-clock time, a journey to Trebizond is a journey you come back to.

It is a sibling app in the monorepo (`packages/niccolo-rising`), served at `/rising/`, sharing the
portal's account system, the `games` table (`game = 'niccolo_rising'`) and the visual palette. It
reuses Banco di Niccolò's world (cities, goods, houses, cast) as content, not as code: the two
simulations are different shapes and are not entangled.

Name: *Niccolò Rising* is the first novel's title, and the arc of the game is that novel's arc: the
dyeworks apprentice who becomes someone the city cannot ignore.

---

## 1. Design pillars

1. **Time is the resource.** Every meaningful verb spends something that only time gives back:
   Energy, Nerve, a course's hours, a voyage's length, a spell in the Steen. The game is played in
   short sessions spread across a day, which is the Torn rhythm.
2. **Build, then spend.** Battle stats are trained, never bought. Schemes grow the skill that makes
   the next scheme pay. Courses unlock verbs rather than numbers where they can.
3. **Claes's city.** Content comes from the novels: the Charetty dyeworks, Astorre's company, the
   Medici branch, the Steen, the St Pol vendetta, the alum and the silk. The flavour text carries the
   world; the mechanics stay readable.
4. **Pure and replayable.** The simulation is a pure reducer over a persisted seed and caller-supplied
   timestamps, exactly as Tea Race's is (portal invariant 2). A driver script can play months of
   compressed real time in seconds and assert on every step.

---

## 2. The character

| Group | Fields | Torn equivalent |
|---|---|---|
| Bars | Energy, Nerve, Spirits, Health | Energy, Nerve, Happy, Life |
| Battle stats | Strength, Defence, Speed, Dexterity | identical |
| Working stats | Craft, Wit, Stamina | Manual labour, Intelligence, Endurance |
| Progress | Level, Experience, Standing | Level, EXP, Respect |
| Purse | Groats in hand, a Medici deposit | Money, bank investment |
| Status | Free, Infirmary, Steen, Travelling, Abroad | Okay, Hospital, Jail, Travelling, Abroad |

**Bars regenerate by the clock.** Each bar holds `current`, `max` and an anchor timestamp; the reducer
adds whole regeneration ticks since the anchor and moves the anchor forward by exactly those ticks,
so a bar never drifts or double-counts across saves. A bar at or above maximum does not tick, and
items may push it over its maximum (Torn's overflow), where it stays until spent.

| Bar | Max | Regen |
|---|---|---|
| Energy | 100 | 5 every 10 minutes |
| Nerve | 10 at level 1, +1 per 2 levels (cap 60) | 1 every 5 minutes |
| Spirits | from lodging (100 to 2,500) | 5 every 15 minutes |
| Health | 100 + 25 per level | 6% of max every 5 minutes |

All tunables live in `content/config.json`.

---

## 3. Places and verbs

The left rail lists the places. Each is one panel.

### 3.1 The training yard (gym)
Spend Energy to raise one battle stat. Four yards, unlocked by level, each with its own energy per
train and quality ("dots"). Gain per train:

```
gain = dots × (1 + spirits / 1500) × 4 / (1 + log10(1 + stat / 50)) × perks
```

then `spirits -= floor(energy × 0.5)`. Spirits therefore matter (eat, drink, live somewhere better
before a session) and stats taper rather than stop. Yards: Astorre's drill yard behind the Charetty
works, the Bruges fencing school, the Duke's archers' butts, and the Burgundian tiltyard.

### 3.2 Schemes (crimes)
Spend Nerve on a scheme. Each has a nerve cost, a difficulty, a payout range, and an outcome table:
success, a clean failure, caught (the Steen), or hurt (the Infirmary). The chance of success rises
with the player's **scheme skill** (a single number gained by attempting, more by succeeding) and
with course perks. Schemes are drawn from the novels: Claes's practical jokes, cardsharping in the
inns, lifting a purse at the Waterhalle, running Spanish alum past the toll, forging a bill on a
Medici factor, reading a cipher letter that is not yours. Some need a completed course.

### 3.3 Work (jobs)
Four employers, each a ladder of ranks with working-stat requirements: the Charetty dyeworks
(Craft), the Medici branch (Wit), the notary Julius (Wit and Stamina), Astorre's company (Stamina
and Craft). A job pays once per elapsed real day and adds working stats daily, as Torn's city jobs
do. Promotion is a deliberate verb that checks the next rank's requirements.

### 3.4 Schooling (education)
One course at a time, measured in real hours. Completing a course grants its perk permanently:
percentage boosts to gym gains, scheme success, travel speed, carrying capacity, infirmary time,
job pay; or unlocks schemes and destinations. Courses: Reckoning at the abacus school, Cipher,
Tuscan and Venetian, Seamanship, Swordsmanship under Astorre, Law at Louvain, Physic under Tobie,
Dyeing and mordants, Greek, Arabic.

### 3.5 Travel
Real-time journeys out of Bruges to a dozen cities from the Niccolò map, from Ghent (15 minutes) to
Timbuktu (5 hours). While travelling the player can do nothing but wait (bars still refill).
Abroad, each city has a market of local goods with limited stock that restocks hourly; the player
can carry a limited number of items home (a pack mule's worth, raised by Seamanship and by buying
a better kit). Goods sell at the Bruges Waterhalle for a value that moves day to day. This is
Torn's flying-and-plushies loop, made into the Dunnett trade in alum, silk, spices and gold.

### 3.6 The Waterhalle (market and shops)
Buy consumables and kit; sell anything carried. Consumables: ale and Malmsey (Nerve), marchpane
and sugared almonds (Spirits), theriac and bandages (Health, and leave the Infirmary early), coffee
of the Turk (Energy, rare, from abroad only). Kit: weapons and armour that equip into two slots.

### 3.7 Lodging (property)
Lodging sets maximum Spirits. From a pallet in the dyeworks loft to a merchant's house on the
Spiegelrei. Bought once, kept forever, the best one owned is the one lived in.

### 3.8 Duels (attacks)
Spend 25 Energy to fight a named character. Combat is simulated to a conclusion in up to 25 rounds:
each round both sides strike in speed order; to-hit is speed against dexterity, damage is
strength-against-defence scaled by the weapon, reduced by armour. Win: groats, experience, standing,
and the opponent goes to the infirmary for an hour (cannot be fought). Lose: the player goes to the
Infirmary for a time proportional to the beating. Opponents run from street toughs to Simon de St
Pol and Jordan de Ribérac, the vicomte, whom nobody should fight early.

### 3.9 The Infirmary and the Steen
Status, not places to visit. In either, almost everything is barred until the timer runs. The
Infirmary can be shortened by theriac; the Steen by a bribe that scales with level.

### 3.10 The Medici counting house (bank)
One deposit at a time for a fixed term (1, 3 or 7 days) at a rate that rises with the term.
Withdrawable only at maturity. The interest is the only income that needs no bar.

### 3.11 Honours
Milestones (first scheme, first duel won, first voyage, a level, a fortune) logged in the
Chronicle. They are a record, not a currency.

### 3.12 Missions (Phase 5)
Thirteen missions in one unbroken chain, told from the first novel: the goose and the
burgomaster, Astorre's yard, the Scots at Sluys, the woad run to Ghent, the snowball that puts
Simon de St Pol in a fountain (and the player in the Infirmary for it), the Geneva courier run, the
Medici cipher, Felix leaving for the war, Spanish alum, silk from Florence, the news of Felix's
death, the marriage to Marian that makes Claes into Nicholas vander Poele, and finally beating
Simon in the street. All content in `content/missions.json`; the logic is `sim/missions.ts` plus
three verbs in `actions.ts`.

One mission in hand at a time, from whoever gives it in the story. Objectives come in two kinds.
**Counting** objectives (schemes, duels, training gains, arrivals) count only what happens after
accepting, as Torn's do; the reducer emits an event for each and the mission tracks it, capped at
the target. **Holding** objectives (goods, groats, a course, a post, a level, a working stat) are
read live and checked when the player reports back in Bruges; goods and groats are handed over
then. A mission may carry a deadline in real hours; if it passes, the mission fails and can be
taken up again from the start. Rewards are groats, experience, standing, items, lodging and
honours, and once a scripted consequence: Simon's men put the player in the Infirmary.

### 3.13 Houses (Phase 6)
Four houses, from the novels: Charetty (Marian), the Medici bank (Portinari), St Pol and Ribérac
(Jordan), and the Doria company (Pagano). Each has a level and standing to join, an entry fee, a
rival, five ranks, and four repeatable contracts. All content in `content/houses.json`.

- **Rank comes from favour**, and is derived rather than stored, so the two cannot disagree.
  Favour comes from contracts, from gifts (50 groats a favour), and from duel wins.
- **Perks** are the rank's totals, folded into the same perk sum courses use, so every existing verb
  picks them up with no new code. Two are new: Medici interest and a Doria discount abroad.
- **Dues** fall daily at the hour of joining. Three missed in a row and the house is done with you;
  no house will take you for 24 hours after leaving one, by choice or not.
- **Chains.** Duel wins each inside 30 minutes of the last build a chain: ×1.5 favour from 10,
  ×2 from 25, ×3 from 50. A win against the house's rival counts double.
- **Loyalty.** Members cannot fight their own house's people, unless their mission or contract
  names that person (see the build log for why that exception exists).
- **Contracts** are missions in miniature on the same objective machinery: one at a time, a
  cooldown between, deadlines on some. An event counts for the mission and the contract at once.

---

## 4. Architecture

- `src/sim/` is **pure**: no `Math.random`, no `Date.now()`. Every action carries `at` (ms). The
  reducer first advances the state to `at` (regeneration, arrivals, course completion, release,
  paydays, restocks) and then applies the verb.
- **An illegal action returns the same state object** (reference equality), discarding the advance
  as well. The save hooks use it to skip a write. A `TICK` that changes nothing also returns the
  same object, so the client can tick every minute without writing every minute.
- The UI renders through `advance(state, now)` as a selector, so countdowns and bars move every
  second without dispatching anything.
- Persistence: the portal's hybrid cloud/local hooks and a single Vercel function at
  `api/niccolo-rising/game` (list, create, load, save, delete), behind `getUser` like every other
  game. The client is authoritative, which is the same trust model the other four games have.

**What the client-authoritative model means here.** Torn is multiplayer and its server owns the
clock. This game is single-player and its client supplies the timestamp, so a player who edits
their own clock can cheat themselves. That is acceptable for a private single-player game and must
be revisited before any player-versus-player feature ships (see §6).

---

## 5. Build phases

| Phase | Content | Status |
|---|---|---|
| 1 | Package scaffold, sign-in gate, cloud and local saves, portal wiring | Done |
| 2 | Pure sim: bars, regen, gym, schemes, jobs, courses, travel, market, lodging, duels, infirmary, Steen, bank, honours | Done |
| 3 | Game screen: status rail with live bars, one panel per place, the Chronicle | Done |
| 4 | Driver: many seeds, months of compressed time, invariants and determinism | Done |
| 5 | Missions: a Dunnett story spine told as Torn-style missions (the first novel's arc) | Done |
| 6 | Houses (factions): join Charetty, Medici, St Pol or Doria; house perks and chain duels | Done |
| 7 | Player versus player: server-authoritative clock and combat resolution in the API | Not started |

---

## 6. Deferred, and why

- **Multiplayer.** Duels against other accounts' characters need the server to own time and
  resolve fights, otherwise a client could forge both. That is a different trust model from every
  other game in the portal and is a phase of its own.
- **A player market.** Torn's item market is between players; here the Waterhalle is an NPC market.
- **Stocks.** Banco di Niccolò already is the stock game.

---

## 7. Build log

### Phases 1 to 4, 2026-10-03
Initial build. Package, API (`api/niccolo-rising/game`, the portal's tenth Vercel function), sign-in
gate, pure sim, every place in §3, game screen and driver. `npm run drive:rising` from the root.

**What the driver checks.** After every action: shape, no non-finite numbers, integer bars, health
within [1, max], purse never negative, inventory and equipment referencing real items, experience
below the next threshold, log ordering. Across a game: an illegal action returns the same object and
`whyIllegal` agrees with `processAction` on every verb; a TICK twice at the same time returns the same
object; `advance()` and TICK agree; a whole game replays byte-identically; and advancing nine hours
in seven-minute steps reaches the same state as one step (log aside). Sixty fuzzed garbage actions
per game (NaN quantities, `__proto__` ids, unknown stats) must neither throw nor corrupt.

**A defect the driver caught on its first run.** Path independence failed on every seed: a bar
that filled part-way through a long absence kept counting ticks past full, so its anchor depended
on how often the player looked. Invisible in play until the bar was next spent, when the first tick
could land early. Fixed in `advanceDraft` by stopping the count at the tick that fills the bar.

**Balance, first pass.** 40 seeds, 30 simulated days, medians:

| Rhythm | Day 7 level | Day 30 level | Day 30 battle stats | Day 30 net worth | Courses by day 14 |
|---|---|---|---|---|---|
| Keen (every 2h) | 5 | 12 | 5,762 | 362,383 gr | 10 of 10 |
| Steady (4 a day) | 4 | 10 | 4,165 | 220,927 gr | 10 of 10 |
| Casual (twice a day) | 2 | 7 | 1,755 | 55,868 gr | 8 of 10 |

Two retunes before these numbers: abroad costs were 35 to 60% of home value (every trip roughly
doubled the money carried) and are now 50 to 72%, longer journeys keeping the wider margin; the bank
paid about 60% a month compounded and now pays about 12%. Course hours were multiplied by four.

**Open for the next tuning pass.** Trade remains the dominant income (about 60% of all groats
earned), and a keen player can afford the top lodging inside a month, after which money has nothing
left to buy. The fix is more sinks rather than a weaker trade loop: lodging upkeep, better kit
tiers, and the house dues Phase 6 brings. Courses are all done by day 14 for an active player,
which is faster than Torn's months; that is a content gap (more courses) more than a tuning one.

### Phase 5, missions, 2026-10-03
Built as §3.12 describes. A new `missions` field on the save; `migrateState` gives a character
created before Phase 5 an empty record, so it loads and starts the chain at the beginning whatever
its level. Checked in the browser by deleting the field from a real save and reloading it.

**What the driver adds.** Mission invariants after every action (no mission done before the one it
follows, progress never over target, holding objectives never counting); a content check that every
id a mission names exists, that the chain is one unbroken line, and that every item a mission asks
for is sold somewhere; the migration of a pre-Phase-5 save; the three new verbs in the fuzz; and a
bot that plays the story (keeps goods it must deliver, travels where the mission sends it, prefers
the opponent and the scheme the mission names). A table of how many characters finish each
mission within 30 days, and on which day, per play rhythm.

**A design fault the table caught on its first run.** The Geneva courier run had a 24-hour
deadline. A twice-a-day player needs three sessions for it (accept and set out; buy and sail home;
report back), which is exactly 24 hours, so it failed on the boundary every time and no casual
character ever got past it. Nothing in the code was wrong; the number was. Geneva is now 48 hours
and the Florence run 72. The rule worth keeping: **a deadline must fit the slowest rhythm the game
means to support, with a session to spare.**

**Where the story falls, 40 seeds, median day of completion:**

| Mission | Keen (every 2h) | Steady (4 a day) | Casual (twice a day) |
|---|---|---|---|
| The goose and the burgomaster | day 1 | day 1 | day 2 |
| Woad from Ghent | day 2 | day 3 | day 5 |
| Courier to Geneva | day 4 | day 7 | day 14 |
| Felix goes for a soldier | day 6 | day 8 | day 16 |
| Silk from Florence | day 8 | day 11 | day 23 |
| News from the south | day 10 | day 15 | day 28 (73% by day 30) |
| Marian | day 14 | day 19 | not within 30 days |
| The vendetta (Simon) | not within 30 days | not within 30 days | not within 30 days |

The first book takes two to three weeks of active play and most of a month of casual play, which
is the pace intended. Beating Simon is deliberately a long goal: at day 30 a keen character's
battle stats (6,000) only just match his. Mission rewards are story, not income: about 0.2% of
all groats earned, against about two-thirds from trade.

### Phase 6, houses, 2026-10-03
Built as §3.13 describes. Two new fields on the save (`house`, `houseLeftAt`), added by
`migrateState` for older characters; checked by the driver and in the browser.

**The risk designed for before writing code.** Dues and pay both fall daily, and whether a day's
dues can be met depends on whether that day's pay came first. Processing all paydays and then all
dues, as the code was shaped to do, would have made a purse depend on how often the player looked.
Money is now settled in one pass in strict time order, credits before debits at the same moment
(`settleMoney`). The driver tests it directly: dues set one minute before pay, an empty purse, five
days in one step against five days in hourly steps. 117 runs, all identical.

**Two faults found on the way, both by the driver's tables, neither by a failed assertion:**

1. *A story soft-lock.* Felix belongs to Charetty and members cannot fight their own house, so
   anyone who joined Charetty before the Phase 5 mission "Felix goes for a soldier" could never
   finish the story: 25% of characters stuck. Fixed by allowing a fight with your own house's
   people when your mission or contract names them. The content check now also refuses any house
   contract that asks members to fight their own house.
2. *A bug in the test bot itself* (`house !== house` with both undefined) hid fault 1 at first, by
   stopping the bot fighting anyone houseless. The game's rule was right; the bot's copy of it was
   wrong. A reminder that a test harness is code and can be wrong in exactly the ways the code
   under test can.

**The economy, which was the point.** Phase 4 left money with nothing to buy after a month.
Median net worth at day 30, 40 seeds:

| Rhythm | Before houses | With houses | Median rank at day 30 |
|---|---|---|---|
| Keen (every 2h) | 364,361 gr | 107,780 gr | 3 of 4 |
| Steady (4 a day) | 224,859 gr | 101,614 gr | 3 |
| Casual (twice a day) | 59,031 gr | 52,182 gr | 0 |

Gifts to houses are now the largest sink. The top rank (12,000 favour) was raised from 6,000 after
the first run showed keen players reaching it inside a month; it is meant to be a long goal, as
Simon is. The cost: casual players reach "News from the south" a little less often by day 30
(55%, from 73%), because dues and fees take money that went into travel. Worth watching, not
fixing yet.
