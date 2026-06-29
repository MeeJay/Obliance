import { useState, useEffect, useCallback, useRef } from 'react';
import {
 ArrowLeft,
 RefreshCw,
 FolderPlus,
 Upload,
 Download,
 Trash2,
 Pencil,
 File,
 FolderOpen,
 HardDrive,
 ChevronRight,
 Loader2,
 FileText,
 FileCode,
 FileArchive,
 FileImage,
 FileVideo,
 FileAudio,
 FileSpreadsheet,
 Shield,
 Package,
 Check,
 X,
 Edit3,
 Save,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { fileApi } from '@/api/file.api';
import { getSocket } from '@/socket/socketClient';
import { isCommandSupported, unsupportedTooltip } from '@/utils/capabilities';
import type { Device, Command } from '@obliance/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileInfo {
 name: string;
 path: string;
 isDir: boolean;
 size: number;
 modified: string;
 mode: string;
}

interface Props {
 device: Device;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_UPLOAD_SIZE = 150 * 1024 * 1024; // 1150 MB

function formatSize(bytes: number): string {
 if (bytes <= 0) return '-';
 if (bytes < 1024) return `${bytes} B`;
 if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
 if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
 return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
 if (!iso) return '-';
 try {
 return new Date(iso).toLocaleString();
 } catch {
 return iso;
 }
}

const EXT_ICON_MAP: Record<string, typeof File> = {
 pdf: FileText,
 doc: FileText,
 docx: FileText,
 txt: FileText,
 md: FileText,
 log: FileText,
 csv: FileSpreadsheet,
 xls: FileSpreadsheet,
 xlsx: FileSpreadsheet,
 js: FileCode,
 ts: FileCode,
 jsx: FileCode,
 tsx: FileCode,
 py: FileCode,
 go: FileCode,
 rs: FileCode,
 java: FileCode,
 c: FileCode,
 cpp: FileCode,
 h: FileCode,
 cs: FileCode,
 rb: FileCode,
 php: FileCode,
 html: FileCode,
 css: FileCode,
 json: FileCode,
 xml: FileCode,
 yaml: FileCode,
 yml: FileCode,
 sh: FileCode,
 bat: FileCode,
 ps1: FileCode,
 zip: FileArchive,
 rar: FileArchive,
 '7z': FileArchive,
 tar: FileArchive,
 gz: FileArchive,
 bz2: FileArchive,
 xz: FileArchive,
 png: FileImage,
 jpg: FileImage,
 jpeg: FileImage,
 gif: FileImage,
 bmp: FileImage,
 svg: FileImage,
 webp: FileImage,
 ico: FileImage,
 mp4: FileVideo,
 mkv: FileVideo,
 avi: FileVideo,
 mov: FileVideo,
 wmv: FileVideo,
 mp3: FileAudio,
 wav: FileAudio,
 flac: FileAudio,
 ogg: FileAudio,
 aac: FileAudio,
 exe: Package,
 msi: Package,
 dmg: Package,
 deb: Package,
 rpm: Package,
 appimage: Package,
 dll: Shield,
 sys: Shield,
 so: Shield,
 dylib: Shield,
};

function getFileIcon(file: FileInfo) {
 if (file.isDir) return FolderOpen;
 const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
 return EXT_ICON_MAP[ext] || File;
}

function pathSeparator(osType: string): string {
 return osType === 'windows' ? '\\' : '/';
}

function joinPath(base: string, name: string, osType: string): string {
 const sep = pathSeparator(osType);
 if (!base) return name;
 if (base.endsWith(sep)) return base + name;
 return base + sep + name;
}

function splitBreadcrumb(path: string, osType: string): { label: string; path: string }[] {
 if (!path) return [];
 const sep = pathSeparator(osType);
 const parts = path.split(sep).filter(Boolean);
 const crumbs: { label: string; path: string }[] = [];

 // On Windows, first part is the drive like "C:"
 for (let i = 0; i < parts.length; i++) {
 const partialPath =
 osType === 'windows'
 ? parts.slice(0, i + 1).join(sep) + (i === 0 ? sep : '')
 : sep + parts.slice(0, i + 1).join(sep);
 crumbs.push({ label: parts[i], path: partialPath });
 }
 return crumbs;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FileExplorerTab({ device }: Props) {
 const { t } = useTranslation();
 const [currentPath, setCurrentPath] = useState('');
 const [files, setFiles] = useState<FileInfo[]>([]);
 const [loading, setLoading] = useState(false);
 const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
 const [dragOver, setDragOver] = useState(false);
 const [renamingFile, setRenamingFile] = useState<string | null>(null);
 const [renameValue, setRenameValue] = useState('');
 const [deletingFile, setDeletingFile] = useState<string | null>(null);
 const [operationInProgress, setOperationInProgress] = useState<Set<string>>(new Set());
 const renameInputRef = useRef<HTMLInputElement>(null);

 // Text editor panel state
 const [editorFile, setEditorFile] = useState<FileInfo | null>(null);
 const [editorContent, setEditorContent] = useState('');
 const [editorOriginal, setEditorOriginal] = useState('');
 const [editorLoading, setEditorLoading] = useState(false);
 const [editorSaving, setEditorSaving] = useState(false);

 // Custom right-click context menu state
 const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileInfo } | null>(null);
 useEffect(() => {
 if (!contextMenu) return;
 const close = () => setContextMenu(null);
 window.addEventListener('click', close);
 window.addEventListener('scroll', close, true);
 window.addEventListener('resize', close);
 return () => {
 window.removeEventListener('click', close);
 window.removeEventListener('scroll', close, true);
 window.removeEventListener('resize', close);
 };
 }, [contextMenu]);
 const pendingCmdRef = useRef<Map<string, { resolve: (cmd: Command) => void; timer: ReturnType<typeof setTimeout> }>>(new Map());

 const isWindows = device.osType === 'windows';

 // ── Socket listener for command results ──────────────────────────────────

 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;

 const handleResult = (msg: { id: string; commandType: string; status: string; result: any }) => {
 const pending = pendingCmdRef.current.get(msg.id);
 if (!pending) return;
 clearTimeout(pending.timer);
 pendingCmdRef.current.delete(msg.id);
 pending.resolve({ id: msg.id, status: msg.status, result: msg.result } as any);
 };

 socket.on('FILE_EXPLORER_RESULT', handleResult);

 return () => {
 socket.off('FILE_EXPLORER_RESULT', handleResult);
 for (const [, pending] of pendingCmdRef.current) {
 clearTimeout(pending.timer);
 }
 pendingCmdRef.current.clear();
 };
 }, []);

 // ── Send a command and wait for its result ───────────────────────────────

 // Dangerous ops that get audited server-side
 const AUDITED_OPS = new Set(['create_directory', 'rename_file', 'delete_file', 'upload_file']);

 const sendCommand = useCallback(
 (
 type: 'list_directory' | 'create_directory' | 'rename_file' | 'delete_file' | 'download_file' | 'upload_file',
 payload: Record<string, any>,
 timeoutMs = 30000,
 ): Promise<any> => {
 const socket = getSocket();
 if (!socket) return Promise.reject(new Error('Socket not connected'));

 const cmdId = crypto.randomUUID();
 const audit = AUDITED_OPS.has(type)
 ? { action: `file_explorer.${type}`, resourceType: payload.path?.endsWith('/') ? 'directory' : 'file', resourcePath: payload.path || payload.oldPath }
 : undefined;

 return new Promise<any>((resolve, reject) => {
 const timer = setTimeout(() => {
 pendingCmdRef.current.delete(cmdId);
 reject(new Error('Command timed out'));
 }, timeoutMs);
 pendingCmdRef.current.set(cmdId, { resolve, timer });

 socket.emit('FILE_EXPLORER_CMD', {
 requestId: cmdId,
 deviceId: device.id,
 commandType: type,
 payload,
 audit,
 });
 });
 },
 [device.id],
 );

 // ── List directory ───────────────────────────────────────────────────────

 const listDirectory = useCallback(
 async (path: string) => {
 setLoading(true);
 setSelectedFiles(new Set());
 try {
 const result = await sendCommand('list_directory', { path });
 if (result.status === 'success') {
 const items: FileInfo[] = (result as any).result?.files ?? (result as any).result ?? [];
 // Sort: directories first, then alphabetically
 items.sort((a, b) => {
 if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
 return a.name.localeCompare(b.name);
 });
 setFiles(items);
 setCurrentPath(path);
 } else {
 toast.error((result as any).error || t('fileExplorer.listFailed'));
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.listFailed'));
 } finally {
 setLoading(false);
 }
 },
 [sendCommand, t],
 );

 // ── Mount: load root + audit open ──────────────────────────────────────

 useEffect(() => {
 fileApi.logOpen(device.id).catch(() => {});
 listDirectory('');
 }, [listDirectory, device.id]);

 // ── Navigation ──────────────────────────────────────────────────────────

 const navigateUp = () => {
 if (!currentPath) return;
 const sep = pathSeparator(device.osType);
 const parts = currentPath.split(sep).filter(Boolean);
 if (parts.length <= 1) {
 listDirectory('');
 } else {
 parts.pop();
 const newPath = isWindows ? parts.join(sep) + (parts.length === 1 ? sep : '') : sep + parts.join(sep);
 listDirectory(newPath);
 }
 };

 const navigateTo = (file: FileInfo) => {
 if (file.isDir) {
 listDirectory(file.path);
 }
 };

 const navigateToBreadcrumb = (path: string) => {
 listDirectory(path);
 };

 // ── Selection ───────────────────────────────────────────────────────────

 const toggleSelect = (filePath: string, e: React.MouseEvent) => {
 e.stopPropagation();
 setSelectedFiles((prev) => {
 const next = new Set(prev);
 if (next.has(filePath)) {
 next.delete(filePath);
 } else {
 next.add(filePath);
 }
 return next;
 });
 };

 // ── Download ────────────────────────────────────────────────────────────

 const handleDownload = async (file: FileInfo) => {
 setOperationInProgress((prev) => new Set(prev).add(file.path));
 try {
 const result = await sendCommand('download_file', { path: file.path }, 60000);
 if (result.status === 'success') {
 const base64: string = (result as any).result?.data ?? '';
 if (!base64) {
 toast.error(t('fileExplorer.downloadEmpty'));
 return;
 }
 const binaryStr = atob(base64);
 const bytes = new Uint8Array(binaryStr.length);
 for (let i = 0; i < binaryStr.length; i++) {
 bytes[i] = binaryStr.charCodeAt(i);
 }
 const blob = new Blob([bytes]);
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = file.name;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 URL.revokeObjectURL(url);
 toast.success(t('fileExplorer.downloadSuccess'));
 } else {
 toast.error((result as any).error || t('fileExplorer.downloadFailed'));
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.downloadFailed'));
 } finally {
 setOperationInProgress((prev) => {
 const s = new Set(prev);
 s.delete(file.path);
 return s;
 });
 }
 };

 // ── Text editor ─────────────────────────────────────────────────────────
 //
 // Extensions that open in the inline text editor are configurable globally
 // (see Settings → File explorer). We fetch the list once at mount and fall
 // back to a sane local default if the server isn't reachable.

 const FALLBACK_EDITABLE: string[] = [
 'txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'cfg',
 'env', 'sh', 'bash', 'ps1', 'bat', 'cmd',
 ];
 const [editableExtensions, setEditableExtensions] = useState<Set<string>>(() => new Set(FALLBACK_EDITABLE));
 useEffect(() => {
 import('@/api/appConfig.api').then(({ appConfigApi }) => {
 appConfigApi.getEditableExtensions()
 .then(({ extensions }) => {
 if (Array.isArray(extensions) && extensions.length > 0) {
 setEditableExtensions(new Set(extensions.map((e) => e.toLowerCase())));
 }
 })
 .catch(() => { /* keep fallback */ });
 });
 }, []);
 const MAX_EDIT_SIZE = 2 * 1024 * 1024; // 2 MB

 function isEditableText(file: FileInfo): boolean {
 if (file.isDir) return false;
 if (file.size > MAX_EDIT_SIZE) return false;
 const name = file.name.toLowerCase();
 const ext = name.split('.').pop() ?? '';
 if (editableExtensions.has(ext)) return true;
 // Files with no extension but common text names
 if (name === 'dockerfile' || name === 'makefile' || name === 'readme' || name === 'license') return true;
 return false;
 }

 const handleOpenEditor = async (file: FileInfo) => {
 if (!isEditableText(file)) {
 toast.error(t('fileExplorer.notEditable') || 'This file is not editable as text');
 return;
 }
 setEditorFile(file);
 setEditorLoading(true);
 setEditorContent('');
 setEditorOriginal('');
 try {
 const result = await sendCommand('download_file', { path: file.path }, 60000);
 if (result.status === 'success') {
 const base64: string = (result as any).result?.data ?? '';
 const binaryStr = atob(base64);
 const bytes = new Uint8Array(binaryStr.length);
 for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
 const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
 setEditorContent(text);
 setEditorOriginal(text);
 } else {
 toast.error((result as any).error || t('fileExplorer.downloadFailed'));
 setEditorFile(null);
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.downloadFailed'));
 setEditorFile(null);
 } finally {
 setEditorLoading(false);
 }
 };

 const handleSaveEditor = async () => {
 if (!editorFile) return;
 setEditorSaving(true);
 try {
 const encoder = new TextEncoder();
 const bytes = encoder.encode(editorContent);
 let binary = '';
 for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
 const base64 = btoa(binary);
 const result = await sendCommand('upload_file', { path: editorFile.path, data: base64, overwrite: true }, 60000);
 if (result.status === 'success') {
 toast.success(t('fileExplorer.saved') || 'File saved');
 setEditorOriginal(editorContent);
 await listDirectory(currentPath);
 } else {
 toast.error((result as any).error || t('fileExplorer.saveFailed') || 'Save failed');
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.saveFailed') || 'Save failed');
 } finally {
 setEditorSaving(false);
 }
 };

 const handleCloseEditor = () => {
 if (editorContent !== editorOriginal) {
 if (!confirm(t('fileExplorer.unsavedChanges') || 'You have unsaved changes. Close anyway?')) return;
 }
 setEditorFile(null);
 setEditorContent('');
 setEditorOriginal('');
 };

 // ── Create directory ────────────────────────────────────────────────────

 const handleCreateFolder = async () => {
 const name = prompt(t('fileExplorer.newFolderPrompt'));
 if (!name?.trim()) return;
 const dirPath = joinPath(currentPath, name.trim(), device.osType);
 setLoading(true);
 try {
 const result = await sendCommand('create_directory', { path: dirPath });
 if (result.status === 'success') {
 toast.success(t('fileExplorer.folderCreated'));
 await listDirectory(currentPath);
 } else {
 toast.error((result as any).error || t('fileExplorer.folderCreateFailed'));
 setLoading(false);
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.folderCreateFailed'));
 setLoading(false);
 }
 };

 // ── Rename ──────────────────────────────────────────────────────────────

 const startRename = (file: FileInfo) => {
 setRenamingFile(file.path);
 setRenameValue(file.name);
 setTimeout(() => renameInputRef.current?.select(), 50);
 };

 const confirmRename = async (file: FileInfo) => {
 const newName = renameValue.trim();
 if (!newName || newName === file.name) {
 setRenamingFile(null);
 return;
 }
 const newPath = joinPath(
 currentPath,
 newName,
 device.osType,
 );
 setOperationInProgress((prev) => new Set(prev).add(file.path));
 setRenamingFile(null);
 try {
 const result = await sendCommand('rename_file', { oldPath: file.path, newPath });
 if (result.status === 'success') {
 toast.success(t('fileExplorer.renamed'));
 await listDirectory(currentPath);
 } else {
 toast.error((result as any).error || t('fileExplorer.renameFailed'));
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.renameFailed'));
 } finally {
 setOperationInProgress((prev) => {
 const s = new Set(prev);
 s.delete(file.path);
 return s;
 });
 }
 };

 // ── Delete ──────────────────────────────────────────────────────────────

 const handleDelete = async (file: FileInfo) => {
 setOperationInProgress((prev) => new Set(prev).add(file.path));
 setDeletingFile(null);
 try {
 const result = await sendCommand('delete_file', { path: file.path, isDir: file.isDir });
 if (result.status === 'success') {
 toast.success(t('fileExplorer.deleted'));
 await listDirectory(currentPath);
 } else {
 toast.error((result as any).error || t('fileExplorer.deleteFailed'));
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.deleteFailed'));
 } finally {
 setOperationInProgress((prev) => {
 const s = new Set(prev);
 s.delete(file.path);
 return s;
 });
 }
 };

 // ── Upload (drag & drop) ────────────────────────────────────────────────

 const handleDrop = async (e: React.DragEvent) => {
 e.preventDefault();
 setDragOver(false);
 const droppedFiles = Array.from(e.dataTransfer.files);
 if (droppedFiles.length === 0) return;

 const oversized = droppedFiles.filter((f) => f.size > MAX_UPLOAD_SIZE);
 if (oversized.length > 0) {
 toast.error(
 `${oversized.length} file(s) exceed 150 MB limit: ${oversized.map((f) => f.name).join(', ')}`,
 );
 }

 const valid = droppedFiles.filter((f) => f.size <= MAX_UPLOAD_SIZE);
 if (valid.length === 0) return;

 setLoading(true);
 let successCount = 0;
 let failCount = 0;

 for (const file of valid) {
 try {
 const base64 = await new Promise<string>((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = () => {
 const result = reader.result as string;
 resolve(result.split(',')[1]);
 };
 reader.onerror = () => reject(new Error('Failed to read file'));
 reader.readAsDataURL(file);
 });

 const destPath = joinPath(currentPath, file.name, device.osType);
 const result = await sendCommand('upload_file', { path: destPath, data: base64, overwrite: false }, 60000);
 if (result.status === 'success') {
 successCount++;
 } else {
 failCount++;
 }
 } catch {
 failCount++;
 }
 }

 if (successCount > 0) toast.success(`${successCount} file(s) uploaded`);
 if (failCount > 0) toast.error(`${failCount} file(s) failed to upload`);
 await listDirectory(currentPath);
 };

 const handleUploadClick = () => {
 const input = document.createElement('input');
 input.type = 'file';
 input.multiple = true;
 input.onchange = async () => {
 if (!input.files?.length) return;
 const files = Array.from(input.files);
 // Reuse the same upload logic
 const fakeEvent = {
 preventDefault: () => {},
 dataTransfer: { files },
 } as unknown as React.DragEvent;
 await handleDrop(fakeEvent);
 };
 input.click();
 };

 // ── Render ──────────────────────────────────────────────────────────────

 const breadcrumbs = splitBreadcrumb(currentPath, device.osType);
 const isRoot = !currentPath;

 // Defensive guard: if an agent build can't browse directories at all
 // (list_directory), show an explanatory banner instead of a dead toolbar.
 // Both current flavors support browsing/create/rename/delete; only file
 // TRANSFER (upload_file/download_file) is legacy-unsupported and is greyed
 // per-action below — so in practice this banner is reserved for future
 // capability-restricted builds.
 if (!isCommandSupported(device, 'list_directory')) {
 return (
 <div className="bg-bg-secondary rounded-xl p-10 text-center text-text-muted text-sm flex flex-col items-center gap-2">
 <FolderOpen className="w-8 h-8 opacity-40" />
 <p>{unsupportedTooltip(t)}</p>
 </div>
 );
 }

 // Per-command capability flags. Some agent builds (legacy) browse and
 // mutate the filesystem but can't stream file bytes — gate upload/download
 // individually so those buttons grey out while the rest stays usable.
 const canCreateDir = isCommandSupported(device, 'create_directory');
 const canUpload = isCommandSupported(device, 'upload_file');
 const canDownload = isCommandSupported(device, 'download_file');
 const canRename = isCommandSupported(device, 'rename_file');
 const canDelete = isCommandSupported(device, 'delete_file');

 return (
 <div className="flex gap-3">
 <div className={clsx(
 'bg-bg-secondary rounded-xl overflow-hidden flex flex-col',
 editorFile ? 'flex-1 min-w-0' : 'w-full'
 )}>
 {/* ── Top bar ──────────────────────────────────────────────────────── */}
 <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
 {/* Back button */}
 <button
 onClick={navigateUp}
 disabled={isRoot || loading}
 className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title={t('fileExplorer.back')}
 >
 <ArrowLeft className="w-4 h-4" />
 </button>

 {/* Breadcrumb */}
 <div className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-x-auto scrollbar-thin">
 <button
 onClick={() => listDirectory('')}
 className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
 isRoot
 ? 'text-accent bg-accent/10'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
 }`}
 >
 <HardDrive className="w-3.5 h-3.5" />
 {isWindows ? t('fileExplorer.drives') : '/'}
 </button>
 {breadcrumbs.map((crumb, i) => (
 <div key={crumb.path} className="flex items-center gap-1 shrink-0">
 <ChevronRight className="w-3 h-3 text-text-muted/50" />
 <button
 onClick={() => navigateToBreadcrumb(crumb.path)}
 className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
 i === breadcrumbs.length - 1
 ? 'text-accent bg-accent/10'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
 }`}
 >
 {crumb.label}
 </button>
 </div>
 ))}
 </div>

 {/* Action buttons */}
 <div className="flex items-center gap-1 shrink-0">
 <button
 onClick={() => listDirectory(currentPath)}
 disabled={loading}
 className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 transition-colors"
 title={t('fileExplorer.refresh')}
 >
 <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
 </button>
 <button
 onClick={handleCreateFolder}
 disabled={loading || isRoot || !canCreateDir}
 className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title={canCreateDir ? t('fileExplorer.newFolder') : unsupportedTooltip(t)}
 >
 <FolderPlus className="w-4 h-4" />
 </button>
 <button
 onClick={handleUploadClick}
 disabled={loading || isRoot || !canUpload}
 className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title={canUpload ? t('fileExplorer.upload') : unsupportedTooltip(t)}
 >
 <Upload className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* ── File list / drop zone ────────────────────────────────────────── */}
 <div
 className={`flex-1 min-h-[300px] relative transition-colors ${
 dragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent/30' : ''
 }`}
 onDragOver={(e) => {
 e.preventDefault();
 if (!isRoot) setDragOver(true);
 }}
 onDragLeave={() => setDragOver(false)}
 onDrop={handleDrop}
 >
 {/* Drag overlay */}
 {dragOver && (
 <div className="absolute inset-0 z-10 flex items-center justify-center bg-accent/5 pointer-events-none">
 <div className="flex flex-col items-center gap-2 text-accent">
 <Upload className="w-10 h-10" />
 <span className="text-sm font-medium">{t('fileExplorer.dropToUpload')}</span>
 <span className="text-xs text-text-muted">Max 150 MB per file</span>
 </div>
 </div>
 )}

 {/* Loading state */}
 {loading && (
 <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-secondary/80">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 )}

 {/* Table */}
 {files.length > 0 ? (
 <div className="overflow-auto max-h-[calc(100vh-320px)]">
 <table className="w-full text-sm">
 <thead className="sticky top-0 z-[5]">
 <tr className="bg-bg-tertiary/80 backdrop-blur text-text-muted text-xs uppercase tracking-wider">
 <th className="w-8 px-3 py-2" />
 <th className="text-left px-3 py-2 font-medium">{t('fileExplorer.name')}</th>
 <th className="text-right px-3 py-2 font-medium w-28">{t('fileExplorer.size')}</th>
 <th className="text-left px-3 py-2 font-medium w-44">{t('fileExplorer.modified')}</th>
 <th className="text-right px-3 py-2 font-medium w-28">{t('fileExplorer.actions')}</th>
 </tr>
 </thead>
 <tbody>
 {files.map((file) => {
 const Icon = getFileIcon(file);
 const isSelected = selectedFiles.has(file.path);
 const isOperating = operationInProgress.has(file.path);
 const isDeleting = deletingFile === file.path;
 const isRenaming = renamingFile === file.path;

 return (
 <tr
 key={file.path}
 onClick={(e) => toggleSelect(file.path, e)}
 onDoubleClick={() => {
 if (file.isDir) {
 navigateTo(file);
 } else if (isEditableText(file)) {
 handleOpenEditor(file);
 } else if (file.size <= MAX_UPLOAD_SIZE) {
 handleDownload(file);
 }
 }}
 onContextMenu={(e) => {
 e.preventDefault();
 e.stopPropagation();
 setContextMenu({ x: e.clientX, y: e.clientY, file });
 }}
 className={`group /50 cursor-pointer transition-colors ${
 isSelected
 ? 'bg-accent/10'
 : 'hover:bg-bg-tertiary/50'
 } ${isOperating ? 'opacity-50 pointer-events-none' : ''}`}
 >
 {/* Icon */}
 <td className="px-3 py-1.5 text-center">
 {isOperating ? (
 <Loader2 className="w-4 h-4 text-accent animate-spin mx-auto" />
 ) : (
 <Icon
 className={`w-4 h-4 mx-auto ${
 file.isDir ? 'text-yellow-500' : 'text-text-muted'
 }`}
 />
 )}
 </td>

 {/* Name */}
 <td className="px-3 py-1.5">
 {isRenaming ? (
 <div className="flex items-center gap-1">
 <input
 ref={renameInputRef}
 type="text"
 value={renameValue}
 onChange={(e) => setRenameValue(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') confirmRename(file);
 if (e.key === 'Escape') setRenamingFile(null);
 }}
 onClick={(e) => e.stopPropagation()}
 onDoubleClick={(e) => e.stopPropagation()}
 className="px-1.5 py-0.5 text-sm bg-bg-tertiary border border-accent/50 rounded text-text-primary focus:outline-none w-64"
 autoFocus
 />
 <button
 onClick={(e) => {
 e.stopPropagation();
 confirmRename(file);
 }}
 className="p-0.5 rounded text-green-400 hover:bg-green-400/10"
 >
 <Check className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={(e) => {
 e.stopPropagation();
 setRenamingFile(null);
 }}
 className="p-0.5 rounded text-red-400 hover:bg-red-400/10"
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 ) : (
 <span
 className={`${
 file.isDir
 ? 'text-text-primary font-medium hover:text-accent'
 : 'text-text-primary'
 } transition-colors`}
 >
 {file.name}
 </span>
 )}
 </td>

 {/* Size */}
 <td className="px-3 py-1.5 text-right text-text-muted text-xs tabular-nums">
 {file.isDir ? '-' : formatSize(file.size)}
 </td>

 {/* Modified */}
 <td className="px-3 py-1.5 text-text-muted text-xs">
 {formatDate(file.modified)}
 </td>

 {/* Actions */}
 <td className="px-3 py-1.5 text-right">
 {isDeleting ? (
 <div
 className="inline-flex items-center gap-1"
 onClick={(e) => e.stopPropagation()}
 >
 <span className="text-xs text-red-400 mr-1">
 {t('fileExplorer.confirmDelete')}
 </span>
 <button
 onClick={() => handleDelete(file)}
 className="p-1 rounded text-red-400 hover:bg-red-400/10 transition-colors"
 title={t('fileExplorer.confirm')}
 >
 <Check className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={() => setDeletingFile(null)}
 className="p-1 rounded text-text-muted hover:bg-bg-tertiary transition-colors"
 title={t('fileExplorer.cancel')}
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 ) : (
 <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
 {!file.isDir && isEditableText(file) && canDownload && (
 <button
 onClick={(e) => {
 e.stopPropagation();
 handleOpenEditor(file);
 }}
 className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
 title={t('fileExplorer.edit') || 'Edit'}
 >
 <Edit3 className="w-3.5 h-3.5" />
 </button>
 )}
 {!file.isDir && (
 <button
 onClick={(e) => {
 e.stopPropagation();
 handleDownload(file);
 }}
 disabled={!canDownload}
 className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title={canDownload ? t('fileExplorer.download') : unsupportedTooltip(t)}
 >
 <Download className="w-3.5 h-3.5" />
 </button>
 )}
 <button
 onClick={(e) => {
 e.stopPropagation();
 startRename(file);
 }}
 disabled={!canRename}
 className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title={canRename ? t('fileExplorer.rename') : unsupportedTooltip(t)}
 >
 <Pencil className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={(e) => {
 e.stopPropagation();
 setDeletingFile(file.path);
 }}
 disabled={!canDelete}
 className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title={canDelete ? t('fileExplorer.delete') : unsupportedTooltip(t)}
 >
 <Trash2 className="w-3.5 h-3.5" />
 </button>
 </div>
 )}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 ) : (
 !loading && (
 <div className="flex flex-col items-center justify-center py-16 text-text-muted">
 <FolderOpen className="w-10 h-10 mb-3 opacity-30" />
 <p className="text-sm">{t('fileExplorer.empty')}</p>
 {!isRoot && (
 <p className="text-xs mt-1 opacity-60">{t('fileExplorer.dropToUpload')}</p>
 )}
 </div>
 )
 )}
 </div>

 {/* ── Status bar ───────────────────────────────────────────────────── */}
 <div className="px-4 py-1.5 bg-bg-tertiary/50 flex items-center justify-between text-xs text-text-muted">
 <span>
 {files.length > 0
 ? `${files.length} ${t('fileExplorer.items')}${
 selectedFiles.size > 0 ? ` — ${selectedFiles.size} ${t('fileExplorer.selected')}` : ''
 }`
 : ''}
 </span>
 <span className="opacity-60">{currentPath || (isWindows ? t('fileExplorer.drives') : '/')}</span>
 </div>
 </div>

 {/* ── Custom right-click context menu ─────────────────────────────── */}
 {contextMenu && (() => {
 const file = contextMenu.file;
 const editable = !file.isDir && isEditableText(file);
 const MENU_W = 200;
 const MENU_H_EST = 240;
 const x = Math.min(contextMenu.x, window.innerWidth - MENU_W - 8);
 const y = Math.min(contextMenu.y, window.innerHeight - MENU_H_EST - 8);
 const close = () => setContextMenu(null);
 return (
 <div
 className="fixed z-[200] w-[200px] bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1"
 style={{ left: x, top: y }}
 onClick={(e) => e.stopPropagation()}
 onContextMenu={(e) => e.preventDefault()}
 >
 {file.isDir ? (
 <button
 onClick={() => { navigateTo(file); close(); }}
 className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors text-left"
 >
 <FolderOpen className="w-3.5 h-3.5 text-yellow-500" />
 Open
 </button>
 ) : (
 <>
 {editable && canDownload && (
 <button
 onClick={() => { handleOpenEditor(file); close(); }}
 className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors text-left"
 >
 <Edit3 className="w-3.5 h-3.5 text-accent" />
 Edit
 </button>
 )}
 <button
 onClick={() => { handleDownload(file); close(); }}
 disabled={!canDownload}
 title={canDownload ? undefined : unsupportedTooltip(t)}
 className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left"
 >
 <Download className="w-3.5 h-3.5 text-accent" />
 Download
 </button>
 </>
 )}
 <div className="h-px bg-border my-1" />
 <button
 onClick={() => { startRename(file); close(); }}
 disabled={!canRename}
 title={canRename ? undefined : unsupportedTooltip(t)}
 className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left"
 >
 <Pencil className="w-3.5 h-3.5 text-accent" />
 Rename
 </button>
 <button
 onClick={() => { setDeletingFile(file.path); close(); }}
 disabled={!canDelete}
 title={canDelete ? undefined : unsupportedTooltip(t)}
 className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left"
 >
 <Trash2 className="w-3.5 h-3.5" />
 Delete
 </button>
 </div>
 );
 })()}

 {/* ── Text editor side panel ──────────────────────────────────────── */}
 {editorFile && (
 <div className="w-1/2 min-w-[400px] bg-bg-secondary rounded-xl overflow-hidden flex flex-col">
 {/* Header */}
 <div className="px-4 py-3 flex items-center gap-2">
 <Edit3 className="w-4 h-4 text-accent shrink-0" />
 <div className="flex-1 min-w-0">
 <div className="text-sm text-text-primary font-medium truncate">{editorFile.name}</div>
 <div className="text-xs text-text-muted truncate" title={editorFile.path}>{editorFile.path}</div>
 </div>
 {editorContent !== editorOriginal && (
 <span className="text-xs text-orange-400 shrink-0">modified</span>
 )}
 <button
 onClick={handleSaveEditor}
 disabled={editorSaving || editorLoading || editorContent === editorOriginal}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 title={t('fileExplorer.save') || 'Save'}
 >
 {editorSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
 {t('fileExplorer.save') || 'Save'}
 </button>
 <button
 onClick={handleCloseEditor}
 disabled={editorSaving}
 className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
 title={t('fileExplorer.close') || 'Close'}
 >
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Editor area */}
 <div className="flex-1 min-h-0 relative">
 {editorLoading ? (
 <div className="absolute inset-0 flex items-center justify-center">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 ) : (
 <textarea
 value={editorContent}
 onChange={(e) => setEditorContent(e.target.value)}
 spellCheck={false}
 className="w-full h-full min-h-[400px] p-4 bg-bg-primary text-text-primary font-mono text-xs leading-relaxed resize-none focus:outline-none"
 onKeyDown={(e) => {
 if ((e.ctrlKey || e.metaKey) && e.key === 's') {
 e.preventDefault();
 handleSaveEditor();
 }
 }}
 />
 )}
 </div>

 {/* Footer with info */}
 <div className="px-4 py-1.5 bg-bg-tertiary/50 flex items-center justify-between text-xs text-text-muted">
 <span>{editorContent.length} chars · {editorContent.split('\n').length} lines</span>
 <span className="opacity-60">Ctrl+S to save</span>
 </div>
 </div>
 )}
 </div>
 );
}
