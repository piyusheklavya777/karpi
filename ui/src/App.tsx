import { useState, useEffect, type FormEvent } from "react";
import {
  listProfiles,
  login,
  register,
  biometricStatus,
  biometricLogin,
  biometricEnable,
  type ProfileInfo,
} from "./lib/karpi";
import Dashboard from "./Dashboard";
import "./App.css";

function App() {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null);

  // Per-profile password state (keyed by profile id)
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileLoading, setProfileLoading] = useState<Record<string, boolean>>({});

  // Biometric state
  const [touchIdAvailable, setTouchIdAvailable] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState<Record<string, boolean>>({});
  const [enableBiometricFor, setEnableBiometricFor] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [biometricEnabling, setBiometricEnabling] = useState(false);

  // New user form state
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newError, setNewError] = useState("");
  const [newLoading, setNewLoading] = useState(false);
  const [showNewConfirm, setShowNewConfirm] = useState(false);

  useEffect(() => {
    listProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
    biometricStatus()
      .then((r) => setTouchIdAvailable(r.available))
      .catch(() => setTouchIdAvailable(false));
  }, []);

  async function handleBiometricLogin(profile: ProfileInfo) {
    setBiometricLoading((s) => ({ ...s, [profile.id]: true }));
    setProfileErrors((s) => ({ ...s, [profile.id]: "" }));

    try {
      const result = await biometricLogin(profile.username);
      if (result.success) {
        setLoggedInUser(result.username || profile.username);
      } else {
        setProfileErrors((s) => ({
          ...s,
          [profile.id]: result.error || "Touch ID failed",
        }));
      }
    } catch (err) {
      setProfileErrors((s) => ({ ...s, [profile.id]: String(err) }));
    } finally {
      setBiometricLoading((s) => ({ ...s, [profile.id]: false }));
    }
  }

  async function handleProfileLogin(profile: ProfileInfo) {
    const pw = passwords[profile.id] || "";
    if (!pw) return;

    setProfileErrors((s) => ({ ...s, [profile.id]: "" }));
    setProfileLoading((s) => ({ ...s, [profile.id]: true }));

    try {
      const result = await login(profile.username, pw);
      if (result.success) {
        // If Touch ID available but not yet enabled, offer to enable
        if (touchIdAvailable && !profile.biometric_enabled) {
          setEnableBiometricFor({ username: profile.username, password: pw });
        } else {
          setLoggedInUser(result.username || profile.username);
        }
      } else {
        setProfileErrors((s) => ({
          ...s,
          [profile.id]: result.error || "Login failed",
        }));
      }
    } catch (err) {
      setProfileErrors((s) => ({ ...s, [profile.id]: String(err) }));
    } finally {
      setProfileLoading((s) => ({ ...s, [profile.id]: false }));
    }
  }

  async function handleEnableBiometric() {
    if (!enableBiometricFor) return;
    setBiometricEnabling(true);
    try {
      await biometricEnable(enableBiometricFor.username, enableBiometricFor.password);
    } catch {
      // Non-critical — proceed to dashboard regardless
    } finally {
      setBiometricEnabling(false);
      setLoggedInUser(enableBiometricFor.username);
      setEnableBiometricFor(null);
    }
  }

  function handleSkipBiometric() {
    if (!enableBiometricFor) return;
    setLoggedInUser(enableBiometricFor.username);
    setEnableBiometricFor(null);
  }

  async function handleNewUser(e: FormEvent) {
    e.preventDefault();
    if (!newUser || !newPass) return;

    setNewError("");
    setNewLoading(true);

    try {
      // Try login first
      const result = await login(newUser, newPass);
      if (result.success) {
        // Offer to enable Touch ID if available and not already enabled
        const profile = profiles.find((p) => p.username === newUser);
        if (touchIdAvailable && (!profile || !profile.biometric_enabled)) {
          setEnableBiometricFor({ username: newUser, password: newPass });
        } else {
          setLoggedInUser(result.username || newUser);
        }
        return;
      }

      // If user not found, offer to create
      const isUnknown =
        result.error === "User not found" ||
        result.error === "Invalid username or password";
      const userExists = profiles.some((p) => p.username === newUser);

      if (!userExists && isUnknown) {
        setShowNewConfirm(true);
      } else {
        setNewError(result.error || "Login failed");
      }
    } catch (err) {
      setNewError(String(err));
    } finally {
      setNewLoading(false);
    }
  }

  async function handleCreateAccount() {
    setNewLoading(true);
    setNewError("");

    try {
      const result = await register(newUser, newPass);
      if (result.success) {
        setShowNewConfirm(false);
        setLoggedInUser(result.username || newUser);
      } else {
        setNewError(result.error || "Registration failed");
      }
    } catch (err) {
      setNewError(String(err));
    } finally {
      setNewLoading(false);
    }
  }

  if (loggedInUser) {
    return (
      <Dashboard
        username={loggedInUser}
        onLogout={() => {
          setLoggedInUser(null);
          setPasswords({});
          setProfileErrors({});
          listProfiles()
            .then(setProfiles)
            .catch(() => setProfiles([]));
        }}
      />
    );
  }

  // Post-login prompt to enable Touch ID
  if (enableBiometricFor) {
    return (
      <div className="auth">
        <header className="auth-header">
          <span className="auth-logo">Karpi</span>
        </header>
        <div className="auth-body">
          <div className="auth-enable-prompt">
            <div className="auth-enable-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v1" />
                <path d="M7 11V8a5 5 0 0 1 9.9-1" />
                <path d="M3 15a8.5 8.5 0 0 0 3.5 4.7" />
                <path d="M20.7 15A8.5 8.5 0 0 1 17.5 19.7" />
                <path d="M4 11a8 8 0 0 1 2-3.4" />
                <path d="M20 11a8 8 0 0 0-2-3.4" />
                <path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
              </svg>
            </div>
            <h2 className="auth-enable-title">Enable Touch ID?</h2>
            <p className="auth-enable-desc">
              Sign in faster next time with Touch ID instead of your password.
            </p>
            <div className="auth-enable-actions">
              <button
                className="btn btn-xs btn-green"
                onClick={handleEnableBiometric}
                disabled={biometricEnabling}
              >
                {biometricEnabling ? "Enabling..." : "Enable Touch ID"}
              </button>
              <button
                className="btn btn-xs btn-dim"
                onClick={handleSkipBiometric}
                disabled={biometricEnabling}
              >
                Not Now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <header className="auth-header">
        <span className="auth-logo">Karpi</span>
      </header>

      <div className="auth-body">
        {/* Existing profiles — each one is a card with inline password */}
        {profiles.length > 0 && (
          <section className="auth-section">
            <h2 className="auth-label">Profiles</h2>
            <div className="auth-grid">
              {profiles.map((p) => {
                const err = profileErrors[p.id];
                const loading = profileLoading[p.id];
                return (
                  <form
                    key={p.id}
                    className="auth-card"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleProfileLogin(p);
                    }}
                  >
                    <div className="auth-card-head">
                      <span className="auth-avatar">
                        {p.username.charAt(0).toUpperCase()}
                      </span>
                      <div className="auth-card-info">
                        <span className="auth-card-name">{p.username}</span>
                        {p.email && (
                          <span className="auth-card-sub">{p.email}</span>
                        )}
                      </div>
                    </div>
                    <div className="auth-card-row">
                      <input
                        type="password"
                        className="auth-input"
                        placeholder="Password"
                        value={passwords[p.id] || ""}
                        onChange={(e) =>
                          setPasswords((s) => ({ ...s, [p.id]: e.target.value }))
                        }
                      />
                      <button
                        type="submit"
                        className="btn btn-xs btn-green"
                        disabled={loading || !passwords[p.id]}
                      >
                        {loading ? "..." : "Sign In"}
                      </button>
                      {touchIdAvailable && p.biometric_enabled && (
                        <button
                          type="button"
                          className="auth-biometric-btn"
                          title="Sign in with Touch ID"
                          disabled={biometricLoading[p.id]}
                          onClick={() => handleBiometricLogin(p)}
                        >
                          {biometricLoading[p.id] ? (
                            <span className="auth-biometric-spinner" />
                          ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v1" />
                              <path d="M7 11V8a5 5 0 0 1 9.9-1" />
                              <path d="M3 15a8.5 8.5 0 0 0 3.5 4.7" />
                              <path d="M20.7 15A8.5 8.5 0 0 1 17.5 19.7" />
                              <path d="M4 11a8 8 0 0 1 2-3.4" />
                              <path d="M20 11a8 8 0 0 0-2-3.4" />
                              <path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                    {err && <span className="auth-card-error">{err}</span>}
                  </form>
                );
              })}
            </div>
          </section>
        )}

        {/* New user section */}
        <section className="auth-section">
          <h2 className="auth-label">
            {profiles.length > 0 ? "New User" : "Sign In"}
          </h2>
          <div className="auth-grid">
            {showNewConfirm ? (
              <div className="auth-card">
                <p className="auth-confirm-text">
                  No account found for <strong>{newUser}</strong>. Create one?
                </p>
                <div className="auth-confirm-actions">
                  <button
                    className="btn btn-xs btn-green"
                    onClick={handleCreateAccount}
                    disabled={newLoading}
                  >
                    {newLoading ? "..." : "Create Account"}
                  </button>
                  <button
                    className="btn btn-xs btn-dim"
                    onClick={() => {
                      setShowNewConfirm(false);
                      setNewPass("");
                    }}
                    disabled={newLoading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="auth-card"
                onSubmit={handleNewUser}
              >
                <div className="auth-card-row">
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="Username"
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                  />
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="Password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn btn-xs btn-green"
                    disabled={newLoading || !newUser || !newPass}
                  >
                    {newLoading ? "..." : "Go"}
                  </button>
                </div>
                {newError && (
                  <span className="auth-card-error">{newError}</span>
                )}
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
