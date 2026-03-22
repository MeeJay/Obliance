import { useState, useEffect } from 'react';
import { MessageSquare, Plus, Pencil, Trash2, X } from 'lucide-react';
import { quickReplyTemplatesApi } from '@/api/quickReplyTemplates.api';
import type { QuickReplyTemplate } from '@obliance/shared';
import toast from 'react-hot-toast';

const LANGUAGES = [
  { code: 'en', name: 'English' }, { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' }, { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português (BR)' }, { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский' }, { code: 'ar', name: 'العربية' },
  { code: 'it', name: 'Italiano' }, { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' }, { code: 'tr', name: 'Türkçe' },
  { code: 'sv', name: 'Svenska' }, { code: 'da', name: 'Dansk' },
  { code: 'cs', name: 'Čeština' }, { code: 'uk', name: 'Українська' },
];

export function QuickReplyTemplatesSection() {
  const [templates, setTemplates] = useState<QuickReplyTemplate[]>([]);
  const [editMode, setEditMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    quickReplyTemplatesApi.list().then(setTemplates).catch(() => {});
  }, []);

  const openCreate = () => {
    setForm({});
    setEditingId(null);
    setEditMode('create');
  };

  const openEdit = (t: QuickReplyTemplate) => {
    setForm({ ...t.translations });
    setEditingId(t.id);
    setEditMode('edit');
  };

  const handleSave = async () => {
    if (!form.en?.trim()) {
      toast.error('English text is required');
      return;
    }
    // Filter empty translations
    const translations: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v.trim()) translations[k] = v.trim();
    }

    try {
      if (editMode === 'create') {
        const created = await quickReplyTemplatesApi.create(translations);
        setTemplates(prev => [...prev, created]);
        toast.success('Template created');
      } else if (editMode === 'edit' && editingId) {
        const updated = await quickReplyTemplatesApi.update(editingId, { translations });
        setTemplates(prev => prev.map(t => t.id === editingId ? updated : t));
        toast.success('Template updated');
      }
      setEditMode(null);
    } catch {
      toast.error('Failed to save template');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await quickReplyTemplatesApi.remove(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const filledCount = (t: QuickReplyTemplate) =>
    Object.values(t.translations).filter(v => v.trim()).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <MessageSquare size={18} className="text-accent" />
          Quick Reply Templates
        </h2>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors">
          <Plus size={14} /> Add Template
        </button>
      </div>
      <p className="text-xs text-text-muted mb-4">
        Multilingual quick reply templates available to all operators in this workspace.
      </p>

      <div className="bg-bg-secondary border border-border rounded-xl divide-y divide-border overflow-hidden">
        {templates.length === 0 && (
          <div className="text-sm text-text-muted text-center py-8 italic">No templates yet</div>
        )}
        {templates.map(t => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary truncate">{t.translations.en || t.translations[Object.keys(t.translations)[0]] || '(empty)'}</div>
              <div className="text-[10px] text-text-muted">{filledCount(t)} / {LANGUAGES.length} languages</div>
            </div>
            <button onClick={() => openEdit(t)} className="p-1.5 text-text-muted hover:text-accent transition-colors">
              <Pencil size={14} />
            </button>
            <button onClick={() => handleDelete(t.id)} className="p-1.5 text-text-muted hover:text-red-400 transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* ── Edit / Create modal ── */}
      {editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-text-primary">
                {editMode === 'create' ? 'Add Template' : 'Edit Template'}
              </h3>
              <button onClick={() => setEditMode(null)} className="p-1 text-text-muted hover:text-text-primary">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {LANGUAGES.map(l => (
                <div key={l.code}>
                  <label className="text-xs text-text-muted mb-1 block">
                    {l.name} {l.code === 'en' && <span className="text-red-400">*</span>}
                  </label>
                  <input
                    value={form[l.code] || ''}
                    onChange={e => setForm(prev => ({ ...prev, [l.code]: e.target.value }))}
                    placeholder={`Quick reply in ${l.name}...`}
                    maxLength={500}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setEditMode(null)}
                className="px-4 py-2 text-sm bg-bg-tertiary text-text-muted rounded-lg hover:text-text-primary transition-colors">
                Cancel
              </button>
              <button onClick={handleSave}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors">
                {editMode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
