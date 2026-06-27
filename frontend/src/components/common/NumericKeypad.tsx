type NumericKeypadProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxDecimals?: number;
  buttonHeight?: number;
  gapClass?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

function appendKey(value: string, key: string, maxDecimals: number) {
  if (key === "⌫") return value.slice(0, -1);
  if (key === ".")
    return value.includes(".") ? value : value ? `${value}.` : "0.";

  const next = value === "0" ? key : `${value}${key}`;
  const [, decimals = ""] = next.split(".");
  if (next.includes(".") && decimals.length > maxDecimals) return value;
  return next;
}

export function NumericKeypad({
  value,
  onChange,
  disabled = false,
  maxDecimals = 6,
  buttonHeight = 64,
  gapClass = "gap-2",
}: NumericKeypadProps) {
  return (
    <div className={`grid grid-cols-3 ${gapClass}`}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          className="rounded-2xl bg-zinc-100 text-xl font-semibold text-zinc-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ height: buttonHeight }}
          onClick={() => onChange(appendKey(value, key, maxDecimals))}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
