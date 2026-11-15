import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  CheckCircle2,
  RefreshCw,
  Search,
  FolderKanban,
  Pencil,
  Trash2,
  Lock,
  LogIn,
} from 'lucide-react';
import { OpenCadViewer } from './components/OpenCadViewer';
import { StructuralEstimatorPage } from './components/StructuralEstimator/StructuralEstimatorPage';
import { ArchitecturalEstimatorPage } from './components/estimators/ArchitecturalEstimator/ArchitecturalEstimatorPage';
import { ElectricalEstimatorPage } from './components/estimators/ElectricalEstimator/ElectricalEstimatorPage';
import { PlumbingEstimatorPage } from './components/estimators/PlumbingEstimator/PlumbingEstimatorPage';
import { FireEstimatorPage } from './components/estimators/FireEstimator/FireEstimatorPage';
import { SheetSelectorModal, SheetConfig, cropRawDataToSheet } from './components/SheetSelectorModal';
import { AppHeader } from './components/dashboard/AppHeader';
import { GuestLandingView } from './components/dashboard/GuestLandingView';
import { ProjectSidebar } from './components/dashboard/ProjectSidebar';
import { PlanCard } from './components/dashboard/PlanCard';
import { AuthModal } from './components/modals/AuthModal';
import { ProfileModal } from './components/modals/ProfileModal';
import { UploadPlanModal } from './components/modals/UploadPlanModal';
import {
  RenameProjectModal,
  DeleteProjectModal,
  MovePlanModal,
  RenamePlanModal,
  CreateProjectModal,
  ConfirmDeletePlanModal,
} from './components/modals/ProjectPlanModals';
import { UploadProgressOverlay } from './components/ui/UploadProgressOverlay';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import {
  PlanDiscipline,
  DISCIPLINES,
  UploadProgressState,
  inferDisciplineFromFilename,
  inferProjectFromFilename,
} from './types/plan';
import {
  AuthConfig,
  AuthSession,
  apiUrl,
  authFetch,
  fetchAuthConfig,
  fetchUserProfile,
  getStoredSession,
  saveSession,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
} from './auth';

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
  const [, setStorageBackend] = useState<string>('cloud-vault');
  const [loadingVault, setLoadingVault] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('ALL');
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>('ALL');

  // Active opened plan state
  const [activePlanPayload, setActivePlanPayload] = useState<{
    plan: any;
    raw: any;
    fullRaw?: any;
    isGuest?: boolean;
  } | null>(null);
  const [guestDwgFile, setGuestDwgFile] = useState<File | null>(null);
  const [viewerInitialMeasure, setViewerInitialMeasure] = useState<boolean>(false);
  const [openingPlan, setOpeningPlan] = useState<boolean>(false);

  // Estimator Routing State
  const [activeEstimatorDiscipline, setActiveEstimatorDiscipline] = useState<PlanDiscipline | null>(null);
  const [isStructuralEstimatorOpen, setIsStructuralEstimatorOpen] = useState<boolean>(false);

  // Auth modal & profile state
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [, setSavingGuestPlan] = useState<boolean>(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadDwgFiles, setUploadDwgFiles] = useState<File[]>([]);
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
    async (planId: number, startMeasure = false, skipHistoryPush = false) => {
      setOpeningPlan(true);
      setViewerInitialMeasure(startMeasure);
      try {
        const res = await authFetch(`/api/plans/${planId}`);
        if (res.ok) {
          const data = await res.json();
          setActivePlanPayload(data);
          if (!skipHistoryPush) {
            const params = new URLSearchParams(window.location.search);
            params.set('planId', String(planId));
            params.delete('view');
            window.history.pushState({ planId }, '', `?${params.toString()}`);
          }
          return data;
        } else {
          showToast('Failed to load plan');
          return null;
        }
      } catch (err: any) {
        showToast(err.message || 'Error opening plan');
        return null;
      } finally {
        setOpeningPlan(false);
      }
    },
    [showToast]
  );

  // Sync browser Back/Forward (popstate) and iOS mobile / standalone PWA left-edge swipe back
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view') as PlanDiscipline | null;
      const planIdParam = params.get('planId');
      const shareParam = params.get('share');

      if (viewParam) {
        setActiveEstimatorDiscipline(viewParam);
        setIsStructuralEstimatorOpen(viewParam === 'structural');
      } else {
        setActiveEstimatorDiscipline(null);
        setIsStructuralEstimatorOpen(false);
      }

      if (!planIdParam && !shareParam) {
        setActivePlanPayload(null);
      } else if (planIdParam && !activePlanPayload) {
        openPlanById(Number(planIdParam), false, true);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activePlanPayload, openPlanById]);

  useEffect(() => {
    let edgeTouchStart: { x: number; y: number; t: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        edgeTouchStart = null;
        return;
      }
      const x = e.touches[0].clientX;
      if (x <= 24) {
        edgeTouchStart = { x, y: e.touches[0].clientY, t: Date.now() };
      } else {
        edgeTouchStart = null;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!edgeTouchStart || e.changedTouches.length === 0) return;
      const dx = e.changedTouches[0].clientX - edgeTouchStart.x;
      const dy = Math.abs(e.changedTouches[0].clientY - edgeTouchStart.y);
      const dt = Date.now() - edgeTouchStart.t;
      edgeTouchStart = null;

      // Trigger back navigation in installed standalone PWA (or browsers that don't handle edge-pop themselves)
      const isStandalonePwa =
        (navigator as any).standalone === true ||
        window.matchMedia?.('(display-mode: standalone)')?.matches;
      if (!isStandalonePwa) return;

      if (dx >= 68 && dy < 56 && dt < 700) {
        if (activeEstimatorDiscipline || isStructuralEstimatorOpen) {
          setActiveEstimatorDiscipline(null);
          setIsStructuralEstimatorOpen(false);
          const params = new URLSearchParams(window.location.search);
          params.delete('view');
          const nextUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
          window.history.replaceState({}, '', nextUrl);
        } else if (activePlanPayload) {
          window.history.replaceState({}, '', window.location.pathname);
          setActivePlanPayload(null);
          setGuestDwgFile(null);
          if (authSession) fetchVaultPlans();
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [
    activeEstimatorDiscipline,
    isStructuralEstimatorOpen,
    activePlanPayload,
    authSession,
    fetchVaultPlans,
  ]);

  // Initialize Auth & check for ?share=<token> / ?planId= on initial load
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
      const viewParam = params.get('view') as PlanDiscipline | null;

      if (shareToken) {
        setOpeningPlan(true);
        fetch(apiUrl(`/api/plans/share/${encodeURIComponent(shareToken)}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (active && data) {
              setActivePlanPayload(data);
              if (viewParam) {
                setActiveEstimatorDiscipline(viewParam);
                if (viewParam === 'structural') setIsStructuralEstimatorOpen(true);
              }
            }
          })
          .finally(() => {
            if (active) setOpeningPlan(false);
          });
      } else if (planIdParam) {
        setOpeningPlan(true);
        authFetch(`/api/plans/${encodeURIComponent(planIdParam)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (active && data) {
              setActivePlanPayload(data);
              if (viewParam) {
                setActiveEstimatorDiscipline(viewParam);
                if (viewParam === 'structural') setIsStructuralEstimatorOpen(true);
              }
            }
          })
          .finally(() => {
            if (active) setOpeningPlan(false);
          });
      }

      await fetchVaultPlans();
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

  const handleDwgFilesSelected = (files: FileList | null) => {
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
            stage: 'Complete. Opening cleaned plan...',
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
          isGuest: !authSession,
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
          isGuest: !authSession,
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
        const { session } = await signUpWithEmail(cfg, authEmail.trim(), authPassword);
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
        fullRaw: sheetSelectorData.parsed?.raw_data || croppedRaw,
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
      if (data?.plan?.id) {
        window.history.pushState({ planId: data.plan.id }, '', `?planId=${data.plan.id}`);
      }
      showToast(dwgFiles.length > 1 ? 'Merged plan saved' : 'Plan saved');
    } catch (err: any) {
      showToast(err.message || 'Failed to save plan');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleGuestCadPreview = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
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
      showToast('Plan saved to vault');
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
        // Fallback
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Share link copied to clipboard');
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

  const handleOpenPlanCardEstimator = (plan: any) => {
    openPlanById(plan.id, false, true).then((loaded) => {
      if (loaded) {
        const disc = (plan.discipline as PlanDiscipline) || 'structural';
        setActiveEstimatorDiscipline(disc);
        if (disc === 'structural') setIsStructuralEstimatorOpen(true);
        const params = new URLSearchParams(window.location.search);
        params.set('planId', String(plan.id));
        params.set('view', disc);
        window.history.pushState({ planId: plan.id, view: disc }, '', `?${params.toString()}`);
      }
    });
  };

  const handleSaveDisciplineEstimate = async (estimateKey: string, estimateData: any) => {
    if (!activePlanPayload) return;
    const normalized =
      estimateData && typeof estimateData === 'object' && estimateKey in estimateData
        ? estimateData[estimateKey]
        : estimateData;
    if (activePlanPayload.isGuest) {
      setActivePlanPayload((prev: any) => ({
        ...prev,
        plan: {
          ...prev.plan,
          [estimateKey]: normalized,
        },
      }));
      return;
    }
    const res = await authFetch(`/api/plans/${activePlanPayload.plan.id}/structural-estimate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [estimateKey]: normalized }),
    });
    if (res.ok) {
      const data = await res.json();
      setActivePlanPayload((prev: any) => ({
        ...prev,
        plan: {
          ...prev.plan,
          ...data,
        },
      }));
      fetchVaultPlans();
    }
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

  const toastNode = toastMsg ? (
    <div className="fixed top-[max(12px,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-24px)] bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs font-medium px-3.5 py-2 rounded-lg flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="truncate">{toastMsg}</span>
    </div>
  ) : null;

  // Render Discipline Estimators
  const estimatorDiscipline = activeEstimatorDiscipline || (isStructuralEstimatorOpen ? 'structural' : null);

  if (activePlanPayload && estimatorDiscipline) {
    const handleEstimatorBack = () => {
      setActiveEstimatorDiscipline(null);
      setIsStructuralEstimatorOpen(false);
      const params = new URLSearchParams(window.location.search);
      params.delete('view');
      const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    };

    return (
      <div className="h-[100dvh] flex flex-col bg-[#111315] text-zinc-100 overflow-hidden">
        {toastNode}

        {estimatorDiscipline === 'structural' && (
          <StructuralEstimatorPage
            plan={activePlanPayload.plan}
            rawData={activePlanPayload.raw}
            fullRawData={activePlanPayload.fullRaw || activePlanPayload.raw}
            isGuest={activePlanPayload.isGuest}
            onBack={handleEstimatorBack}
            onSaveEstimate={(est) => handleSaveDisciplineEstimate('structural_estimate', est)}
            showToast={showToast}
          />
        )}

        {estimatorDiscipline === 'architectural' && (
          <ArchitecturalEstimatorPage
            plan={activePlanPayload.plan}
            rawData={activePlanPayload.raw}
            fullRawData={activePlanPayload.fullRaw || activePlanPayload.raw}
            isGuest={activePlanPayload.isGuest}
            onBack={handleEstimatorBack}
            onSaveEstimate={(est) => handleSaveDisciplineEstimate('architectural_estimate', est)}
            showToast={showToast}
          />
        )}

        {estimatorDiscipline === 'electrical' && (
          <ElectricalEstimatorPage
            plan={activePlanPayload.plan}
            rawData={activePlanPayload.raw}
            fullRawData={activePlanPayload.fullRaw || activePlanPayload.raw}
            isGuest={activePlanPayload.isGuest}
            onBack={handleEstimatorBack}
            onSaveEstimate={(est) => handleSaveDisciplineEstimate('electrical_estimate', est)}
            showToast={showToast}
          />
        )}

        {estimatorDiscipline === 'plumbing' && (
          <PlumbingEstimatorPage
            plan={activePlanPayload.plan}
            rawData={activePlanPayload.raw}
            fullRawData={activePlanPayload.fullRaw || activePlanPayload.raw}
            isGuest={activePlanPayload.isGuest}
            onBack={handleEstimatorBack}
            onSaveEstimate={(est) => handleSaveDisciplineEstimate('plumbing_estimate', est)}
            showToast={showToast}
          />
        )}

        {estimatorDiscipline === 'fire' && (
          <FireEstimatorPage
            plan={activePlanPayload.plan}
            rawData={activePlanPayload.raw}
            fullRawData={activePlanPayload.fullRaw || activePlanPayload.raw}
            isGuest={activePlanPayload.isGuest}
            onBack={handleEstimatorBack}
            onSaveEstimate={(est) => handleSaveDisciplineEstimate('fire_estimate', est)}
            showToast={showToast}
          />
        )}
      </div>
    );
  }

  // If a Plan is open in CAD Viewer
  if (activePlanPayload) {
    const p = activePlanPayload.plan;
    return (
      <div className="h-[100dvh] flex flex-col bg-[#111315] text-zinc-100 overflow-hidden">
        {toastNode}
        <UploadProgressOverlay progress={uploadProgress} />
        <ErrorBoundary
          fallbackTitle="Unable to Open CAD Viewer"
          onReset={() => {
            window.history.replaceState({}, '', window.location.pathname);
            setActiveEstimatorDiscipline(null);
            setIsStructuralEstimatorOpen(false);
            setActivePlanPayload(null);
            setGuestDwgFile(null);
          }}
        >
          <OpenCadViewer
            plan={p}
            rawData={activePlanPayload.raw}
            initialMeasure={viewerInitialMeasure}
            isGuest={activePlanPayload.isGuest}
            onOpenEstimator={(discipline) => {
              setActiveEstimatorDiscipline(discipline);
              if (discipline === 'structural') setIsStructuralEstimatorOpen(true);
              const params = new URLSearchParams(window.location.search);
              params.set('view', discipline);
              if (activePlanPayload.plan?.id) {
                params.set('planId', String(activePlanPayload.plan.id));
              }
              window.history.pushState({}, '', `?${params.toString()}`);
            }}
            onOpenStructuralEstimator={() => {
              setActiveEstimatorDiscipline('structural');
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
              window.history.replaceState({}, '', window.location.pathname);
              setActiveEstimatorDiscipline(null);
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
                const dt = new DataTransfer();
                dt.items.add(file);
                await handleGuestCadPreview(dt.files);
                return;
              }
              const form = new FormData();
              form.append('dwg_file', file);
              try {
                const data = await runUploadWithProgress(`/api/plans/${p.id}/dwg`, form, file);
                setActivePlanPayload(data);
                showToast('DWG uploaded and cleaned');
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
        </ErrorBoundary>
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          authMode={authMode}
          setAuthMode={setAuthMode}
          authEmail={authEmail}
          setAuthEmail={setAuthEmail}
          authPassword={authPassword}
          setAuthPassword={setAuthPassword}
          authBusy={authBusy}
          authError={authError}
          authNotice={authNotice}
          onSubmit={handleAuthSubmit}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#111315] text-zinc-100 pb-20 sm:pb-8 overflow-x-hidden">
      {toastNode}

      {/* Mobile Floating Action Button */}
      {authSession && !loadingVault && (
        <button
          onClick={() => {
            if (selectedProject !== 'ALL') setUploadProject(selectedProject);
            setShowUploadModal(true);
          }}
          className="sm:hidden fixed right-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 min-h-[44px] px-4 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 border border-white/20 text-xs font-medium flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Upload plan</span>
        </button>
      )}

      {/* Top App Header */}
      <AppHeader
        authSession={authSession}
        username={username}
        userEmail={userEmail}
        userInitial={userInitial}
        onOpenAuth={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
          setShowAuthModal(true);
        }}
        onOpenProfile={() => setShowProfileModal(true)}
        onSignOut={handleSignOut}
        onOpenUpload={() => {
          if (selectedProject !== 'ALL') setUploadProject(selectedProject);
          setShowUploadModal(true);
        }}
        installPrompt={installPrompt}
        onInstallApp={async () => {
          if (installPrompt) {
            installPrompt.prompt();
            await installPrompt.userChoice;
            setInstallPrompt(null);
          }
        }}
        isIosBrowser={isIosBrowser}
        showToast={showToast}
      />

      {/* Guest Landing Hero when not signed in */}
      {!authSession ? (
        <GuestLandingView
          uploading={uploading}
          onSelectFiles={handleGuestCadPreview}
          onOpenSignUp={() => {
            setAuthMode('signup');
            setShowAuthModal(true);
          }}
        />
      ) : (
        /* Authenticated Drafting Station Shell */
        <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-col md:flex-row gap-3 sm:gap-5 items-start">
          {/* Mobile Horizontal Projects Bar */}
          <div className="md:hidden w-full flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              onClick={() => setSelectedProject('ALL')}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition shrink-0 flex items-center gap-1.5 ${
                selectedProject === 'ALL'
                  ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
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
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition shrink-0 flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
                  }`}
                >
                  <span className="truncate max-w-[130px]">{proj}</span>
                  <span className="text-[10px] tabular-nums font-mono opacity-80">({count})</span>
                </button>
              );
            })}
            <button
              onClick={() => setCreateProjectModal({ name: '' })}
              className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 shrink-0 transition"
              title="Create new project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Desktop Left Sidebar */}
          <ProjectSidebar
            distinctProjects={distinctProjects}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProject}
            onOpenCreateProject={() => setCreateProjectModal({ name: '' })}
            plans={plans}
          />

          {/* Right Main Content Pane */}
          <div className="flex-1 w-full space-y-3 sm:space-y-4 min-w-0">
            {/* Active Project Scope Header */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
                  <FolderKanban className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-sm sm:text-base font-medium text-zinc-100 truncate">
                    {selectedProject === 'ALL' ? 'All plans' : selectedProject}
                  </h2>
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono tabular-nums bg-zinc-950 border border-zinc-800 text-zinc-400 shrink-0">
                    {projectScopedPlans.length} {projectScopedPlans.length === 1 ? 'plan' : 'plans'}
                  </span>
                  {selectedProject !== 'ALL' && (
                    <div className="flex items-center gap-1 text-[11px] text-zinc-400 shrink-0">
                      <button
                        onClick={() =>
                          setRenameProjectModal({
                            oldName: selectedProject,
                            newName: selectedProject,
                          })
                        }
                        className="min-w-[36px] min-h-[36px] px-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-amber-400 inline-flex items-center justify-center gap-1 transition"
                        title="Rename project"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Rename</span>
                      </button>
                      <button
                        onClick={() => {
                          const count = plans.filter(
                            (p) => (p.project_name || 'Default Project') === selectedProject
                          ).length;
                          setDeleteProjectModal({ name: selectedProject, count });
                        }}
                        className="min-w-[36px] min-h-[36px] px-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 inline-flex items-center justify-center gap-1 transition"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
                className="hidden sm:inline-flex px-3.5 min-h-[38px] rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium items-center gap-1.5 transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Upload plan</span>
              </button>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search plans"
                  className="w-full min-h-[42px] bg-zinc-900 border border-zinc-800 focus:border-amber-400/70 rounded-xl pl-10 pr-4 py-2 text-base sm:text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  onClick={() => setSelectedDiscipline('ALL')}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition shrink-0 ${
                    selectedDiscipline === 'ALL'
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
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
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition shrink-0 flex items-center gap-1 ${
                        active
                          ? d.pillActiveClass
                          : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <span>{d.label}</span>
                      <span className="opacity-75 text-[10px] font-mono tabular-nums">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Loading or Plan Cards Grid */}
            {loadingVault || openingPlan ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-400">
                <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
                <div className="text-sm font-medium text-zinc-200">
                  {openingPlan ? 'Opening cleaned plan view...' : 'Loading plan vault...'}
                </div>
              </div>
            ) : filteredPlans.length === 0 ? (
              <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 sm:p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-amber-400 flex items-center justify-center mx-auto">
                  {!authSession ? <Lock className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <h3 className="text-sm font-medium text-zinc-100">
                    {!authSession
                      ? 'Sign in to access your personal plan vault'
                      : plans.length === 0
                      ? 'Your plan vault is empty'
                      : 'No matching plans found'}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {!authSession
                      ? 'Private drawings and projects are protected. Sign in to access your vault, or test with instant guest preview.'
                      : plans.length === 0
                      ? 'Upload a DWG or DXF plan to view, isolate sheet views, and calculate discipline estimates'
                      : 'Try changing your search query or discipline filter'}
                  </p>
                </div>
                {!authSession ? (
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      onClick={() => {
                        setAuthMode('signin');
                        setShowAuthModal(true);
                      }}
                      className="px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium inline-flex items-center gap-2 transition"
                    >
                      <LogIn className="w-4 h-4" />
                      Sign in / Register
                    </button>
                    <button
                      onClick={() => {
                        if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                        setShowUploadModal(true);
                      }}
                      className="px-4 min-h-[42px] rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-200 text-xs font-medium inline-flex items-center gap-2 border border-zinc-700 transition"
                    >
                      <Plus className="w-4 h-4" />
                      Instant guest preview
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                      setShowUploadModal(true);
                    }}
                    className="px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium inline-flex items-center gap-2 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Upload plan
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredPlans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    selectedProject={selectedProject}
                    onOpenPlan={() => openPlanById(plan.id)}
                    onOpenEstimator={() => handleOpenPlanCardEstimator(plan)}
                    onMovePlan={(p) =>
                      setMovePlanModal({
                        plan: p,
                        targetProject: p.project_name || distinctProjects[0] || 'Default Project',
                        customProject: '',
                      })
                    }
                    onRenamePlan={(p) => setRenamePlanModal({ plan: p, newName: p.name })}
                    onSharePlan={handleSharePlan}
                    onDeletePlan={(p) => setConfirmDeletePlan(p)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      )}

      {/* Upload Plan Modal (Single progress bar within modal) */}
      <UploadPlanModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        uploadDwgFiles={uploadDwgFiles}
        onSelectDwgFiles={handleDwgFilesSelected}
        onRemoveDwgFile={removeDwgFile}
        uploadProject={uploadProject}
        onChangeProject={setUploadProject}
        distinctProjects={distinctProjects}
        uploadDiscipline={uploadDiscipline}
        onChangeDiscipline={setUploadDiscipline}
        disciplineAutoDetected={disciplineAutoDetected}
        uploadTitle={uploadTitle}
        onChangeTitle={setUploadTitle}
        uploading={uploading}
        uploadProgress={uploadProgress}
        uploadError={uploadError}
        onSubmit={handleUploadSubmit}
      />

      {/* Floating Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        authMode={authMode}
        setAuthMode={setAuthMode}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authBusy={authBusy}
        authError={authError}
        authNotice={authNotice}
        onSubmit={handleAuthSubmit}
      />

      {/* User Preferences & Unit Customization Modal */}
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        authSession={authSession}
        setAuthSession={setAuthSession}
        showToast={showToast}
      />

      {/* Global Upload Progress Overlay (Only active when Upload modal is NOT open) */}
      {!showUploadModal && <UploadProgressOverlay progress={uploadProgress} />}

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

      {/* Project & Plan Management Modals */}
      <RenameProjectModal
        modal={renameProjectModal}
        onClose={() => setRenameProjectModal(null)}
        onSave={handleRenameProject}
        onChangeName={(newName) =>
          setRenameProjectModal((prev) => (prev ? { ...prev, newName } : null))
        }
      />

      <DeleteProjectModal
        modal={deleteProjectModal}
        onClose={() => setDeleteProjectModal(null)}
        onConfirm={handleDeleteProject}
      />

      <MovePlanModal
        modal={movePlanModal}
        distinctProjects={distinctProjects}
        onClose={() => setMovePlanModal(null)}
        onConfirm={handleMovePlan}
        onChangeTargetProject={(targetProject) =>
          setMovePlanModal((prev) => (prev ? { ...prev, targetProject } : null))
        }
        onChangeCustomProject={(customProject) =>
          setMovePlanModal((prev) => (prev ? { ...prev, customProject } : null))
        }
      />

      <RenamePlanModal
        modal={renamePlanModal}
        onClose={() => setRenamePlanModal(null)}
        onSave={handleRenamePlan}
        onChangeName={(newName) =>
          setRenamePlanModal((prev) => (prev ? { ...prev, newName } : null))
        }
      />

      <CreateProjectModal
        modal={createProjectModal}
        onClose={() => setCreateProjectModal(null)}
        onCreate={handleCreateProject}
        onChangeName={(name) => setCreateProjectModal({ name })}
      />

      <ConfirmDeletePlanModal
        plan={confirmDeletePlan}
        onClose={() => setConfirmDeletePlan(null)}
        onConfirm={handleDeletePlan}
      />
    </div>
  );
}

export default App;
