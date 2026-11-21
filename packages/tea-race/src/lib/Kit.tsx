// GENERATED from shared/portal/client/Kit.tsx by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
import { useEffect, useId, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/**
 * The portal's UI kit, shared by every game (copied into each game's lib/ by
 * scripts/sync-shared.mjs, beside kit.css, which holds every style these components use). Import
 * `./lib/kit.css` once in the game's main.tsx; the adoption guide is shared/portal/client/KIT.md.
 *
 * Nothing here carries a colour. The game maps its own palette onto the --kit-* variables (listed
 * at the top of kit.css), so the same component looks native in every game, in light and dark.
 *
 * What each component guarantees, so no game has to repeat it:
 * - hover, press, focus-visible and disabled states;
 * - 40px minimum targets and 16px field text on phones and touch screens;
 * - no movement under reduced motion or the portal's Motion: off;
 * - a disabled control can say why, in a visible line wired to it with aria-describedby.
 */

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

const joinIds = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

// ---------------------------------------------------------------------------------------------
// Button

export type ButtonTone = 'default' | 'primary' | 'quiet' | 'danger';
export type ButtonSize = 'normal' | 'small';

/** Every native button attribute passes through (id, title, aria-*, data-*, onClick, form...). */
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Defaults to "button", so a kit Button inside a form never submits it by accident. */
  type?: 'button' | 'submit' | 'reset';
  /**
   * Why the button is disabled, in a sentence. Shown as a visible line under the button while
   * `disabled` is true, and wired to it with aria-describedby. Passing it at all (even while the
   * button is enabled) puts the button in a `span.kit-btn-wrap`, so the layout does not jump
   * when the reason appears.
   */
  disabledReason?: string;
  /** Style for that wrapper (for example `{ flex: 1 }` in a row), when there is one. */
  wrapStyle?: CSSProperties;
  children?: ReactNode;
};

export function Button({
  tone = 'default',
  size = 'normal',
  type = 'button',
  disabled,
  disabledReason,
  wrapStyle,
  className,
  children,
  'aria-describedby': describedBy,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const showReason = !!disabled && !!disabledReason;
  const button = (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-describedby={joinIds(describedBy, showReason ? reasonId : undefined)}
      className={cx('kit-btn', tone !== 'default' && `kit-btn--${tone}`, size === 'small' && 'kit-btn--small', className)}
    >
      {children}
    </button>
  );
  if (disabledReason === undefined) return button;
  return (
    <span className="kit-btn-wrap" style={wrapStyle}>
      {button}
      {showReason && (
        <span className="kit-reason" id={reasonId}>
          {disabledReason}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Field and SelectField

type FieldExtras = {
  /** The visible label. Required: a field without one is unnamed to a screen reader. */
  label: ReactNode;
  /** A line under the field, always shown, wired with aria-describedby. */
  hint?: ReactNode;
  /** An error line under the field. Sets aria-invalid while present. */
  error?: ReactNode;
  /** Style for the wrapping div (the input itself takes `style`). */
  wrapStyle?: CSSProperties;
  wrapClassName?: string;
};

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & FieldExtras;

/** A labelled text input. Pass `id` to fix it (a tour or a test selects on it); otherwise one is made. */
export function Field({ label, hint, error, wrapStyle, wrapClassName, id, className, ...input }: FieldProps) {
  const ids = useFieldIds(id);
  return (
    <div className={cx('kit-field', wrapClassName)} style={wrapStyle}>
      <label className="kit-label" htmlFor={ids.control}>
        {label}
      </label>
      <input
        {...input}
        id={ids.control}
        className={cx('kit-input', className)}
        aria-invalid={error ? true : input['aria-invalid']}
        aria-describedby={joinIds(input['aria-describedby'], hint ? ids.hint : undefined, error ? ids.error : undefined)}
      />
      <FieldNotes ids={ids} hint={hint} error={error} />
    </div>
  );
}

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & FieldExtras & { children: ReactNode };

/** A labelled <select>; its <option>s are the children. */
export function SelectField({ label, hint, error, wrapStyle, wrapClassName, id, className, children, ...select }: SelectFieldProps) {
  const ids = useFieldIds(id);
  return (
    <div className={cx('kit-field', wrapClassName)} style={wrapStyle}>
      <label className="kit-label" htmlFor={ids.control}>
        {label}
      </label>
      <select
        {...select}
        id={ids.control}
        className={cx('kit-select', className)}
        aria-invalid={error ? true : select['aria-invalid']}
        aria-describedby={joinIds(select['aria-describedby'], hint ? ids.hint : undefined, error ? ids.error : undefined)}
      >
        {children}
      </select>
      <FieldNotes ids={ids} hint={hint} error={error} />
    </div>
  );
}

function useFieldIds(id: string | undefined) {
  const made = useId();
  const control = id ?? made;
  return { control, hint: `${control}-hint`, error: `${control}-error` };
}

function FieldNotes({ ids, hint, error }: { ids: { hint: string; error: string }; hint?: ReactNode; error?: ReactNode }) {
  return (
    <>
      {hint && (
        <p className="kit-hint" id={ids.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p className="kit-error" id={ids.error}>
          {error}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Toggle

export type ToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onChange' | 'aria-pressed'> & {
  /** On or off. */
  pressed: boolean;
  /** Called with the new value when the player flips it. */
  onPressedChange: (next: boolean) => void;
  /** The visible label beside the switch. Keep it the same in both states: aria-pressed says which. */
  children: ReactNode;
  /** As on Button: a visible line under the toggle while it is disabled. */
  disabledReason?: string;
  wrapStyle?: CSSProperties;
};

/** An on/off switch: a real button with aria-pressed, drawn as a track and thumb. */
export function Toggle({
  pressed,
  onPressedChange,
  children,
  disabled,
  disabledReason,
  wrapStyle,
  className,
  onClick,
  'aria-describedby': describedBy,
  ...rest
}: ToggleProps) {
  const reasonId = useId();
  const showReason = !!disabled && !!disabledReason;
  const toggle = (
    <button
      {...rest}
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      aria-describedby={joinIds(describedBy, showReason ? reasonId : undefined)}
      className={cx('kit-toggle', className)}
      onClick={e => {
        onClick?.(e);
        if (!e.defaultPrevented) onPressedChange(!pressed);
      }}
    >
      <span className="kit-toggle-track" aria-hidden="true">
        <span className="kit-toggle-thumb" />
      </span>
      <span>{children}</span>
    </button>
  );
  if (disabledReason === undefined) return toggle;
  return (
    <span className="kit-btn-wrap" style={wrapStyle}>
      {toggle}
      {showReason && (
        <span className="kit-reason" id={reasonId}>
          {disabledReason}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// LiveRegion

export type LiveRegionProps = {
  /** The text to announce. Announced each time it changes; an empty string announces nothing. */
  message: string;
  /** "polite" (the default) waits for the reader to finish; "assertive" interrupts. Keep assertive for errors. */
  politeness?: 'polite' | 'assertive';
  /**
   * Bump this to announce the same message again (a second "Not enough money" after another
   * failed purchase). Screen readers ignore a region whose text did not change.
   */
  nonce?: number | string;
};

/**
 * A visually hidden live region. It is in the page from the first render (a region that appears
 * already holding its text is often not read), and each new message is put in a beat after the
 * region is cleared, so the reader notices the change.
 */
export function LiveRegion({ message, politeness = 'polite', nonce }: LiveRegionProps) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText('');
    if (!message) return;
    const t = window.setTimeout(() => setText(message), 60);
    return () => window.clearTimeout(t);
  }, [message, nonce]);
  return (
    <div
      className="kit-sr-only"
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
    >
      {text}
    </div>
  );
}
