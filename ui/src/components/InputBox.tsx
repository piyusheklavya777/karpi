// ui/src/components/InputBox.tsx

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import clsx from "clsx";

interface IInputBoxProps {
  className?: string;
  placeholder?: string;
  onSubmit: (command: string) => void;
}

export function InputBox({
  className,
  placeholder = "Type a command and press Enter...",
  onSubmit,
}: IInputBoxProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;

    onSubmit(trimmed);

    // Add to history (avoid duplicates at the end)
    setHistory((prev) => {
      const newHistory = prev.filter((cmd) => cmd !== trimmed);
      return [...newHistory, trimmed];
    });

    setValue("");
    setHistoryIndex(-1);
  }, [value, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (history.length === 0) return;

        const newIndex =
          historyIndex === -1
            ? history.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex === -1) return;

        if (historyIndex >= history.length - 1) {
          setHistoryIndex(-1);
          setValue("");
        } else {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setValue(history[newIndex]);
        }
      } else if (e.key === "Escape") {
        setValue("");
        setHistoryIndex(-1);
      }
    },
    [handleSubmit, history, historyIndex]
  );

  return (
    <div
      className={clsx(
        "flex items-center gap-3 border-t border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3",
        className
      )}
    >
      <span className="text-[#ff69b4] font-mono text-sm">❯</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={clsx(
          "flex-1 bg-transparent text-white font-mono text-sm",
          "placeholder:text-gray-600 outline-none"
        )}
        autoFocus
      />
      <button
        onClick={handleSubmit}
        disabled={!value.trim()}
        className={clsx(
          "px-3 py-1 rounded text-sm font-medium transition-colors",
          value.trim()
            ? "bg-[#ff69b4] text-black hover:bg-[#ff85c1]"
            : "bg-[#2a2a2a] text-gray-500 cursor-not-allowed"
        )}
      >
        Run
      </button>
    </div>
  );
}
