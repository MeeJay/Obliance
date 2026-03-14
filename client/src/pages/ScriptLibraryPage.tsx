import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Terminal, Edit, Trash2, RefreshCw, Code, Tag } from 'lucide-react';
import { scriptApi } from '@/api/script.api';
import { useDeviceStore } from '@/store/deviceStore';
import type { Script, ScriptCategory, ScriptPlatform, ScriptRuntime } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

const PLATFORM_LABELS: Record<ScriptPlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  all: 'All platforms',
};

const RUNTIME_LABELS: Record<ScriptRuntime, string> = {
  powershell: 'PowerShell',
  pwsh: 'PowerShell Core',
  cmd: 'CMD',
  bash: 'Bash',
  zsh: 'Zsh',
  sh: 'Shell',
  python: 'Python',
  python3: 'Python 3',
  perl: 'Perl',
  ruby: 'Ruby',
};

interface ScriptFormData {
  name: string;
  description: string;
  platform: ScriptPlatform;
  runtime: ScriptRuntime;
  content: string;
  timeoutSeconds: number;
  runAs: 'system' | 'user';
  tags: string;
  categoryId: number | null;
}

const defaultForm: ScriptFormData = {
  name: '',
  description: '',
  platform: 'all',
  runtime: 'powershell',
  content: '',
  timeoutSeconds: 300,
  runAs: 'system',
  tags: '',
  categoryId: null,
};

export function ScriptLibraryPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [categories, setCategories] = useState<ScriptCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<ScriptFormData>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);

  const { fetchDevices } = useDeviceStore();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [scriptList, catList] = await Promise.all([
        scriptApi.list({ categoryId: selectedCategory ?? undefined, platform: selectedPlatform || undefined, search: search || undefined }),
        scriptApi.listCategories(),
      ]);
      setScripts(scriptList);
      setCategories(catList);
    } catch {
      toast.error('Failed to load scripts');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, selectedPlatform, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) {
      toast.error('Name and content are required');
      return;
    }
    setIsSaving(true);
    try {
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      const data = {
        name: form.name,
        description: form.description || null,
        platform: form.platform,
        runtime: form.runtime,
        content: form.content,
        timeoutSeconds: form.timeoutSeconds,
        runAs: form.runAs,
        tags,
        categoryId: form.categoryId,
        tenantId: null,
      };
      if (isCreating) {
        await scriptApi.create(data as any);
        toast.success('Script created');
      } else if (selectedScript) {
        await scriptApi.update(selectedScript.id, data);
        toast.success('Script updated');
      }
      setIsEditing(false);
      setIsCreating(false);
      setSelectedScript(null);
      setForm(defaultForm);
      await load();
    } catch {
      toast.error('Failed to save script');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (script: Script) => {
    if (!confirm(`Delete script "${script.name}"?`)) return;
    try {
      await scriptApi.delete(script.id);
      if (selectedScript?.id === script.id) setSelectedScript(null);
      toast.success('Script deleted');
      await load();
    } catch {
      toast.error('Failed to delete script');
    }
  };

  const handleStartCreate = () => {
    setForm(defaultForm);
    setIsCreating(true);
    setIsEditing(true);
    setSelectedScript(null);
  };

  const handleStartEdit = (script: Script) => {
    setForm({
      name: script.name,
      description: script.description ?? '',
      platform: script.platform,
      runtime: script.runtime,
      content: script.content,
      timeoutSeconds: script.timeoutSeconds,
      runAs: script.runAs,
      tags: script.tags.join(', '),
      categoryId: script.categoryId,
    });
    setSelectedScript(script);
    setIsEditing(true);
    setIsCreating(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: category filter + list */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-text-primary">Scripts</h1>
            <button
              onClick={handleStartCreate}
              className="p-1.5 bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">All platforms</option>
            {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Categories */}
        <div className="p-2 border-b border-border">
          <button
            onClick={() => setSelectedCategory(null)}
            className={clsx('w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors', selectedCategory === null ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary')}
          >
            All scripts
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={clsx('w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors', selectedCategory === cat.id ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary')}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Script list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-24">
              <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          ) : scripts.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">No scripts found</p>
          ) : (
            scripts.map((script) => (
              <button
                key={script.id}
                onClick={() => { setSelectedScript(script); setIsEditing(false); setIsCreating(false); }}
                className={clsx(
                  'w-full text-left p-3 rounded-lg transition-colors mb-1',
                  selectedScript?.id === script.id && !isCreating ? 'bg-accent/10 border border-accent/30' : 'hover:bg-bg-tertiary',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Terminal className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span className="text-sm font-medium text-text-primary truncate">{script.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>{PLATFORM_LABELS[script.platform]}</span>
                  <span>·</span>
                  <span>{RUNTIME_LABELS[script.runtime]}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: script detail / form */}
      <div className="flex-1 overflow-y-auto">
        {isEditing ? (
          <div className="p-6 space-y-4 max-w-3xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">{isCreating ? 'New Script' : 'Edit Script'}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setIsEditing(false); setIsCreating(false); }}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text-primary bg-bg-secondary border border-border rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Platform</label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value as ScriptPlatform })}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                >
                  {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Runtime</label>
                <select
                  value={form.runtime}
                  onChange={(e) => setForm({ ...form, runtime: e.target.value as ScriptRuntime })}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                >
                  {Object.entries(RUNTIME_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Timeout (seconds)</label>
                <input
                  type="number"
                  value={form.timeoutSeconds}
                  onChange={(e) => setForm({ ...form, timeoutSeconds: parseInt(e.target.value, 10) || 300 })}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Run As</label>
                <select
                  value={form.runAs}
                  onChange={(e) => setForm({ ...form, runAs: e.target.value as 'system' | 'user' })}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="system">System</option>
                  <option value="user">User</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-muted uppercase">Category</label>
                <select
                  value={form.categoryId ?? ''}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">No category</option>
                  {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-text-muted uppercase">Tags (comma-separated)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="e.g. security, audit, cleanup"
                  className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent resize-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Content *</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={20}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent resize-y font-mono"
                placeholder={form.runtime === 'powershell' || form.runtime === 'pwsh' ? '# PowerShell script\nWrite-Host "Hello World"' : '#!/bin/bash\necho "Hello World"'}
              />
            </div>
          </div>
        ) : selectedScript ? (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-text-primary">{selectedScript.name}</h2>
                <p className="text-sm text-text-muted mt-1">
                  {PLATFORM_LABELS[selectedScript.platform]} · {RUNTIME_LABELS[selectedScript.runtime]} · {selectedScript.timeoutSeconds}s timeout · run as {selectedScript.runAs}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleStartEdit(selectedScript)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg hover:border-accent/50 text-text-muted hover:text-text-primary transition-colors"
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit
                </button>
                {!selectedScript.isBuiltin && (
                  <button
                    onClick={() => handleDelete(selectedScript)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>
            </div>

            {selectedScript.description && (
              <p className="text-sm text-text-muted">{selectedScript.description}</p>
            )}

            {selectedScript.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedScript.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs bg-bg-tertiary border border-border rounded-full text-text-muted">
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="bg-bg-tertiary border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                <Code className="w-4 h-4 text-text-muted" />
                <span className="text-xs text-text-muted font-medium">{RUNTIME_LABELS[selectedScript.runtime]}</span>
                <span className="ml-auto text-xs text-text-muted">{selectedScript.content.split('\n').length} lines</span>
              </div>
              <pre className="p-4 text-sm font-mono text-text-primary overflow-x-auto whitespace-pre-wrap max-h-[32rem]">{selectedScript.content}</pre>
            </div>

            <div className="text-xs text-text-muted">
              Created {new Date(selectedScript.createdAt).toLocaleDateString()} · Updated {new Date(selectedScript.updatedAt).toLocaleDateString()}
              {selectedScript.isBuiltin && <span className="ml-2 px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-text-muted">Built-in</span>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Terminal className="w-12 h-12 mb-3 opacity-30" />
            <p>Select a script or create a new one</p>
            <button
              onClick={handleStartCreate}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              New Script
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
