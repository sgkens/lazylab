import { RestoreBackup } from './VaultRecovery';
import React, { useState } from 'react';
import { AlertTriangle, KeyRound, Lock, LogIn, ShieldCheck } from 'lucide-react';
import { sessionApi } from '../services/api';
import { SessionState } from '../types/vault';
import { BrandMark } from './BrandMark';

interface AuthScreenProps {
  state: SessionState;
  onAuthenticated: () => void;
}

const inputClass =
  'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500 font-mono';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block space-y-1">
    <span className="text-xs font-medium text-zinc-400">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
  </label>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({ state, onAuthenticated }) => {
  const isSetup = state.setupRequired;
  const [recovery, setRecovery] = useState(false);
  const [restore, setRestore] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [username, setUsername] = useState(state.username || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [gitlabHost, setGitlabHost] = useState('https://gitlab.com');
  const [gitlabToken, setGitlabToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const insecure = !state.secure && !isLocalHost;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if ((isSetup || recovery) && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (recovery) {
        await sessionApi.recover(recoveryKey, password);
      } else if (isSetup) {
        await sessionApi.setup({
          setupCode: setupCode.trim(),
          username: username.trim(),
          password,
          gitlabHost: gitlabToken.trim() ? gitlabHost.trim() : undefined,
          gitlabToken: gitlabToken.trim() || undefined
        });
      } else {
        await sessionApi.login(username.trim(), password);
      }
      setPassword('');
      setConfirm('');
      setGitlabToken('');
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex items-center justify-center p-4 font-sans">
      <form onSubmit={submit} className="w-full max-w-sm bg-zinc-900/80 border border-zinc-800 rounded-xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <BrandMark size={36} />
          <div>
            <h1 className="text-base font-bold">{isSetup ? 'Set up lazylab' : 'Sign in to lazylab'}</h1>
            <p className="text-xs text-zinc-500">
              {isSetup
                ? 'Create the admin account. The password also encrypts the vault.'
                : state.vaultUnlocked
                  ? 'Vault is unlocked.'
                  : 'Vault is locked. Signing in unlocks it.'}
            </p>
          </div>
        </div>

        {insecure && (
          <div className="flex gap-2 text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded-lg p-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              This connection is not HTTPS. Your password and session are sent in plain text. Enable LAZYLAB_TLS or use an HTTPS proxy.
            </span>
          </div>
        )}

        {isSetup && (
          <Field label="Setup code" hint="Printed in the server log on first start (docker compose logs lazylab).">
            <input className={inputClass} value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoFocus required />
          </Field>
        )}

        {!restore && !recovery && <Field label="Username">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus={!isSetup}
            required
          />
        </Field>}

        {!restore && <Field label={recovery ? "New password" : "Password"} hint={isSetup || recovery ? 'At least 12 characters. Keep a recovery key in a safe place.' : undefined}>
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup || recovery ? 'new-password' : 'current-password'}
            minLength={isSetup || recovery ? 12 : undefined}
            required
          />
        </Field>}

        {recovery && <Field label="Recovery key"><input className={inputClass} value={recoveryKey} onChange={e => setRecoveryKey(e.target.value)} autoComplete="off" required /></Field>}
        {recovery && <Field label="Confirm new password"><input className={inputClass} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>}

        {isSetup && !restore && (
          <>
            <Field label="Confirm password">
              <input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>

            <div className="pt-2 border-t border-zinc-800 space-y-3">
              <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-orange-400" />
                GitLab connection (optional, can be added later in the Vault)
              </p>
              <Field label="GitLab host">
                <input className={inputClass} value={gitlabHost} onChange={(e) => setGitlabHost(e.target.value)} />
              </Field>
              <Field label="Personal access token" hint="Scope: api. Stored encrypted in the vault.">
                <input className={inputClass} type="password" value={gitlabToken} onChange={(e) => setGitlabToken(e.target.value)} autoComplete="off" />
              </Field>
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg p-2">{error}</p>}

        {restore && <RestoreBackup setupCode={setupCode} onRestored={onAuthenticated} />}
        {!restore && <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg py-2 transition-colors"
        >
          {isSetup ? <ShieldCheck className="w-4 h-4" /> : state.vaultUnlocked ? <LogIn className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {busy ? 'Working…' : recovery ? 'Reset password and sign in' : isSetup ? 'Create account' : state.vaultUnlocked ? 'Sign in' : 'Unlock and sign in'}
        </button>}
        <button type="button" className="text-xs text-orange-400" onClick={() => { setPassword(''); setConfirm(''); setError(null); if (isSetup) setRestore(!restore); else setRecovery(!recovery); }}>{isSetup ? restore ? 'Create a new vault instead' : 'Restore from a backup' : recovery ? 'Back to sign in' : 'Forgot password? Use the recovery key'}</button>
      </form>
    </div>
  );
};
