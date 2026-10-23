import React, { useEffect, useState } from 'react';
import { sessionApi } from '../services/api';

const input = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100';
function printRecoveryKey(key: string) {
  const sheet = window.open('', '_blank', 'width=700,height=500');
  if (!sheet) throw new Error('Allow a popup to print the recovery key');
  sheet.opener = null;
  sheet.document.title = 'lazylab recovery key';
  for (const [tag, text] of [['h1', 'lazylab recovery key'], ['pre', key], ['p', 'Keep this key away from the server. Anyone with the key and vault file can read your secrets.']] as const) {
    const element = sheet.document.createElement(tag);
    element.textContent = text;
    sheet.document.body.appendChild(element);
  }
  sheet.document.close();
  sheet.focus();
  sheet.print();
}

const button = 'rounded-lg bg-orange-600 px-3 py-2 text-sm text-white disabled:opacity-50';

/** Shared first-run and account restore form. A conflict always needs an explicit second submission. */
export function RestoreBackup({ setupCode, currentPassword, onRestored }: { setupCode?: string; currentPassword?: string; onRestored: () => void }) {
  const [backup, setBackup] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function restore(replaceNewer = false) {
    setBusy(true); setError('');
    try {
      await sessionApi.restore({ backup, currentPassword, setupCode, credential: useRecovery ? { recoveryKey, newPassword } : { password }, replaceNewer });
      onRestored();
    } catch (err: any) { setError(err.message); setConflict(Boolean(err.data?.conflict)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <label className="block text-xs text-zinc-400">Encrypted backup file<input className={input} type="file" accept=".json,application/json" onChange={async e => { setConflict(false); setError(''); const file = e.target.files?.[0]; if (file) { if (file.size > 8 * 1024 * 1024) { setError('Backup is too large (8 MiB maximum)'); setBackup(''); } else setBackup(await file.text()); } }} /></label>
    <label className="block text-xs text-zinc-400"><input type="checkbox" checked={useRecovery} onChange={e => { setUseRecovery(e.target.checked); setConflict(false); }} /> Use its recovery key</label>
    {useRecovery ? <><input aria-label="Backup recovery key" className={input} placeholder="Recovery key" value={recoveryKey} onChange={e => { setRecoveryKey(e.target.value); setConflict(false); }} autoComplete="off" /><input aria-label="Restored vault new password" className={input} type="password" placeholder="New password (12+ characters)" value={newPassword} onChange={e => { setNewPassword(e.target.value); setConflict(false); }} autoComplete="new-password" /></> : <input aria-label="Backup password" className={input} type="password" placeholder="Password used by this backup" value={password} onChange={e => { setPassword(e.target.value); setConflict(false); }} autoComplete="off" />}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <button type="button" className={button} disabled={busy || !backup || (useRecovery ? !recoveryKey || newPassword.length < 12 : !password)} onClick={() => restore(false)}>Restore backup</button>
    {conflict && <button type="button" className="block text-sm text-red-400" disabled={busy} onClick={() => { if (window.confirm('Replace the running vault with this older or different backup? Every device will be signed out.')) restore(true); }}>Confirm replacement of the running vault</button>}
  </div>;
}

export function VaultRecovery({ onRestored }: { onRestored: () => void }) {
  const [current, setCurrent] = useState('');
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { sessionApi.recoveryStatus().then(s => setConfigured(s.configured)).catch(() => {}); }, []);
  async function act(action: 'create' | 'remove' | 'backup') {
    setBusy(true); setMessage(''); setKey('');
    try {
      if (action === 'create') { const result = await sessionApi.createRecoveryKey(current); setKey(result.recoveryKey); setConfigured(true); }
      if (action === 'remove') { await sessionApi.removeRecoveryKey(current); setConfigured(false); }
      if (action === 'backup') {
        const { backup } = await sessionApi.backup(current);
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `lazylab-vault-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setCurrent('');
    } catch (err: any) { setMessage(err.message); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <p className="text-xs text-zinc-400">Recovery key: {configured ? 'configured' : 'not configured'}. Keep the key and encrypted backups somewhere safe away from the server.</p>
    <input aria-label="Current password for backup and recovery" className={input} type="password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" />
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !current} onClick={() => { if (!configured || window.confirm('Replace the recovery key? The previous key will stop opening the current vault.')) act('create'); }}>{configured ? 'Replace recovery key' : 'Create recovery key'}</button>{configured && <button type="button" className={button} disabled={busy || !current} onClick={() => { if (window.confirm('Remove the recovery key? Keep your password safe.')) act('remove'); }}>Remove recovery key</button>}<button type="button" className={button} disabled={busy || !current} onClick={() => act('backup')}>Download encrypted backup</button></div>
    {key && <div className="space-y-2"><p className="text-xs text-amber-300">Shown once. Save or print this key before closing. Anyone with it and the vault file can read your secrets.</p><code className="block break-all select-all text-sm">{key}</code><button type="button" className={button} onClick={() => { try { printRecoveryKey(key); } catch (err: any) { setMessage(err.message); } }}>Print recovery key</button><button type="button" className={button} onClick={() => setKey('')}>I saved it — hide key</button></div>}
    {message && <p role="alert" className="text-xs text-red-400">{message}</p>}
    <p className="text-xs text-zinc-400">Restore replaces the vault and signs out every device. Enter the current password above and select the backup below.</p>
    <RestoreBackup currentPassword={current} onRestored={onRestored} />
  </div>;
}
