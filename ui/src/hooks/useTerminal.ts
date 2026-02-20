// ui/src/hooks/useTerminal.ts

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";

interface ITerminalOutput {
  session_id: number;
  data: string;
}

interface ITerminalExit {
  session_id: number;
  exit_code: number | null;
}

interface IUseTerminalOptions {
  cwd?: string;
  onExit?: (exitCode: number | null) => void;
}

export function useTerminal(options: IUseTerminalOptions = {}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initTerminal = useCallback(
    async (container: HTMLDivElement) => {
      if (xtermRef.current) return; // Already initialized

      terminalRef.current = container;

      // Create xterm instance
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
        lineHeight: 1.2,
        theme: {
          background: "#0d0d0d",
          foreground: "#e0e0e0",
          cursor: "#ff69b4",
          cursorAccent: "#0d0d0d",
          selectionBackground: "#ff69b444",
          black: "#1a1a1a",
          red: "#ff5555",
          green: "#50fa7b",
          yellow: "#f1fa8c",
          blue: "#6272a4",
          magenta: "#ff79c6",
          cyan: "#8be9fd",
          white: "#f8f8f2",
          brightBlack: "#6272a4",
          brightRed: "#ff6e6e",
          brightGreen: "#69ff94",
          brightYellow: "#ffffa5",
          brightBlue: "#d6acff",
          brightMagenta: "#ff92df",
          brightCyan: "#a4ffff",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Open terminal in container
      term.open(container);
      fitAddon.fit();

      // Get dimensions
      const { cols, rows } = term;

      try {
        // Spawn PTY session
        const sessionId = await invoke<number>("spawn_terminal", {
          cols,
          rows,
          cwd: options.cwd,
        });
        sessionIdRef.current = sessionId;

        // Send input to PTY
        term.onData((data) => {
          if (sessionIdRef.current !== null) {
            invoke("write_terminal", {
              sessionId: sessionIdRef.current,
              data,
            }).catch(console.error);
          }
        });

        setIsReady(true);
      } catch (e) {
        setError(e as string);
        console.error("Failed to spawn terminal:", e);
      }
    },
    [options.cwd]
  );

  // Listen for PTY output
  useEffect(() => {
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    const setup = async () => {
      unlistenOutput = await listen<ITerminalOutput>(
        "terminal-output",
        (event) => {
          if (
            event.payload.session_id === sessionIdRef.current &&
            xtermRef.current
          ) {
            xtermRef.current.write(event.payload.data);
          }
        }
      );

      unlistenExit = await listen<ITerminalExit>("terminal-exit", (event) => {
        if (event.payload.session_id === sessionIdRef.current) {
          options.onExit?.(event.payload.exit_code);
        }
      });
    };

    setup();

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, [options.onExit]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current && sessionIdRef.current !== null) {
        fitAddonRef.current.fit();
        const { cols, rows } = xtermRef.current;
        invoke("resize_terminal", {
          sessionId: sessionIdRef.current,
          cols,
          rows,
        }).catch(console.error);
      }
    };

    window.addEventListener("resize", handleResize);

    // Also observe the container for size changes
    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, [isReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionIdRef.current !== null) {
        invoke("kill_terminal", { sessionId: sessionIdRef.current }).catch(
          console.error
        );
      }
      xtermRef.current?.dispose();
    };
  }, []);

  const focus = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  const write = useCallback((data: string) => {
    if (sessionIdRef.current !== null) {
      invoke("write_terminal", {
        sessionId: sessionIdRef.current,
        data,
      }).catch(console.error);
    }
  }, []);

  const clear = useCallback(() => {
    xtermRef.current?.clear();
  }, []);

  return {
    initTerminal,
    isReady,
    error,
    focus,
    write,
    clear,
    sessionId: sessionIdRef.current,
  };
}
