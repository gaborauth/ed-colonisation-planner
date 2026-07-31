import { useEffect, useState } from "react";

// Ported from tksetup.py's validate_input(_positive)/on_focus_out(_integer): allow the field to sit
// in an incomplete-but-valid-while-typing state (empty, or a lone leading "-"), and normalize it
// only once the user leaves the field.

interface NumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  allowNegative?: boolean;
  /** What an empty field resolves to on blur: stay unset, or snap to 0. */
  blankMeans?: "undefined" | "zero";
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  /** Fires on an actual mouse click, not keyboard focus — `ObjectivePanel`'s preference number
   * field uses this to "activate" (enable) a preference on click, matching the slider's own
   * click-anywhere-sets-a-value behavior. Deliberately `onClick`, not `onFocus`: focus also fires
   * from keyboard Tab-navigation, which would silently activate every field a keyboard user tabs
   * past just to reach something else — `onClick` only ever fires from an intentional pointer
   * interaction (typing after a keyboard Tab still reaches `onChange` below, which activates a
   * field the same way on any real value entered, so keyboard users aren't blocked, just not
   * activated by focus alone). */
  onClick?: () => void;
}

function isValidWhileTyping(text: string, allowNegative: boolean): boolean {
  if (text === "") return true;
  if (allowNegative && text === "-") return true;
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/;
  return pattern.test(text);
}

export function NumberInput({
  value,
  onChange,
  allowNegative = false,
  blankMeans = "undefined",
  ariaLabel,
  id,
  disabled,
  onClick,
}: NumberInputProps) {
  const [text, setText] = useState(value === undefined ? "" : String(value));

  useEffect(() => {
    setText(value === undefined ? "" : String(value));
  }, [value]);

  function handleChange(raw: string): void {
    if (!isValidWhileTyping(raw, allowNegative)) return;
    setText(raw);
    if (raw !== "" && raw !== "-") {
      onChange(Number(raw));
    }
  }

  function handleBlur(): void {
    if (text === "" || text === "-") {
      const resolved = blankMeans === "zero" ? 0 : undefined;
      setText(resolved === undefined ? "" : String(resolved));
      onChange(resolved);
    }
  }

  return (
    <input
      id={id}
      className="number-input"
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      onClick={onClick}
    />
  );
}
