import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cloud,
  Upload,
  FileCode2,
  Ruler,
  Share2,
  Trash2,
  Search,
  Plus,
  CheckCircle2,
  Layers,
  RefreshCw,
  X,
  Download,
  FolderKanban,
  FolderInput,
  FolderPlus,
  Pencil,
  Clock,
  LogOut,
  Lock,
  Settings,
  Compass,
  ArrowRight,
} from 'lucide-react';
import { OpenCadViewer } from './components/OpenCadViewer';
import { StructuralEstimatorPage } from './components/StructuralEstimator/StructuralEstimatorPage';
import { SheetSelectorModal, SheetConfig, cropRawDataToSheet } from './components/SheetSelectorModal';
import {
  AuthConfig,
  AuthSession,
  UserProfile,
  apiUrl,
  authFetch,
  fetchAuthConfig,
  fetchUserProfile,
  getStoredSession,
  saveSession,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
  updateUserProfile,
} from './auth';

export type PlanDiscipline = 'architectural' | 'electrical' | 'structural' | 'plumbing' | 'fire';

export const DISCIPLINES: {
  id: PlanDiscipline;
  label: string;
  badgeClass: string;
  pillActiveClass: string;
}[] = [
  {
    id: 'architectural',
    label: 'Architectural',
    badgeClass: 'bg-white/5 border-white/10 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-900 border-zinc-100',
  },
  {
    id: 'electrical',
    label: 'Electrical',
    badgeClass: 'bg-white/5 border-white/10 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-900 border-zinc-100',
  },
  {
    id: 'structural',
    label: 'Structural',
    badgeClass: 'bg-blue-500/15 border-blue-500/35 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-900 border-zinc-100',
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    badgeClass: 'bg-white/5 border-white/10 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-900 border-zinc-100',
  },
  {
    id: 'fire',
    label: 'Fire',
    badgeClass: 'bg-white/5 border-white/10 text-zinc-300',
    pillActiveClass: 'bg-zinc-100 text-zinc-900 border-zinc-100',
  },
];

function inferDisciplineFromFilename(...names: (string | undefined | null)[]): PlanDiscipline {
  const s = names.filter(Boolean).join(' ').toLowerCase();
  if (/(?:^|[\s_\-.])(elec\w*|power|lighting|conduit|wiring|panel|switch\w*|sldb|mddb)(?:$|[\s_\-.])/.test(s)) {
    return 'electrical';
  }
  if (/(?:^|[\s_\-.])(struct\w*|column\w*|col|beam\w*|footing\w*|foundation\w*|rcc|slab|khunt|centerline|lintel|plinth)(?:$|[\s_\-.])/.test(s)) {
    return 'structural';
  }
  if (/(?:^|[\s_\-.])(plumb\w*|sanitary|drain\w*|sewer\w*|water|pipe\w*|phe|stp|ugt|oht)(?:$|[\s_\-.])/.test(s)) {
    return 'plumbing';
  }
  if (/(?:^|[\s_\-.])(fire\w*|sprinkler\w*|hydrant\w*|smoke|alarm\w*|hose|fhc)(?:$|[\s_\-.])/.test(s)) {
    return 'fire';
  }
  return 'architectural';
}

function inferProjectFromFilename(filename: string, existingProjects: string[]): string {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const stopMatch = stem.match(
    /\b(block|working|plan|layout|ground|first|second|third|fourth|1st|2nd|3rd|4th|terrace|typical|floor|sheet|elec\w*|struct\w*|plumb\w*|fire\w*|arch\w*|section\w*|elevation\w*|detail\w*|centerline|column\w*|footing\w*)\b/i
  );
  const prefix = (stopMatch && stopMatch.index !== undefined ? stem.slice(0, stopMatch.index) : stem)
    .replace(/\s+/g, ' ')
    .trim();
  if (!prefix) return '';
  const titled = prefix
    .split(' ')
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
  const low = titled.toLowerCase();
  for (const p of existingProjects) {
    if (p && p !== 'Default Project') {
      const pl = p.toLowerCase();
      if (pl === low || pl.startsWith(low + ' ') || low.startsWith(pl + ' ')) {
        return p;
      }
    }
  }
  return titled;
}

interface UploadProgressState {
  pct: number;
  stage: string;
  elapsedSec: number;
  remainingSec: number;
}

function UploadProgressOverlay({ progress }: { progress: UploadProgressState | null }) {
  if (!progress) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-3 shadow-2xl">
        <div className="flex items-center justify-between text-xs font-medium text-white">
          <span className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            {progress.stage}
          </span>
          <span className="text-blue-400 font-mono">{progress.pct}%</span>
        </div>
        <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
          <span>Elapsed: {progress.elapsedSec}s</span>
          <span className="text-zinc-300 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {progress.remainingSec > 0
              ? `~${progress.remainingSec}s remaining`
              : 'Finishing up...'}
          </span>
        </div>
      </div>
    </div>
  );
}

const isIosBrowser =
  typeof navigator !== 'undefined' &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(navigator as any).standalone;

export function App() {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getStoredSession());
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const [plans, setPlans] = useState<any[]>([]);
  const [storageBackend, setStorageBackend] = useState<string>('cloud-vault');
  const [loadingVault, setLoadingVault] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('ALL');
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>('ALL');

  // Active opened plan state
  const [activePlanPayload, setActivePlanPayload] = useState<{ plan: any; raw: any; fullRaw?: any; isGuest?: boolean } | null>(null);
  const [guestDwgFile, setGuestDwgFile] = useState<File | null>(null);
  const [viewerInitialMeasure, setViewerInitialMeasure] = useState<boolean>(false);
  const [openingPlan, setOpeningPlan] = useState<boolean>(false);
  const [isStructuralEstimatorOpen, setIsStructuralEstimatorOpen] = useState<boolean>(false);

  // Auth modal & profile state
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [savingGuestPlan, setSavingGuestPlan] = useState<boolean>(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadDwgFiles, setUploadDwgFiles] = useState<File[]>([]);
  const uploadDwgFile = uploadDwgFiles[0] || null;
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [uploadProject, setUploadProject] = useState<string>('');
  const [uploadDiscipline, setUploadDiscipline] = useState<PlanDiscipline>('architectural');
  const [disciplineAutoDetected, setDisciplineAutoDetected] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Sheet Window Selector state
  const [sheetSelectorData, setSheetSelectorData] = useState<{
    dwgFiles: File[];
    project: string;
    discipline: PlanDiscipline;
    parsed: any;
    filesData?: any[];
    isGuest: boolean;
  } | null>(null);

  // Project & Plan Management Modals
  const [confirmDeletePlan, setConfirmDeletePlan] = useState<any | null>(null);
  const [renameProjectModal, setRenameProjectModal] = useState<{ oldName: string; newName: string } | null>(null);
  const [deleteProjectModal, setDeleteProjectModal] = useState<{ name: string; count: number } | null>(null);
  const [movePlanModal, setMovePlanModal] = useState<{ plan: any; targetProject: string; customProject: string } | null>(null);
  const [renamePlanModal, setRenamePlanModal] = useState<{ plan: any; newName: string } | null>(null);
  const [createProjectModal, setCreateProjectModal] = useState<{ name: string } | null>(null);

  // Toast & PWA install prompt
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((prev) => (prev === msg ? null : prev)), 3200);
  }, []);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const fetchVaultPlans = useCallback(async () => {
    setLoadingVault(true);
    try {
      const res = await authFetch('/api/plans');
      if (res.status === 401) {
        saveSession(null);
        setAuthSession(null);
        setPlans([]);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
        if (data.storage_backend) setStorageBackend(data.storage_backend);
      }
    } finally {
      setLoadingVault(false);
    }
  }, []);

  const openPlanById = useCallback(
    async (planId: number, startMeasure = false) => {
      setOpeningPlan(true);
      setViewerInitialMeasure(startMeasure);
      try {
        const res = await authFetch(`/api/plans/${planId}`);
        if (res.ok) {
          const data = await res.json();
          setActivePlanPayload(data);
        } else {
          showToast('Failed to load plan');
        }
      } catch (err: any) {
        showToast(err.message || 'Error opening plan');
      } finally {
        setOpeningPlan(false);
      }
    },
    [showToast]
  );

  // Initialize Auth & check for ?share=<token> on initial load
  useEffect(() => {
    let active = true;
    (async () => {
      const cfg = await fetchAuthConfig();
      if (!active) return;
      setAuthConfig(cfg);
      const sess = getStoredSession();
      if (sess && active) {
        setAuthSession(sess);
        fetchUserProfile().then((prof) => {
          if (!active) return;
          if (prof) {
            setAuthSession((s) => (s ? { ...s, user: prof } : null));
          } else if (!getStoredSession()) {
            setAuthSession(null);
          }
        });
      }

      const params = new URLSearchParams(window.location.search);
      const shareToken = params.get('share');
      const planIdParam = params.get('planId');
      if (shareToken) {
        setOpeningPlan(true);
        fetch(apiUrl(`/api/plans/share/${encodeURIComponent(shareToken)}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (active && data) {
              setActivePlanPayload(data);
              if (params.get('view') === 'structural') {
                setIsStructuralEstimatorOpen(true);
              }
            }
          })
          .finally(() => {
            if (active) setOpeningPlan(false);
          });
      } else if (planIdParam && sess) {
        setOpeningPlan(true);
        authFetch(`/api/plans/${encodeURIComponent(planIdParam)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (active && data) {
              setActivePlanPayload(data);
              if (params.get('view') === 'structural') {
                setIsStructuralEstimatorOpen(true);
              }
            }
          })
          .finally(() => {
            if (active) setOpeningPlan(false);
          });
      }

      if (sess) {
        await fetchVaultPlans();
      } else if (active) {
        setLoadingVault(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchVaultPlans]);

  const distinctProjects = Array.from(
    new Set(plans.map((p) => p.project_name || 'Default Project'))
  ).sort();

  const userEmail = authSession?.user?.email || '';
  const username = userEmail ? userEmail.split('@')[0] : 'Account';
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';

  const handleFilePicked = (dwg: File | null) => {
    const detectedDisc = inferDisciplineFromFilename(dwg?.name, undefined, uploadTitle);
    setUploadDiscipline(detectedDisc);
    setDisciplineAutoDetected(true);
    if (!uploadProject.trim()) {
      const inferredProj = inferProjectFromFilename(dwg?.name || '', distinctProjects);
      if (inferredProj) {
        setUploadProject(inferredProj);
      } else if (selectedProject !== 'ALL') {
        setUploadProject(selectedProject);
      }
    }
  };

  const handleDwgFilesSelected = (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.dwg') || ext.endsWith('.dxf');
    });
    if (arr.length === 0) return;
    setUploadDwgFiles((prev) => {
      const existingNames = new Set(prev.map((p) => p.name));
      const newOnes = arr.filter((f) => !existingNames.has(f.name));
      const combined = [...prev, ...newOnes];
      if (combined.length > 0 && !uploadTitle) {
        handleFilePicked(combined[0]);
      }
      return combined;
    });
  };

  const removeDwgFile = (fileName: string) => {
    setUploadDwgFiles((prev) => prev.filter((f) => f.name !== fileName));
  };

  const runUploadWithProgress = (
    url: string,
    form: FormData,
    dwgFile: File | null
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const sizeMB = dwgFile ? dwgFile.size / (1024 * 1024) : 0.2;
      const isDwg = dwgFile?.name.toLowerCase().endsWith('.dwg');
      // Calibrated to optimized LibreDWG + single-pass ezdxf pipeline (~12-14s for 1.7MB DWG)
      const estTotalSec = !dwgFile
        ? 3
        : isDwg
        ? Math.max(7, Math.min(26, Math.round(sizeMB * 4.5 + 6)))
        : Math.max(4, Math.min(18, Math.round(sizeMB * 0.4 + 3)));

      let uploadBytesDone = false;
      let latestUploadRatio = 0;

      const updateTick = () => {
        const elapsedSec = Math.max(0, Math.round((Date.now() - startTime) / 1000));
        let pct = 5;
        let stage = 'Uploading files to Cloud Vault...';

        if (!uploadBytesDone) {
          pct = Math.min(30, Math.max(4, Math.round(latestUploadRatio * 30)));
          stage = 'Uploading CAD drawings...';
        } else {
          const procElapsed = (Date.now() - startTime) / 1000;
          const procRatio = Math.min(0.97, procElapsed / estTotalSec);
          pct = Math.min(97, Math.max(32, Math.round(30 + procRatio * 68)));
          if (pct < 55) {
            stage = isDwg
              ? 'Converting DWG binary to DXF (LibreDWG)...'
              : 'Loading DXF structure...';
          } else if (pct < 80) {
            stage = 'Extracting CAD layers, blocks & geometry...';
          } else if (pct < 93) {
            stage = 'Detecting sheet frames & isolating plan view...';
          } else {
            stage = 'Finalizing cleaned plan view...';
          }
        }

        const remainingSec = Math.max(1, Math.round(estTotalSec - (Date.now() - startTime) / 1000));
        setUploadProgress({ pct, stage, elapsedSec, remainingSec });
      };

      updateTick();
      const timer = window.setInterval(updateTick, 250);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl(url), true);
      const token = getStoredSession()?.access_token;
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          latestUploadRatio = ev.loaded / ev.total;
          if (ev.loaded >= ev.total) {
            uploadBytesDone = true;
          }
          updateTick();
        }
      };

      xhr.upload.onload = () => {
        uploadBytesDone = true;
        updateTick();
      };

      xhr.onload = () => {
        window.clearInterval(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadProgress({
            pct: 100,
            stage: 'Complete! Opening cleaned plan...',
            elapsedSec: Math.round((Date.now() - startTime) / 1000),
            remainingSec: 0,
          });
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Invalid server response'));
          }
        } else {
          let detail = 'Upload failed';
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed.detail) detail = parsed.detail;
          } catch {
            // fallback
          }
          reject(new Error(detail));
        }
      };

      xhr.onerror = () => {
        window.clearInterval(timer);
        reject(new Error('Network error while uploading plan'));
      };

      xhr.send(form);
    });
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadDwgFiles.length === 0) {
      setUploadError('Please select one or more DWG/DXF files.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      if (uploadDwgFiles.length > 1) {
        const form = new FormData();
        uploadDwgFiles.forEach((f) => form.append('dwg_files', f));
        const parsed = await runUploadWithProgress('/api/plans/preview-multi', form, uploadDwgFiles[0]);
        const first = parsed.files?.[0];
        setSheetSelectorData({
          dwgFiles: uploadDwgFiles,
          project: uploadProject.trim(),
          discipline: uploadDiscipline,
          parsed: first,
          filesData: parsed.files,
          isGuest: false,
        });
        setShowUploadModal(false);
      } else {
        const form = new FormData();
        form.append('dwg_file', uploadDwgFiles[0]);
        const parsed = await runUploadWithProgress('/api/plans/preview-guest', form, uploadDwgFiles[0]);
        setSheetSelectorData({
          dwgFiles: uploadDwgFiles,
          project: uploadProject.trim(),
          discipline: uploadDiscipline,
          parsed,
          isGuest: false,
        });
        setShowUploadModal(false);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to inspect CAD files');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cfg = authConfig || { enabled: true, type: 'foss' };
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      if (authMode === 'signin') {
        const sess = await signInWithEmail(cfg, authEmail.trim(), authPassword);
        setAuthSession(sess);
        setAuthPassword('');
        setShowAuthModal(false);
        await fetchVaultPlans();
        showToast('Signed in');
      } else {
        const { session } = await signUpWithEmail(
          cfg,
          authEmail.trim(),
          authPassword
        );
        if (session) {
          setAuthSession(session);
          setAuthPassword('');
          setShowAuthModal(false);
          await fetchVaultPlans();
          showToast('Account created');
        }
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSheetSelectorConfirm = async ({
    planTitle: confirmedTitle,
    sheets: configuredSheets,
    activeSheetId,
  }: {
    planTitle: string;
    sheets: SheetConfig[];
    activeSheetId: string;
  }) => {
    if (!sheetSelectorData) return;
    const { dwgFiles, project, discipline, isGuest } = sheetSelectorData;
    setSheetSelectorData(null);

    if (isGuest) {
      // If user selected multiple sheets (from 1 or multiple DWG files), merge them into a unified plan
      if (configuredSheets.length > 1 || dwgFiles.length > 1) {
        setUploading(true);
        try {
          const form = new FormData();
          dwgFiles.forEach((f) => form.append('dwg_files', f));
          form.append('sheets_json', JSON.stringify(configuredSheets));
          form.append('active_sheet_id', activeSheetId);
          const merged = await runUploadWithProgress('/api/plans/merge-preview', form, dwgFiles[0]);
          setGuestDwgFile(dwgFiles[0]);
          setActivePlanPayload({
            plan: {
              id: 0,
              name: confirmedTitle || 'Merged CAD Plan',
              project_name: 'Guest Inspection',
              discipline: 'architectural',
              has_dwg: true,
              active_sheet_id: merged.active_sheet_id || activeSheetId,
              active_sheet_name: configuredSheets.find((s) => s.id === (merged.active_sheet_id || activeSheetId))?.name || 'Selected View',
              unit_name: merged.unit_name || 'm',
              scale_to_m: merged.scale_to_m || 1.0,
              sheets: merged.sheets || configuredSheets,
              summary: merged.summary,
            },
            raw: merged.raw_data,
            fullRaw: merged.full_raw_data,
            isGuest: true,
          });
          showToast(dwgFiles.length > 1 ? 'Sheets merged. Sign up to save' : 'Sheets ready. Sign up to save');
        } catch (err: any) {
          showToast(err.message || 'Failed to merge plans');
        } finally {
          setUploading(false);
          setUploadProgress(null);
        }
        return;
      }

      // Single sheet selected from 1 DWG file: isolate and crop tightly to discard all clutter immediately
      const targetSheet = configuredSheets[0];
      const croppedRaw = cropRawDataToSheet(sheetSelectorData.parsed?.raw_data, targetSheet);
      setGuestDwgFile(dwgFiles[0]);
      setActivePlanPayload({
        plan: {
          id: 0,
          name: confirmedTitle || targetSheet?.name || 'Guest Plan',
          project_name: 'Guest Inspection',
          discipline: 'architectural',
          has_dwg: true,
          active_sheet_id: targetSheet?.id || activeSheetId,
          active_sheet_name: targetSheet?.name || 'Selected View',
          unit_name: sheetSelectorData.parsed?.unit_name || 'm',
          scale_to_m: sheetSelectorData.parsed?.scale_to_m || 1.0,
          sheets: configuredSheets,
          summary: sheetSelectorData.parsed?.summary,
        },
        raw: croppedRaw,
        fullRaw: croppedRaw,
        isGuest: true,
      });
      showToast(`Isolated view: ${targetSheet?.name || 'Selected Sheet'}`);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      if (dwgFiles.length > 1) {
        dwgFiles.forEach((f) => form.append('dwg_files', f));
      } else if (dwgFiles.length === 1) {
        form.append('dwg_file', dwgFiles[0]);
      }
      form.append('name', confirmedTitle);
      if (project) form.append('project_name', project);
      form.append('discipline', discipline);
      form.append('sheets_json', JSON.stringify(configuredSheets));
      form.append('active_sheet_id', activeSheetId);

      const data = await runUploadWithProgress('/api/plans', form, dwgFiles[0] || null);
      setUploadDwgFiles([]);
      setUploadTitle('');
      setUploadProject('');
      setDisciplineAutoDetected(false);
      await fetchVaultPlans();
      setViewerInitialMeasure(false);
      setActivePlanPayload(data);
      showToast(dwgFiles.length > 1 ? 'Merged plan saved' : 'Plan saved');
    } catch (err: any) {
      showToast(err.message || 'Failed to save plan');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleGuestCadPreview = async (files: File | File[] | FileList) => {
    const fileList = Array.isArray(files)
      ? files
      : 'length' in files
      ? Array.from(files)
      : [files];
    const valid = fileList.filter((f) => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.dwg') || ext.endsWith('.dxf');
    });
    if (valid.length === 0) return;

    setUploading(true);
    setUploadError(null);
    try {
      if (valid.length > 1) {
        const form = new FormData();
        valid.forEach((f) => form.append('dwg_files', f));
        const parsed = await runUploadWithProgress('/api/plans/preview-multi', form, valid[0]);
        const first = parsed.files?.[0];
        setSheetSelectorData({
          dwgFiles: valid,
          project: 'Guest Inspection',
          discipline: 'architectural',
          parsed: first,
          filesData: parsed.files,
          isGuest: true,
        });
      } else {
        const form = new FormData();
        form.append('dwg_file', valid[0]);
        const data = await runUploadWithProgress('/api/plans/preview-guest', form, valid[0]);
        setSheetSelectorData({
          dwgFiles: valid,
          project: 'Guest Inspection',
          discipline: 'architectural',
          parsed: data,
          isGuest: true,
        });
      }
    } catch (err: any) {
      showToast(err.message || 'Error parsing CAD files');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleSaveGuestPlan = async () => {
    if (!authSession) {
      setAuthMode('signup');
      setShowAuthModal(true);
      return;
    }
    if (!guestDwgFile && !activePlanPayload) return;
    setSavingGuestPlan(true);
    try {
      const form = new FormData();
      if (guestDwgFile) {
        form.append('dwg_file', guestDwgFile);
      }
      form.append('name', activePlanPayload?.plan?.name || 'My Plan');
      form.append('project_name', 'My Project');
      form.append('discipline', 'architectural');
      if (activePlanPayload?.plan?.sheets) {
        form.append('sheets_json', JSON.stringify(activePlanPayload.plan.sheets));
      }
      if (activePlanPayload?.plan?.active_sheet_id) {
        form.append('active_sheet_id', activePlanPayload.plan.active_sheet_id);
      }

      const data = await runUploadWithProgress('/api/plans', form, guestDwgFile);
      setGuestDwgFile(null);
      await fetchVaultPlans();
      setActivePlanPayload({ ...data, isGuest: false });
      showToast('Plan saved permanently to your vault!');
    } catch (err: any) {
      showToast(err.message || 'Failed to save plan');
    } finally {
      setSavingGuestPlan(false);
    }
  };

  const handleSignOut = async () => {
    if (authConfig) {
      await signOutSession(authConfig);
    }
    setAuthSession(null);
    setActivePlanPayload(null);
    setPlans([]);
    showToast('Signed out');
  };

  const handleQuickUpdateMeta = async (
    planId: number,
    patch: { discipline?: string; project_name?: string }
  ) => {
    const res = await authFetch(`/api/plans/${planId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await fetchVaultPlans();
      showToast('Plan organization updated!');
    }
  };

  const handleSharePlan = async (plan: any) => {
    const shareUrl = `${window.location.origin}/?share=${plan.share_token}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: plan.name,
          text: `View & measure plan "${plan.name}" (DWG / DXF) in PlanVault`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to clipboard copy if user cancels or share fails
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Shareable plan link copied to clipboard!');
    } catch {
      window.prompt('Copy share link:', shareUrl);
    }
  };

  const handleDeletePlan = async (planId: number) => {
    setConfirmDeletePlan(null);
    const res = await authFetch(`/api/plans/${planId}`, { method: 'DELETE' });
    if (res.ok) {
      if (activePlanPayload?.plan?.id === planId) {
        setActivePlanPayload(null);
      }
      await fetchVaultPlans();
      showToast('Plan removed from Cloud Vault');
    }
  };

  const handleRenameProject = async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      setRenameProjectModal(null);
      return;
    }
    try {
      const res = await authFetch(`/api/projects/${encodeURIComponent(oldName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: trimmed }),
      });
      if (res.ok) {
        if (selectedProject === oldName) {
          setSelectedProject(trimmed);
        }
        await fetchVaultPlans();
        showToast(`Project renamed to "${trimmed}"`);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to rename project');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to rename project');
    } finally {
      setRenameProjectModal(null);
    }
  };

  const handleDeleteProject = async (projectName: string) => {
    try {
      const res = await authFetch(`/api/projects/${encodeURIComponent(projectName)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (selectedProject === projectName) {
          setSelectedProject('ALL');
        }
        await fetchVaultPlans();
        showToast(`Project "${projectName}" deleted`);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to delete project');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to delete project');
    } finally {
      setDeleteProjectModal(null);
    }
  };

  const handleMovePlan = async (planId: number, targetProject: string) => {
    const trimmed = targetProject.trim();
    if (!trimmed) return;
    try {
      const res = await authFetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_name: trimmed }),
      });
      if (res.ok) {
        await fetchVaultPlans();
        showToast(`Plan moved to "${trimmed}"`);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to move plan');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to move plan');
    } finally {
      setMovePlanModal(null);
    }
  };

  const handleRenamePlan = async (planId: number, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const res = await authFetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        await fetchVaultPlans();
        showToast('Plan name updated');
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to update plan name');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to update plan name');
    } finally {
      setRenamePlanModal(null);
    }
  };

  const handleCreateProject = (projectName: string) => {
    const trimmed = projectName.trim();
    if (trimmed) {
      setSelectedProject(trimmed);
      setUploadProject(trimmed);
      setShowUploadModal(true);
    }
    setCreateProjectModal(null);
  };

  const projectScopedPlans = plans.filter((p) => {
    if (selectedProject !== 'ALL' && (p.project_name || 'Default Project') !== selectedProject) {
      return false;
    }
    return true;
  });

  const filteredPlans = projectScopedPlans.filter((p) => {
    if (selectedDiscipline !== 'ALL' && (p.discipline || 'architectural') !== selectedDiscipline) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.project_name?.toLowerCase().includes(q) ||
      p.discipline?.toLowerCase().includes(q) ||
      p.dwg_filename?.toLowerCase().includes(q) ||
      p.active_sheet_name?.toLowerCase().includes(q)
    );
  });

  const groupedByProject: Record<string, any[]> = {};
  for (const p of filteredPlans) {
    const proj = p.project_name || 'Default Project';
    if (!groupedByProject[proj]) groupedByProject[proj] = [];
    groupedByProject[proj].push(p);
  }
  const projectGroupKeys = Object.keys(groupedByProject).sort();

  const authModal = showAuthModal && (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {authMode === 'signin' ? 'Sign In to PlanVault' : 'Create account'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                {authMode === 'signin'
                  ? 'Access and sync your private vault'
                  : 'Save DWG plans & customize your measurement units'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAuthModal(false)}
            className="p-1 rounded-lg text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAuthSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {authError && (
            <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              {authError}
            </div>
          )}

          {authNotice && (
            <div className="p-2.5 rounded-xl bg-zinc-900 border border-blue-500/40 text-xs text-blue-200">
              {authNotice}
            </div>
          )}

          <button
            type="submit"
            disabled={authBusy}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white shadow-lg transition"
          >
            {authBusy
              ? 'Please wait...'
              : authMode === 'signin'
              ? 'Sign In'
              : 'Create Account & Save'}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => {
              setAuthMode((m) => (m === 'signin' ? 'signup' : 'signin'));
              setAuthError(null);
              setAuthNotice(null);
            }}
            className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
          >
            {authMode === 'signin'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );

  // If Structural Estimator is open
  if (activePlanPayload && isStructuralEstimatorOpen) {
    return (
      <div className="h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
        {toastMsg && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMsg}</span>
          </div>
        )}
        <StructuralEstimatorPage
          plan={activePlanPayload.plan}
          rawData={activePlanPayload.raw}
          fullRawData={activePlanPayload.fullRaw}
          isGuest={activePlanPayload.isGuest}
          onBack={() => {
            setIsStructuralEstimatorOpen(false);
            const params = new URLSearchParams(window.location.search);
            params.delete('view');
            const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
            window.history.replaceState({}, '', newUrl);
          }}
          onSaveEstimate={async (estimate) => {
            if (activePlanPayload.isGuest) {
              setActivePlanPayload((prev: any) => ({
                ...prev,
                plan: {
                  ...prev.plan,
                  structural_estimate: estimate,
                },
              }));
              return;
            }
            const res = await authFetch(`/api/plans/${activePlanPayload.plan.id}/structural-estimate`, {
              method: 'PUT',
              body: JSON.stringify({ structural_estimate: estimate }),
            });
            if (res.ok) {
              const data = await res.json();
              setActivePlanPayload((prev: any) => ({
                ...prev,
                plan: {
                  ...prev.plan,
                  structural_estimate: data.structural_estimate,
                },
              }));
              fetchVaultPlans();
            } else {
              throw new Error('Save failed');
            }
          }}
          showToast={showToast}
        />
      </div>
    );
  }

  // If a Plan is open in the viewer, show full-screen mobile-first Viewer
  if (activePlanPayload) {
    const p = activePlanPayload.plan;
    return (
      <div className="h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
        {toastMsg && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMsg}</span>
          </div>
        )}
        <UploadProgressOverlay progress={uploadProgress} />
        <OpenCadViewer
          plan={p}
          rawData={activePlanPayload.raw}
          initialMeasure={viewerInitialMeasure}
          isGuest={activePlanPayload.isGuest}
          onOpenStructuralEstimator={() => {
            setIsStructuralEstimatorOpen(true);
            const params = new URLSearchParams(window.location.search);
            params.set('view', 'structural');
            if (activePlanPayload.plan?.id) {
              params.set('planId', String(activePlanPayload.plan.id));
            }
            window.history.pushState({}, '', `?${params.toString()}`);
          }}
          onSavePlan={handleSaveGuestPlan}
          onOpenAuth={
            !authSession
              ? (mode) => {
                  setAuthMode(mode);
                  setAuthError(null);
                  setAuthNotice(null);
                  setShowAuthModal(true);
                }
              : undefined
          }
          onBack={() => {
            if (window.location.search.includes('share=')) {
              window.history.replaceState({}, '', '/');
            }
            setIsStructuralEstimatorOpen(false);
            setActivePlanPayload(null);
            setGuestDwgFile(null);
            if (authSession) fetchVaultPlans();
          }}
          onShare={handleSharePlan}
          onSelectSheet={async (sheetId) => {
            if (activePlanPayload.isGuest) {
              if (sheetId === 'all' && activePlanPayload.fullRaw) {
                setActivePlanPayload((prev: any) => ({
                  ...prev,
                  plan: {
                    ...prev.plan,
                    active_sheet_id: 'all',
                    active_sheet_name: 'All Selected Sheets',
                  },
                  raw: activePlanPayload.fullRaw,
                }));
                showToast('Showing all selected sheets');
                return;
              }
              const sheets = p.sheets || [];
              const targetSheet = sheets.find((s: any) => s.id === sheetId);
              if (targetSheet && activePlanPayload.fullRaw) {
                const cropped = cropRawDataToSheet(activePlanPayload.fullRaw, targetSheet);
                setActivePlanPayload((prev: any) => ({
                  ...prev,
                  plan: {
                    ...prev.plan,
                    active_sheet_id: sheetId,
                    active_sheet_name: targetSheet.name,
                  },
                  raw: cropped,
                }));
                showToast(`Isolated view: ${targetSheet.name}`);
              }
              return;
            }
            const res = await authFetch(`/api/plans/${p.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active_sheet_id: sheetId }),
            });
            if (res.ok) {
              const data = await res.json();
              setActivePlanPayload(data);
              showToast(`Isolated view: ${data.plan.active_sheet_name}`);
            }
          }}
          onChangeUnitScale={async (scaleToM) => {
            if (activePlanPayload.isGuest) {
              setActivePlanPayload((prev) => {
                if (!prev) return null;
                return {
                  ...prev,
                  plan: { ...prev.plan, scale_to_m: scaleToM },
                  raw: { ...prev.raw, scale_to_m: scaleToM },
                };
              });
              showToast('Measurement unit updated for preview');
              return;
            }
            const res = await authFetch(`/api/plans/${p.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scale_to_m: scaleToM }),
            });
            if (res.ok) {
              const data = await res.json();
              setActivePlanPayload(data);
              showToast(`Measurement unit updated to ${data.plan.unit_name}`);
            }
          }}
          onUploadDwg={async (file) => {
            if (activePlanPayload.isGuest) {
              await handleGuestCadPreview(file);
              return;
            }
            const form = new FormData();
            form.append('dwg_file', file);
            try {
              const data = await runUploadWithProgress(`/api/plans/${p.id}/dwg`, form, file);
              setActivePlanPayload(data);
              showToast('DWG uploaded & cleaned!');
            } finally {
              setUploadProgress(null);
            }
          }}
          onUpdateMetadata={async (patch) => {
            if (activePlanPayload.isGuest) {
              setActivePlanPayload((prev) => {
                if (!prev) return null;
                const nextPlan = { ...prev.plan, ...patch };
                return { ...prev, plan: nextPlan };
              });
              showToast('Updated plan details');
              return;
            }
            const res = await authFetch(`/api/plans/${p.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            });
            if (res.ok) {
              const data = await res.json();
              setActivePlanPayload(data);
              await fetchVaultPlans();
              showToast('Plan saved');
            }
          }}
        />
        {authModal}
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 pb-20 sm:pb-8">
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {authSession && !loadingVault && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-zinc-900/95 backdrop-blur-md border-t border-white/10 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => {
              if (selectedProject !== 'ALL') setUploadProject(selectedProject);
              setShowUploadModal(true);
            }}
            className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Upload plan
          </button>
        </div>
      )}

      {/* Top Mobile-First App Bar */}
      <header className="sticky top-0 z-30 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shrink-0">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-white">PlanVault</h1>
              {!authSession && <span className="text-[11px] text-zinc-400">Guest</span>}
            </div>
            <p className="text-[11px] text-zinc-400 truncate hidden sm:block">
              Plans by project and discipline
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {authSession ? (
            <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs">
              <div className="w-5 h-5 rounded-md bg-blue-600/20 text-blue-400 flex items-center justify-center text-[10px] font-semibold shrink-0">
                {userInitial}
              </div>
              <span
                className="text-zinc-300 font-mono truncate max-w-[70px] sm:max-w-[140px]"
                title={userEmail}
              >
                {username}
              </span>
              <button
                onClick={() => setShowProfileModal(true)}
                className="p-1 rounded-lg text-zinc-400 hover:text-blue-400 transition"
                title="Preferences & Units"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSignOut}
                className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 transition"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setAuthMode('signin');
                  setAuthError(null);
                  setShowAuthModal(true);
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white transition"
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError(null);
                  setShowAuthModal(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow transition"
              >
                Sign Up
              </button>
            </div>
          )}

          {installPrompt && (
            <button
              onClick={async () => {
                installPrompt.prompt();
                await installPrompt.userChoice;
                setInstallPrompt(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 border border-zinc-700"
            >
              <Download className="w-3.5 h-3.5 text-zinc-300" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          {!installPrompt && isIosBrowser && (
            <button
              onClick={() => showToast('Tap Share, then Add to Home Screen')}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 border border-zinc-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
          )}

          {authSession && (
            <button
              onClick={() => {
                if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                setShowUploadModal(true);
              }}
              className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Upload plan</span>
            </button>
          )}
        </div>
      </header>

      {/* Guest Landing Page Hero when not signed in */}
      {!authSession ? (
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center space-y-8">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
              <Compass className="w-3.5 h-3.5" />
              <span>FOSS CAD Takeoff & Sheet Organizer</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-semibold text-white tracking-tight">
              Open and measure DWG drawings in your browser
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Open DWG and DXF files on desktop or phone, then measure distances and room areas. Nothing to install.
            </p>
          </div>

          {/* Guest CAD Upload Card */}
          <div className="max-w-lg w-full mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="text-center space-y-1">
              <h3 className="text-base font-medium text-white">Try the viewer</h3>
              <p className="text-xs text-zinc-400">
                Upload a DWG or DXF file to view and measure immediately as a guest.
              </p>
            </div>

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 hover:border-blue-500/50 rounded-2xl p-6 cursor-pointer bg-zinc-950/60 transition group">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-105 transition mb-3">
                <Upload className="w-6 h-6" />
              </div>
              <span className="text-sm font-medium text-white">Tap to choose DWG or DXF files</span>
              <span className="text-xs text-zinc-400 mt-1">Free instant preview • Upload one or multiple drawings</span>
              <input
                type="file"
                accept=".dwg,.dxf"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleGuestCadPreview(e.target.files);
                  }
                }}
              />
            </label>

            {uploading && (
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-blue-400 animate-pulse py-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Parsing and cleaning CAD entities...</span>
              </div>
            )}

            <div className="border-t border-zinc-800 pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400 text-center sm:text-left">
                Need to save plans, organize projects & sync?
              </span>
              <button
                onClick={() => {
                  setAuthMode('signup');
                  setShowAuthModal(true);
                }}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium flex items-center justify-center gap-1.5 transition"
              >
                <span>Create account</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Feature Highlights Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto pt-4">
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 space-y-1.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                <Ruler className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-medium text-white">Distance and area</h4>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Measure distances, room areas, and perimeter polygons with customizable units (m, mm, ft, in).
              </p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 space-y-1.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-zinc-300">
                <Layers className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-medium text-white">Sheet isolation</h4>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Isolates each floor plan from drawing borders and title blocks.
              </p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 space-y-1.5">
              <div className="w-8 h-8 rounded-lg bg-zinc-500/10 flex items-center justify-center text-zinc-400">
                <Cloud className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-medium text-white">Save and share</h4>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Save plans privately to your vault and generate instant shareable links for client review.
              </p>
            </div>
          </div>
        </main>
      ) : (
      /* Unslop AEC Drafting-Station App Shell */
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-col md:flex-row gap-3 sm:gap-5 items-start">
        {/* Mobile Horizontal Projects Bar */}
        <div className="md:hidden w-full flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-3 px-3">
          <button
            onClick={() => setSelectedProject('ALL')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition shrink-0 flex items-center gap-1.5 ${
              selectedProject === 'ALL'
                ? 'bg-zinc-100 text-zinc-950 border-white'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            <FolderKanban className="w-3 h-3 opacity-75 shrink-0" />
            <span>All</span>
            <span className="text-[10px] tabular-nums font-mono opacity-80">({plans.length})</span>
          </button>
          {distinctProjects.map((proj) => {
            const count = plans.filter((p) => (p.project_name || 'Default Project') === proj).length;
            const isSelected = selectedProject === proj;
            return (
              <button
                key={proj}
                onClick={() => setSelectedProject(proj)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-zinc-100 text-zinc-950 border-white'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                <span className="truncate max-w-[130px]">{proj}</span>
                <span className="text-[10px] tabular-nums font-mono opacity-80">({count})</span>
              </button>
            );
          })}
          <button
            onClick={() => setCreateProjectModal({ name: '' })}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white shrink-0"
            title="Create new project"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Desktop Left Sidebar: Projects Navigation */}
        <aside className="hidden md:block w-64 shrink-0 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-3 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
              <FolderKanban className="w-3.5 h-3.5 text-blue-400" />
              Projects ({distinctProjects.length})
            </span>
            <button
              onClick={() => setCreateProjectModal({ name: '' })}
              className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
              title="Create new project"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Vertical Projects Navigation */}
          <div className="space-y-1">
            <button
              onClick={() => setSelectedProject('ALL')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                selectedProject === 'ALL'
                  ? 'bg-zinc-100 text-zinc-950 shadow-xs'
                  : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <FolderKanban className="w-4 h-4 opacity-70 shrink-0" />
                <span className="truncate">All Plans</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] tabular-nums font-mono ${
                  selectedProject === 'ALL'
                    ? 'bg-black/20 text-zinc-900 font-semibold'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {plans.length}
              </span>
            </button>

            {distinctProjects.map((proj) => {
              const count = plans.filter((p) => (p.project_name || 'Default Project') === proj).length;
              const isSelected = selectedProject === proj;
              return (
                <button
                  key={proj}
                  onClick={() => setSelectedProject(proj)}
                  title={proj}
                  className={`group w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                    isSelected
                      ? 'bg-zinc-800 text-white font-medium border border-zinc-700/60'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                    <FolderKanban
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-400'
                      }`}
                    />
                    <span className="truncate">{proj}</span>
                  </div>
                  <span
                    className={`ml-1.5 shrink-0 px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-mono ${
                      isSelected ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-950 text-zinc-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Main Content Pane */}
        <div className="flex-1 w-full space-y-3 sm:space-y-4 min-w-0">
          {/* Compact Active Project Scope Header */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl px-3 py-2 sm:px-4 sm:py-3 flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                <FolderKanban className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-sm sm:text-base font-semibold text-white truncate">
                  {selectedProject === 'ALL' ? 'All Plans' : selectedProject}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums bg-zinc-800 text-zinc-300 shrink-0">
                  {projectScopedPlans.length} {projectScopedPlans.length === 1 ? 'plan' : 'plans'}
                </span>
                {selectedProject !== 'ALL' && (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 shrink-0 ml-1">
                    <button
                      onClick={() =>
                        setRenameProjectModal({
                          oldName: selectedProject,
                          newName: selectedProject,
                        })
                      }
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-blue-400 inline-flex items-center gap-1 transition"
                      title="Rename project"
                    >
                      <Pencil className="w-3 h-3" />
                      <span className="hidden sm:inline">Rename</span>
                    </button>
                    <button
                      onClick={() => {
                        const count = plans.filter(
                          (p) => (p.project_name || 'Default Project') === selectedProject
                        ).length;
                        setDeleteProjectModal({ name: selectedProject, count });
                      }}
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 inline-flex items-center gap-1 transition"
                      title="Delete project"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                setShowUploadModal(true);
              }}
              className="hidden sm:inline-flex px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium items-center gap-1.5 shadow-sm transition shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Upload plan</span>
            </button>
          </div>

          {/* Filter Bar: Search + Discipline Pills */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search plans..."
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-3 px-3 sm:mx-0 sm:px-0">
              <button
                onClick={() => setSelectedDiscipline('ALL')}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition shrink-0 ${
                  selectedDiscipline === 'ALL'
                    ? 'bg-zinc-200 text-zinc-950 border-white'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                All ({projectScopedPlans.length})
              </button>
              {DISCIPLINES.map((d) => {
                const count = projectScopedPlans.filter(
                  (p) => (p.discipline || 'architectural') === d.id
                ).length;
                const active = selectedDiscipline === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDiscipline(d.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition shrink-0 flex items-center gap-1 ${
                      active
                        ? d.pillActiveClass
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <span>{d.label}</span>
                    <span className="opacity-75 text-[10px] font-mono">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Loading or Plan Cards Grid */}
          {loadingVault || openingPlan ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <RefreshCw className="w-7 h-7 text-blue-400 animate-spin" />
              <div className="text-sm font-semibold text-zinc-200">
                {openingPlan ? 'Opening Cleaned Plan View...' : 'Loading Cloud Plan Vault...'}
              </div>
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6 text-blue-400" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-sm font-medium text-white">
                  {plans.length === 0 ? 'Your Cloud Plan Vault is Empty' : 'No Matching Plans Found'}
                </h3>
                <p className="text-xs text-zinc-400">
                  {plans.length === 0
                    ? 'Upload a DWG/DXF plan to view, isolate sheet views, and measure distances.'
                    : 'Try changing your search query or discipline filter.'}
                </p>
              </div>
              <button
                onClick={() => {
                  if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                  setShowUploadModal(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium inline-flex items-center gap-2 shadow-lg"
              >
                <Plus className="w-4 h-4" />
                Upload plan
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredPlans.map((plan) => {
                const s = plan.summary || {};
                const totalSheets = s.total_sheets_in_dwg || (plan.sheets?.length ?? 0);
                const discObj =
                  DISCIPLINES.find((d) => d.id === (plan.discipline || 'architectural')) ||
                  DISCIPLINES[0];

                return (
                  <div
                    key={plan.id}
                    className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between gap-3 transition shadow-xs overflow-hidden"
                  >
                    <div className="space-y-2">
                      {/* Row 1: Discipline Tag + Project (Left) & Actions (Right) */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[10px] font-medium shrink-0 ${discObj.badgeClass}`}
                          >
                            {discObj.label}
                          </span>
                          {selectedProject === 'ALL' && (
                            <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1 truncate min-w-0">
                              <FolderKanban className="w-2.5 h-2.5 opacity-60 shrink-0" />
                              <span className="truncate max-w-[110px] sm:max-w-[150px]">
                                {plan.project_name || 'Default Project'}
                              </span>
                            </span>
                          )}
                        </div>

                        {/* Row 1 Right: Quiet Action Icons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() =>
                              setMovePlanModal({
                                plan,
                                targetProject: plan.project_name || 'Default Project',
                                customProject: '',
                              })
                            }
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition"
                            title="Move to another project"
                          >
                            <FolderInput className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setRenamePlanModal({ plan, newName: plan.name })}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition"
                            title="Rename plan"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleSharePlan(plan)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-400 hover:text-white transition"
                            title="Share Plan Link"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeletePlan(plan)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white transition"
                            title="Delete Plan"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Row 2: Full-width Plan Title (no overflow) */}
                      <button
                        onClick={() => openPlanById(plan.id, false)}
                        className="text-left group block w-full min-w-0"
                        title={`Open ${plan.name}`}
                      >
                        <h3 className="text-sm font-medium text-white group-hover:text-blue-400 transition line-clamp-2 break-words">
                          {plan.name}
                        </h3>
                      </button>

                      {/* Row 3: Metadata row (without redundant storage/filename path) */}
                      <div className="text-[11px] text-zinc-400 bg-zinc-950/70 rounded-xl px-3 py-2 border border-zinc-800/80 font-mono space-y-1">
                        {totalSheets > 1 && (
                          <div className="text-zinc-300 flex items-center gap-1.5 min-w-0">
                            <span className="text-blue-400 shrink-0">Sheet:</span>
                            <span className="truncate">{plan.active_sheet_name || '1'}</span>
                            <span className="text-zinc-400 shrink-0 tabular-nums">({totalSheets})</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-zinc-400 flex-wrap tabular-nums">
                          <span>
                            {s.cleaned_primitives ? s.cleaned_primitives.toLocaleString() : 0} entities
                          </span>
                          <span>·</span>
                          <span>{s.layers_count || 0} layers</span>
                          <span>·</span>
                          <span>{plan.unit_name || 'm'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Row 4: Action Buttons (Open DWG & Measure) */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => openPlanById(plan.id, false)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition"
                      >
                        <FileCode2 className="w-3.5 h-3.5" />
                        <span>Open DWG</span>
                      </button>
                      <button
                        onClick={() => openPlanById(plan.id, true)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-300 text-xs font-medium transition"
                      >
                        <Ruler className="w-3.5 h-3.5" />
                        <span>Measure</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      )}

      {/* Project & Plan Management Modals */}
      {renameProjectModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setRenameProjectModal(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-400" />
                Rename Project
              </h3>
              <button
                onClick={() => setRenameProjectModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRenameProject(renameProjectModal.oldName, renameProjectModal.newName);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={renameProjectModal.newName}
                  onChange={(e) =>
                    setRenameProjectModal({
                      ...renameProjectModal,
                      newName: e.target.value,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameProjectModal(null)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameProjectModal.newName.trim()}
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteProjectModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDeleteProjectModal(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Delete Project?</h3>
                  <p className="text-[11px] text-zinc-400">{deleteProjectModal.name}</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteProjectModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to delete project{' '}
              <strong className="text-white">{deleteProjectModal.name}</strong>? This will
              permanently delete all <strong className="text-white">{deleteProjectModal.count} plan(s)</strong> and
              associated CAD drawings inside it from the cloud vault.
            </p>
            <div className="text-[11px] text-zinc-400 bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5">
              Tip: If you want to keep any drawings, move them to another project before deleting.
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteProjectModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteProject(deleteProjectModal.name)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Project & Plans</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {movePlanModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setMovePlanModal(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-blue-400" />
                Move Plan to Project
              </h3>
              <button
                onClick={() => setMovePlanModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-300">
              Moving <strong className="text-white">{movePlanModal.plan.name}</strong> from{' '}
              <span className="font-mono text-zinc-400">
                {movePlanModal.plan.project_name || 'Default Project'}
              </span>
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const target =
                  movePlanModal.targetProject === '__NEW__'
                    ? movePlanModal.customProject
                    : movePlanModal.targetProject;
                handleMovePlan(movePlanModal.plan.id, target);
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Destination Project
                </label>
                <select
                  value={movePlanModal.targetProject}
                  onChange={(e) =>
                    setMovePlanModal({
                      ...movePlanModal,
                      targetProject: e.target.value,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {distinctProjects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="__NEW__">+ Create new project...</option>
                </select>
              </div>
              {movePlanModal.targetProject === '__NEW__' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    New Project Name
                  </label>
                  <input
                    type="text"
                    autoFocus
                    placeholder="e.g. Tower 2"
                    value={movePlanModal.customProject}
                    onChange={(e) =>
                      setMovePlanModal({
                        ...movePlanModal,
                        customProject: e.target.value,
                      })
                    }
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMovePlanModal(null)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    movePlanModal.targetProject === '__NEW__' &&
                    !movePlanModal.customProject.trim()
                  }
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
                >
                  Move Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renamePlanModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setRenamePlanModal(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-400" />
                Rename Plan
              </h3>
              <button
                onClick={() => setRenamePlanModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRenamePlan(renamePlanModal.plan.id, renamePlanModal.newName);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Plan Display Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={renamePlanModal.newName}
                  onChange={(e) =>
                    setRenamePlanModal({
                      ...renamePlanModal,
                      newName: e.target.value,
                    })
                  }
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenamePlanModal(null)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renamePlanModal.newName.trim()}
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createProjectModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setCreateProjectModal(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-400" />
                New Project
              </h3>
              <button
                onClick={() => setCreateProjectModal(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateProject(createProjectModal.name);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. 1086 Mansa Tower B"
                  value={createProjectModal.name}
                  onChange={(e) => setCreateProjectModal({ name: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateProjectModal(null)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!createProjectModal.name.trim()}
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
                >
                  Create & Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeletePlan && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setConfirmDeletePlan(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Delete Plan?</h3>
                  <p className="text-[11px] text-zinc-400">
                    {confirmDeletePlan.project_name || 'Default Project'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfirmDeletePlan(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to delete{' '}
              <strong className="text-white">{confirmDeletePlan.name}</strong>? This will
              permanently remove its DWG drawing and parsed data from Cloud Vault.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeletePlan(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeletePlan(confirmDeletePlan.id)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Plan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal / Bottom Sheet */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-zinc-900 border-t sm:border border-zinc-700 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-blue-400" />
                  Upload CAD Drawing to Cloud Vault
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Organize by project & discipline; multi-sheet DWGs auto-clean to match your view.
                </p>
              </div>
              <button
                onClick={() => !uploading && setShowUploadModal(false)}
                disabled={uploading}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3.5">
              {/* 1. DWG / DXF Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-200">
                    1. CAD Drawing File(s) (.DWG or .DXF)
                  </label>
                  {uploadDwgFiles.length > 1 && (
                    <span className="text-[10px] font-semibold text-blue-400">
                      {uploadDwgFiles.length} files selected — will merge into 1 plan
                    </span>
                  )}
                </div>
                <label className="flex items-center justify-between gap-2 p-3 rounded-xl bg-zinc-950 border border-dashed border-zinc-700 hover:border-blue-500 cursor-pointer transition">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileCode2 className="w-5 h-5 text-blue-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {uploadDwgFiles.length === 0
                          ? 'Choose one or multiple .DWG / .DXF files'
                          : `${uploadDwgFiles.length} CAD file${uploadDwgFiles.length > 1 ? 's' : ''} selected`}
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        {uploadDwgFiles.length > 1
                          ? 'All selected drawings will be merged into a single multi-sheet plan'
                          : 'Select multiple DWGs to merge all floor plans into one master sheet list'}
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-[11px] font-medium text-zinc-200 shrink-0">
                    {uploadDwgFiles.length > 0 ? '+ Add More' : 'Browse'}
                  </span>
                  <input
                    type="file"
                    accept=".dwg,.dxf"
                    multiple
                    disabled={uploading}
                    onChange={(e) => handleDwgFilesSelected(e.target.files)}
                    className="hidden"
                  />
                </label>

                {/* File chips list if multiple files selected */}
                {uploadDwgFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {uploadDwgFiles.map((file) => (
                      <span
                        key={file.name}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 text-xs font-medium text-zinc-200 border border-zinc-700"
                      >
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeDwgFile(file.name)}
                          className="text-zinc-400 hover:text-rose-400 p-0.5"
                          title="Remove file"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Project Name */}
              <div>
                <label className="block text-xs font-medium text-zinc-200 mb-1">
                  2. Project Name (Select existing or type new)
                </label>
                <input
                  type="text"
                  list="existing-projects-list"
                  value={uploadProject}
                  disabled={uploading}
                  onChange={(e) => setUploadProject(e.target.value)}
                  placeholder="e.g., 1086 Mansa (auto-detected from filename if left blank)"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <datalist id="existing-projects-list">
                  {distinctProjects.map((proj) => (
                    <option key={proj} value={proj} />
                  ))}
                </datalist>
              </div>

              {/* 3. Plan Discipline Type */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-200">
                    3. Plan Type / Discipline
                  </label>
                  {disciplineAutoDetected && (
                    <span className="text-[10px] font-semibold text-zinc-300">
                      Auto-detected from file name (click to change)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {DISCIPLINES.map((d) => {
                    const active = uploadDiscipline === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={uploading}
                        onClick={() => {
                          setUploadDiscipline(d.id);
                          setDisciplineAutoDetected(false);
                        }}
                        className={`py-2 px-2 rounded-xl text-[11px] font-medium border transition text-center truncate ${
                          active
                            ? d.pillActiveClass
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Optional Plan Title */}
              <div>
                <label className="block text-xs font-medium text-zinc-200 mb-1">
                  4. Plan Title (Optional — auto-detected from sheet title)
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  disabled={uploading}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g., Ground Floor Working Plan (Block A+B)"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Live Progress Bar & Estimated Time Remaining */}
              {uploading && uploadProgress && (
                <div className="p-3.5 rounded-xl bg-zinc-950 border border-blue-500/40 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span className="text-white flex items-center gap-2 truncate">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                      <span className="truncate">{uploadProgress.stage}</span>
                    </span>
                    <span className="text-blue-400 font-mono shrink-0">{uploadProgress.pct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${uploadProgress.pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                    <span>Elapsed: {uploadProgress.elapsedSec}s</span>
                    <span className="text-zinc-300 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {uploadProgress.remainingSec > 0
                        ? `Est. ~${uploadProgress.remainingSec}s remaining`
                        : 'Almost done (<2s)...'}
                    </span>
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
                  {uploadError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-medium text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing ({uploadProgress?.pct ?? 0}%)...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Upload & Clean Plan</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Auth Modal for Sign In / Sign Up */}
      {authModal}

      {/* User Preferences & Unit Customization Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
                  <Settings className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Profile Preferences</h3>
                  <p className="text-[11px] text-zinc-400">{authSession?.user?.email}</p>
                </div>
              </div>
              <button
                onClick={() => setShowProfileModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-zinc-300">
                Default Takeoff Measurement Unit
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'm', label: 'Meters (m)', desc: 'Metric standard' },
                  { id: 'mm', label: 'Millimeters (mm)', desc: 'Architectural details' },
                  { id: 'ft', label: 'Feet (ft)', desc: 'Imperial standard' },
                  { id: 'in', label: 'Inches (in)', desc: 'Imperial engineering' },
                ].map((u) => {
                  const active = (authSession?.user?.default_unit || 'm') === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={async () => {
                        try {
                          const updated = await updateUserProfile(u.id as any);
                          setAuthSession((s) => (s ? { ...s, user: updated } : null));
                          showToast(`Default unit set to ${u.label}`);
                        } catch {
                          showToast('Failed to update unit preference');
                        }
                      }}
                      className={`p-3 rounded-2xl border text-left transition ${
                        active
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-medium">{u.label}</div>
                      <div className="text-[10px] text-zinc-400">{u.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Upload Progress Overlay */}
      <UploadProgressOverlay progress={uploadProgress} />

      {/* Sheet Window Selector & Configuration Modal */}
      {sheetSelectorData && (
        <SheetSelectorModal
          planTitle={uploadTitle.trim() || sheetSelectorData.parsed?.name || ''}
          dwgFilename={sheetSelectorData.dwgFiles.map((f) => f.name).join(', ')}
          rawData={sheetSelectorData.parsed?.raw_data}
          initialSheets={sheetSelectorData.parsed?.sheets}
          filesData={sheetSelectorData.filesData}
          onConfirm={handleSheetSelectorConfirm}
          onCancel={() => setSheetSelectorData(null)}
        />
      )}
    </div>
  );
}

export default App;
