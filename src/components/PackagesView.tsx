import React, { useState, useEffect } from 'react';
import {
  Package,
  Boxes,
  FileCode,
  Layers,
  Search,
  Filter,
  Download,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Clock,
  Terminal,
  FolderArchive,
  Tag,
  Hash,
  X,
  HardDrive,
  FileDown,
  Key
} from 'lucide-react';
import { GitLabPackage, GitLabProject, PackageType } from '../types/gitlab';
import { api } from '../services/api';

interface PackagesViewProps {
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

export const PackagesView: React.FC<PackagesViewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject
}) => {
  const [packages, setPackages] = useState<GitLabPackage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<GitLabPackage | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    loadPackages();
  }, [selectedProjectId, typeFilter]);

  const loadPackages = async () => {
    try {
      setIsLoading(true);
      const res = await api.getPackages(selectedProjectId || undefined, typeFilter);
      if (res.success) {
        setPackages(res.packages);
      }
    } catch (err) {
      console.error('Failed to load packages:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const getPackageTypeBadge = (type: PackageType) => {
    switch (type) {
      case 'npm':
        return <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-rose-950/60 text-rose-300 border border-rose-800/60">npm</span>;
      case 'maven':
        return <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-orange-950/60 text-orange-300 border border-orange-800/60">maven</span>;
      case 'pypi':
        return <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-sky-950/60 text-sky-300 border border-sky-800/60">PyPI</span>;
      case 'container':
        return <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-blue-950/60 text-blue-300 border border-blue-800/60">Container</span>;
      case 'generic':
        return <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">Generic</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-zinc-800 text-zinc-300 border border-zinc-700">{type}</span>;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const handleExportSbom = () => {
    const sbom = {
      generator: 'LabWI Package Manager',
      exported_at: new Date().toISOString(),
      project_id: selectedProjectId || 'all',
      packages_count: filteredPackages.length,
      packages: filteredPackages.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        type: p.package_type,
        created_at: p.created_at,
        files: p.package_files?.map((f) => ({
          name: f.file_name,
          size_bytes: f.size,
          sha256: f.file_sha256
        }))
      }))
    };
    const blob = new Blob([JSON.stringify(sbom, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gitlab-packages-manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Compute storage statistics
  const totalSizeBytes = packages.reduce((acc, p) => {
    const filesSize = p.package_files?.reduce((facc, f) => facc + (f.size || 0), 0) || 0;
    return acc + filesSize;
  }, 0);

  const filteredPackages = packages.filter((pkg) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!pkg.name.toLowerCase().includes(q) && !pkg.version.toLowerCase().includes(q)) {
        return false;
      }
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
              value={selectedProjectId || ''}
              onChange={(e) => onSelectProject(e.target.value ? Number(e.target.value) : 0)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Package Type Filters */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
            {['all', 'npm', 'maven', 'pypi', 'container', 'generic'].map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2.5 py-1 rounded capitalize transition-colors ${
                  typeFilter === type
                    ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Actions Cluster */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search package name or version..."
              className="w-40 sm:w-56 pl-8 pr-3 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-mono"
            />
          </div>

          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
            title="Registry Auth & Login snippets"
          >
            <Key className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Registry Auth</span>
          </button>

          <button
            onClick={handleExportSbom}
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
            title="Export package registry inventory as JSON"
          >
            <FileDown className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Export Manifest</span>
          </button>

          <button
            onClick={loadPackages}
            disabled={isLoading}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh package list"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-orange-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="p-6">
        {/* Registry Summary Card */}
        <div className="mb-6 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Boxes className="w-5 h-5 text-orange-400" />
              <span>GitLab Packages & Container Registry</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Read-only registry viewer for npm, Maven, PyPI, Docker container images, and generic release bundles.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
              <HardDrive className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-zinc-500">Registry Storage:</span>
              <span className="text-white font-bold">{formatFileSize(totalSizeBytes)}</span>
            </div>
            <div className="bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400">
              <span className="text-white font-bold">{packages.length}</span> total packages
            </div>
          </div>
        </div>

        {isLoading && packages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <RefreshCw className="w-6 h-6 animate-spin text-orange-400 mb-2" />
            <span>Loading package registries...</span>
          </div>
        ) : filteredPackages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-900/30 rounded-xl border border-zinc-800/60 p-6">
            <Package className="w-10 h-10 text-zinc-600 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-300">No packages found</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">
              No packages match the current filter. Ensure builds in your pipelines publish artifacts to the GitLab Package Registry.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPackages.map((pkg) => {
              const fileCount = pkg.package_files?.length || 1;
              const totalSize = pkg.package_files?.reduce((acc, f) => acc + (f.size || 0), 0) || 0;

              return (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackage(pkg)}
                  className="bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between group shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {getPackageTypeBadge(pkg.package_type)}
                          <span className="text-xs font-mono text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded">
                            v{pkg.version}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white group-hover:text-orange-400 transition-colors truncate font-mono">
                          {pkg.name}
                        </h4>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-orange-400 transition-colors shrink-0" />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono mt-3">
                      <span className="flex items-center gap-1">
                        <FolderArchive className="w-3.5 h-3.5 text-zinc-500" />
                        {fileCount} {fileCount === 1 ? 'file' : 'files'}
                      </span>
                      {totalSize > 0 && (
                        <span>• {formatFileSize(totalSize)}</span>
                      )}
                    </div>

                    {pkg.tags && pkg.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {pkg.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800"
                          >
                            <Tag className="w-2.5 h-2.5 text-orange-400" />
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 mt-4 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-500">
                    <span>{pkg.project_name || 'Project'}</span>
                    <span>{new Date(pkg.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Package Detail Modal */}
      {selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-zinc-800 text-orange-400">
                  <Package className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {getPackageTypeBadge(selectedPackage.package_type)}
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                      v{selectedPackage.version}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white truncate font-mono mt-0.5">
                    {selectedPackage.name}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => setSelectedPackage(null)}
                className="text-zinc-500 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Installation Snippet */}
              {selectedPackage.install_command && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                      Quick Install Command
                    </span>
                    <button
                      onClick={() => handleCopy(selectedPackage.install_command!, 'install-cmd')}
                      className="text-xs font-mono text-zinc-400 hover:text-orange-400 flex items-center gap-1 transition-colors"
                    >
                      {copiedText === 'install-cmd' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="bg-black border border-zinc-800 rounded-lg p-3 font-mono text-xs text-zinc-200 overflow-x-auto">
                    <code>{selectedPackage.install_command}</code>
                  </div>
                </div>
              )}

              {/* Package Metadata */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-xs">
                <div>
                  <span className="text-zinc-500 block">Package Type</span>
                  <span className="font-semibold text-zinc-200 capitalize">{selectedPackage.package_type}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Status</span>
                  <span className="font-semibold text-emerald-400 capitalize">{selectedPackage.status}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Published</span>
                  <span className="font-mono text-zinc-200">{new Date(selectedPackage.created_at).toLocaleDateString()}</span>
                </div>
                {selectedPackage.pipeline_id && (
                  <div>
                    <span className="text-zinc-500 block">Pipeline</span>
                    <span className="font-mono text-orange-400">#{selectedPackage.pipeline_id}</span>
                  </div>
                )}
                {selectedPackage.project_name && (
                  <div className="col-span-2">
                    <span className="text-zinc-500 block">Project</span>
                    <span className="text-zinc-300 truncate block">{selectedPackage.project_name}</span>
                  </div>
                )}
              </div>

              {/* Package Files & Checksums */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FolderArchive className="w-3.5 h-3.5 text-zinc-400" />
                  Package Artifact Files ({selectedPackage.package_files?.length || 0})
                </h4>

                <div className="space-y-2">
                  {selectedPackage.package_files && selectedPackage.package_files.length > 0 ? (
                    selectedPackage.package_files.map((file) => (
                      <div
                        key={file.id}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-white break-all">{file.file_name}</span>
                          <span className="font-mono text-zinc-400 shrink-0">{formatFileSize(file.size)}</span>
                        </div>

                        {file.file_sha256 && (
                          <div className="flex items-center justify-between gap-2 bg-black/60 p-2 rounded border border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                            <span className="truncate">
                              <span className="text-zinc-500">SHA256: </span>
                              {file.file_sha256}
                            </span>
                            <button
                              onClick={() => handleCopy(file.file_sha256!, `sha-${file.id}`)}
                              className="text-zinc-400 hover:text-white shrink-0"
                              title="Copy SHA256 checksum"
                            >
                              {copiedText === `sha-${file.id}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-xs text-zinc-500 bg-zinc-900/40 rounded-lg border border-zinc-800">
                      No standalone file records attached to this package manifest.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedPackage(null)}
                className="px-4 py-2 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registry Auth Snippets Modal */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-400" />
                <span>Container & Package Registry Authentication</span>
              </h3>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs font-mono">
              <div>
                <span className="text-zinc-400 font-semibold block mb-1">Docker / Podman CLI Login</span>
                <div className="bg-black p-3 rounded border border-zinc-800 text-zinc-200 text-[11px] leading-relaxed flex items-center justify-between gap-2">
                  <code className="break-all">docker login registry.gitlab.com -u &lt;username&gt; -p &lt;personal-access-token&gt;</code>
                  <button
                    onClick={() => handleCopy('docker login registry.gitlab.com -u <username> -p <personal-access-token>', 'docker-login')}
                    className="text-zinc-400 hover:text-white shrink-0"
                  >
                    {copiedText === 'docker-login' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-zinc-400 font-semibold block mb-1">npm Registry Configuration (.npmrc)</span>
                <div className="bg-black p-3 rounded border border-zinc-800 text-zinc-200 text-[11px] leading-relaxed flex items-center justify-between gap-2">
                  <code className="break-all">@labwi:registry=https://gitlab.com/api/v4/packages/npm/<br/>//gitlab.com/api/v4/packages/npm/:_authToken=&lt;token&gt;</code>
                  <button
                    onClick={() => handleCopy('@labwi:registry=https://gitlab.com/api/v4/packages/npm/\n//gitlab.com/api/v4/packages/npm/:_authToken=<token>', 'npm-login')}
                    className="text-zinc-400 hover:text-white shrink-0"
                  >
                    {copiedText === 'npm-login' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-zinc-400 font-semibold block mb-1">PyPI pip Configuration (~/.pip/pip.conf)</span>
                <div className="bg-black p-3 rounded border border-zinc-800 text-zinc-200 text-[11px] leading-relaxed flex items-center justify-between gap-2">
                  <code className="break-all">[global]<br/>extra-index-url = https://__token__:&lt;token&gt;@gitlab.com/api/v4/packages/pypi/simple</code>
                  <button
                    onClick={() => handleCopy('[global]\nextra-index-url = https://__token__:<token>@gitlab.com/api/v4/packages/pypi/simple', 'pypi-login')}
                    className="text-zinc-400 hover:text-white shrink-0"
                  >
                    {copiedText === 'pypi-login' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 text-[11px] text-zinc-500">
                Tokens need <code className="text-zinc-400">read_package_registry</code> or <code className="text-zinc-400">read_registry</code> scope.
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="px-4 py-2 rounded text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
