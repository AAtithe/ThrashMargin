# The portal UI kit: adoption guide

`Kit.tsx` and `kit.css` give every game the same buttons, fields, selects, toggle, disabled-reason
line and screen-reader live region, so hover, press, focus-visible, disabled, 40px phone targets,
16px phone field text and reduced motion are written once instead of seven times.

`npm run sync-shared` copies both files into each game's client `lib/` folder (beside
`Loading.tsx`): `src/lib/` in most games, `client/src/lib/` in Thrash Margin. Never edit those
copies; edit the originals here and run `npm run sync-shared`.

## 1. Import the stylesheet once

In the game's `main.tsx`, after `portal.css` and **before** `styles.css`, so the game's own rules
can still override the kit where a screen needs it:

```ts
import './portal.css';
import './lib/kit.css';
import './styles.css';
```

## 2. Map the kit onto the game's palette

The kit has no colours of its own. Add this block to the game's `styles.css`, inside the light
`:root { ... }` block, next to the `--ui-*` tokens. Swap `--ui-brass` for whatever the game's
current primary Button uses (Fireline and Thrash Margin: `--ui-accent`; Thrash Margin's ink on it
is `--ui-accent-ink`), and copy the font stack, radius and sizes from the game's `buttonBase`.

```css
  /* UI kit (lib/kit.css). */
  --kit-font: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --kit-radius: 2px;
  --kit-font-size: 0.82rem;
  --kit-font-size-small: 0.74rem;
  --kit-pad: 0.35rem 0.65rem;
  --kit-pad-small: 0.2rem 0.5rem;
  --kit-text: var(--ui-text);
  --kit-text-soft: var(--ui-text-soft);
  --kit-text-faint: var(--ui-text-faint);
  --kit-surface: var(--ui-panel-raised);
  --kit-field: var(--ui-panel);
  --kit-rule: var(--ui-rule);
  --kit-rule-strong: var(--ui-rule-strong);
  --kit-accent: var(--ui-brass);
  --kit-on-accent: var(--ui-ground);
  --kit-danger: var(--ui-bad);
  /* Only if the game has hover and press washes (Tea Race does); otherwise leave them out. */
  --kit-hover: var(--ui-hover);
  --kit-press: var(--ui-press);
```

**Light and dark.** Because every line is a `var(--ui-…)` reference, the one block follows dark
mode on its own: `:root[data-theme="dark"]` redefines the `--ui-*` tokens and the `--kit-*`
values resolve against them. Add `--kit-*` lines to the dark block only where dark mode needs a
*different mapping* (for example a different token for `--kit-on-accent`). Never put a hex
literal in a `--kit-*` line; add a `--ui-*` token to both blocks and map to that.

The full list, with the portal fallback each one uses when a game leaves it out, is at the top of
`kit.css`. A game that has no token for a variable can simply leave it out.

Check the result in both modes, at 375px and at desktop width, and that the primary button text
still meets AA (4.5:1) on `--kit-accent`.

## 3. Replace a game Button

Before (each game's own `components/ui.tsx`):

```tsx
<Button tone="primary" onClick={start} disabled={!ship} id="tour-sail">Sail</Button>
```

After:

```tsx
import { Button } from '../lib/Kit';

<Button tone="primary" onClick={start} disabled={!ship} id="tour-sail">Sail</Button>
```

The easiest safe route is usually to keep the game's `Button` export and make it a thin wrapper
over the kit, so no call site changes:

```tsx
import { Button as KitButton, type ButtonProps } from '../lib/Kit';
export function Button({ ariaLabel, ...rest }: ButtonProps & { ariaLabel?: string }) {
  return <KitButton aria-label={ariaLabel} {...rest} />;
}
```

Then delete the game's own `.xx-btn` hover, active, disabled and `@media (pointer: coarse)` rules
from `styles.css`, and its inline tone styles, once nothing else uses them.

What the kit Button takes: `tone` (`default`, `primary`, `quiet`, `danger`), `size` (`normal`,
`small`), `disabled`, `disabledReason`, `wrapStyle`, and every native button attribute (`id`,
`title`, `className`, `style`, `onClick`, `aria-*`, `data-*`). `type` defaults to `"button"`.

Keep every `id`, `data-tour-*` attribute and visible label exactly as it was: the tour scripts
(`scripts/tours/*.cjs`) and `scripts/loading-check.cjs` select on them. A game tone the kit lacks
(Thrash Margin's `move` and `attack`) stays in the game: pass `className` and a game rule that sets
`--kit-btn-face`, `--kit-btn-ink` and `--kit-btn-edge`, the three variables every tone sets.

## 4. Say why a control is disabled

```tsx
<Button
  tone="primary"
  disabled={!ship}
  disabledReason="Choose a ship before you sail."
  onClick={sail}
>
  Sail
</Button>
```

While `disabled` is true, the reason shows as a visible line under the button and the button's
`aria-describedby` points at it. Passing `disabledReason` at all puts the button in a
`span.kit-btn-wrap`, even while enabled, so the layout does not jump when the reason appears. In a
flex row where the button used to stretch, give that wrapper the layout with `wrapStyle={{ flex: 1 }}`
(and the button `style={{ width: '100%' }}`). Write the reason as a short sentence saying what to
do, in British English. `Toggle` takes `disabledReason` the same way.

## 5. The other components

```tsx
import { Field, SelectField, Toggle, LiveRegion } from '../lib/Kit';

<Field label="Captain's name" value={name} onChange={e => setName(e.target.value)}
       hint="Shown on the leaderboard." error={nameError} />

<SelectField label="Difficulty" value={level} onChange={e => setLevel(e.target.value)}>
  <option value="easy">Easy</option>
  <option value="normal">Normal</option>
</SelectField>

<Toggle pressed={monsoons} onPressedChange={setMonsoons}>Optional rule: monsoons</Toggle>

<LiveRegion message={status} />                       {/* polite: role="status" */}
<LiveRegion message={error} politeness="assertive" /> {/* interrupts: role="alert" */}
```

- `Field` and `SelectField` make an id if you do not pass one; pass `id` when a tour or test selects
  on it. `hint` and `error` are wired with `aria-describedby`; `error` also sets `aria-invalid`.
- `Toggle` is a `<button aria-pressed>`. Keep its label the same in both states.
- `LiveRegion` is visually hidden and stays mounted (render it unconditionally, before any early
  return). It announces each change of `message`; bump `nonce` to repeat the same message.
- `kit-sr-only` is the class to hide any other text visually while keeping it for screen readers.

## 6. Verify

`npm run check` (typechecks and the sync check), then load the game in both modes at 375px and
desktop width: hover, Tab focus, a disabled button with its reason, and a field on the phone
(40px tall, 16px text, no zoom on focus).
