// ui/src/components/Terminal.tsx

import { useCallback, useRef, useEffect } from "react";
import clsx from "clsx";
import { useTerminal } from "../hooks/useTerminal";

interface ITerminalProps {
  className?: string;
  cwd?: string;
  onReady?: () => void;
  onExit?: (exitCode: number | null) => void;
}

export function Terminal({ className, cwd, onReady, onExit }: ITerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { initTerminal, isReady, error, focus } = useTerminal({
    cwd,
    onExit,
  });

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        containerRef.current = node;
        initTerminal(node);
      }
    },
    [initTerminal]
  );

  useEffect(() => {
    if (isReady) {
      focus();
      onReady?.();
    }
  }, [isReady, focus, onReady]);

  if (error) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center bg-[#0d0d0d] text-red-400",
          className
        )}
      >
        <div className="text-center">
          <p className="text-lg font-semibold">Failed to initialize terminal</p>
          <p className="mt-2 text-sm opacity-70">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setRef}
      className={clsx("relative bg-[#0d0d0d]", className)}
      onClick={focus}
    />
  );
}
