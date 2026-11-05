import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cloud,
  Upload,
  FileCode2,
  FileText,
  Ruler,
  Share2,
  Trash2,
  Search,
  Plus,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  X,
  Download,
  FolderKanban,
  Clock,
  LogOut,
  Lock,
} from 'lucide-react';
import { OpenCadViewer, ViewerTabMode } from './components/OpenCadViewer';
import {
  AuthConfig,
  AuthSession,
  apiUrl,
  authFetch,
  consumeUrlHashSession,
  ensureFreshSession,
  fetchAuthConfig,
  getStoredSession,
  saveSession,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
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
    badgeClass: 'bg-blue-500/15 border-blue-500/35 text-blue-300',
    pillActiveClass: 'bg-blue-600 text-white border-blue-500',
  },
  {
    id: 'electrical',
    label: 'Electrical',
    badgeClass: 'bg-amber-500/15 border-amber-500/35 text-amber-300',
    pillActiveClass: 'bg-amber-600 text-white border-amber-500',
  },
  {
    id: 'structural',
    label: 'Structural',
    badgeClass: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300',
    pillActiveClass: 'bg-emerald-600 text-white border-emerald-500',
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    badgeClass: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-300',
    pillActiveClass: 'bg-cyan-600 text-white border-cyan-500',
  },
  {
    id: 'fire',
    label: 'Fire',
    badgeClass: 'bg-rose-500/15 border-rose-500/35 text-rose-300',
    pillActiveClass: 'bg-rose-600 text-white border-rose-500',
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
  const [activePlanPayload, setActivePlanPayload] = useState<{ plan: any; raw: any } | null>(null);
  const [viewerInitialTab, setViewerInitialTab] = useState<ViewerTabMode>('dwg');
  const [viewerInitialMeasure, setViewerInitialMeasure] = useState<boolean>(false);
  const [openingPlan, setOpeningPlan] = useState<boolean>(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadDwgFile, setUploadDwgFile] = useState<File | null>(null);
  const [uploadPdfFile, setUploadPdfFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [uploadProject, setUploadProject] = useState<string>('');
  const [uploadDiscipline, setUploadDiscipline] = useState<PlanDiscipline>('architectural');
  const [disciplineAutoDetected, setDisciplineAutoDetected] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Quick inline PDF attach for existing card
  const cardPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [attachingPdfPlanId, setAttachingPdfPlanId] = useState<number | null>(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState<any | null>(null);

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
    async (planId: number, tab: ViewerTabMode = 'dwg', startMeasure = false) => {
      setOpeningPlan(true);
      setViewerInitialTab(tab);
      setViewerInitialMeasure(startMeasure);
      try {
        const res = await authFetch(`/api/plans/${planId}`);
        if (res.ok) {
          const data = await res.json();
          setActivePlanPayload(data);
        }
      } finally {
        setOpeningPlan(false);
      }
    },
    []
  );

  // Initialize Supabase Auth & check for ?share=<token> on initial load
  useEffect(() => {
    let active = true;
    (async () => {
      const cfg = await fetchAuthConfig();
      if (!active) return;
      setAuthConfig(cfg);
      let sess = getStoredSession();
      if (cfg.enabled) {
        const hashSess = await consumeUrlHashSession(cfg);
        if (hashSess) {
          sess = hashSess;
        } else {
          sess = await ensureFreshSession(cfg);
        }
        if (active) setAuthSession(sess);
      }

      const params = new URLSearchParams(window.location.search);
      const shareToken = params.get('share');
      if (shareToken) {
        setOpeningPlan(true);
        fetch(apiUrl(`/api/plans/share/${encodeURIComponent(shareToken)}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (active && data) setActivePlanPayload(data);
          })
          .finally(() => {
            if (active) setOpeningPlan(false);
          });
      }

      if (!cfg.enabled || sess) {
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

  const handleFilePicked = (dwg: File | null, pdf: File | null) => {
    const detectedDisc = inferDisciplineFromFilename(dwg?.name, pdf?.name, uploadTitle);
    setUploadDiscipline(detectedDisc);
    setDisciplineAutoDetected(true);
    if (!uploadProject.trim()) {
      const inferredProj = inferProjectFromFilename(dwg?.name || pdf?.name || '', distinctProjects);
      if (inferredProj) {
        setUploadProject(inferredProj);
      } else if (selectedProject !== 'ALL') {
        setUploadProject(selectedProject);
      }
    }
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
          stage = 'Uploading CAD & PDF files...';
        } else if (!dwgFile) {
          pct = 90;
          stage = 'Saving PDF plan to vault...';
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
    if (!uploadDwgFile && !uploadPdfFile) {
      setUploadError('Please select a DWG/DXF file, a PDF file, or both.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      if (uploadDwgFile) form.append('dwg_file', uploadDwgFile);
      if (uploadPdfFile) form.append('pdf_file', uploadPdfFile);
      if (uploadTitle.trim()) form.append('name', uploadTitle.trim());
      if (uploadProject.trim()) form.append('project_name', uploadProject.trim());
      form.append('discipline', uploadDiscipline);

      const data = await runUploadWithProgress('/api/plans', form, uploadDwgFile);
      setShowUploadModal(false);
      setUploadDwgFile(null);
      setUploadPdfFile(null);
      setUploadTitle('');
      setUploadProject('');
      setDisciplineAutoDetected(false);
      await fetchVaultPlans();
      setViewerInitialTab(data.plan.has_dwg ? 'dwg' : 'pdf');
      setViewerInitialMeasure(false);
      setActivePlanPayload(data);
      showToast('Plan uploaded & DWG cleaned to match view!');
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload plan');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authConfig) return;
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      if (authMode === 'signin') {
        const sess = await signInWithEmail(authConfig, authEmail.trim(), authPassword);
        setAuthSession(sess);
        setAuthPassword('');
        await fetchVaultPlans();
        showToast('Signed in to your PlanVault!');
      } else {
        const { session, confirmationRequired } = await signUpWithEmail(
          authConfig,
          authEmail.trim(),
          authPassword
        );
        if (confirmationRequired) {
          setAuthNotice('Check your email for the confirmation link, then sign in.');
          setAuthMode('signin');
        } else if (session) {
          setAuthSession(session);
          setAuthPassword('');
          await fetchVaultPlans();
          showToast('Account created & signed in!');
        }
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthBusy(false);
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
          text: `View & measure plan "${plan.name}" (DWG + PDF) in PlanVault`,
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
      p.pdf_filename?.toLowerCase().includes(q) ||
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

  // If a Plan is open in the viewer, show full-screen mobile-first Viewer
  if (activePlanPayload) {
    const p = activePlanPayload.plan;
    return (
      <div className="h-[100dvh] flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
        {toastMsg && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMsg}</span>
          </div>
        )}
        {uploadProgress && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between text-xs font-bold text-white">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                  {uploadProgress.stage}
                </span>
                <span className="text-blue-400 font-mono">{uploadProgress.pct}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${uploadProgress.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>Elapsed: {uploadProgress.elapsedSec}s</span>
                <span className="text-emerald-300 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {uploadProgress.remainingSec > 0
                    ? `~${uploadProgress.remainingSec}s remaining`
                    : 'Finishing up...'}
                </span>
              </div>
            </div>
          </div>
        )}
        <OpenCadViewer
          plan={p}
          rawData={activePlanPayload.raw}
          initialTab={viewerInitialTab}
          initialMeasure={viewerInitialMeasure}
          onBack={() => {
            if (window.location.search.includes('share=')) {
              window.history.replaceState({}, '', '/');
            }
            setActivePlanPayload(null);
            fetchVaultPlans();
          }}
          onShare={handleSharePlan}
          onSelectSheet={async (sheetId) => {
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
          onUploadPdf={async (file) => {
            const form = new FormData();
            form.append('pdf_file', file);
            const res = await authFetch(`/api/plans/${p.id}/pdf`, { method: 'POST', body: form });
            if (res.ok) {
              const data = await res.json();
              setActivePlanPayload(data);
              showToast('Associated PDF uploaded & DWG matched!');
            }
          }}
          onGeneratePdf={async () => {
            const res = await authFetch(`/api/plans/${p.id}/generate-pdf`, { method: 'POST' });
            if (res.ok) {
              const data = await res.json();
              setActivePlanPayload((prev) => (prev ? { ...prev, plan: data.plan } : null));
              showToast('Associated PDF generated from cleaned DWG view!');
            }
          }}
          onUploadDwg={async (file) => {
            const form = new FormData();
            form.append('dwg_file', file);
            try {
              const data = await runUploadWithProgress(`/api/plans/${p.id}/dwg`, form, file);
              setActivePlanPayload(data);
              showToast('DWG uploaded & cleaned to match PDF!');
            } finally {
              setUploadProgress(null);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-950 text-slate-100 pb-20 sm:pb-8">
      {/* Hidden input for quick PDF attachment from vault card */}
      <input
        ref={cardPdfInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          const targetId = attachingPdfPlanId;
          e.target.value = '';
          if (!f || !targetId) return;
          showToast('Uploading PDF & matching DWG sheet...');
          const form = new FormData();
          form.append('pdf_file', f);
          const res = await authFetch(`/api/plans/${targetId}/pdf`, { method: 'POST', body: form });
          if (res.ok) {
            await fetchVaultPlans();
            showToast('Associated PDF attached & DWG view cleaned!');
          }
          setAttachingPdfPlanId(null);
        }}
      />

      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Mobile-First App Bar */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-sm shrink-0">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold tracking-tight text-white">PlanVault</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Cloud PWA
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Project & Discipline Organizer · Auto View Cleanup · CAD Measure
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {authSession?.user?.email && (
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs">
              <span className="text-slate-300 font-mono truncate max-w-[130px] sm:max-w-[180px]">
                {authSession.user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="p-1 rounded-lg text-slate-400 hover:text-rose-400 transition"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
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
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          {(!authConfig?.enabled || authSession) && (
            <button
              onClick={() => {
                if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                setShowUploadModal(true);
              }}
              className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Upload Plan (DWG + PDF)</span>
            </button>
          )}
        </div>
      </header>

      {/* Supabase Auth Gate when enabled and user is not signed in */}
      {authConfig?.enabled && !authSession ? (
        <main className="flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-white">
                  {authMode === 'signin' ? 'Sign In to PlanVault' : 'Create Your PlanVault Account'}
                </h2>
                <p className="text-xs text-slate-400">
                  Your DWG & PDF plans are saved privately to your account.
                </p>
              </div>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {authError && (
                <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
                  {authError}
                </div>
              )}

              {authNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200">
                  {authNotice}
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-bold text-white shadow-lg transition"
              >
                {authBusy
                  ? 'Please wait...'
                  : authMode === 'signin'
                  ? 'Sign In'
                  : 'Create Account'}
              </button>
            </form>

            <div className="text-center pt-1 border-t border-slate-800">
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
                  ? "Don't have an account? Create one"
                  : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </main>
      ) : (
      /* Main Vault Container */
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 space-y-4">
        {/* Layer 1: Project Navigation Bar */}
        {distinctProjects.length > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FolderKanban className="w-3.5 h-3.5 text-blue-400" />
                Projects
              </span>
              <span className="text-[11px] text-slate-400">
                {distinctProjects.length} {distinctProjects.length === 1 ? 'Project' : 'Projects'} · {plans.length} Plans
              </span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedProject('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition shrink-0 flex items-center gap-1.5 ${
                  selectedProject === 'ALL'
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span>All Projects</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">
                  {plans.length}
                </span>
              </button>
              {distinctProjects.map((proj) => {
                const count = plans.filter((p) => (p.project_name || 'Default Project') === proj).length;
                const active = selectedProject === proj;
                return (
                  <button
                    key={proj}
                    onClick={() => setSelectedProject(proj)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition shrink-0 flex items-center gap-1.5 ${
                      active
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <FolderKanban className="w-3.5 h-3.5 opacity-80" />
                    <span>{proj}</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Layer 2: Plan Type (Discipline) Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-800/80">
              <button
                onClick={() => setSelectedDiscipline('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition shrink-0 ${
                  selectedDiscipline === 'ALL'
                    ? 'bg-slate-200 text-slate-950 border-white'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                All Types ({projectScopedPlans.length})
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
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition shrink-0 flex items-center gap-1 ${
                      active
                        ? d.pillActiveClass
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span>{d.label}</span>
                    <span className="opacity-75 text-[10px]">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search & Cloud Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search plans by project, type, title, sheet, DWG or PDF filename..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px] text-slate-400 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Storage: <strong className="text-slate-200 font-mono">{storageBackend}</strong>
            </span>
            <span>·</span>
            <span>Showing {filteredPlans.length} of {plans.length} Plans</span>
          </div>
        </div>

        {/* Loading or Plan Cards Grouped by Project */}
        {loadingVault || openingPlan ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
            <RefreshCw className="w-7 h-7 text-blue-400 animate-spin" />
            <div className="text-sm font-semibold text-slate-200">
              {openingPlan ? 'Opening Cleaned Plan View...' : 'Loading Cloud Plan Vault...'}
            </div>
          </div>
        ) : filteredPlans.length === 0 ? (
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto">
              <Upload className="w-6 h-6 text-blue-400" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-sm font-bold text-white">
                {plans.length === 0 ? 'Your Cloud Plan Vault is Empty' : 'No Matching Plans Found'}
              </h3>
              <p className="text-xs text-slate-400">
                {plans.length === 0
                  ? 'Upload a DWG/DXF plan and its associated PDF. PlanVault organizes plans by project & discipline and cleans multi-sheet DWGs.'
                  : 'Try switching the project or plan discipline filter above, or upload a new plan.'}
              </p>
            </div>
            <button
              onClick={() => {
                if (selectedProject !== 'ALL') setUploadProject(selectedProject);
                setShowUploadModal(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center gap-2 shadow-lg"
            >
              <Plus className="w-4 h-4" />
              Upload Plan (DWG + PDF)
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {projectGroupKeys.map((projName) => {
              const projPlans = groupedByProject[projName];
              return (
                <section key={projName} className="space-y-3">
                  {/* Project Group Header */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 px-1">
                    <div className="flex items-center gap-2">
                      <FolderKanban className="w-4 h-4 text-blue-400" />
                      <h2 className="text-sm font-extrabold text-white tracking-tight">
                        {projName}
                      </h2>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                        {projPlans.length} {projPlans.length === 1 ? 'plan' : 'plans'}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setUploadProject(projName);
                        setShowUploadModal(true);
                      }}
                      className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Plan to {projName}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {projPlans.map((plan) => {
                      const s = plan.summary || {};
                      const totalSheets = s.total_sheets_in_dwg || (plan.sheets?.length ?? 0);
                      const discObj =
                        DISCIPLINES.find((d) => d.id === (plan.discipline || 'architectural')) ||
                        DISCIPLINES[0];

                      return (
                        <div
                          key={plan.id}
                          className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 flex flex-col justify-between gap-3.5 transition shadow-sm"
                        >
                          <div className="space-y-2">
                            {/* Top Row: Title + Share + Delete */}
                            <div className="flex items-start justify-between gap-2">
                              <button
                                onClick={() => openPlanById(plan.id, 'dwg', false)}
                                className="text-left group min-w-0"
                              >
                                <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition truncate">
                                  {plan.name}
                                </h3>
                                <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5 truncate">
                                  <Sparkles className="w-3 h-3 shrink-0" />
                                  <span className="truncate">
                                    {plan.match_reason || 'Cleaned Single-Sheet Plan View'}
                                  </span>
                                </p>
                              </button>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleSharePlan(plan)}
                                  className="p-2 rounded-xl bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white transition"
                                  title="Share Plan Link"
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeletePlan(plan)}
                                  className="p-2 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white transition"
                                  title="Delete Plan"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Discipline Selector Badge + Paired Files Badges */}
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              <select
                                value={plan.discipline || 'architectural'}
                                onChange={(e) =>
                                  handleQuickUpdateMeta(plan.id, { discipline: e.target.value })
                                }
                                title="Change Plan Discipline Type"
                                className={`px-2 py-0.5 rounded-md border text-[11px] font-bold cursor-pointer focus:outline-none ${discObj.badgeClass}`}
                              >
                                {DISCIPLINES.map((d) => (
                                  <option
                                    key={d.id}
                                    value={d.id}
                                    className="bg-slate-900 text-slate-100"
                                  >
                                    {d.label}
                                  </option>
                                ))}
                              </select>

                              {plan.has_dwg ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-mono">
                                  <FileCode2 className="w-3 h-3" />
                                  <span className="truncate max-w-[140px]">
                                    {plan.dwg_filename}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[11px]">
                                  No DWG attached
                                </span>
                              )}

                              {plan.has_pdf ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-mono">
                                  <FileText className="w-3 h-3" />
                                  <span className="truncate max-w-[140px]">
                                    {plan.pdf_filename}
                                  </span>
                                </span>
                              ) : (
                                <button
                                  onClick={() => {
                                    setAttachingPdfPlanId(plan.id);
                                    cardPdfInputRef.current?.click();
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-semibold transition"
                                >
                                  <Upload className="w-3 h-3" />
                                  + Upload PDF
                                </button>
                              )}
                            </div>

                            {/* Cleanup Metrics Row */}
                            {plan.has_dwg && (
                              <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-950/70 rounded-xl px-3 py-1.5 border border-slate-800/80">
                                {totalSheets > 1 && (
                                  <span className="text-emerald-300 font-semibold">
                                    Isolated 1 of {totalSheets} plans
                                  </span>
                                )}
                                <span>
                                  Cleaned:{' '}
                                  <strong className="text-slate-200">
                                    {s.cleaned_primitives?.toLocaleString() || 0}
                                  </strong>
                                  {s.original_primitives > s.cleaned_primitives
                                    ? ` / ${s.original_primitives.toLocaleString()} entities`
                                    : ' entities'}
                                </span>
                                <span>Layers: {s.layers_count || 0}</span>
                                <span>Unit: {plan.unit_name}</span>
                              </div>
                            )}
                          </div>

                          {/* Bottom Card Action Buttons: Open DWG | Measure | Open PDF */}
                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <button
                              onClick={() => openPlanById(plan.id, 'dwg', false)}
                              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                            >
                              <FileCode2 className="w-3.5 h-3.5" />
                              <span>Open DWG</span>
                            </button>

                            <button
                              onClick={() => openPlanById(plan.id, 'dwg', true)}
                              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition"
                            >
                              <Ruler className="w-3.5 h-3.5" />
                              <span>Measure</span>
                            </button>

                            <button
                              onClick={() => openPlanById(plan.id, 'pdf', false)}
                              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
                            >
                              <FileText className="w-3.5 h-3.5 text-amber-400" />
                              <span>{plan.has_pdf ? 'Open PDF' : 'Add PDF'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
      )}

      {/* Mobile Sticky Bottom Upload Bar */}
      {(!authConfig?.enabled || authSession) && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 p-3 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 z-30">
          <button
            onClick={() => {
              if (selectedProject !== 'ALL') setUploadProject(selectedProject);
              setShowUploadModal(true);
            }}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg"
          >
            <Plus className="w-4 h-4" />
            <span>Upload Plan (.DWG + Associated .PDF)</span>
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeletePlan && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setConfirmDeletePlan(null)}
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Delete Plan?</h3>
                  <p className="text-[11px] text-slate-400">
                    {confirmDeletePlan.project_name || 'Default Project'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfirmDeletePlan(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to delete{' '}
              <strong className="text-white">{confirmDeletePlan.name}</strong>? This will
              permanently remove its DWG and PDF files from Cloud Vault.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeletePlan(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeletePlan(confirmDeletePlan.id)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white flex items-center gap-1.5 transition"
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
          <div className="w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-blue-400" />
                  Upload Plan to Cloud Vault
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Organize by project & discipline; multi-sheet DWGs auto-clean to match your view.
                </p>
              </div>
              <button
                onClick={() => !uploading && setShowUploadModal(false)}
                disabled={uploading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3.5">
              {/* 1. DWG / DXF Input */}
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  1. CAD Drawing File (.DWG or .DXF)
                </label>
                <label className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-950 border border-dashed border-slate-700 hover:border-blue-500 cursor-pointer transition">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileCode2 className="w-5 h-5 text-blue-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {uploadDwgFile ? uploadDwgFile.name : 'Choose .DWG or .DXF file'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Auto-detects project & plan type from filename
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-200 shrink-0">
                    Browse
                  </span>
                  <input
                    type="file"
                    accept=".dwg,.dxf"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setUploadDwgFile(f);
                      handleFilePicked(f, uploadPdfFile);
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              {/* 2. Associated PDF Input */}
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  2. Associated PDF Plan (.PDF — or upload later)
                </label>
                <label className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-950 border border-dashed border-slate-700 hover:border-amber-500 cursor-pointer transition">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-5 h-5 text-amber-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {uploadPdfFile
                          ? uploadPdfFile.name
                          : 'Choose associated .PDF file (optional)'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Used to match & isolate the exact sheet in the DWG
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-200 shrink-0">
                    Browse
                  </span>
                  <input
                    type="file"
                    accept=".pdf"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setUploadPdfFile(f);
                      handleFilePicked(uploadDwgFile, f);
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              {/* 3. Project Name */}
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1">
                  3. Project Name (Select existing or type new)
                </label>
                <input
                  type="text"
                  list="existing-projects-list"
                  value={uploadProject}
                  disabled={uploading}
                  onChange={(e) => setUploadProject(e.target.value)}
                  placeholder="e.g., 1086 Mansa (auto-detected from filename if left blank)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <datalist id="existing-projects-list">
                  {distinctProjects.map((proj) => (
                    <option key={proj} value={proj} />
                  ))}
                </datalist>
              </div>

              {/* 4. Plan Discipline Type */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-200">
                    4. Plan Type / Discipline
                  </label>
                  {disciplineAutoDetected && (
                    <span className="text-[10px] font-semibold text-emerald-400">
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
                        className={`py-2 px-2 rounded-xl text-[11px] font-bold border transition text-center truncate ${
                          active
                            ? d.pillActiveClass
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 5. Optional Plan Title */}
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1">
                  5. Plan Title (Optional — auto-detected from sheet title)
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  disabled={uploading}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g., Ground Floor Working Plan (Block A+B)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Live Progress Bar & Estimated Time Remaining */}
              {uploading && uploadProgress && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-blue-500/40 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span className="text-white flex items-center gap-2 truncate">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                      <span className="truncate">{uploadProgress.stage}</span>
                    </span>
                    <span className="text-blue-400 font-mono shrink-0">{uploadProgress.pct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${uploadProgress.pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>Elapsed: {uploadProgress.elapsedSec}s</span>
                    <span className="text-emerald-300 flex items-center gap-1">
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
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-bold text-white flex items-center gap-2"
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
    </div>
  );
}

export default App;
