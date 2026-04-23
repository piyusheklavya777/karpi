import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runKarpi, logout } from "./lib/karpi";
import { useTerminal } from "./hooks/useTerminal";
import "./Dashboard.css";

// ── Server types ─────────────────────────────────────────────────────────────

interface Tunnel {
  id: string;
  name: string;
  type: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  running: boolean;
  pid: number | null;
  started_at: string | null;
}

interface SyncedFile {
  id: string;
  name: string;
  last_synced: string | null;
}

interface Server {
  id: string;
  name: string;
  host: string;
  username: string;
  last_connected: string | null;
  tunnels: Tunnel[];
  synced_files: SyncedFile[];
}

// ── Project types ────────────────────────────────────────────────────────────

interface Step {
  type: string;
  app_name?: string;
  command_name?: string;
  server_name?: string;
  tunnel_name?: string;
  delay_ms?: number;
  custom_command?: string | null;
}

interface ProjCommand {
  id: string;
  name: string;
  type: string;
  command: string | null;
  steps?: Step[];
  running: boolean;
  pid: number | null;
  started_at: string | null;
}

interface App {
  id: string;
  name: string;
  type: string;
  relative_path: string;
  linked_server_id: string | null;
  linked_tunnel_id: string | null;
  commands: ProjCommand[];
}

interface Project {
  id: string;
  name: string;
  base_path: string;
  apps: App[];
  commands: ProjCommand[];
}

const POLL_INTERVAL = 15_000;
const TERMINAL_PREF_KEY = "karpi-terminal-pref";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
const isWindows =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Win");

const TERMINAL_OPTIONS: { value: string; label: string }[] = [
  { value: "inline", label: "Inline" },
  ...(isMac
    ? [
        { value: "terminal", label: "Terminal" },
        { value: "iterm", label: "iTerm2" },
        { value: "warp", label: "Warp" },
      ]
    : []),
  ...(isWindows
    ? [
        { value: "windows-terminal", label: "Windows Terminal" },
        { value: "powershell", label: "PowerShell" },
      ]
    : []),
];

// ── Live uptime component (ticks every second for running processes) ─────────

function LiveUptime({ startedAt, pulse }: { startedAt: string; pulse: boolean }) {
  const [display, setDisplay] = useState(() => timeAgoLive(startedAt));

  useEffect(() => {
    const id = setInterval(() => setDisplay(timeAgoLive(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className={`uptime ${pulse ? "uptime-pulse" : ""}`}>{display}</span>
  );
}

// ── Inline Terminal (PTY-backed xterm panel for a single command) ────────────

function InlineTerminal({
  cwd,
  command,
  onSessionId,
  onExit,
}: {
  cwd?: string;
  command: string;
  onSessionId: (id: number) => void;
  onExit: (code: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wroteRef = useRef(false);

  const { initTerminal, isReady, error, write } = useTerminal({
    cwd,
    onExit,
    onSessionReady: onSessionId,
  });

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        containerRef.current = node;
        initTerminal(node);
      }
    },
    [initTerminal],
  );

  // Write the command once the PTY is ready
  useEffect(() => {
    if (isReady && !wroteRef.current) {
      wroteRef.current = true;
      write(command + "\n");
    }
  }, [isReady, command, write]);

  if (error) {
    return (
      <div className="inline-terminal inline-terminal-error">
        Terminal error: {error}
      </div>
    );
  }

  return <div ref={setRef} className="inline-terminal" />;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Dashboard({ username, onLogout }: { username: string; onLogout?: () => void }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [actionStatus, setActionStatus] = useState<Record<string, string>>({});
  const [refreshPulse, setRefreshPulse] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Terminal preference (persisted in localStorage)
  const [terminalPref, setTerminalPref] = useState(
    () => localStorage.getItem(TERMINAL_PREF_KEY) || "inline",
  );

  function updateTerminalPref(value: string) {
    setTerminalPref(value);
    localStorage.setItem(TERMINAL_PREF_KEY, value);
  }

  // PTY inline terminal state
  const [ptySessions, setPtySessions] = useState<Record<string, number>>({});
  const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(
    () => new Set(),
  );
  const [ptyStartTimes, setPtyStartTimes] = useState<Record<string, string>>(
    {},
  );

  const loadAll = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        runKarpi<Server[]>(["servers", "list-full"]).catch(() => []),
        runKarpi<Project[]>(["projects", "list-full"]).catch(() => []),
      ]);
      setServers(s);
      setProjects(p);
      // Brief pulse on all running items to show refresh happened
      setRefreshPulse(true);
      setTimeout(() => setRefreshPulse(false), 600);
    } catch {
      /* noop */
    }
  }, []);

  // Initial load + auto-poll every 15s
  useEffect(() => {
    loadAll();
    timerRef.current = setInterval(loadAll, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadAll]);

  async function runAction(key: string, args: string[]) {
    setActionStatus((s) => ({ ...s, [key]: "running" }));
    try {
      await runKarpi(args);
      setActionStatus((s) => ({ ...s, [key]: "done" }));
      await loadAll();
      setTimeout(() => setActionStatus((s) => ({ ...s, [key]: "" })), 2000);
    } catch {
      setActionStatus((s) => ({ ...s, [key]: "error" }));
      setTimeout(() => setActionStatus((s) => ({ ...s, [key]: "" })), 3000);
    }
  }

  // ── PTY helpers ───────────────────────────────────────────────────────────

  function startPty(key: string) {
    setPtySessions((s) => ({ ...s })); // will be set via onSessionId
    setExpandedTerminals((s) => new Set(s).add(key));
    setPtyStartTimes((s) => ({ ...s, [key]: new Date().toISOString() }));
  }

  function stopPty(key: string) {
    const sid = ptySessions[key];
    if (sid != null) {
      invoke("kill_terminal", { sessionId: sid }).catch(console.error);
    }
    setPtySessions((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
    setExpandedTerminals((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    setPtyStartTimes((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
  }

  function toggleTerminal(key: string) {
    setExpandedTerminals((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isPtyRunning(key: string) {
    return ptySessions[key] != null;
  }

  async function handleSsh(key: string, cmd: string) {
    // If an inline PTY is already running, disconnect it
    if (isPtyRunning(key)) {
      stopPty(key);
      return;
    }

    if (terminalPref === "inline") {
      startPty(key);
    } else {
      try {
        const result = await invoke<string>("open_external_terminal", {
          terminal: terminalPref,
          command: cmd,
        });
        const status = result === "copied" ? "copied" : "done";
        setActionStatus((s) => ({ ...s, [key]: status }));
        setTimeout(
          () => setActionStatus((s) => ({ ...s, [key]: "" })),
          2500,
        );
      } catch (e) {
        console.error("Failed to open external terminal:", e);
        setActionStatus((s) => ({ ...s, [key]: "error" }));
        setTimeout(
          () => setActionStatus((s) => ({ ...s, [key]: "" })),
          3000,
        );
      }
    }
  }

  // ── StatusBtn (unchanged for sequence commands & tunnels) ─────────────────

  function StatusBtn({
    actionKey,
    args,
    running,
    startedAt,
    runLabel = "Run",
    stopLabel = "Stop",
  }: {
    actionKey: string;
    args: string[];
    running: boolean;
    startedAt?: string | null;
    runLabel?: string;
    stopLabel?: string;
  }) {
    const st = actionStatus[actionKey];
    return (
      <span className="status-btn-group">
        {running && startedAt && (
          <LiveUptime startedAt={startedAt} pulse={refreshPulse} />
        )}
        <button
          className={`btn btn-xs ${st === "done" ? "btn-done" : running ? "btn-red" : "btn-green"}`}
          onClick={() => runAction(actionKey, args)}
          disabled={st === "running"}
        >
          {st === "running" ? "..." : st === "done" ? "✓" : running ? stopLabel : runLabel}
        </button>
      </span>
    );
  }

  // ── DirectCmdBtn (PTY-based for direct app commands) ──────────────────────

  function DirectCmdBtn({
    actionKey,
    ptyRunning,
    startedAt,
  }: {
    actionKey: string;
    ptyRunning: boolean;
    startedAt?: string;
  }) {
    return (
      <span className="status-btn-group">
        {ptyRunning && startedAt && (
          <LiveUptime startedAt={startedAt} pulse={refreshPulse} />
        )}
        <button
          className={`btn btn-xs ${ptyRunning ? "btn-red" : "btn-green"}`}
          onClick={(e) => {
            e.stopPropagation();
            if (ptyRunning) stopPty(actionKey);
            else startPty(actionKey);
          }}
        >
          {ptyRunning ? "Stop" : "Run"}
        </button>
      </span>
    );
  }

  return (
    <div className="dash">
      <header className="dash-header">
        <span className="dash-logo">Karpi</span>
        <span className="dash-user">@{username}</span>
        {onLogout && (
          <button
            className="btn btn-xs btn-dim dash-logout"
            onClick={async () => {
              await logout().catch(() => {});
              onLogout();
            }}
          >
            Sign Out
          </button>
        )}
      </header>

      <div className="dash-body">
        {/* ── Servers ──────────────────────────────────────── */}
        {servers.length > 0 && (
          <section className="dash-section">
            <h2 className="section-label">Servers</h2>
            <div className="card-grid">
              {servers.map((s) => {
                const sshKey = `ssh-${s.name}`;
                const sshRunning = isPtyRunning(sshKey);
                const sshExpanded = expandedTerminals.has(sshKey);
                const sshCmd = `ssh ${s.username}@${s.host}`;
                const sshStatus = actionStatus[sshKey];

                return (
                <div key={s.id} className="card">
                  <div className="card-head">
                    <div className="card-title">
                      <span className="card-name">{s.name}</span>
                      <span className="card-sub">
                        {s.username}@{s.host}
                      </span>
                    </div>
                    <div className="ssh-controls">
                      {TERMINAL_OPTIONS.length > 1 && (
                        <select
                          className="terminal-select"
                          value={terminalPref}
                          onChange={(e) => updateTerminalPref(e.target.value)}
                        >
                          {TERMINAL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        className={`btn ${
                          sshRunning
                            ? "btn-red"
                            : sshStatus === "done" || sshStatus === "copied"
                              ? "btn-done"
                              : sshStatus === "error"
                                ? "btn-red"
                                : "btn-white"
                        }`}
                        onClick={() => handleSsh(sshKey, sshCmd)}
                        disabled={sshStatus === "running"}
                      >
                        {sshRunning
                          ? "Disconnect"
                          : sshStatus === "copied"
                            ? "Copied!"
                            : sshStatus === "done"
                              ? "Opened"
                              : sshStatus === "error"
                                ? "Error"
                                : "SSH"}
                      </button>
                    </div>
                  </div>

                  {sshRunning && (
                    <div
                      className={
                        sshExpanded
                          ? "inline-terminal-wrap"
                          : "inline-terminal-wrap inline-terminal-hidden"
                      }
                    >
                      <InlineTerminal
                        command={sshCmd}
                        onSessionId={(sid) =>
                          setPtySessions((prev) => ({
                            ...prev,
                            [sshKey]: sid,
                          }))
                        }
                        onExit={() => stopPty(sshKey)}
                      />
                    </div>
                  )}

                  {(s.synced_files.length > 0 || s.tunnels.length > 0) && (
                    <div className="card-rows">
                      {s.synced_files.map((f) => {
                        const key = `sync-${s.name}-${f.name}`;
                        const st = actionStatus[key];
                        return (
                          <button
                            key={f.id}
                            className={`row-action ${st === "done" ? "done" : ""}`}
                            onClick={() =>
                              runAction(key, ["servers", "sync", s.name, f.name])
                            }
                            disabled={st === "running"}
                          >
                            <span className="ra-icon">
                              {st === "running" ? "↻" : st === "done" ? "✓" : "↑"}
                            </span>
                            <span className="ra-text">{f.name}</span>
                            {f.last_synced && (
                              <span className="ra-dim">{timeAgo(f.last_synced)}</span>
                            )}
                          </button>
                        );
                      })}
                      {s.tunnels.map((t) => (
                        <div key={t.id} className="row">
                          <span className={`dot ${t.running ? "on" : ""}`} />
                          <span className="row-text">{t.name}</span>
                          <span className="ra-dim">:{t.local_port}</span>
                          <StatusBtn
                            actionKey={`tun-${s.name}-${t.name}`}
                            args={["servers", "tunnel", t.running ? "stop" : "start", s.name, t.name]}
                            running={t.running}
                            startedAt={t.started_at}
                            runLabel="Start"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Projects ─────────────────────────────────────── */}
        {projects.length > 0 && (
          <section className="dash-section">
            <h2 className="section-label">Projects</h2>
            <div className="card-grid">
              {projects.map((p) => (
                <div key={p.id} className="card">
                  <div className="card-head">
                    <div className="card-title">
                      <span className="card-name">{p.name}</span>
                      <span className="card-sub">{p.base_path}</span>
                    </div>
                  </div>

                  <div className="card-rows">
                    {/* Project-level commands (sequences) — still use CLI */}
                    {p.commands.map((c) => {
                      const key = `pcmd-${p.name}-${c.name}`;
                      return (
                        <div key={c.id} className="group">
                          <div className="row">
                            <span className={`dot ${c.running ? "on" : ""}`} />
                            <span className="row-text row-bold">{c.name}</span>
                            <span className="badge">{c.type}</span>
                            <StatusBtn
                              actionKey={key}
                              args={
                                c.running
                                  ? ["projects", "stop", p.name, c.name]
                                  : ["projects", "run", p.name, c.name]
                              }
                              running={c.running}
                              startedAt={c.started_at}
                            />
                          </div>
                          {/* Sequence steps indented */}
                          {c.steps && c.steps.length > 0 && (
                            <div className="indent-1">
                              {c.steps.map((step, i) => (
                                <div key={i} className="step-row">
                                  <span className="step-line" />
                                  <span className="step-icon">
                                    {step.type === "app_command"
                                      ? "▶"
                                      : step.type === "tunnel"
                                        ? "⇄"
                                        : step.type === "delay"
                                          ? "◷"
                                          : "⚡"}
                                  </span>
                                  <span className="step-text">
                                    {step.type === "app_command"
                                      ? `${step.app_name} › ${step.command_name}`
                                      : step.type === "tunnel"
                                        ? `${step.server_name} › ${step.tunnel_name}`
                                        : step.type === "delay"
                                          ? `wait ${step.delay_ms}ms`
                                          : step.custom_command || "custom"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Apps */}
                    {p.apps.map((a) => (
                      <div key={a.id} className="group">
                        <div className="row">
                          <span className="app-name">{a.name}</span>
                          <span className="badge badge-blue">{a.type}</span>
                        </div>
                        {/* App commands indented */}
                        <div className="indent-1">
                          {a.commands.map((c) => {
                            const key = `acmd-${p.name}-${a.name}-${c.name}`;
                            const isDirect = c.type === "direct" && !!c.command;
                            const ptyRunning = isPtyRunning(key);
                            const expanded = expandedTerminals.has(key);
                            const cwd =
                              p.base_path +
                              (a.relative_path && a.relative_path !== "."
                                ? "/" + a.relative_path
                                : "");

                            if (isDirect) {
                              return (
                                <div key={c.id} className="cmd-group">
                                  <div
                                    className={`row row-clickable ${ptyRunning ? "row-active" : ""}`}
                                    onClick={() => {
                                      if (ptyRunning) toggleTerminal(key);
                                    }}
                                  >
                                    <span
                                      className={`dot ${ptyRunning ? "on" : ""}`}
                                    />
                                    <span className="row-text">{c.name}</span>
                                    {c.command && (
                                      <span className="ra-dim mono">
                                        {c.command}
                                      </span>
                                    )}
                                    {ptyRunning && (
                                      <span className="terminal-toggle">
                                        {expanded ? "▾" : "▸"}
                                      </span>
                                    )}
                                    <DirectCmdBtn
                                      actionKey={key}
                                      ptyRunning={ptyRunning}
                                      startedAt={ptyStartTimes[key]}
                                    />
                                  </div>
                                  {/* Inline terminal — hidden via CSS when collapsed, not unmounted */}
                                  {ptyRunning && (
                                    <div
                                      className={
                                        expanded
                                          ? "inline-terminal-wrap"
                                          : "inline-terminal-wrap inline-terminal-hidden"
                                      }
                                    >
                                      <InlineTerminal
                                        cwd={cwd}
                                        command={c.command!}
                                        onSessionId={(sid) =>
                                          setPtySessions((s) => ({
                                            ...s,
                                            [key]: sid,
                                          }))
                                        }
                                        onExit={() => stopPty(key)}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            // Non-direct (sequence) app commands — keep existing CLI path
                            return (
                              <div key={c.id} className="row">
                                <span
                                  className={`dot ${c.running ? "on" : ""}`}
                                />
                                <span className="row-text">{c.name}</span>
                                {c.command && (
                                  <span className="ra-dim mono">
                                    {c.command}
                                  </span>
                                )}
                                <StatusBtn
                                  actionKey={key}
                                  args={
                                    c.running
                                      ? [
                                          "projects",
                                          "stop",
                                          p.name,
                                          c.name,
                                          "--app",
                                          a.name,
                                        ]
                                      : [
                                          "projects",
                                          "run",
                                          p.name,
                                          c.name,
                                          "--app",
                                          a.name,
                                        ]
                                  }
                                  running={c.running}
                                  startedAt={c.started_at}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {p.commands.length === 0 && p.apps.length === 0 && (
                      <span className="empty">No commands</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {servers.length === 0 && projects.length === 0 && (
          <div className="dash-empty">No servers or projects configured</div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function timeAgoLive(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
