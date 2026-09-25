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
 CheckSquare,
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
import { saveBlob } from '@/utils/download';
import { useIsCoarsePointer, useMediaQuery, MEDIA } from '@/hooks/useMediaQuery';
import { useConfirm, usePrompt } from '@/components/common/ConfirmDialog';
import { ActionMenu, type ActionMenuItem } from '@/components/common/ActionMenu';
import { Modal } from '@/components/common/Modal';
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

const MAX_UPLOAD_SIZE = 150 * 1024 * 1024; // 150 MB
// Touch devices: the base64 copy of the file lives in the WebView's memory.
const MAX_UPLOAD_MB_TOUCH = 25;
const MAX_UPLOAD_SIZE_TOUCH = MAX_UPLOAD_MB_TOUCH * 1024 * 1024;

// 40 px tap targets on touch screens (desktop sizes unchanged) — docs/obli-mobile.md §5.4.
const TB = 'coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center';

// File names / paths: no autocapitalize / autocorrect on mobile keyboards.
const PLAIN_INPUT = { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } as const;

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
 const confirm = useConfirm();
 const prompt = usePrompt();
 // Touch screens (docs/obli-mobile.md §5): a tap opens (folder → navigate,
 // text file → editor, other file → actions menu), the file icon toggles the
 // selection, row actions stay visible (or sit in a "⋯" menu on phones) and
 // rename / delete go through dialogs. Desktop keeps click = select,
 // double-click = open, the right-click menu and the inline rename / delete.
 const isCoarse = useIsCoarsePointer();
 // The text editor is a side panel from lg up, a full-screen sheet below.
 const isLg = useMediaQuery(MEDIA.lg);
 // The per-row "⋯" menu only exists below md: not mounted at all on
 // desktop (large folders would otherwise mount thousands of hidden menus).
 const isMd = useMediaQuery(MEDIA.md);
 const fileInputRef = useRef<HTMLInputElement>(null);
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

 // Custom right-click context menu state (also opened by a long-press, or by
 // a tap on a file that has no direct "open" action, on touch screens)
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

 // True when a click comes from a finger. Decided per event, so a touch
 // laptop used with a mouse keeps the desktop behaviour for mouse clicks.
 const isTouchEvent = (e: React.MouseEvent) => {
 const pt = (e.nativeEvent as PointerEvent).pointerType;
 return pt ? pt === 'touch' : isCoarse;
 };

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
 // Native bridge in the Android app (blob: URLs cannot be downloaded
 // there), classic <a download> in a browser.
 const saved = await saveBlob(new Blob([bytes]), file.name, 'application/octet-stream');
 if (saved) toast.success(t('fileExplorer.downloadSuccess'));
 else toast.error(t('fileExplorer.downloadFailed'));
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
 toast.error(t('fileExplorer.notEditable', 'This file is not editable as text'));
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
 toast.success(t('fileExplorer.saved', 'File saved'));
 setEditorOriginal(editorContent);
 await listDirectory(currentPath);
 } else {
 toast.error((result as any).error || t('fileExplorer.saveFailed', 'Save failed'));
 }
 } catch (err: any) {
 toast.error(err.message || t('fileExplorer.saveFailed', 'Save failed'));
 } finally {
 setEditorSaving(false);
 }
 };

 const handleCloseEditor = async () => {
 if (editorContent !== editorOriginal) {
 const ok = await confirm({
 message: t('fileExplorer.unsavedChanges', 'You have unsaved changes. Close anyway?'),
 confirmLabel: t('fileExplorer.discardChanges', 'Discard changes'),
 danger: true,
 });
 if (!ok) return;
 }
 setEditorFile(null);
 setEditorContent('');
 setEditorOriginal('');
 };

 // ── Create directory ────────────────────────────────────────────────────

 const handleCreateFolder = async () => {
 const name = await prompt({
 title: t('fileExplorer.newFolder'),
 message: t('fileExplorer.newFolderPrompt'),
 required: true,
 confirmLabel: t('common.create', 'Create'),
 });
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

 const confirmRename = async (file: FileInfo, value: string = renameValue) => {
 const newName = value.trim();
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

 // Touch screens: rename through a dialog (the inline field is too narrow).
 const renameViaDialog = async (file: FileInfo) => {
 const value = await prompt({
 title: t('fileExplorer.rename'),
 defaultValue: file.name,
 required: true,
 confirmLabel: t('fileExplorer.rename'),
 });
 if (value === null) return;
 await confirmRename(file, value);
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

 // Touch screens: confirm in a dialog instead of the inline "Delete? ✓ ✗".
 const deleteViaDialog = async (file: FileInfo) => {
 const ok = await confirm({
 message: t('fileExplorer.deleteConfirm', 'Delete "{{name}}"?', { name: file.name }),
 danger: true,
 });
 if (ok) await handleDelete(file);
 };

 const requestRename = (file: FileInfo) => {
 if (isCoarse) renameViaDialog(file);
 else startRename(file);
 };

 const requestDelete = (file: FileInfo) => {
 if (isCoarse) deleteViaDialog(file);
 else setDeletingFile(file.path);
 };

 // ── Upload (drag & drop) ────────────────────────────────────────────────

 const handleDrop = async (e: React.DragEvent) => {
 e.preventDefault();
 setDragOver(false);
 const droppedFiles = Array.from(e.dataTransfer.files);
 if (droppedFiles.length === 0) return;

 // Each file is read whole into memory as base64 and sent in one command:
 // on touch devices (phones / tablets, often low on RAM) a large file can
 // crash the WebView tab, so they get a lower cap until uploads are chunked.
 const uploadLimit = isCoarse ? MAX_UPLOAD_SIZE_TOUCH : MAX_UPLOAD_SIZE;
 const oversized = droppedFiles.filter((f) => f.size > uploadLimit);
 if (oversized.length > 0) {
 const names = oversized.map((f) => f.name).join(', ');
 toast.error(
 isCoarse
 ? t('fileExplorer.tooLargeTouch', '{{count}} file(s) exceed the {{limit}} MB upload limit on phones and tablets (the file is loaded in memory): {{names}}', {
 count: oversized.length,
 limit: MAX_UPLOAD_MB_TOUCH,
 names,
 })
 : t('fileExplorer.tooLarge', '{{count}} file(s) exceed the 150 MB limit: {{names}}', {
 count: oversized.length,
 names,
 }),
 isCoarse ? { duration: 8000 } : undefined,
 );
 }

 const valid = droppedFiles.filter((f) => f.size <= uploadLimit);
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

 if (successCount > 0) toast.success(t('fileExplorer.uploadedCount', '{{count}} file(s) uploaded', { count: successCount }));
 if (failCount > 0) toast.error(t('fileExplorer.uploadFailedCount', '{{count}} file(s) failed to upload', { count: failCount }));
 await listDirectory(currentPath);
 };

 // The file input lives in the DOM (below): mobile WebView file choosers do
 // not always honour a detached input. This is also the touch path —
 // drag & drop only exists with a mouse.
 const handleUploadClick = () => {
 fileInputRef.current?.click();
 };

 const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 const input = e.currentTarget;
 const picked = input.files ? Array.from(input.files) : [];
 input.value = ''; // picking the same file again must fire onChange
 if (picked.length === 0) return;
 // Reuse the same upload logic
 const fakeEvent = {
 preventDefault: () => {},
 dataTransfer: { files: picked },
 } as unknown as React.DragEvent;
 await handleDrop(fakeEvent);
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
 const unsupported = unsupportedTooltip(t);

 // "Open" = what a double-click does on desktop and a tap does on touch.
 const openFile = (file: FileInfo, at: { x: number; y: number }) => {
 if (file.isDir) {
 navigateTo(file);
 } else if (isEditableText(file) && canDownload) {
 handleOpenEditor(file);
 } else {
 // No direct action: show the file's actions where the finger is.
 setContextMenu({ x: at.x, y: at.y, file });
 }
 };

 // Row actions for the "⋯" menu (phones / tablets).
 const fileActions = (file: FileInfo): ActionMenuItem[] => {
 const editable = !file.isDir && isEditableText(file);
 return [
 {
 key: 'open',
 icon: <FolderOpen className="w-4 h-4 text-yellow-500" />,
 label: t('fileExplorer.open', 'Open'),
 onClick: () => navigateTo(file),
 hidden: !file.isDir,
 },
 {
 key: 'edit',
 icon: <Edit3 className="w-4 h-4 text-accent" />,
 label: t('fileExplorer.edit', 'Edit'),
 onClick: () => handleOpenEditor(file),
 hidden: !editable || !canDownload,
 },
 {
 key: 'download',
 icon: <Download className="w-4 h-4 text-accent" />,
 label: t('fileExplorer.download'),
 description: canDownload ? undefined : unsupported,
 onClick: () => handleDownload(file),
 hidden: file.isDir,
 disabled: !canDownload,
 },
 {
 key: 'rename',
 icon: <Pencil className="w-4 h-4 text-accent" />,
 label: t('fileExplorer.rename'),
 description: canRename ? undefined : unsupported,
 onClick: () => renameViaDialog(file),
 disabled: !canRename,
 separator: true,
 },
 {
 key: 'delete',
 icon: <Trash2 className="w-4 h-4" />,
 label: t('fileExplorer.delete'),
 description: canDelete ? undefined : unsupported,
 onClick: () => deleteViaDialog(file),
 disabled: !canDelete,
 danger: true,
 },
 ];
 };

 const editorDirty = editorContent !== editorOriginal;
 const editorAsSheet = !!editorFile && !isLg;

 const saveButton = (
 <button
 onClick={handleSaveEditor}
 disabled={editorSaving || editorLoading || !editorDirty}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 title={t('fileExplorer.save', 'Save')}
 >
 {editorSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
 {t('fileExplorer.save', 'Save')}
 </button>
 );

 const unsavedBadge = editorDirty && (
 <span className="text-xs text-orange-400 shrink-0">{t('fileExplorer.unsavedBadge', 'modified')}</span>
 );

 const renderEditorArea = (textareaClassName: string) => (
 <div className="flex-1 min-h-0 relative">
 {editorLoading ? (
 <div className="absolute inset-0 flex items-center justify-center">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 ) : (
 <textarea
 value={editorContent}
 onChange={(e) => setEditorContent(e.target.value)}
 {...PLAIN_INPUT}
 aria-label={editorFile?.name}
 className={textareaClassName}
 onKeyDown={(e) => {
 if ((e.ctrlKey || e.metaKey) && e.key === 's') {
 e.preventDefault();
 handleSaveEditor();
 }
 }}
 />
 )}
 </div>
 );

 const editorStats = (
 <>
 <span>{t('fileExplorer.editorStats', '{{chars}} chars · {{lines}} lines', { chars: editorContent.length, lines: editorContent.split('\n').length })}</span>
 <span className="opacity-60 coarse:hidden">{t('fileExplorer.ctrlSToSave', 'Ctrl+S to save')}</span>
 </>
 );

 return (
 <div className="flex gap-3">
 <div className={clsx(
 'bg-bg-secondary rounded-xl overflow-hidden flex flex-col',
 editorFile && !editorAsSheet ? 'flex-1 min-w-0' : 'w-full'
 )}>
 {/* Hidden picker used by the Upload button (the touch upload path). */}
 <input
 ref={fileInputRef}
 type="file"
 multiple
 className="hidden"
 tabIndex={-1}
 aria-hidden="true"
 onChange={handleFileInputChange}
 />

 {/* ── Top bar ──────────────────────────────────────────────────────── */}
 <div className="px-4 py-3 flex items-center gap-2 flex-wrap max-sm:px-3">
 {/* Back button */}
 <button
 onClick={navigateUp}
 disabled={isRoot || loading}
 className={clsx('p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors', TB)}
 title={t('fileExplorer.back')}
 aria-label={t('fileExplorer.back')}
 >
 <ArrowLeft className="w-4 h-4" />
 </button>

 {/* Breadcrumb (own line on phones) */}
 <div className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-x-auto scrollbar-thin max-sm:order-last max-sm:basis-full overscroll-x-contain">
 <button
 onClick={() => listDirectory('')}
 className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors coarse:py-2 coarse:px-2.5 ${
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
 className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors coarse:py-2 coarse:px-2.5 ${
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
 <div className="flex items-center gap-1 shrink-0 max-sm:ml-auto">
 <button
 onClick={() => listDirectory(currentPath)}
 disabled={loading}
 className={clsx('p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 transition-colors', TB)}
 title={t('fileExplorer.refresh')}
 aria-label={t('fileExplorer.refresh')}
 >
 <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
 </button>
 <button
 onClick={handleCreateFolder}
 disabled={loading || isRoot || !canCreateDir}
 className={clsx('p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors', TB)}
 title={canCreateDir ? t('fileExplorer.newFolder') : unsupported}
 aria-label={canCreateDir ? t('fileExplorer.newFolder') : unsupported}
 >
 <FolderPlus className="w-4 h-4" />
 </button>
 <button
 onClick={handleUploadClick}
 disabled={loading || isRoot || !canUpload}
 className={clsx('p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors', TB)}
 title={canUpload ? t('fileExplorer.upload') : unsupported}
 aria-label={canUpload ? t('fileExplorer.upload') : unsupported}
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
 <span className="text-xs text-text-muted">{t('fileExplorer.maxUploadSize', 'Max 150 MB per file')}</span>
 </div>
 </div>
 )}

 {/* Loading state (also swallows a second tap while a folder opens) */}
 {loading && (
 <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-secondary/80">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 )}

 {/* Table — nested scroll on large screens; on phones (and short
 touch screens) the page scrolls instead of a 40 px strip. */}
 {files.length > 0 ? (
 <div className="overflow-auto max-h-[calc(100dvh-320px)] supports-[not(height:100dvh)]:max-h-[calc(100vh-320px)] max-md:max-h-none coarse:[@media(max-height:600px)]:max-h-none">
 <table className="w-full text-sm">
 <thead className="sticky top-0 z-[5]">
 <tr className="bg-bg-tertiary/80 backdrop-blur text-text-muted text-xs uppercase tracking-wider">
 <th className="w-8 px-3 py-2 max-sm:px-2" />
 <th className="text-left px-3 py-2 font-medium max-sm:px-1">{t('fileExplorer.name')}</th>
 <th className="text-right px-3 py-2 font-medium w-28 hidden sm:table-cell">{t('fileExplorer.size')}</th>
 <th className="text-left px-3 py-2 font-medium w-44 hidden sm:table-cell">{t('fileExplorer.modified')}</th>
 <th className="text-right px-3 py-2 font-medium w-12 md:w-28 max-sm:px-1">
 <span className="max-md:sr-only">{t('fileExplorer.actions')}</span>
 </th>
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
 onClick={(e) => {
 if (isTouchEvent(e)) {
 // Tap = open. stopPropagation also keeps the
 // window 'click' listener from closing a menu
 // this tap just opened.
 e.stopPropagation();
 openFile(file, { x: e.clientX, y: e.clientY });
 } else {
 toggleSelect(file.path, e);
 }
 }}
 onDoubleClick={(e) => {
 if (isTouchEvent(e)) return; // the tap already opened it
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
 className={`group /50 cursor-pointer transition-colors coarse:select-none coarse:[-webkit-touch-callout:none] ${
 isSelected
 ? 'bg-accent/10'
 : 'hover:bg-bg-tertiary/50'
 } ${isOperating ? 'opacity-50 pointer-events-none' : ''}`}
 >
 {/* Icon — on touch it also toggles the selection */}
 <td
 className="px-3 py-1.5 text-center max-sm:px-2"
 onClick={(e) => {
 if (!isTouchEvent(e)) return;
 toggleSelect(file.path, e);
 }}
 >
 {isOperating ? (
 <Loader2 className="w-4 h-4 text-accent animate-spin mx-auto" />
 ) : isSelected && isCoarse ? (
 <CheckSquare className="w-4 h-4 mx-auto text-accent" aria-label={t('fileExplorer.selected')} />
 ) : (
 <Icon
 className={`w-4 h-4 mx-auto ${
 file.isDir ? 'text-yellow-500' : 'text-text-muted'
 }`}
 />
 )}
 </td>

 {/* Name (+ size · date under it on phones) */}
 <td className="px-3 py-1.5 max-sm:px-1 coarse:py-2.5">
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
 {...PLAIN_INPUT}
 aria-label={t('fileExplorer.rename')}
 className="px-1.5 py-0.5 text-sm bg-bg-tertiary border border-accent/50 rounded text-text-primary focus:outline-none w-full max-w-64 min-w-0"
 autoFocus
 />
 <button
 onClick={(e) => {
 e.stopPropagation();
 confirmRename(file);
 }}
 aria-label={t('fileExplorer.confirm')}
 className={clsx('p-0.5 rounded text-green-400 hover:bg-green-400/10', TB)}
 >
 <Check className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={(e) => {
 e.stopPropagation();
 setRenamingFile(null);
 }}
 aria-label={t('fileExplorer.cancel')}
 className={clsx('p-0.5 rounded text-red-400 hover:bg-red-400/10', TB)}
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 ) : (
 <>
 <span
 className={`${
 file.isDir
 ? 'text-text-primary font-medium hover:text-accent'
 : 'text-text-primary'
 } transition-colors max-sm:[overflow-wrap:anywhere]`}
 >
 {file.name}
 </span>
 <div className="sm:hidden mt-0.5 text-[11px] text-text-muted tabular-nums">
 {file.isDir ? formatDate(file.modified) : `${formatSize(file.size)} · ${formatDate(file.modified)}`}
 </div>
 </>
 )}
 </td>

 {/* Size */}
 <td className="px-3 py-1.5 text-right text-text-muted text-xs tabular-nums hidden sm:table-cell">
 {file.isDir ? '-' : formatSize(file.size)}
 </td>

 {/* Modified */}
 <td className="px-3 py-1.5 text-text-muted text-xs hidden sm:table-cell">
 {formatDate(file.modified)}
 </td>

 {/* Actions */}
 <td className="px-3 py-1.5 text-right max-sm:px-1">
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
 className={clsx('p-1 rounded text-red-400 hover:bg-red-400/10 transition-colors', TB)}
 title={t('fileExplorer.confirm')}
 aria-label={t('fileExplorer.confirm')}
 >
 <Check className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={() => setDeletingFile(null)}
 className={clsx('p-1 rounded text-text-muted hover:bg-bg-tertiary transition-colors', TB)}
 title={t('fileExplorer.cancel')}
 aria-label={t('fileExplorer.cancel')}
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 ) : (
 <>
 {/* md+: inline buttons — revealed on hover with a mouse,
 always visible on touch screens. */}
 <div className="hidden md:inline-flex items-center gap-0.5 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity">
 {!file.isDir && isEditableText(file) && canDownload && (
 <button
 onClick={(e) => {
 e.stopPropagation();
 handleOpenEditor(file);
 }}
 className={clsx('p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors', TB)}
 title={t('fileExplorer.edit', 'Edit')}
 aria-label={t('fileExplorer.edit', 'Edit')}
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
 className={clsx('p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors', TB)}
 title={canDownload ? t('fileExplorer.download') : unsupported}
 aria-label={canDownload ? t('fileExplorer.download') : unsupported}
 >
 <Download className="w-3.5 h-3.5" />
 </button>
 )}
 <button
 onClick={(e) => {
 e.stopPropagation();
 requestRename(file);
 }}
 disabled={!canRename}
 className={clsx('p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors', TB)}
 title={canRename ? t('fileExplorer.rename') : unsupported}
 aria-label={canRename ? t('fileExplorer.rename') : unsupported}
 >
 <Pencil className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={(e) => {
 e.stopPropagation();
 requestDelete(file);
 }}
 disabled={!canDelete}
 className={clsx('p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors', TB)}
 title={canDelete ? t('fileExplorer.delete') : unsupported}
 aria-label={canDelete ? t('fileExplorer.delete') : unsupported}
 >
 <Trash2 className="w-3.5 h-3.5" />
 </button>
 </div>
 {/* Phones: every action in one "⋯" menu (bottom sheet). The
 wrapper keeps the menu's clicks (portalled, but they
 bubble through React) away from the row. Only mounted
 below md. */}
 {!isMd && (
 <div
 className="md:hidden inline-flex"
 onClick={(e) => e.stopPropagation()}
 onDoubleClick={(e) => e.stopPropagation()}
 onContextMenu={(e) => e.stopPropagation()}
 >
 <ActionMenu
 items={fileActions(file)}
 label={t('fileExplorer.actions')}
 sheetTitle={file.name}
 />
 </div>
 )}
 </>
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
 <p className="text-xs mt-1 opacity-60 coarse:hidden">{t('fileExplorer.dropToUpload')}</p>
 )}
 </div>
 )
 )}
 </div>

 {/* ── Status bar ───────────────────────────────────────────────────── */}
 <div className="px-4 py-1.5 bg-bg-tertiary/50 flex items-center justify-between text-xs text-text-muted max-md:gap-3">
 <span className="max-md:shrink-0">
 {files.length > 0
 ? `${files.length} ${t('fileExplorer.items')}${
 selectedFiles.size > 0 ? ` — ${selectedFiles.size} ${t('fileExplorer.selected')}` : ''
 }`
 : ''}
 </span>
 <span className="opacity-60 max-md:min-w-0 max-md:truncate">{currentPath || (isWindows ? t('fileExplorer.drives') : '/')}</span>
 </div>
 </div>

 {/* ── Custom right-click context menu (long-press / tap on touch) ──── */}
 {contextMenu && (() => {
 const file = contextMenu.file;
 const editable = !file.isDir && isEditableText(file);
 const MENU_W = 200;
 const MENU_H_EST = isCoarse ? 300 : 240;
 const x = Math.max(8, Math.min(contextMenu.x, window.innerWidth - MENU_W - 8));
 const y = Math.max(8, Math.min(contextMenu.y, window.innerHeight - MENU_H_EST - 8));
 const close = () => setContextMenu(null);
 const row = 'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left coarse:py-3 coarse:text-sm';
 // Touch: a disabled item explains itself under its label (no hover title).
 const why = (ok: boolean) => !ok && isCoarse && (
 <span className="block text-[11px] text-text-muted">{unsupported}</span>
 );
 return (
 <div
 className="fixed z-[200] w-[200px] bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1"
 style={{ left: x, top: y }}
 role="menu"
 onClick={(e) => e.stopPropagation()}
 onContextMenu={(e) => e.preventDefault()}
 >
 {file.isDir ? (
 <button
 role="menuitem"
 onClick={() => { navigateTo(file); close(); }}
 className={clsx(row, 'text-text-primary hover:bg-bg-tertiary')}
 >
 <FolderOpen className="w-3.5 h-3.5 text-yellow-500" />
 {t('fileExplorer.open', 'Open')}
 </button>
 ) : (
 <>
 {editable && canDownload && (
 <button
 role="menuitem"
 onClick={() => { handleOpenEditor(file); close(); }}
 className={clsx(row, 'text-text-primary hover:bg-bg-tertiary')}
 >
 <Edit3 className="w-3.5 h-3.5 text-accent" />
 {t('fileExplorer.edit', 'Edit')}
 </button>
 )}
 <button
 role="menuitem"
 onClick={() => { handleDownload(file); close(); }}
 disabled={!canDownload}
 title={canDownload ? undefined : unsupported}
 className={clsx(row, 'text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed')}
 >
 <Download className="w-3.5 h-3.5 text-accent shrink-0" />
 <span>{t('fileExplorer.download')}{why(canDownload)}</span>
 </button>
 </>
 )}
 <div className="h-px bg-border my-1" />
 <button
 role="menuitem"
 onClick={() => { requestRename(file); close(); }}
 disabled={!canRename}
 title={canRename ? undefined : unsupported}
 className={clsx(row, 'text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed')}
 >
 <Pencil className="w-3.5 h-3.5 text-accent shrink-0" />
 <span>{t('fileExplorer.rename')}{why(canRename)}</span>
 </button>
 <button
 role="menuitem"
 onClick={() => { requestDelete(file); close(); }}
 disabled={!canDelete}
 title={canDelete ? undefined : unsupported}
 className={clsx(row, 'text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:cursor-not-allowed')}
 >
 <Trash2 className="w-3.5 h-3.5 shrink-0" />
 <span>{t('fileExplorer.delete')}{why(canDelete)}</span>
 </button>
 </div>
 );
 })()}

 {/* ── Text editor: side panel from lg up ───────────────────────────── */}
 {editorFile && !editorAsSheet && (
 <div className="w-1/2 min-w-[400px] bg-bg-secondary rounded-xl overflow-hidden flex flex-col">
 {/* Header */}
 <div className="px-4 py-3 flex items-center gap-2">
 <Edit3 className="w-4 h-4 text-accent shrink-0" />
 <div className="flex-1 min-w-0">
 <div className="text-sm text-text-primary font-medium truncate">{editorFile.name}</div>
 <div className="text-xs text-text-muted truncate" title={editorFile.path}>{editorFile.path}</div>
 </div>
 {unsavedBadge}
 {saveButton}
 <button
 onClick={handleCloseEditor}
 disabled={editorSaving}
 className={clsx('p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors', TB)}
 title={t('fileExplorer.close', 'Close')}
 aria-label={t('fileExplorer.close', 'Close')}
 >
 <X className="w-4 h-4" />
 </button>
 </div>

 {/* Editor area */}
 {renderEditorArea('w-full h-full min-h-[400px] p-4 bg-bg-primary text-text-primary font-mono text-xs leading-relaxed resize-none focus:outline-none')}

 {/* Footer with info */}
 <div className="px-4 py-1.5 bg-bg-tertiary/50 flex items-center justify-between text-xs text-text-muted">
 {editorStats}
 </div>
 </div>
 )}

 {/* ── Text editor: full-screen sheet below lg ──────────────────────── */}
 <Modal
 open={editorAsSheet}
 onClose={handleCloseEditor}
 size="full"
 closeOnBackdrop={false}
 dismissible={!editorSaving}
 title={editorFile?.name}
 icon={<Edit3 className="w-4 h-4 text-accent shrink-0" />}
 headerExtra={<>{unsavedBadge}{saveButton}</>}
 bodyClassName="p-0 flex flex-col"
 footer={<div className="flex w-full items-center justify-between gap-3">{editorStats}</div>}
 footerClassName="py-1.5 bg-bg-tertiary/50 text-xs text-text-muted"
 >
 <div className="px-4 pb-2 text-xs text-text-muted truncate">{editorFile?.path}</div>
 {renderEditorArea('w-full h-full min-h-[12rem] p-3 bg-bg-primary text-text-primary font-mono text-xs leading-relaxed resize-none focus:outline-none')}
 </Modal>
 </div>
 );
}
