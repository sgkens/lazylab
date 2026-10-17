import React, { useState, useEffect } from 'react';
import {
  Key,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  Plus,
  Trash2,
  FileText,
  Shield,
  Search,
  Filter,
  RefreshCw,
  FolderGit2,
  Users,
  X,
  AlertCircle,
  Download,
  Upload,
  CopyPlus,
  FileDown
} from 'lucide-react';
import { GitLabProject, GitLabVariable } from '../types/gitlab';
import { api } from '../services/api';

interface VariablesViewProps {
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

export const VariablesView: React.FC<VariablesViewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject
}) => {
  const currentProjectId = selectedProjectId || (projects.length > 0 ? projects[0].id : 901);
  const [variables, setVariables] = useState<GitLabVariable[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'project' | 'group'>('all');
  const [envFilter, setEnvFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importScope, setImportScope] = useState<'project' | 'group'>('project');
  const [isImporting, setIsImporting] = useState(false);

  const [formData, setFormData] = useState<{
    key: string;
    value: string;
    variable_type: 'env_var' | 'file';
    protected: boolean;
    masked: boolean;
    environment_scope: string;
    scope_type: 'project' | 'group';
  }>({
    key: '',
    value: '',
    variable_type: 'env_var',
    protected: false,
    masked: true,
    environment_scope: '*',
    scope_type: 'project'
  });

  useEffect(() => {
    loadVariables();
  }, [currentProjectId]);

  const loadVariables = async () => {
    try {
      setIsLoading(true);
      const [projRes, grpRes] = await Promise.all([
        api.getVariables('project', currentProjectId),
        api.getVariables('group', 101)
      ]);
      const combined: GitLabVariable[] = [
        ...(projRes.success ? projRes.variables : []),
        ...(grpRes.success ? grpRes.variables : [])
      ];
      setVariables(combined);
    } catch (err) {
      console.error('Failed to load variables:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleReveal = (varKey: string) => {
    setRevealedKeys((prev) => ({
      ...prev,
      [varKey]: !prev[varKey]
    }));
  };

  const handleCopy = (value: string, id: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleClone = (v: GitLabVariable) => {
    setFormData({
      key: `${v.key}_COPY`,
      value: v.value,
      variable_type: v.variable_type,
      protected: v.protected,
      masked: v.masked,
      environment_scope: v.environment_scope,
      scope_type: v.scope_type as any
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (v: GitLabVariable) => {
    if (!confirm(`Delete variable "${v.key}" from ${v.scope_type} scope?`)) return;
    try {
      const res = await api.deleteVariable(v.scope_type as any, v.scope_id, v.key);
      if (res.success) {
        setVariables(variables.filter((item) => !(item.key === v.key && item.scope_type === v.scope_type)));
      }
    } catch (err) {
      console.error('Failed to delete variable:', err);
    }
  };

  const handleSaveVariable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.key.trim() || !formData.value.trim()) return;

    try {
      const targetScopeId = formData.scope_type === 'project' ? currentProjectId : 101;
      const targetScopeName =
        formData.scope_type === 'project'
          ? (projects.find((p) => p.id === currentProjectId)?.name || 'Current Project')
          : 'platform (Group)';

      const payload: GitLabVariable = {
        ...formData,
        key: formData.key.trim().toUpperCase(),
        value: formData.value,
        scope_id: targetScopeId,
        scope_name: targetScopeName
      };

      const res = await api.saveVariable(payload);
      if (res.success) {
        const index = variables.findIndex(
          (v) => v.key === payload.key && v.scope_type === payload.scope_type
        );
        if (index >= 0) {
          const updated = [...variables];
          updated[index] = res.variable;
          setVariables(updated);
        } else {
          setVariables([res.variable, ...variables]);
        }
        setIsModalOpen(false);
        setFormData({
          key: '',
          value: '',
          variable_type: 'env_var',
          protected: false,
          masked: true,
          environment_scope: '*',
          scope_type: 'project'
        });
      }
    } catch (err) {
      console.error('Failed to save variable:', err);
    }
  };

  const handleBulkImport = async () => {
    if (!importText.trim()) return;
    try {
      setIsImporting(true);
      const lines = importText.split('\n');
      const targetScopeId = importScope === 'project' ? currentProjectId : 101;
      const targetScopeName =
        importScope === 'project'
          ? (projects.find((p) => p.id === currentProjectId)?.name || 'Current Project')
          : 'platform (Group)';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const key = trimmed.slice(0, eqIdx).trim().toUpperCase();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        if (key && value) {
          await api.saveVariable({
            key,
            value,
            variable_type: 'env_var',
            protected: false,
            masked: true,
            environment_scope: '*',
            scope_type: importScope,
            scope_id: targetScopeId,
            scope_name: targetScopeName
          });
        }
      }

      await loadVariables();
      setIsImportModalOpen(false);
      setImportText('');
    } catch (err) {
      console.error('Failed to import variables:', err);
    } finally {
      setIsImporting(false);
    }
  };

  const generateEnvFileContent = () => {
    const header = `# GitLab CI/CD Variables Export\n# Project ID: ${currentProjectId}\n# Exported on: ${new Date().toISOString()}\n\n`;
    const lines = filteredVars.map((v) => `${v.key}="${v.value}"`).join('\n');
    return header + lines;
  };

  const handleDownloadEnvFile = () => {
    const text = generateEnvFileContent();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `.env.gitlab-ci`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const allEnvs = Array.from(new Set(variables.map((v) => v.environment_scope)));

  const filteredVars = variables.filter((v) => {
    if (scopeFilter !== 'all' && v.scope_type !== scopeFilter) return false;
    if (envFilter !== 'all' && v.environment_scope !== envFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return v.key.toLowerCase().includes(q) || v.environment_scope.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-zinc-900/60 border-b border-zinc-800 text-xs shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Project Selector */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 font-medium">Project:</span>
            <select
              value={currentProjectId}
              onChange={(e) => onSelectProject(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Scope Filters */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
            <button
              onClick={() => setScopeFilter('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                scopeFilter === 'all' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All Scopes ({variables.length})
            </button>
            <button
              onClick={() => setScopeFilter('project')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                scopeFilter === 'project' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5 text-orange-400" />
              <span>Project Scoped</span>
            </button>
            <button
              onClick={() => setScopeFilter('group')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                scopeFilter === 'group' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-purple-400" />
              <span>Group / Namespace</span>
            </button>
          </div>

          {/* Environment Scope Filter */}
          <div className="flex items-center gap-1.5 text-zinc-500">
            <span>Env:</span>
            <select
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
            >
              <option value="all">All Envs</option>
              {allEnvs.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search variable key or environment..."
              className="w-40 sm:w-56 pl-8 pr-3 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-mono"
            />
          </div>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
            title="Bulk import from .env file format"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Import .env</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
            title="Export variables as .env file for local development"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Export .env</span>
          </button>

          <button
            onClick={loadVariables}
            disabled={isLoading}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh variables"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-orange-400' : ''}`} />
          </button>

          <button
            onClick={() => {
              setFormData({
                key: '',
                value: '',
                variable_type: 'env_var',
                protected: false,
                masked: true,
                environment_scope: '*',
                scope_type: 'project'
              });
              setIsModalOpen(true);
            }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Variable</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-orange-400" />
              <span>CI/CD Variables (Project & Group Scoped)</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Secure environment variables and file keys injected into GitLab CI/CD runner execution jobs.
            </p>
          </div>
        </div>

        {isLoading && variables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <RefreshCw className="w-6 h-6 animate-spin text-orange-400 mb-2" />
            <span>Loading CI/CD variables...</span>
          </div>
        ) : filteredVars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-900/30 rounded-xl border border-zinc-800/60 p-6">
            <Key className="w-10 h-10 text-zinc-600 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-300">No variables found</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">
              Add secrets, cloud credentials, or import a .env file to supply environment variables for your pipeline jobs.
            </p>
          </div>
        ) : (
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800 uppercase font-mono text-[11px] tracking-wider">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Key / Identifier</th>
                    <th className="px-4 py-3 font-semibold">Scope</th>
                    <th className="px-4 py-3 font-semibold">Value</th>
                    <th className="px-4 py-3 font-semibold">Environment</th>
                    <th className="px-4 py-3 font-semibold">Attributes</th>
                    <th className="px-5 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredVars.map((v) => {
                    const uniqueId = `${v.scope_type}:${v.key}`;
                    const isRevealed = revealedKeys[uniqueId];

                    return (
                      <tr key={uniqueId} className="hover:bg-zinc-900/50 transition-colors">
                        {/* Key */}
                        <td className="px-5 py-3.5 font-mono font-bold text-white whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-orange-400">{v.key}</span>
                            {v.variable_type === 'file' && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                File
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Scope */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {v.scope_type === 'project' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                              <FolderGit2 className="w-3 h-3 text-orange-400" />
                              Project
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">
                              <Users className="w-3 h-3 text-purple-400" />
                              Group: {v.scope_name || 'platform'}
                            </span>
                          )}
                        </td>

                        {/* Value */}
                        <td className="px-4 py-3.5 font-mono text-zinc-300">
                          <div className="flex items-center gap-2 max-w-xs">
                            <span className="truncate">
                              {isRevealed || !v.masked
                                ? v.value
                                : '••••••••••••••••••••••••'}
                            </span>
                            {v.masked && (
                              <button
                                onClick={() => toggleReveal(uniqueId)}
                                className="text-zinc-500 hover:text-zinc-300 shrink-0"
                                title={isRevealed ? 'Mask value' : 'Reveal value'}
                              >
                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            <button
                              onClick={() => handleCopy(v.value, uniqueId)}
                              className="text-zinc-500 hover:text-zinc-300 shrink-0"
                              title="Copy value"
                            >
                              {copiedKey === uniqueId ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Environment Scope */}
                        <td className="px-4 py-3.5 whitespace-nowrap font-mono text-zinc-400">
                          <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[11px]">
                            {v.environment_scope}
                          </span>
                        </td>

                        {/* Attributes */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {v.protected && (
                              <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                                <Shield className="w-2.5 h-2.5" />
                                Protected
                              </span>
                            )}
                            {v.masked && (
                              <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60">
                                <Lock className="w-2.5 h-2.5" />
                                Masked
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleClone(v)}
                              className="p-1.5 text-zinc-500 hover:text-orange-400 hover:bg-zinc-800 rounded transition-colors"
                              title="Duplicate / Clone variable"
                            >
                              <CopyPlus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(v)}
                              className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition-colors"
                              title="Delete variable"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Variable Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-orange-400" />
                <span>Configure CI/CD Variable</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVariable} className="mt-4 space-y-4 text-xs font-mono">
              {/* Scope Selector */}
              <div>
                <label className="text-zinc-400 font-semibold block mb-1">Variable Target Scope</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, scope_type: 'project' })}
                    className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-colors ${
                      formData.scope_type === 'project'
                        ? 'bg-orange-950/40 border-orange-500 text-white'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    <FolderGit2 className="w-4 h-4 text-orange-400" />
                    <div>
                      <span className="font-bold block">Project Scoped</span>
                      <span className="text-[10px] text-zinc-500 block truncate">Current project only</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, scope_type: 'group' })}
                    className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-colors ${
                      formData.scope_type === 'group'
                        ? 'bg-purple-950/40 border-purple-500 text-white'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    <Users className="w-4 h-4 text-purple-400" />
                    <div>
                      <span className="font-bold block">Group Scoped</span>
                      <span className="text-[10px] text-zinc-500 block truncate">Inherited across group</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Key */}
              <div>
                <label className="text-zinc-400 font-semibold block mb-1">
                  Key Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                  placeholder="e.g. AWS_ACCESS_KEY_ID, DEPLOY_TOKEN"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Value */}
              <div>
                <label className="text-zinc-400 font-semibold block mb-1">
                  Value <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  placeholder="Secret key, certificate contents, or API credentials..."
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-orange-500 resize-none"
                />
              </div>

              {/* Environment Scope */}
              <div>
                <label className="text-zinc-400 font-semibold block mb-1">
                  Environment Scope
                </label>
                <input
                  type="text"
                  value={formData.environment_scope}
                  onChange={(e) => setFormData({ ...formData, environment_scope: e.target.value })}
                  placeholder="* (All environments) or production, staging"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.masked}
                    onChange={(e) => setFormData({ ...formData, masked: e.target.checked })}
                    className="rounded bg-zinc-900 border-zinc-700 text-orange-600 focus:ring-0"
                  />
                  <div>
                    <span className="text-zinc-200 font-bold block">Mask Variable</span>
                    <span className="text-[11px] text-zinc-500 block">
                      Prevent value from printing in CI execution logs
                    </span>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.protected}
                    onChange={(e) => setFormData({ ...formData, protected: e.target.checked })}
                    className="rounded bg-zinc-900 border-zinc-700 text-orange-600 focus:ring-0"
                  />
                  <div>
                    <span className="text-zinc-200 font-bold block">Protected Variable</span>
                    <span className="text-[11px] text-zinc-500 block">
                      Only inject into pipelines on protected branches or tags
                    </span>
                  </div>
                </label>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded font-semibold text-white bg-orange-600 hover:bg-orange-500 transition-colors shadow-sm"
                >
                  Save Variable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk .env Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-sky-400" />
                <span>Bulk Import from .env file</span>
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs font-mono">
              <p className="text-zinc-400">
                Paste the contents of your <code className="text-orange-400 font-bold">.env</code> or credentials file below. Each line formatted as <code className="text-zinc-300">KEY=VALUE</code> will be parsed and registered.
              </p>

              <div>
                <label className="text-zinc-400 font-semibold block mb-1">Import Destination</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setImportScope('project')}
                    className={`px-3 py-1.5 rounded-md border text-xs font-mono transition-colors ${
                      importScope === 'project'
                        ? 'bg-orange-950/60 border-orange-500 text-orange-200'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    Project Scope
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportScope('group')}
                    className={`px-3 py-1.5 rounded-md border text-xs font-mono transition-colors ${
                      importScope === 'group'
                        ? 'bg-purple-950/60 border-purple-500 text-purple-200'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    Group Scope
                  </button>
                </div>
              </div>

              <div>
                <textarea
                  rows={6}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`DATABASE_URL=postgres://user:pass@db.internal:5432/main\nAPI_SECRET_KEY=sk_live_901238491823\nSENTRY_DSN=https://abc@sentry.io/123`}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-orange-500 resize-none text-xs leading-5"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkImport}
                  disabled={isImporting || !importText.trim()}
                  className="px-4 py-2 rounded font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-1.5"
                >
                  {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  <span>Import All Variables</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export .env Modal */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Export Variables (.env format)</span>
              </h3>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs font-mono">
              <p className="text-zinc-400">
                Variables formatted for your local development or container debugging environment:
              </p>

              <pre className="p-3 bg-black rounded-lg border border-zinc-800 text-zinc-300 max-h-48 overflow-y-auto whitespace-pre leading-relaxed select-all">
                {generateEnvFileContent()}
              </pre>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generateEnvFileContent());
                    setCopiedKey('export_all');
                    setTimeout(() => setCopiedKey(null), 2000);
                  }}
                  className="px-4 py-2 rounded text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors flex items-center gap-1.5"
                >
                  {copiedKey === 'export_all' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'export_all' ? 'Copied!' : 'Copy to Clipboard'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadEnvFile}
                  className="px-4 py-2 rounded font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-sm flex items-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Download .env File</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
