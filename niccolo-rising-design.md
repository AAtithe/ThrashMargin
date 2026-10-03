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
| 5 | Missions: a Dunnett story spine told as Torn-style missions (the first novel's arc) | Not started |
| 6 | Houses (factions): join Charetty, Medici, St Pol or Doria; house perks and chain duels | Not started |
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
