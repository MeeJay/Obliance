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
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { fileApi } from '@/api/file.api';
import { getSocket } from '@/socket/socketClient';
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

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden flex flex-col">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
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
            disabled={loading || isRoot}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t('fileExplorer.newFolder')}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={handleUploadClick}
            disabled={loading || isRoot}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t('fileExplorer.upload')}
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
                        } else if (file.size <= MAX_UPLOAD_SIZE) {
                          handleDownload(file);
                        }
                      }}
                      className={`group border-b border-border/50 cursor-pointer transition-colors ${
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
                            {!file.isDir && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(file);
                                }}
                                className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                                title={t('fileExplorer.download')}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(file);
                              }}
                              className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                              title={t('fileExplorer.rename')}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingFile(file.path);
                              }}
                              className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                              title={t('fileExplorer.delete')}
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
      <div className="px-4 py-1.5 border-t border-border bg-bg-tertiary/50 flex items-center justify-between text-xs text-text-muted">
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
  );
}
