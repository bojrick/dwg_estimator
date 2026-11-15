import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Save } from 'lucide-react';
import { VersionHistoryControl } from './VersionHistoryControl';

export type MobileWorkstationView = 'drawing' | 'split' | 'takeoff';

export interface EstimatorStepItem<T extends string = string> {
  id: T;
  num: string | number;
  label: string;
}

/** Auto-switches mobile view to Drawing when a CAD pick tool activates, and back to Takeoff when finished. */
export function useMobileWorkstationView(isCanvasToolActive?: boolean) {
  const [mobileView, setMobileView] = useState<MobileWorkstationView>('takeoff');
  const prevToolActiveRef = useRef(Boolean(isCanvasToolActive));

  useEffect(() => {
    const active = Boolean(isCanvasToolActive);
    if (!prevToolActiveRef.current && active) {
      setMobileView('drawing');
    } else if (prevToolActiveRef.current && !active) {
      setMobileView('takeoff');
    }
    prevToolActiveRef.current = active;
  }, [isCanvasToolActive]);

  return [mobileView, setMobileView] as const;
}

export function getWorkstationPaneClasses(
  mobileView: MobileWorkstationView,
  desktopCanvasWidth = 'lg:w-[55%]',
  desktopPanelWidth = 'lg:w-[45%]'
) {
  const canvasClass =
    mobileView === 'drawing'
      ? `flex-1 h-full min-h-0 lg:flex-none ${desktopCanvasWidth} lg:h-full lg:border-r border-white/[0.08] relative flex flex-col`
      : mobileView === 'split'
      ? `h-[42%] shrink-0 min-h-0 lg:h-full ${desktopCanvasWidth} border-b lg:border-b-0 lg:border-r border-white/[0.08] relative flex flex-col`
      : `hidden lg:flex ${desktopCanvasWidth} lg:h-full lg:border-r border-white/[0.08] relative flex-col min-h-0`;

  const panelClass =
    mobileView === 'takeoff'
      ? `flex-1 h-full min-h-0 lg:flex-none ${desktopPanelWidth} lg:h-full flex flex-col bg-zinc-950 overflow-hidden`
      : mobileView === 'split'
      ? `h-[58%] min-h-0 lg:h-full ${desktopPanelWidth} flex flex-col bg-zinc-950 overflow-hidden`
      : `hidden lg:flex ${desktopPanelWidth} lg:h-full flex-col bg-zinc-950 overflow-hidden min-h-0`;

  return { canvasClass, panelClass };
}

interface MobileViewModeBarProps {
  view: MobileWorkstationView;
  onChange: (view: MobileWorkstationView) => void;
}

const VIEW_MODES: { id: MobileWorkstationView; label: string }[] = [
  { id: 'drawing', label: 'Drawing' },
  { id: 'split', label: 'Split' },
  { id: 'takeoff', label: 'Takeoff' },
];

export const MobileViewModeBar: React.FC<MobileViewModeBarProps> = ({ view, onChange }) => (
  <div className="lg:hidden shrink-0 border-b border-white/[0.08] bg-zinc-950 px-2.5 py-1">
    <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-zinc-900 border border-white/[0.08] max-w-md mx-auto">
      {VIEW_MODES.map((m) => {
        const active = view === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`min-h-[34px] px-2 rounded-md text-xs font-medium transition-colors ${
              active
                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/35'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  </div>
);

interface EstimatorWorkstationShellProps<T extends string> {
  onBack: () => void;
  title: string;
  subtitle?: React.ReactNode;
  subtitleAccent?: boolean;
  headerCenter?: React.ReactNode;
  versions: any[];
  currency?: string;
  onRestoreVersion: (version: any) => void;
  onExportCsv: () => void;
  onSave: () => void;
  isSaving: boolean;
  steps: readonly EstimatorStepItem<NoInfer<T>>[];
  activeStep: T;
  onStepChange: (step: NoInfer<T>) => void;
  canvas: React.ReactNode;
  panel: React.ReactNode;
  footer?: React.ReactNode;
  isCanvasToolActive?: boolean;
  toast?: React.ReactNode;
  children?: React.ReactNode;
}

export function EstimatorWorkstationShell<T extends string>({
  onBack,
  title,
  subtitle,
  subtitleAccent = false,
  headerCenter,
  versions,
  currency = '₹',
  onRestoreVersion,
  onExportCsv,
  onSave,
  isSaving,
  steps,
  activeStep,
  onStepChange,
  canvas,
  panel,
  footer,
  isCanvasToolActive,
  toast,
  children,
}: EstimatorWorkstationShellProps<T>) {
  const [mobileView, setMobileView] = useMobileWorkstationView(isCanvasToolActive);
  const { canvasClass, panelClass } = getWorkstationPaneClasses(mobileView);

  return (
    <div className="h-[100dvh] w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden select-none pb-[env(safe-area-inset-bottom)] lg:pb-0">
      {/* Top Bar */}
      <header className="shrink-0 border-b border-white/[0.08] bg-zinc-950 pt-[max(8px,env(safe-area-inset-top))] pb-2 lg:pt-[env(safe-area-inset-top)] lg:pb-0 px-2.5 sm:px-4 flex items-center justify-between gap-2 sm:gap-3 lg:h-12">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 xl:flex-initial">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="inline-flex items-center justify-center gap-1.5 min-w-[40px] min-h-[40px] lg:min-w-0 lg:min-h-0 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 border border-white/[0.08] transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="h-4 w-px bg-white/[0.08] hidden sm:block shrink-0" />
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="text-xs sm:text-sm font-medium text-zinc-100 truncate">{title}</h1>
            {subtitle && (
              <span
                className={`hidden sm:inline-block text-[11px] px-2 py-0.5 rounded border truncate max-w-[180px] shrink-0 ${
                  subtitleAccent
                    ? 'text-amber-300 bg-amber-400/10 border-amber-400/30'
                    : 'text-zinc-400 bg-zinc-900 border-white/[0.08]'
                }`}
              >
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {headerCenter}

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <VersionHistoryControl
            versions={versions}
            currency={currency}
            onRestoreVersion={onRestoreVersion}
          />
          <button
            type="button"
            onClick={onExportCsv}
            className="inline-flex items-center justify-center gap-1.5 min-w-[40px] min-h-[40px] lg:min-w-0 lg:min-h-0 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] transition-colors"
            title="Export CSV"
            aria-label="Export CSV"
          >
            <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] lg:min-h-0 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save estimate'}</span>
            <span className="sm:hidden">{isSaving ? '...' : 'Save'}</span>
          </button>
        </div>
      </header>

      <MobileViewModeBar view={mobileView} onChange={setMobileView} />

      {/* Main Split Workstation */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <div className={canvasClass}>{canvas}</div>

        <div className={panelClass}>
          {/* Responsive 4-Step Tab Bar */}
          <div className="shrink-0 flex overflow-x-auto no-scrollbar xl:grid xl:grid-cols-4 border-b border-white/[0.08] bg-zinc-900/50">
            {steps.map((s) => {
              const active = activeStep === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onStepChange(s.id)}
                  className={`flex-1 shrink-0 min-w-fit px-3 py-2 min-h-[40px] whitespace-nowrap text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                    active
                      ? 'border-amber-400 text-zinc-100 bg-zinc-900'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded text-[10px] inline-flex items-center justify-center tabular-nums shrink-0 ${
                      active ? 'bg-amber-400 text-zinc-950 font-semibold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {s.num}
                  </span>
                  <span className="whitespace-nowrap">{s.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4">
            {panel}
          </div>

          {footer && (
            <div className="shrink-0 min-h-12 px-3 sm:px-4 py-2 lg:py-0 lg:h-12 border-t border-white/[0.08] bg-zinc-950 flex items-center justify-between gap-2 text-xs">
              {footer}
            </div>
          )}
        </div>
      </div>

      {toast}
      {children}
    </div>
  );
}
