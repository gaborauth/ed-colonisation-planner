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
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
    />
  );
}
