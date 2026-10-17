import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Bot,
  CheckCircle2,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Lock,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  Variable
} from 'lucide-react';
import { notifyApi, sessionApi, vaultApi } from '../services/api';
import { NotifyChannelInput, NotifyChannelType, NotifyRules, NotifyState } from '../types/notify';
import { GitLabProject } from '../types/gitlab';
import { AgentTokenInfo, DeviceSession, VaultEntry, VaultEntryKind, VaultProfile } from '../types/vault';

interface VaultViewProps {
  projects: GitLabProject[];
  onProfileChanged: () => void;
  onLocked: () => void;
  showToast: (msg: string) => void;
  /** Section to open, e.g. 'notify' from the notification centre. */
  initialSection?: VaultSection;
}

export type VaultSection = 'profiles' | 'ci' | 'runner' | 'secret' | 'agent' | 'notify' | 'account';
type Section = VaultSection;

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'profiles', label: 'GitLab profiles', icon: Server },
  { id: 'ci', label: 'CI secrets', icon: Variable },
  { id: 'runner', label: 'Runner tokens', icon: Cpu },
  { id: 'secret', label: 'Secrets', icon: KeyRound },
  { id: 'agent', label: 'Agent tokens', icon: Bot },
  { id: 'notify', label: 'Notifications', icon: Bell },
  { id: 'account', label: 'Account', icon: ShieldCheck }
];

const inputClass =
  'w-full bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500 font-mono';
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-orange-600 hover:bg-orange-500 text-white`;
const btnGhost = `${btn} text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800`;
const btnDanger = `${btn} text-red-300 bg-red-950/40 hover:bg-red-900/60 border border-red-900/60`;

/** navigator.clipboard only exists in secure contexts (HTTPS or localhost); fall back to execCommand on plain HTTP. */
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

const fmtDate = (v: string | number) => new Date(v).toLocaleString();

const SecretValue: React.FC<{ kind: 'profile' | VaultEntryKind; id: string; hint: string; showToast: (m: string) => void }> = ({
  kind,
  id,
  hint,
  showToast
}) => {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setValue(null), 30_000);
    return () => clearTimeout(t);
  }, [value]);

  const fetchValue = async () => (await vaultApi.reveal(kind, id)).value;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <code className="text-[11px] text-zinc-400 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 truncate max-w-[22rem]">
        {value ?? hint}
      </code>
      <button
        title={value ? 'Hide' : 'Reveal for 30 seconds'}
        className="p-1 text-zinc-500 hover:text-zinc-200"
        onClick={async () => setValue(value ? null : await fetchValue())}
      >
        {value ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <button
        title="Copy"
        className="p-1 text-zinc-500 hover:text-zinc-200"
        onClick={async () => {
          await copyText(value ?? (await fetchValue()));
          showToast('Copied to clipboard');
        }}
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

const Card: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <section className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-4">
    <header>
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
    </header>
    {children}
  </section>
);

const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-xs text-zinc-500 italic">{text}</p>;

export const VaultView: React.FC<VaultViewProps> = ({ projects, onProfileChanged, onLocked, showToast, initialSection }) => {
  const [section, setSection] = useState<Section>(initialSection ?? 'profiles');

  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);
  const [profiles, setProfiles] = useState<VaultProfile[]>([]);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [agentTokens, setAgentTokens] = useState<AgentTokenInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await vaultApi.summary();
      setProfiles(res.profiles);
      setEntries(res.entries);
      setAgentTokens(res.agentTokens);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs a vault mutation, refreshes the summary, and surfaces errors. */
  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setError(null);
    try {
      await fn();
      await load();
      if (okMsg) showToast(okMsg);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-52 shrink-0 border-r border-zinc-800 p-3 space-y-1 bg-zinc-950">
        <div className="flex items-center gap-2 px-2 pb-3 text-sm font-semibold text-zinc-100">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Vault
        </div>
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const count =
            id === 'profiles'
              ? profiles.length
              : id === 'agent'
                ? agentTokens.length
                : id === 'account' || id === 'notify'
                  ? null
                  : entries.filter((e) => e.kind === id).length;
          return (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                section === id ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">{label}</span>
              {count !== null && <span className="text-zinc-500 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </aside>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">
        {error && <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg p-2">{error}</p>}

        {section === 'profiles' && (
          <ProfilesSection profiles={profiles} run={run} showToast={showToast} onProfileChanged={onProfileChanged} />
        )}
        {section === 'ci' && <CiSection entries={entries.filter((e) => e.kind === 'ci')} projects={projects} run={run} showToast={showToast} />}
        {section === 'runner' && (
          <EntriesSection
            kind="runner"
            title="Runner tokens"
            description="Runner authentication tokens (glrt-…). Tokens returned by Register Runner are saved here automatically."
            entries={entries.filter((e) => e.kind === 'runner')}
            run={run}
            showToast={showToast}
          />
        )}
        {section === 'secret' && (
          <EntriesSection
            kind="secret"
            title="Secrets"
            description="Free-form secrets: deploy keys, registry passwords, API keys for other services."
            entries={entries.filter((e) => e.kind === 'secret')}
            run={run}
            showToast={showToast}
          />
        )}
        {section === 'agent' && <AgentSection tokens={agentTokens} run={run} showToast={showToast} />}
        {section === 'notify' && <NotifySection run={run} showToast={showToast} />}
        {section === 'account' && <AccountSection run={run} onLocked={onLocked} />}
      </div>
    </div>
  );
};

type Run = (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;

// ---- GitLab profiles ------------------------------------------------------------

const ProfilesSection: React.FC<{ profiles: VaultProfile[]; run: Run; showToast: (m: string) => void; onProfileChanged: () => void }> = ({
  profiles,
  run,
  showToast,
  onProfileChanged
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const changed = async (fn: () => Promise<unknown>, msg: string) => {
    if (await run(fn, msg)) onProfileChanged();
  };

  return (
    <Card title="GitLab profiles" description="Host + personal access token pairs. The active profile is used for all GitLab calls; none active means demo mode.">
      {profiles.length === 0 ? (
        <Empty text="No profiles. lazylab is running in demo mode." />
      ) : (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                  {p.name}
                  {p.active && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-950/50 border border-emerald-800/60 rounded px-1.5 py-0.5">
                      <CheckCircle2 className="w-3 h-3" /> active
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 font-mono truncate">{p.host}</div>
              </div>
              <SecretValue kind="profile" id={p.id} hint={p.tokenHint} showToast={showToast} />
              {p.active ? (
                <button className={btnGhost} onClick={() => changed(() => vaultApi.deactivateProfile(), 'Switched to demo mode')}>
                  Deactivate
                </button>
              ) : (
                <button className={btnGhost} onClick={() => changed(() => vaultApi.activateProfile(p.id), `Switched to ${p.name}`)}>
                  Activate
                </button>
              )}
              <button
                className={btnDanger}
                onClick={() => confirm(`Delete profile ${p.name}?`) && changed(() => vaultApi.deleteProfile(p.id), 'Profile deleted')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1.5fr_auto] gap-2 items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await run(() => vaultApi.addProfile({ name: name || undefined, host, token, activate: true }), 'Profile verified and activated');
          setBusy(false);
          if (ok) {
            setName('');
            setToken('');
            onProfileChanged();
          }
        }}
      >
        <input className={inputClass} placeholder="name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputClass} placeholder="https://gitlab.example.com" value={host} onChange={(e) => setHost(e.target.value)} required />
        <input className={inputClass} type="password" placeholder="glpat-…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
        <button className={btnPrimary} disabled={busy}>
          <Plus className="w-3.5 h-3.5" /> {busy ? 'Verifying…' : 'Add'}
        </button>
      </form>
    </Card>
  );
};

// ---- generic entries (secrets, runner tokens) -----------------------------------

const EntryList: React.FC<{
  entries: VaultEntry[];
  run: Run;
  showToast: (m: string) => void;
  extra?: (e: VaultEntry) => React.ReactNode;
  emptyText: string;
}> = ({ entries, run, showToast, extra, emptyText }) =>
  entries.length === 0 ? (
    <Empty text={emptyText} />
  ) : (
    <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
      {entries.map((e) => (
        <li key={e.id} className="px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-zinc-100 truncate">{e.name}</div>
              <div className="text-[11px] text-zinc-500 truncate">
                {e.note ? `${e.note} · ` : ''}updated {fmtDate(e.updatedAt)}
              </div>
            </div>
            <SecretValue kind={e.kind} id={e.id} hint={e.valueHint} showToast={showToast} />
            <button className={btnDanger} onClick={() => confirm(`Delete ${e.name}?`) && run(() => vaultApi.deleteEntry(e.id), 'Deleted')}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {extra?.(e)}
        </li>
      ))}
    </ul>
  );

const AddEntryForm: React.FC<{ kind: VaultEntryKind; run: Run; namePlaceholder: string }> = ({ kind, run, namePlaceholder }) => {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1fr_auto] gap-2 items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => vaultApi.addEntry({ kind, name, value, note: note || undefined }), 'Saved to vault')) {
          setName('');
          setValue('');
          setNote('');
        }
      }}
    >
      <input className={inputClass} placeholder={namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} required />
      <input className={inputClass} type="password" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" required />
      <input className={inputClass} placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={btnPrimary}>
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
    </form>
  );
};

const EntriesSection: React.FC<{
  kind: VaultEntryKind;
  title: string;
  description: string;
  entries: VaultEntry[];
  run: Run;
  showToast: (m: string) => void;
}> = ({ kind, title, description, entries, run, showToast }) => (
  <Card title={title} description={description}>
    <EntryList
      entries={entries}
      run={run}
      showToast={showToast}
      emptyText="Nothing stored yet."
      extra={(e) =>
        e.kind === 'runner' && e.meta?.runnerId ? (
          <div className="text-[11px] text-zinc-500 font-mono">
            runner #{e.meta.runnerId} on {e.meta.host}
          </div>
        ) : null
      }
    />
    <AddEntryForm kind={kind} run={run} namePlaceholder={kind === 'runner' ? 'runner description' : 'name'} />
  </Card>
);

// ---- CI secrets ---------------------------------------------------------------

const PushForm: React.FC<{ entry: VaultEntry; projects: GitLabProject[]; run: Run; onDone: () => void }> = ({ entry, projects, run, onDone }) => {
  const [scopeType, setScopeType] = useState<'project' | 'group'>('project');
  const [scopeId, setScopeId] = useState<string>(projects[0] ? String(projects[0].id) : '');
  const [key, setKey] = useState(entry.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  const [envScope, setEnvScope] = useState('*');
  const [masked, setMasked] = useState(true);
  const [isProtected, setIsProtected] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-lg grid grid-cols-2 md:grid-cols-3 gap-2 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await run(
          () =>
            vaultApi.pushCiSecret(entry.id, {
              scope_type: scopeType,
              scope_id: Number(scopeId),
              key,
              environment_scope: envScope,
              masked,
              protected: isProtected
            }),
          `Pushed ${key} to GitLab`
        );
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <select className={inputClass} value={scopeType} onChange={(e) => setScopeType(e.target.value as 'project' | 'group')}>
        <option value="project">project</option>
        <option value="group">group</option>
      </select>
      {scopeType === 'project' && projects.length > 0 ? (
        <select className={inputClass} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.path_with_namespace || p.name}
            </option>
          ))}
        </select>
      ) : (
        <input className={inputClass} placeholder={`${scopeType} id`} value={scopeId} onChange={(e) => setScopeId(e.target.value)} required />
      )}
      <input className={inputClass} placeholder="VARIABLE_KEY" value={key} onChange={(e) => setKey(e.target.value)} required />
      <input className={inputClass} placeholder="environment scope" value={envScope} onChange={(e) => setEnvScope(e.target.value)} />
      <label className="flex items-center gap-1.5 text-zinc-400">
        <input type="checkbox" checked={masked} onChange={(e) => setMasked(e.target.checked)} /> masked
      </label>
      <label className="flex items-center gap-1.5 text-zinc-400">
        <input type="checkbox" checked={isProtected} onChange={(e) => setIsProtected(e.target.checked)} /> protected
      </label>
      <div className="col-span-2 md:col-span-3 flex gap-2">
        <button className={btnPrimary} disabled={busy}>
          <Upload className="w-3.5 h-3.5" /> {busy ? 'Pushing…' : 'Push to GitLab'}
        </button>
        <button type="button" className={btnGhost} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
};

const CiSection: React.FC<{ entries: VaultEntry[]; projects: GitLabProject[]; run: Run; showToast: (m: string) => void }> = ({
  entries,
  projects,
  run,
  showToast
}) => {
  const [pushing, setPushing] = useState<string | null>(null);
  const projectName = (id: number) => projects.find((p) => p.id === id)?.path_with_namespace || `#${id}`;

  return (
    <Card
      title="CI secrets"
      description="Values kept here and pushed to GitLab CI/CD variables using the active profile. Re-push after rotating a value."
    >
      <EntryList
        entries={entries}
        run={run}
        showToast={showToast}
        emptyText="No CI secrets yet."
        extra={(e) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(e.meta?.targets || []).map((t) => (
                <span
                  key={`${t.scope_type}-${t.scope_id}-${t.key}-${t.environment_scope}`}
                  title={`pushed ${fmtDate(t.pushedAt)}`}
                  className="text-[10px] font-mono text-sky-300 bg-sky-950/40 border border-sky-900/60 rounded px-1.5 py-0.5"
                >
                  {t.scope_type === 'project' ? projectName(t.scope_id) : `group #${t.scope_id}`} · {t.key}
                  {t.environment_scope !== '*' ? ` (${t.environment_scope})` : ''}
                </span>
              ))}
              {pushing !== e.id && (
                <button className="text-[11px] text-orange-400 hover:text-orange-300 inline-flex items-center gap-1" onClick={() => setPushing(e.id)}>
                  <Upload className="w-3 h-3" /> push to GitLab
                </button>
              )}
            </div>
            {pushing === e.id && <PushForm entry={e} projects={projects} run={run} onDone={() => setPushing(null)} />}
          </div>
        )}
      />
      <AddEntryForm kind="ci" run={run} namePlaceholder="name, e.g. NPM_TOKEN" />
    </Card>
  );
};

// ---- notifications -------------------------------------------------------------

const RULE_LABELS: { key: keyof NotifyRules; label: string; hint: string }[] = [
  { key: 'myMrPipelines', label: 'Watch my MR pipelines', hint: 'Auto-watch the running pipeline of each of your open MRs' },
  { key: 'reviewRequests', label: 'New review requests', hint: 'Notify when someone asks you to review an MR' },
  { key: 'reReview', label: 'New commits on MRs I review', hint: 'Notify when the author pushes to an MR you are reviewing' },
  { key: 'runnerOffline', label: 'Runner offline', hint: 'Notify when one of your runners stops contacting GitLab' }
];

const CHANNEL_HELP: Record<NotifyChannelType, { url: string; hint: string }> = {
  ntfy: { url: 'https://ntfy.sh', hint: 'Server URL and topic. Install the ntfy app on your phone and subscribe to the same topic. Token only for protected topics.' },
  gotify: { url: 'https://gotify.example.lan', hint: 'Server URL and an application token created in Gotify.' },
  webhook: { url: 'https://hooks.slack.com/services/…', hint: 'Any URL that accepts a JSON POST. Pick Slack or Discord for their incoming-webhook format.' }
};

const NotifySection: React.FC<{ run: Run; showToast: (m: string) => void }> = ({ run, showToast }) => {
  const [state, setState] = useState<NotifyState | null>(null);
  const [form, setForm] = useState<NotifyChannelInput>({ type: 'ntfy', name: '', url: CHANNEL_HELP.ntfy.url, topic: '', events: 'all' });
  const [testing, setTesting] = useState<string | null>(null);

  const reload = useCallback(async () => setState(await notifyApi.state()), []);
  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    const ok = await run(fn, msg);
    await reload().catch(() => undefined);
    return ok;
  };

  const setType = (type: NotifyChannelType) =>
    setForm({ type, name: form.name, url: CHANNEL_HELP[type].url, events: form.events, format: type === 'webhook' ? 'json' : undefined });

  return (
    <>
      <Card title="Rules" description="What lazylab watches for you in the background. Notifications appear in the bell menu, as desktop notifications, and on every enabled channel below.">
        <div className="space-y-2">
          {RULE_LABELS.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-orange-500"
                checked={state?.rules[key] ?? false}
                disabled={!state}
                onChange={(e) => act(() => notifyApi.updateRules({ [key]: e.target.checked }))}
              />
              <span>
                <span className="text-zinc-100">{label}</span>
                <span className="block text-zinc-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Push channels" description="Deliver notifications to your phone or chat while you are away from the browser. Tokens and webhook URLs are stored encrypted in the vault.">
        {!state || state.channels.length === 0 ? (
          <Empty text="No channels. Browser notifications only." />
        ) : (
          <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
            {state.channels.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
                    {c.name}
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">
                      {c.type}
                      {c.format && c.format !== 'json' ? `·${c.format}` : ''}
                    </span>
                    {c.events === 'failures' && <span className="text-[10px] text-rose-300">failures only</span>}
                  </div>
                  <div className="text-[11px] text-zinc-500 font-mono truncate">
                    {c.urlHint}
                    {c.topic ? ` / ${c.topic}` : ''}
                    {c.tokenHint ? ` · token ${c.tokenHint}` : ''}
                  </div>
                  {c.lastError ? (
                    <div className="text-[11px] text-red-400 truncate">Last error: {c.lastError}</div>
                  ) : c.lastDeliveredAt ? (
                    <div className="text-[11px] text-emerald-400">Last delivered {fmtDate(c.lastDeliveredAt)}</div>
                  ) : null}
                </div>
                <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <input
                    type="checkbox"
                    className="accent-orange-500"
                    checked={c.enabled}
                    onChange={(e) => act(() => notifyApi.updateChannel(c.id, { enabled: e.target.checked }))}
                  />
                  on
                </label>
                <button
                  className={btnGhost}
                  disabled={testing === c.id}
                  onClick={async () => {
                    setTesting(c.id);
                    await act(() => notifyApi.testChannel(c.id), 'Test notification sent');
                    setTesting(null);
                  }}
                >
                  {testing === c.id ? 'Sending…' : 'Test'}
                </button>
                <button className={btnDanger} onClick={() => confirm(`Delete channel ${c.name}?`) && act(() => notifyApi.deleteChannel(c.id), 'Channel deleted')}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-2 border-t border-zinc-800 pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => notifyApi.addChannel(form), 'Channel added')) {
              setForm({ ...form, name: '', token: '', topic: '' });
            }
          }}
        >
          <div className="flex gap-2">
            <select className={`${inputClass} w-32`} value={form.type} onChange={(e) => setType(e.target.value as NotifyChannelType)}>
              <option value="ntfy">ntfy</option>
              <option value="gotify">Gotify</option>
              <option value="webhook">Webhook</option>
            </select>
            <input className={inputClass} placeholder="name, e.g. phone" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <select className={`${inputClass} w-36`} value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value as 'all' | 'failures' })}>
              <option value="all">all events</option>
              <option value="failures">failures only</option>
            </select>
          </div>
          <input className={inputClass} placeholder={CHANNEL_HELP[form.type].url} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          <div className="flex gap-2">
            {form.type === 'ntfy' && (
              <input className={inputClass} placeholder="topic" value={form.topic ?? ''} onChange={(e) => setForm({ ...form, topic: e.target.value })} required />
            )}
            {form.type !== 'webhook' && (
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                placeholder={form.type === 'gotify' ? 'application token' : 'access token (optional)'}
                value={form.token ?? ''}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                required={form.type === 'gotify'}
              />
            )}
            {form.type === 'webhook' && (
              <select className={`${inputClass} w-40`} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as 'json' | 'slack' | 'discord' })}>
                <option value="json">plain JSON</option>
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
              </select>
            )}
            <button className={btnPrimary} type="submit">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">{CHANNEL_HELP[form.type].hint}</p>
        </form>
      </Card>
    </>
  );
};

// ---- agent tokens -------------------------------------------------------------

/** Ready-to-paste client setup for a new agent token: MCP for Claude Code and Codex, REST for scripts. */
const AgentSetupSnippets: React.FC<{ token: string; showToast: (m: string) => void }> = ({ token, showToast }) => {
  const [tab, setTab] = useState<'claude' | 'codex' | 'rest'>('claude');
  const origin = window.location.origin;
  const snippets = {
    claude: `claude mcp add --transport http lazylab ${origin}/mcp \\\n  --header "Authorization: Bearer ${token}"`,
    codex: `# ~/.codex/config.toml\n[mcp_servers.lazylab]\nurl = "${origin}/mcp"\nbearer_token_env_var = "LAZYLAB_TOKEN"\n\n# shell profile\nexport LAZYLAB_TOKEN=${token}`,
    rest: `export LAZYLAB_TOKEN=${token}\ncurl -H "Authorization: Bearer $LAZYLAB_TOKEN" ${origin}/api/agent/inbox`
  };
  const labels = { claude: 'Claude Code (MCP)', codex: 'Codex (MCP)', rest: 'REST / scripts' };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-2 py-0.5 rounded text-[11px] ${tab === k ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            {labels[k]}
          </button>
        ))}
      </div>
      <div className="relative">
        <pre className="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-all bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 pr-9">
          {snippets[tab]}
        </pre>
        <button
          className="absolute top-1 right-1 p-1 text-zinc-500 hover:text-zinc-200"
          title="Copy setup"
          onClick={async () => {
            await copyText(snippets[tab]);
            showToast('Copied');
          }}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const AgentSection: React.FC<{ tokens: AgentTokenInfo[]; run: Run; showToast: (m: string) => void }> = ({ tokens, run, showToast }) => {
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);

  return (
    <Card
      title="Agent tokens"
      description="Bearer tokens for the MCP server at /mcp and for /api/agent/* (Claude Code, Codex, Antigravity, scripts). Shown once at creation; only a hash is stored."
    >
      {created && (
        <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded-lg space-y-2">
          <p className="text-xs text-emerald-300">Copy this token now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono text-zinc-100 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 break-all">{created}</code>
            <button
              className={btnGhost}
              onClick={async () => {
                await copyText(created);
                showToast('Token copied');
              }}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <AgentSetupSnippets token={created} showToast={showToast} />
          <button className={btnGhost} onClick={() => setCreated(null)}>
            Done
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <Empty text="No agent tokens." />
      ) : (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-zinc-100">{t.name}</div>
                <div className="text-[11px] text-zinc-500 font-mono">
                  {t.prefix}… · created {fmtDate(t.createdAt)}
                </div>
              </div>
              <button className={btnDanger} onClick={() => confirm(`Revoke ${t.name}?`) && run(() => vaultApi.deleteAgentToken(t.id), 'Token revoked')}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          let token = '';
          if (await run(async () => (token = (await vaultApi.createAgentToken(name)).token))) {
            setCreated(token);
            setName('');
          }
        }}
      >
        <input className={inputClass} placeholder="name, e.g. laptop-claude-code" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className={btnPrimary}>
          <Plus className="w-3.5 h-3.5" /> Create
        </button>
      </form>
    </Card>
  );
};

// ---- account ------------------------------------------------------------------

const AccountSection: React.FC<{ run: Run; onLocked: () => void }> = ({ run, onLocked }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    sessionApi.devices().then((r) => setDevices(r.devices)).catch(() => setDevices([]));
  }, []);

  return (
    <>
      <Card title="Signed-in devices" description="Sessions are held in memory. Restarting the server or locking the vault signs every device out.">
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
          {devices.map((d, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2 text-xs">
              <Laptop className="w-4 h-4 text-zinc-500" />
              <div className="flex-1 min-w-0">
                <div className="text-zinc-200 truncate">
                  {d.ip} {d.current && <span className="text-emerald-400">(this device)</span>}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">{d.userAgent}</div>
              </div>
              <span className="text-[11px] text-zinc-500">last seen {fmtDate(d.lastSeen)}</span>
            </li>
          ))}
        </ul>
        <button
          className={btnDanger}
          onClick={async () => {
            if (!confirm('Lock the vault? Every device is signed out and GitLab sync stops until someone signs in again.')) return;
            if (await run(() => sessionApi.lock())) onLocked();
          }}
        >
          <Lock className="w-3.5 h-3.5" /> Lock vault now
        </button>
      </Card>

      <Card title="Change password" description="Re-encrypts the vault key with the new password. Stored secrets are unchanged.">
        <form
          className="grid grid-cols-1 md:grid-cols-3 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setLocalError(null);
            if (next !== confirmNext) {
              setLocalError('New passwords do not match.');
              return;
            }
            if (await run(() => sessionApi.changePassword(current, next), 'Password changed')) {
              setCurrent('');
              setNext('');
              setConfirmNext('');
            }
          }}
        >
          <input className={inputClass} type="password" placeholder="current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <input className={inputClass} type="password" placeholder="new password (12+ chars)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
          <input className={inputClass} type="password" placeholder="confirm new password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} autoComplete="new-password" required />
          {localError && <p className="md:col-span-3 text-xs text-red-400">{localError}</p>}
          <div>
            <button className={btnPrimary}>Change password</button>
          </div>
        </form>
      </Card>
    </>
  );
};
