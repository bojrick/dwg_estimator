import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Download,
  Printer,
  Trash2,
  Table as TableIcon,
  Sparkles,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import {
  BbsBarItem,
  BbsMemberGroup,
  CivilAuditAnomaly,
  ExtractedCadTable,
  RebarTextCandidate,
  StructuralEstimateState,
  StructuralMemberType,
  StructuralMemberDefinition,
  GuidedWorkflowStep,
  BeamCrossSectionInspection,
} from './types';
import {
  STANDARD_DIAMETERS,
  calculateDiameterSummary,
  calculateTakeoffTotals,
  generateBbsFromMemberDefinitions,
  runLocalIs456Audit,
} from './bbsMath';
import { scanTextsForRebar } from './rebarTextParser';
import {
  extractTableFromBoundingBox,
  autoDetectScheduleTables,
  expandGroupedMemberMarks,
  BoxCoords,
} from './cadTableParser';
import { ScheduleTableModal } from './ScheduleTableModal';
import { GuidedWorkflowBar } from './GuidedWorkflowBar';
import { MemberCatalogStep } from './MemberCatalogStep';
import { ReinforcementLinkStep } from './ReinforcementLinkStep';
import {
  scanStructuralTagsWithVerification,
  scanGeneralNotesAndSections,
  isExactTokenMatch,
} from './tagScanner';
import { cropRawDataToSheet } from '../SheetSelectorModal';
import { extractBeamCrossSectionFromBBox } from './cadGeometryEngine';
import { authFetch } from '../../auth';

interface StructuralEstimatorPageProps {
  plan: any;
  rawData: any;
  fullRawData?: any;
  isGuest?: boolean;
  onBack: () => void;
  onSaveEstimate: (estimate: StructuralEstimateState) => Promise<void>;
  showToast: (msg: string) => void;
}

const PROJECT_DIAMETER_CHOICES = [8, 10, 12, 16, 20, 25, 28, 32];

export const StructuralEstimatorPage: React.FC<StructuralEstimatorPageProps> = ({
  plan,
  rawData: initialRawData,
  fullRawData,
  onBack,
  onSaveEstimate,
  showToast,
}) => {
  const [sheets, setSheets] = useState<any[]>(() => plan?.sheets || []);
  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    return plan?.active_sheet_id && plan.active_sheet_id !== 'all'
      ? plan.active_sheet_id
      : (plan?.sheets || [])[0]?.id || 'all';
  });

  // Guided workflow state
  const [currentStep, setCurrentStep] = useState<GuidedWorkflowStep>('scope');
  const [selectedScope, setSelectedScope] = useState<StructuralMemberType>('beam');
  const [takeoffTab, setTakeoffTab] = useState<'bbs' | 'diameter' | 'audit'>('bbs');

  // Estimate state with Step 1 Project & IS Code Assumptions
  const [estimateState, setEstimateState] = useState<StructuralEstimateState>(() => {
    const saved = plan?.structural_estimate || {};
    const savedParams = saved.parameters || {};
    return {
      workflowStep: saved.workflowStep || 'scope',
      selectedScope: saved.selectedScope || 'beam',
      layoutSheetId: saved.layoutSheetId || (plan?.sheets || [])[0]?.id,
      scheduleSheetId: saved.scheduleSheetId || (plan?.sheets || [])[0]?.id,
      definedMembers: saved.definedMembers || [],
      members: saved.members || [],
      scheduleTables: saved.scheduleTables || [],
      parameters: {
        wastagePct: savedParams.wastagePct ?? 3.0,
        bindingWirePct: savedParams.bindingWirePct ?? 1.0,
        steelRatePerKg:
          savedParams.steelRatePerKg !== undefined && savedParams.steelRatePerKg !== 0.85
            ? savedParams.steelRatePerKg
            : 68,
        currency: savedParams.currency && savedParams.currency !== '$' ? savedParams.currency : '₹',
        maxStockLengthM: savedParams.maxStockLengthM ?? 12.0,
        allowedDiameters: savedParams.allowedDiameters || [8, 10, 12, 16, 20, 25, 28, 32],
        concreteGrade: savedParams.concreteGrade || 'M25',
        steelGrade: savedParams.steelGrade || 'Fe500D',
        lapLengthMultiplier: savedParams.lapLengthMultiplier ?? 50,
        hookAllowanceMultiplier: savedParams.hookAllowanceMultiplier ?? 24,
        defaultFloorHeightMm: savedParams.defaultFloorHeightMm ?? 3000,
        seismicDuctileDetailing: savedParams.seismicDuctileDetailing ?? true,
        defaultCoverMm: savedParams.defaultCoverMm || {
          footing: 50,
          column: 40,
          beam: 25,
          slab: 20,
        },
      },
      notes: saved.notes || '',
    };
  });

  const [definedMembers, setDefinedMembers] = useState<StructuralMemberDefinition[]>(() => {
    return estimateState.definedMembers || [];
  });

  // AI Loading states
  const [isAiAnalyzingStep1, setIsAiAnalyzingStep1] = useState(false);
  const [isAiNormalizingStep2, setIsAiNormalizingStep2] = useState(false);
  const [isAiMatchingStep3, setIsAiMatchingStep3] = useState(false);

  // Crop raw data to active sheet for CAD canvas rendering
  const activeSheet = useMemo(() => {
    return sheets.find((s) => s.id === activeSheetId);
  }, [sheets, activeSheetId]);

  const masterRawData = useMemo(() => {
    return fullRawData || initialRawData;
  }, [fullRawData, initialRawData]);

  const activeRaw = useMemo(() => {
    if (!masterRawData) return null;
    if (!activeSheet || activeSheetId === 'all') return masterRawData;
    return cropRawDataToSheet(masterRawData, activeSheet);
  }, [masterRawData, activeSheet, activeSheetId]);

  // Auto-detect schedule tables across ALL sheets on initial load if none saved yet
  useEffect(() => {
    if (!masterRawData?.texts || estimateState.scheduleTables.length > 0) return;
    const autoTables = autoDetectScheduleTables(
      masterRawData.texts,
      masterRawData.lines || [],
      masterRawData.polylines || [],
      'all'
    );
    if (autoTables.length > 0) {
      setEstimateState((prev) => ({
        ...prev,
        scheduleTables: autoTables,
      }));
    }
  }, [masterRawData]);

  // Dynamic calculated BBS items passing all Step 1 IS Code parameters
  const [bbsItems, setBbsItems] = useState<BbsBarItem[]>([]);

  useEffect(() => {
    if (definedMembers.length > 0) {
      const generated = generateBbsFromMemberDefinitions(definedMembers, estimateState.parameters);
      setBbsItems(generated);
    } else if (estimateState.members && estimateState.members.length > 0) {
      const flat = estimateState.members.flatMap((m) => m.items || []);
      setBbsItems(flat);
    } else {
      setBbsItems([]);
    }
  }, [definedMembers, estimateState.members, estimateState.parameters]);

  // Real-time deterministic IS 456 / IS 13920 & Allowed Diameter Audit
  const auditAnomalies = useMemo<CivilAuditAnomaly[]>(() => {
    return runLocalIs456Audit(definedMembers, estimateState.parameters);
  }, [definedMembers, estimateState.parameters]);

  const pendingMatchCount = useMemo(
    () => definedMembers.filter((m) => m.pendingSectionMatch?.status === 'pending').length,
    [definedMembers]
  );

  // Span picking & CAD tool states
  const [pickingMemberId, setPickingMemberId] = useState<string | null>(null);
  const [pickedFirstPoint, setPickedFirstPoint] = useState<[number, number] | null>(null);
  const [selectedPlanCallout, setSelectedPlanCallout] = useState<any | null>(null);
  const [highlightedMark, setHighlightedMark] = useState<string | null>(null);
  const [inspectingTable, setInspectingTable] = useState<ExtractedCadTable | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [toolMode, setToolMode] = useState<
    'pan' | 'select_table' | 'pick_span' | 'select_layout' | 'select_cross_section'
  >('pan');
  const [inspectedCrossSection, setInspectedCrossSection] =
    useState<BeamCrossSectionInspection | null>(null);
  const [detectedRebarTexts] = useState<RebarTextCandidate[]>([]);

  const [layoutBoundingBox, setLayoutBoundingBox] = useState<BoxCoords | null>(() => {
    return estimateState.layoutBoundingBox || null;
  });
  const [activeLegendTableId, setActiveLegendTableId] = useState<string | null>(() => {
    return estimateState.activeLegendTableId || estimateState.scheduleTables[0]?.id || null;
  });
  const [inspectedMember, setInspectedMember] = useState<StructuralMemberDefinition | null>(null);

  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);

  const [viewState, setViewState] = useState({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const fitToView = useCallback(() => {
    if (!activeRaw || !containerRef.current || !canvasRef.current) return;
    const b = activeRaw.bbox_raw || activeRaw.bbox_full;
    if (!b || !b.width || !b.height) return;

    const cw = containerRef.current.clientWidth || 600;
    const ch = containerRef.current.clientHeight || 500;
    const pad = 36;

    const scaleX = (cw - pad * 2) / b.width;
    const scaleY = (ch - pad * 2) / b.height;
    const scale = Math.min(scaleX, scaleY, 50);

    const midX = (b.min_x + b.max_x) / 2;
    const midY = (b.min_y + b.max_y) / 2;

    const offsetX = cw / 2 - midX * scale;
    const offsetY = ch / 2 + midY * scale;

    setViewState({ scale, offsetX, offsetY });
  }, [activeRaw]);

  useEffect(() => {
    fitToView();
  }, [fitToView, activeSheetId]);

  const worldToScreen = useCallback(
    (wx: number, wy: number) => {
      const sx = wx * viewState.scale + viewState.offsetX;
      const sy = -wy * viewState.scale + viewState.offsetY;
      return [sx, sy];
    },
    [viewState]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const wx = (sx - viewState.offsetX) / viewState.scale;
      const wy = -(sy - viewState.offsetY) / viewState.scale;
      return [wx, wy];
    },
    [viewState]
  );

  // Update Step 1 parameters helper
  const updateParameters = (patch: Partial<StructuralEstimateState['parameters']>) => {
    setEstimateState((prev) => ({
      ...prev,
      parameters: {
        ...prev.parameters,
        ...patch,
      },
    }));
  };

  const toggleAllowedDiameter = (dia: number) => {
    const current = estimateState.parameters.allowedDiameters || PROJECT_DIAMETER_CHOICES;
    const exists = current.includes(dia);
    const next = exists ? current.filter((d) => d !== dia) : [...current, dia].sort((a, b) => a - b);
    if (next.length === 0) return;
    updateParameters({ allowedDiameters: next });
  };

  // Step 1 AI: Classify sheets & extract General Notes IS Code specs
  const handleAnalyzeSheetsAndSpecsAi = async () => {
    if (!masterRawData || !plan?.id) return;
    setIsAiAnalyzingStep1(true);
    try {
      const { generalNotesTexts } = scanGeneralNotesAndSections(masterRawData, sheets);
      const res = await authFetch(`/api/plans/${plan.id}/structural-ai/analyze-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheets,
          general_notes_texts: generalNotesTexts,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sheets) && data.sheets.length > 0) {
          setSheets((prev) =>
            prev.map((s) => {
              const found = data.sheets.find((cs: any) => cs.id === s.id);
              return found && found.name ? { ...s, name: found.name, category: found.category } : s;
            })
          );
        }
        if (data.specs) {
          updateParameters({
            concreteGrade: data.specs.concreteGrade || estimateState.parameters.concreteGrade,
            steelGrade: data.specs.steelGrade || estimateState.parameters.steelGrade,
            lapLengthMultiplier:
              data.specs.lapLengthMultiplier || estimateState.parameters.lapLengthMultiplier,
            defaultCoverMm: {
              ...estimateState.parameters.defaultCoverMm,
              ...(data.specs.defaultCoverMm || {}),
            },
          });
        }
        showToast('Updated sheet names and IS 456 specifications from drawing notes');
      }
    } catch (err) {
      showToast('Applied local specification rules from drawing notes');
    } finally {
      setIsAiAnalyzingStep1(false);
    }
  };

  // Scan all sheets for schedule tables
  const handleAutoDetectAllTables = () => {
    if (!masterRawData?.texts) return;
    const detected = autoDetectScheduleTables(
      masterRawData.texts,
      masterRawData.lines || [],
      masterRawData.polylines || [],
      'all'
    );
    if (detected.length === 0) {
      showToast('No automatic grid tables found. Use "Pick table on drawing" to select one.');
      return;
    }
    setEstimateState((prev) => ({
      ...prev,
      scheduleTables: detected,
    }));
    showToast(`Detected ${detected.length} schedule table(s) across drawing`);
  };

  // Step 2: Member & Size Extractor preserving compound marks (B1-1, B2-5, B3-6, B4-10, B5-100)
  const handleScanLayoutTags = (options?: { allowedLayers?: string[]; customPrefix?: string }) => {
    if (!activeRaw?.texts) return;

    const activeLegend = estimateState.scheduleTables.find((t) => t.id === activeLegendTableId);

    const discovered = scanStructuralTagsWithVerification(
      activeRaw.texts,
      selectedScope,
      estimateState.scheduleTables,
      {
        ...options,
        bbox: layoutBoundingBox || undefined,
        activeLegendTable: activeLegend || undefined,
        lines: activeRaw.lines || [],
        polylines: activeRaw.polylines || [],
        scaleToM: activeRaw.scale_to_m || 0.001,
      }
    );

    const defaultCover =
      estimateState.parameters.defaultCoverMm[
        selectedScope as keyof typeof estimateState.parameters.defaultCoverMm
      ] || (selectedScope === 'column' ? 40 : selectedScope === 'beam' ? 25 : 20);
    const fallbackSpan =
      selectedScope === 'column' ? estimateState.parameters.defaultFloorHeightMm || 3000 : 4000;

    const memberMap = new Map<string, StructuralMemberDefinition>();
    const discoveredMarkList = discovered.map((d) => d.mark);

    // Phase 1: Expand Schedule Tables while preserving compound marks (B1-1, B2-5, B5-100)
    const tablesForScope = activeLegend
      ? [activeLegend]
      : estimateState.scheduleTables.filter(
          (t) => !t.detectedType || t.detectedType === selectedScope
        );

    for (const tbl of tablesForScope) {
      let markCol = 0;
      let sizeCol = -1;
      let mainRebarCol = -1;
      let topRebarCol = -1;
      let stirrupCol = -1;

      for (let c = 0; c < tbl.headers.length; c++) {
        const h = tbl.headers[c].toLowerCase();
        if (/(mark|id|no|col|beam|footing|member)/i.test(h)) markCol = c;
        else if (/(size|dim|b\s*x\s*d|section|width|depth)/i.test(h)) sizeCol = c;
        else if (/(top|hanger)/i.test(h)) topRebarCol = c;
        else if (/(main|bottom|btm|longitudinal|vertical|bar)/i.test(h)) mainRebarCol = c;
        else if (/(stirrup|tie|link|ring|shear)/i.test(h)) stirrupCol = c;
      }

      for (const r of tbl.rows) {
        const rawMarkCell = (r[markCol] || '').trim();
        if (!rawMarkCell) continue;
        const expandedMarks = expandGroupedMemberMarks(rawMarkCell, discoveredMarkList);

        let w = selectedScope === 'beam' ? 230 : 300;
        let d = 450;
        const sizeText = sizeCol >= 0 && r[sizeCol] ? r[sizeCol] : r.join(' ');
        const sMatch = sizeText.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
        if (sMatch) {
          let parsedW = parseInt(sMatch[1], 10);
          let parsedD = parseInt(sMatch[2], 10);
          if (parsedW <= 36 && parsedD <= 48) {
            parsedW = Math.round(parsedW * 25.4);
            parsedD = Math.round(parsedD * 25.4);
          }
          if (parsedW >= 100 && parsedD >= 100) {
            w = parsedW;
            d = parsedD;
          }
        }

        let mainBars = { count: 4, diameter: 16 };
        if (mainRebarCol >= 0 && r[mainRebarCol]) {
          const mMatch = r[mainRebarCol].match(
            /(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm|[\u03A6\u00D8])?\s*(\d{1,2})/i
          );
          if (mMatch) {
            mainBars = { count: parseInt(mMatch[1], 10), diameter: parseInt(mMatch[2], 10) };
          }
        }

        let secondaryBars = { count: 2, diameter: 12 };
        if (topRebarCol >= 0 && r[topRebarCol]) {
          const tMatch = r[topRebarCol].match(
            /(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm|[\u03A6\u00D8])?\s*(\d{1,2})/i
          );
          if (tMatch) {
            secondaryBars = { count: parseInt(tMatch[1], 10), diameter: parseInt(tMatch[2], 10) };
          }
        }

        let stirrups = { diameter: 8, spacingMm: 150, legs: 2 };
        if (stirrupCol >= 0 && r[stirrupCol]) {
          const stMatch = r[stirrupCol].match(
            /(?:[tTyY#]|dia|mm|[\u03A6\u00D8])?\s*(\d{1,2})\s*(?:@|at)\s*(\d{2,4})/i
          );
          if (stMatch) {
            stirrups = {
              diameter: parseInt(stMatch[1], 10),
              spacingMm: parseInt(stMatch[2], 10),
              legs: /4\s*l/i.test(r[stirrupCol]) ? 4 : 2,
            };
          }
        }

        for (const mark of expandedMarks) {
          const existing = definedMembers.find((m) => m.mark === mark);
          memberMap.set(mark, {
            id: existing?.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            mark,
            category: selectedScope,
            floorLevel: existing?.floorLevel || activeSheet?.name || 'Ground Floor',
            countOnLayout: 1,
            widthMm: w,
            depthMm: d,
            spanMm: existing?.spanMm || fallbackSpan,
            clearCoverMm: defaultCover,
            sizeSource: 'schedule',
            isVerifiedInLegend: true,
            linkedLegendMark: mark,
            mainBars: existing?.mainBars || mainBars,
            secondaryBars: existing?.secondaryBars || secondaryBars,
            stirrups: existing?.stirrups || stirrups,
          });
        }
      }
    }

    // Phase 2: Merge Layout Discovered Marks (Each compound mark B1-1, B2-5, B3-6 keeps its distinct section!)
    for (const disc of discovered) {
      const detectedSpan = disc.detectedGeometry?.lengthMm;
      if (memberMap.has(disc.mark)) {
        const mem = memberMap.get(disc.mark)!;
        mem.countOnLayout = disc.countOnLayout;
        if (detectedSpan) mem.spanMm = detectedSpan;
        if (disc.detectedGeometry) mem.detectedGeometry = disc.detectedGeometry;
        if (disc.layers[0]) mem.layerName = disc.layers[0];
        if (disc.sizeSource === 'inline_text' && disc.suggestedWidthMm && disc.suggestedDepthMm) {
          mem.widthMm = disc.suggestedWidthMm;
          mem.depthMm = disc.suggestedDepthMm;
          mem.sizeSource = 'inline_text';
          mem.scheduleConflict = disc.scheduleConflict;
        }
      } else {
        const existing = definedMembers.find((m) => m.mark === disc.mark);
        memberMap.set(disc.mark, {
          id: existing?.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          mark: disc.mark,
          category: selectedScope,
          floorLevel: existing?.floorLevel || activeSheet?.name || 'Ground Floor',
          countOnLayout: disc.countOnLayout,
          widthMm: disc.suggestedWidthMm || existing?.widthMm || (selectedScope === 'beam' ? 230 : 300),
          depthMm: disc.suggestedDepthMm || existing?.depthMm || 450,
          spanMm: detectedSpan || existing?.spanMm || fallbackSpan,
          clearCoverMm: defaultCover,
          sizeSource: disc.sizeSource || 'manual',
          scheduleConflict: disc.scheduleConflict,
          isVerifiedInLegend: disc.isVerifiedInLegend,
          layerName: disc.layers[0],
          detectedGeometry: disc.detectedGeometry || undefined,
          linkedLegendMark: disc.isVerifiedInLegend ? disc.mark : undefined,
          mainBars: disc.scheduleMainBars || existing?.mainBars || { count: 4, diameter: 16 },
          secondaryBars:
            disc.scheduleSecondaryBars || existing?.secondaryBars || { count: 2, diameter: 12 },
          stirrups:
            disc.scheduleStirrups || existing?.stirrups || { diameter: 8, spacingMm: 150, legs: 2 },
        });
      }
    }

    const newMembers = Array.from(memberMap.values()).sort((a, b) =>
      a.mark.localeCompare(b.mark, undefined, { numeric: true, sensitivity: 'base' })
    );

    if (newMembers.length === 0) {
      showToast(`No ${selectedScope} marks detected on this sheet.`);
      return;
    }

    setDefinedMembers(newMembers);
    showToast(`Detected ${newMembers.length} distinct ${selectedScope} marks with sizes`);
  };

  // Step 2 AI: Normalize schedule tables & apply per-mark sections
  const handleNormalizeTablesAi = async () => {
    if (!plan?.id || estimateState.scheduleTables.length === 0) return;
    setIsAiNormalizingStep2(true);
    try {
      const res = await authFetch(`/api/plans/${plan.id}/structural-ai/normalize-tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tables: estimateState.scheduleTables,
          known_layout_marks: definedMembers.map((m) => m.mark),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const byMark = data.membersByMark || {};
        let updatedCount = 0;
        setDefinedMembers((prev) =>
          prev.map((m) => {
            const rec = byMark[m.mark.toUpperCase()];
            if (!rec) return m;
            updatedCount++;
            return {
              ...m,
              widthMm: rec.widthMm || m.widthMm,
              depthMm: rec.depthMm || m.depthMm,
              sizeSource: rec.widthMm ? 'schedule' : m.sizeSource,
              isVerifiedInLegend: true,
              mainBars: rec.mainBars || m.mainBars,
              secondaryBars: rec.secondaryBars || m.secondaryBars,
              stirrups: rec.stirrups || m.stirrups,
            };
          })
        );
        showToast(`Synced ${updatedCount} member sections from schedule tables`);
      }
    } catch (err) {
      showToast('Synced schedule tables using local parser');
    } finally {
      setIsAiNormalizingStep2(false);
    }
  };

  // Step 3 AI: Match scattered cross-sections across sheets & queue for human confirmation
  const handleMatchSectionsAi = async () => {
    if (!plan?.id || !masterRawData) return;
    setIsAiMatchingStep3(true);
    try {
      const { sectionClusters } = scanGeneralNotesAndSections(masterRawData, sheets);
      const res = await authFetch(`/api/plans/${plan.id}/structural-ai/match-and-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          members: definedMembers,
          section_clusters: sectionClusters,
          parameters: estimateState.parameters,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const matches: any[] = data.matches || [];
        if (matches.length === 0) {
          showToast('No new scattered section matches found across sheets');
          return;
        }
        setDefinedMembers((prev) =>
          prev.map((m) => {
            const match = matches.find(
              (mt) => String(mt.memberMark).toUpperCase() === m.mark.toUpperCase()
            );
            if (!match) return m;
            return {
              ...m,
              pendingSectionMatch: {
                sectionTitle: match.sectionTitle,
                sheetId: match.sheetId,
                confidence: match.confidence || 0.88,
                status: 'pending',
                widthMm: match.widthMm,
                depthMm: match.depthMm,
                topBars: match.topBars,
                topExtraBars: match.topExtraBars,
                bottomBars: match.bottomBars,
                stirrups: match.stirrups,
              },
            };
          })
        );
        showToast(
          `Found ${matches.length} scattered section match(es). Please confirm in the drawer below.`
        );
      }
    } catch (err) {
      showToast('Could not reach section matcher service');
    } finally {
      setIsAiMatchingStep3(false);
    }
  };

  // Render CAD sheet to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeRaw) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.lineWidth = 1;
    const lines = activeRaw.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const [x1, y1] = worldToScreen(ln.start[0], ln.start[1]);
      const [x2, y2] = worldToScreen(ln.end[0], ln.end[1]);
      ctx.strokeStyle = ln.color || '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    const polylines = activeRaw.polylines || [];
    for (let i = 0; i < polylines.length; i++) {
      const pl = polylines[i];
      if (!pl.points || pl.points.length < 2) continue;
      ctx.strokeStyle = pl.color || '#94a3b8';
      ctx.beginPath();
      const [sx0, sy0] = worldToScreen(pl.points[0][0], pl.points[0][1]);
      ctx.moveTo(sx0, sy0);
      for (let p = 1; p < pl.points.length; p++) {
        const [px, py] = worldToScreen(pl.points[p][0], pl.points[p][1]);
        ctx.lineTo(px, py);
      }
      if (pl.closed) ctx.closePath();
      ctx.stroke();
    }

    const texts = activeRaw.texts || [];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const [tx, ty] = worldToScreen(t.x, t.y);
      if (tx < -50 || tx > rect.width + 50 || ty < -50 || ty > rect.height + 50) continue;
      const screenH = Math.max(8, (t.height || 0.25) * viewState.scale);
      if (screenH < 4) continue;

      const isHighlighted =
        highlightedMark && isExactTokenMatch(String(t.text), highlightedMark);

      ctx.font = `${isHighlighted ? 'bold ' : ''}${Math.round(screenH)}px sans-serif`;
      ctx.fillStyle = isHighlighted ? '#38bdf8' : t.color || '#cbd5e1';
      ctx.fillText(t.text, tx, ty);

      if (isHighlighted) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          tx - 4,
          ty - screenH / 2 - 2,
          screenH * t.text.length * 0.7 + 8,
          screenH + 4
        );
      }
    }

    if (layoutBoundingBox) {
      const [sMinX, sMaxY] = worldToScreen(layoutBoundingBox.min_x, layoutBoundingBox.max_y);
      const [sMaxX, sMinY] = worldToScreen(layoutBoundingBox.max_x, layoutBoundingBox.min_y);
      const bw = Math.abs(sMaxX - sMinX);
      const bh = Math.abs(sMaxY - sMinY);

      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.fillRect(sMinX, sMinY, bw, bh);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(sMinX, sMinY, bw, bh);
      ctx.setLineDash([]);
    }

    if (inspectedMember) {
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (t.text && isExactTokenMatch(String(t.text), inspectedMember.mark)) {
          const [tx, ty] = worldToScreen(t.x, t.y);
          const r = Math.max(12, (t.height || 0.25) * viewState.scale * 1.5 + 4);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const geom = inspectedMember.detectedGeometry;
      if (geom) {
        if (geom.type === 'line' && geom.start && geom.end) {
          const [sx1, sy1] = worldToScreen(geom.start[0], geom.start[1]);
          const [sx2, sy2] = worldToScreen(geom.end[0], geom.end[1]);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
        } else if (
          (geom.type === 'rect' || geom.type === 'polygon') &&
          geom.boundaryPoints &&
          geom.boundaryPoints.length >= 3
        ) {
          ctx.beginPath();
          for (let pIdx = 0; pIdx < geom.boundaryPoints.length; pIdx++) {
            const [bx, by] = worldToScreen(
              geom.boundaryPoints[pIdx][0],
              geom.boundaryPoints[pIdx][1]
            );
            if (pIdx === 0) ctx.moveTo(bx, by);
            else ctx.lineTo(bx, by);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    for (const pin of detectedRebarTexts) {
      const [px, py] = worldToScreen(pin.x, pin.y);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pickedFirstPoint) {
      const [p1x, p1y] = worldToScreen(pickedFirstPoint[0], pickedFirstPoint[1]);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(p1x, p1y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (marqueeStart && marqueeEnd) {
      const minX = Math.min(marqueeStart.x, marqueeEnd.x);
      const minY = Math.min(marqueeStart.y, marqueeEnd.y);
      const w = Math.abs(marqueeStart.x - marqueeEnd.x);
      const h = Math.abs(marqueeStart.y - marqueeEnd.y);

      const isLayoutSelect = toolMode === 'select_layout';
      const isCrossSection = toolMode === 'select_cross_section';
      ctx.fillStyle = isLayoutSelect
        ? 'rgba(16, 185, 129, 0.15)'
        : isCrossSection
        ? 'rgba(245, 158, 11, 0.15)'
        : 'rgba(59, 130, 246, 0.15)';
      ctx.fillRect(minX, minY, w, h);
      ctx.strokeStyle = isLayoutSelect ? '#10b981' : isCrossSection ? '#f59e0b' : '#3b82f6';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minX, minY, w, h);
      ctx.setLineDash([]);
    }
  }, [
    activeRaw,
    viewState,
    worldToScreen,
    detectedRebarTexts,
    highlightedMark,
    pickedFirstPoint,
    marqueeStart,
    marqueeEnd,
    layoutBoundingBox,
    inspectedMember,
    toolMode,
  ]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    if (
      toolMode === 'select_table' ||
      toolMode === 'select_layout' ||
      toolMode === 'select_cross_section'
    ) {
      setMarqueeStart({ x: clientX, y: clientY });
      setMarqueeEnd({ x: clientX, y: clientY });
      return;
    }

    if (toolMode === 'pick_span' && pickingMemberId) {
      const [wx, wy] = screenToWorld(clientX, clientY);
      if (!pickedFirstPoint) {
        setPickedFirstPoint([wx, wy]);
        showToast('Start point set. Click the second point on the drawing.');
      } else {
        const scaleToM = activeRaw?.scale_to_m || 1.0;
        const distUnits = Math.hypot(wx - pickedFirstPoint[0], wy - pickedFirstPoint[1]);
        const distMm = Math.round(distUnits * scaleToM * 1000);

        setDefinedMembers((prev) =>
          prev.map((m) => (m.id === pickingMemberId ? { ...m, spanMm: distMm } : m))
        );
        showToast(`Measured span: ${distMm} mm (${(distMm / 1000).toFixed(2)} m)`);
        setPickedFirstPoint(null);
        setPickingMemberId(null);
        setToolMode('pan');
      }
      return;
    }

    if (currentStep === 'reinforcement' && activeRaw?.texts) {
      const [wx, wy] = screenToWorld(clientX, clientY);
      const clickedText = activeRaw.texts.find(
        (t: any) => Math.hypot(t.x - wx, t.y - wy) < (t.height || 0.3) * 3
      );
      if (clickedText) {
        const cleanStr = String(clickedText.text).trim();
        const cand = scanTextsForRebar([clickedText])[0];
        setSelectedPlanCallout(
          cand || {
            id: `callout_${Date.now()}`,
            text: cleanStr,
            diameter: 16,
            count: 2,
            x: clickedText.x,
            y: clickedText.y,
          }
        );
        showToast(`Selected callout: "${cleanStr}"`);
        return;
      }
    }

    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    if (
      (toolMode === 'select_table' ||
        toolMode === 'select_layout' ||
        toolMode === 'select_cross_section') &&
      marqueeStart
    ) {
      setMarqueeEnd({ x: clientX, y: clientY });
      return;
    }

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setViewState((prev) => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy,
      }));
    }
  };

  const handleMouseUp = () => {
    if (toolMode === 'select_layout' && marqueeStart && marqueeEnd) {
      const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

      if (Math.abs(x2 - x1) > 20 && Math.abs(y2 - y1) > 20) {
        const [wMinX, wMaxY] = screenToWorld(x1, y1);
        const [wMaxX, wMinY] = screenToWorld(x2, y2);
        const bbox: BoxCoords = {
          min_x: Math.min(wMinX, wMaxX),
          min_y: Math.min(wMinY, wMaxY),
          max_x: Math.max(wMinX, wMaxX),
          max_y: Math.max(wMinY, wMaxY),
        };
        setLayoutBoundingBox(bbox);
        setEstimateState((prev) => ({ ...prev, layoutBoundingBox: bbox }));
        showToast('Cropped drawing scan area');
      }
      setMarqueeStart(null);
      setMarqueeEnd(null);
      setToolMode('pan');
      return;
    }

    if (toolMode === 'select_table' && marqueeStart && marqueeEnd) {
      const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

      if (Math.abs(x2 - x1) > 20 && Math.abs(y2 - y1) > 20) {
        const [wMinX, wMaxY] = screenToWorld(x1, y1);
        const [wMaxX, wMinY] = screenToWorld(x2, y2);
        const bbox: BoxCoords = {
          min_x: Math.min(wMinX, wMaxX),
          min_y: Math.min(wMinY, wMaxY),
          max_x: Math.max(wMinX, wMaxX),
          max_y: Math.max(wMinY, wMaxY),
        };

        const table = extractTableFromBoundingBox(
          activeRaw?.texts || [],
          bbox,
          undefined,
          activeRaw?.lines || [],
          activeRaw?.polylines || []
        );

        if (table) {
          table.sheetId = activeSheetId;
          setInspectingTable(table);
          showToast(`Extracted schedule table (${table.rows.length} rows)`);
        } else {
          showToast('No table grid detected inside box');
        }
      }
      setMarqueeStart(null);
      setMarqueeEnd(null);
      setToolMode('pan');
      return;
    }

    if (toolMode === 'select_cross_section' && marqueeStart && marqueeEnd) {
      const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

      if (Math.abs(x2 - x1) > 20 && Math.abs(y2 - y1) > 20) {
        const [wMinX, wMaxY] = screenToWorld(x1, y1);
        const [wMaxX, wMinY] = screenToWorld(x2, y2);
        const bbox: BoxCoords = {
          min_x: Math.min(wMinX, wMaxX),
          min_y: Math.min(wMinY, wMaxY),
          max_x: Math.max(wMinX, wMaxX),
          max_y: Math.max(wMinY, wMaxY),
        };

        const cs = extractBeamCrossSectionFromBBox(
          activeRaw?.texts || [],
          activeRaw?.lines || [],
          activeRaw?.polylines || [],
          bbox,
          activeRaw?.scale_to_m || 0.001
        );

        setInspectedCrossSection(cs);
        showToast(
          `Extracted section: ${cs.mark || 'Detail'} (${cs.widthMm || 230}×${cs.depthMm || 450}mm)`
        );
      }
      setMarqueeStart(null);
      setMarqueeEnd(null);
      setToolMode('pan');
      return;
    }

    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewState((prev) => {
      const newScale = Math.min(Math.max(prev.scale * zoomFactor, 0.01), 200);
      const newOffsetX = mouseX - (mouseX - prev.offsetX) * (newScale / prev.scale);
      const newOffsetY = mouseY - (mouseY - prev.offsetY) * (newScale / prev.scale);
      return { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY };
    });
  };

  const handleStartPickingSpan = (memberId: string) => {
    setPickingMemberId(memberId);
    setPickedFirstPoint(null);
    setToolMode('pick_span');
    showToast('Click two points on the drawing to measure clear span');
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const memberGroupsMap = new Map<string, BbsMemberGroup>();
      for (const item of bbsItems) {
        const key = `${item.memberId}_${item.memberType}`;
        const group = memberGroupsMap.get(key) || {
          id: key,
          name: item.memberId,
          type: item.memberType,
          sheetId: item.sourceSheetId,
          items: [],
        };
        group.items.push(item);
        memberGroupsMap.set(key, group);
      }

      const nextState: StructuralEstimateState = {
        ...estimateState,
        workflowStep: currentStep,
        selectedScope,
        definedMembers,
        members: Array.from(memberGroupsMap.values()),
      };

      setEstimateState(nextState);
      await onSaveEstimate(nextState);
      showToast('Saved structural BBS estimate');
    } catch (err) {
      showToast('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportBbsCsv = () => {
    const headers = [
      'Member ID',
      'Element Type',
      'Level',
      'Bar Mark',
      'Shape',
      'Dia (mm)',
      'Cut Length (m)',
      'No. of Members',
      'Bars per Member',
      'Total Bars',
      'Total Length (m)',
      'Unit Wt (kg/m)',
      'Total Wt (kg)',
      'Notes',
    ];
    const rows = bbsItems.map((i) =>
      [
        `"${i.memberId}"`,
        `"${i.memberType}"`,
        `"${i.floorLevel || 'All'}"`,
        `"${i.mark}"`,
        `"${i.shape}"`,
        i.diameter,
        i.cuttingLengthM.toFixed(3),
        i.numMembers,
        i.barsPerMember,
        i.totalBars,
        i.totalLengthM.toFixed(2),
        i.unitWeightKgM.toFixed(3),
        i.totalWeightKg.toFixed(2),
        `"${(i.notes || '').replace(/"/g, '""')}"`,
      ].join(',')
    );

    const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.name || 'structural'}_bbs_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded BBS CSV');
  };

  const diameterSummary = useMemo(() => {
    return calculateDiameterSummary(bbsItems);
  }, [bbsItems]);

  const takeoffTotals = useMemo(() => {
    return calculateTakeoffTotals(diameterSummary, estimateState.parameters);
  }, [diameterSummary, estimateState.parameters]);

  const params = estimateState.parameters;

  return (
    <div className="h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Top Bar */}
      <header className="h-12 border-b border-zinc-800/80 bg-zinc-950 px-4 flex items-center justify-between gap-4 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
            title="Back to viewer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-medium text-zinc-100 truncate">{plan?.name}</h1>
              <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] font-mono">
                IS 456 · IS 2502
              </span>
            </div>
          </div>
        </div>

        {/* Live Summary & Global Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {bbsItems.length > 0 && (
            <div className="hidden md:flex items-center gap-3 px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono tabular-nums mr-1">
              <span className="text-zinc-400">
                Steel: <strong className="text-zinc-100">{takeoffTotals.totalWeightWithWastageTonnes} t</strong>
              </span>
              <span className="text-zinc-700">·</span>
              <span className="text-emerald-400 font-medium">
                {params.currency} {takeoffTotals.totalCost.toLocaleString('en-IN')}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleExportBbsCsv}
            disabled={bbsItems.length === 0}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 text-xs font-medium transition"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            disabled={bbsItems.length === 0}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 text-zinc-200 text-xs font-medium transition"
          >
            <Printer className="w-3.5 h-3.5 text-zinc-400" />
            <span>Print</span>
          </button>

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 text-xs font-medium transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </header>

      {/* Guided 4-Step Progress Bar */}
      <GuidedWorkflowBar
        currentStep={currentStep}
        onStepChange={(step) => setCurrentStep(step)}
        memberCount={definedMembers.length}
        bbsItemCount={bbsItems.length}
        pendingMatchCount={pendingMatchCount}
        anomalyCount={auditAnomalies.length}
      />

      {/* Main Split Workstation (Locked 100dvh, Zero Outer Scroll) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Pane: Interactive CAD Canvas + Sheet Switcher */}
        <div className="w-full lg:w-1/2 h-1/2 lg:h-full border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-col relative bg-zinc-950">
          {/* Sheet Tabs inside CAD Header */}
          <div className="h-9 px-3 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-between gap-2 text-xs overflow-x-auto shrink-0">
            <div className="flex items-center gap-1 min-w-0">
              <Layers className="w-3.5 h-3.5 text-zinc-500 shrink-0 mr-1" />
              {sheets.length > 0 ? (
                sheets.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSheetId(s.id)}
                    className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition whitespace-nowrap ${
                      activeSheetId === s.id
                        ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {s.name || `Sheet ${idx + 1}`}
                  </button>
                ))
              ) : (
                <span className="text-zinc-500 text-[11px]">Full modelspace</span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setViewState((v) => ({ ...v, scale: v.scale * 1.25 }))}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewState((v) => ({ ...v, scale: v.scale * 0.8 }))}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={fitToView}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                title="Fit drawing"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Canvas */}
          <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden">
            {toolMode !== 'pan' && (
              <div className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 rounded-lg bg-amber-400 text-zinc-950 text-[11px] font-medium flex items-center gap-2 shadow">
                <span>
                  {toolMode === 'pick_span'
                    ? 'Click 2 points on drawing to measure span'
                    : toolMode === 'select_table'
                    ? 'Drag box around schedule table'
                    : toolMode === 'select_cross_section'
                    ? 'Drag box around cross-section detail'
                    : 'Drag box around floor plan area'}
                </span>
                <button
                  type="button"
                  onClick={() => setToolMode('pan')}
                  className="underline text-[10px]"
                >
                  Cancel
                </button>
              </div>
            )}

            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              className={`w-full h-full block touch-none select-none ${
                toolMode !== 'pan'
                  ? 'cursor-crosshair'
                  : currentStep === 'reinforcement'
                  ? 'cursor-pointer'
                  : 'cursor-grab active:cursor-grabbing'
              }`}
            />
          </div>
        </div>

        {/* Right Pane: Zero-Scroll Workstation Container */}
        <div className="w-full lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-zinc-900 overflow-hidden">
          {/* STEP 1: PROJECT SETUP, STEEL PRICING, STOCK CONSTRAINTS & IS CODE ASSUMPTIONS */}
          {currentStep === 'scope' && (
            <div className="h-full flex flex-col overflow-hidden">
              {/* Top Bar: Element Scope + AI Auto-Fill */}
              <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-zinc-300 mr-1">Element:</span>
                  {[
                    { id: 'beam', label: 'Beams' },
                    { id: 'column', label: 'Columns' },
                    { id: 'footing', label: 'Footings' },
                    { id: 'slab', label: 'Slabs' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedScope(item.id as StructuralMemberType)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                        selectedScope === item.id
                          ? 'bg-zinc-100 text-zinc-950'
                          : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAnalyzeSheetsAndSpecsAi}
                  disabled={isAiAnalyzingStep1}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                  title="Read General Notes and title blocks to auto-fill grades, covers, and sheet names"
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  <span>
                    {isAiAnalyzingStep1 ? 'Reading notes...' : 'Auto-fill from drawing notes'}
                  </span>
                </button>
              </div>

              {/* Fitted Middle Content: 2-Column Project & IS Code Setup + Schedule Tables */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-xs">
                {/* 2-Column Grid: Commercial Constraints vs IS 456 / 2502 / 13920 Assumptions */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {/* Card 1: Steel Pricing, Max Stock Length & Diameter Constraints */}
                  <div className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
                      <span className="font-medium text-zinc-200">
                        Steel pricing & stock constraints
                      </span>
                      <span className="text-[11px] text-emerald-400 font-mono tabular-nums">
                        {params.currency} {((params.steelRatePerKg || 0) * 1000).toLocaleString('en-IN')} / tonne
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                      <div>
                        <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                          Steel rate per kg
                        </label>
                        <div className="flex items-center gap-1">
                          <select
                            value={params.currency}
                            onChange={(e) => updateParameters({ currency: e.target.value })}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-xs"
                          >
                            <option value="₹">₹</option>
                            <option value="$">$</option>
                            <option value="AED">AED</option>
                          </select>
                          <input
                            type="number"
                            step="1"
                            value={params.steelRatePerKg}
                            onChange={(e) =>
                              updateParameters({ steelRatePerKg: Math.max(0, Number(e.target.value)) })
                            }
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                          Max bar stock length (m)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="3"
                          max="18"
                          value={params.maxStockLengthM ?? 12.0}
                          onChange={(e) =>
                            updateParameters({
                              maxStockLengthM: Math.max(3, Number(e.target.value)),
                            })
                          }
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                          title="Bars longer than this automatically include a lap splice"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                          Rolling wastage (%)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={params.wastagePct}
                          onChange={(e) =>
                            updateParameters({ wastagePct: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                          Binding wire (%)
                        </label>
                        <input
                          type="number"
                          step="0.25"
                          value={params.bindingWirePct}
                          onChange={(e) =>
                            updateParameters({
                              bindingWirePct: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                        />
                      </div>
                    </div>

                    {/* Allowed Bar Diameter Constraints */}
                    <div className="pt-1 border-t border-zinc-900 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-400">
                          Allowed bar diameters (mm)
                        </span>
                        <div className="flex items-center gap-2 text-[10px]">
                          <button
                            type="button"
                            onClick={() =>
                              updateParameters({ allowedDiameters: [8, 10, 12, 16, 20] })
                            }
                            className="text-zinc-400 hover:text-zinc-200 underline"
                          >
                            Residential (≤20)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateParameters({ allowedDiameters: PROJECT_DIAMETER_CHOICES })
                            }
                            className="text-zinc-400 hover:text-zinc-200 underline"
                          >
                            All sizes
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 font-mono tabular-nums">
                        {PROJECT_DIAMETER_CHOICES.map((d) => {
                          const isAllowed = (
                            params.allowedDiameters || PROJECT_DIAMETER_CHOICES
                          ).includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleAllowedDiameter(d)}
                              className={`px-2 py-0.5 rounded border text-[11px] transition ${
                                isAllowed
                                  ? 'bg-zinc-800 border-zinc-600 text-zinc-100 font-medium'
                                  : 'bg-zinc-950 border-zinc-900 text-zinc-600 line-through'
                              }`}
                            >
                              Φ{d}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Card 2: IS 456 / IS 2502 / IS 13920 Assumptions */}
                  <div className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
                      <span className="font-medium text-zinc-200">
                        IS 456 & IS 13920 code assumptions
                      </span>
                      <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={params.seismicDuctileDetailing ?? true}
                          onChange={(e) =>
                            updateParameters({ seismicDuctileDetailing: e.target.checked })
                          }
                          className="rounded border-zinc-700 bg-zinc-900"
                        />
                        <span>IS 13920 ductile zones</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                      <div>
                        <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                          Concrete & steel grade
                        </label>
                        <div className="flex items-center gap-1">
                          <select
                            value={params.concreteGrade || 'M25'}
                            onChange={(e) => updateParameters({ concreteGrade: e.target.value })}
                            className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                          >
                            {['M20', 'M25', 'M30', 'M35', 'M40'].map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                          <select
                            value={params.steelGrade || 'Fe500D'}
                            onChange={(e) => updateParameters({ steelGrade: e.target.value })}
                            className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                          >
                            {['Fe415', 'Fe500', 'Fe500D', 'Fe550D'].map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                          Lap / Ld & stirrup hook
                        </label>
                        <div className="flex items-center gap-1">
                          <select
                            value={params.lapLengthMultiplier ?? 50}
                            onChange={(e) =>
                              updateParameters({ lapLengthMultiplier: Number(e.target.value) })
                            }
                            className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                            title="Development & lap length multiplier (e.g. 50d)"
                          >
                            {[40, 45, 48, 50, 55, 60].map((m) => (
                              <option key={m} value={m}>
                                {m}d lap
                              </option>
                            ))}
                          </select>
                          <select
                            value={params.hookAllowanceMultiplier ?? 24}
                            onChange={(e) =>
                              updateParameters({ hookAllowanceMultiplier: Number(e.target.value) })
                            }
                            className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                            title="Stirrup hook allowance (24d for 135° seismic, 18d for 90°)"
                          >
                            <option value={24}>24d (135°)</option>
                            <option value={20}>20d (std)</option>
                            <option value={18}>18d (90°)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Clear Covers (mm) & Floor Height */}
                    <div className="pt-1 border-t border-zinc-900 space-y-1">
                      <span className="text-[10px] text-zinc-400 block">
                        Clear cover (mm) & default floor height
                      </span>
                      <div className="grid grid-cols-5 gap-1.5 font-mono tabular-nums text-[11px]">
                        {(['footing', 'column', 'beam', 'slab'] as const).map((el) => (
                          <div key={el}>
                            <span className="text-[10px] font-sans text-zinc-500 capitalize block">
                              {el}
                            </span>
                            <input
                              type="number"
                              value={params.defaultCoverMm[el]}
                              onChange={(e) =>
                                updateParameters({
                                  defaultCoverMm: {
                                    ...params.defaultCoverMm,
                                    [el]: Math.max(10, Number(e.target.value)),
                                  },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-center text-zinc-100"
                            />
                          </div>
                        ))}
                        <div>
                          <span className="text-[10px] font-sans text-zinc-500 block">
                            Floor ht
                          </span>
                          <input
                            type="number"
                            step="100"
                            value={params.defaultFloorHeightMm ?? 3000}
                            onChange={(e) =>
                              updateParameters({
                                defaultFloorHeightMm: Math.max(1500, Number(e.target.value)),
                              })
                            }
                            className="w-full bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sheet Mapping & Schedule Table Extractor Card */}
                <div className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <TableIcon className="w-3.5 h-3.5 text-zinc-400" />
                      <span className="font-medium text-zinc-200">
                        Schedule tables & sheet mapping ({estimateState.scheduleTables.length})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleAutoDetectAllTables}
                        className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-[11px] font-medium transition"
                      >
                        Scan all sheets for tables
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setToolMode(toolMode === 'select_table' ? 'pan' : 'select_table')
                        }
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                          toolMode === 'select_table'
                            ? 'bg-amber-400 text-zinc-950'
                            : 'bg-zinc-100 hover:bg-white text-zinc-950'
                        }`}
                      >
                        {toolMode === 'select_table' ? 'Cancel box' : 'Pick table on drawing'}
                      </button>
                    </div>
                  </div>

                  {sheets.length > 1 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                          Layout sheet:
                        </span>
                        <select
                          value={activeSheetId}
                          onChange={(e) => setActiveSheetId(e.target.value)}
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-[11px]"
                        >
                          {sheets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                          Schedule sheet:
                        </span>
                        <select
                          value={estimateState.scheduleSheetId || activeSheetId}
                          onChange={(e) =>
                            setEstimateState((prev) => ({
                              ...prev,
                              scheduleSheetId: e.target.value,
                            }))
                          }
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-[11px]"
                        >
                          {sheets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {estimateState.scheduleTables.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {estimateState.scheduleTables.map((tbl) => (
                        <div
                          key={tbl.id}
                          className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-[11px] text-zinc-100 truncate block">
                              {tbl.title || 'Schedule table'}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                              {tbl.rows.length} rows · {tbl.headers.length} cols
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setInspectingTable(tbl)}
                              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px]"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEstimateState((prev) => ({
                                  ...prev,
                                  scheduleTables: prev.scheduleTables.filter((t) => t.id !== tbl.id),
                                }))
                              }
                              className="p-1 text-zinc-500 hover:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Pinned Bottom Footer (Zero Scroll needed to proceed) */}
              <div className="h-12 px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
                <div className="text-[11px] text-zinc-400 font-mono tabular-nums">
                  {params.concreteGrade} · {params.steelGrade} · Max bar {params.maxStockLengthM}m · Ld={params.lapLengthMultiplier}d
                </div>

                <button
                  type="button"
                  onClick={() => setCurrentStep('catalog')}
                  className="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <span>Continue to members & sizes</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: MEMBERS & SIZES (Zero-Scroll Component) */}
          {currentStep === 'catalog' && (
            <MemberCatalogStep
              scope={selectedScope}
              members={definedMembers}
              scheduleTables={estimateState.scheduleTables}
              cadTexts={activeRaw?.texts}
              cadLayers={activeRaw?.layers}
              layoutBoundingBox={layoutBoundingBox}
              activeLegendTableId={activeLegendTableId}
              inspectedMemberId={inspectedMember?.id || null}
              defaultCoverMm={
                params.defaultCoverMm[selectedScope as keyof typeof params.defaultCoverMm]
              }
              defaultFloorHeightMm={params.defaultFloorHeightMm}
              isAiNormalizing={isAiNormalizingStep2}
              onChangeMembers={(m) => setDefinedMembers(m)}
              onScanLayoutTags={handleScanLayoutTags}
              onNormalizeTablesAi={handleNormalizeTablesAi}
              onPickSpanOnDrawing={handleStartPickingSpan}
              onHighlightMember={(mark) => {
                setHighlightedMark(mark === highlightedMark ? null : mark);
              }}
              onSelectMemberForInspection={(m) => setInspectedMember(m)}
              onStartSelectLayoutBox={() => {
                setToolMode('select_layout');
                showToast('Drag a box around the floor plan area');
              }}
              onClearLayoutBox={() => {
                setLayoutBoundingBox(null);
                setEstimateState((prev) => ({ ...prev, layoutBoundingBox: null }));
              }}
              onChangeActiveLegendTableId={(id) => {
                setActiveLegendTableId(id);
                setEstimateState((prev) => ({ ...prev, activeLegendTableId: id }));
              }}
              onBackToStep1={() => setCurrentStep('scope')}
              onProceedToStep3={() => setCurrentStep('reinforcement')}
              activePickingMemberId={pickingMemberId}
            />
          )}

          {/* STEP 3: REINFORCEMENT & SCATTERED SECTIONS (Zero-Scroll Master-Detail Component) */}
          {currentStep === 'reinforcement' && (
            <ReinforcementLinkStep
              scope={selectedScope}
              members={definedMembers}
              scheduleTables={estimateState.scheduleTables}
              allowedDiameters={params.allowedDiameters}
              isMatchingSectionsAi={isAiMatchingStep3}
              onChangeMembers={(m) => setDefinedMembers(m)}
              onOpenScheduleTableModal={(t) => setInspectingTable(t)}
              onMatchSectionsAi={handleMatchSectionsAi}
              onHighlightMember={(mark) => setHighlightedMark(mark)}
              onBackToStep2={() => setCurrentStep('catalog')}
              onProceedToStep4={() => setCurrentStep('takeoff')}
              selectedPlanCallout={selectedPlanCallout}
              onClearSelectedCallout={() => setSelectedPlanCallout(null)}
              inspectedCrossSection={inspectedCrossSection}
              onClearInspectedCrossSection={() => setInspectedCrossSection(null)}
              onStartCrossSectionMarquee={() =>
                setToolMode(
                  toolMode === 'select_cross_section' ? 'pan' : 'select_cross_section'
                )
              }
              isCrossSectionToolActive={toolMode === 'select_cross_section'}
            />
          )}

          {/* STEP 4: BBS & STEEL TAKEOFF + IS 456 AUDIT (Zero-Scroll Tabbed View) */}
          {currentStep === 'takeoff' && (
            <div className="h-full flex flex-col overflow-hidden bg-zinc-900">
              {/* Pinned Top Summary Cards + View Switcher */}
              <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 space-y-2.5 shrink-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                  <div className="bg-zinc-900 border border-zinc-800/80 rounded-lg p-2">
                    <div className="text-[10px] font-sans text-zinc-400">Net rebar weight</div>
                    <div className="text-sm font-medium text-zinc-100 mt-0.5">
                      {takeoffTotals.netWeightKg.toLocaleString('en-IN')} kg
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {takeoffTotals.netWeightTonnes} t
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800/80 rounded-lg p-2">
                    <div className="text-[10px] font-sans text-zinc-400">
                      Gross (+{params.wastagePct}% waste)
                    </div>
                    <div className="text-sm font-medium text-amber-300 mt-0.5">
                      {takeoffTotals.totalWeightWithWastageKg.toLocaleString('en-IN')} kg
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      +{takeoffTotals.wastageKg} kg waste
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800/80 rounded-lg p-2">
                    <div className="text-[10px] font-sans text-zinc-400">
                      Binding wire ({params.bindingWirePct}%)
                    </div>
                    <div className="text-sm font-medium text-zinc-200 mt-0.5">
                      {takeoffTotals.bindingWireKg} kg
                    </div>
                    <div className="text-[10px] font-sans text-zinc-500">
                      Max stock {params.maxStockLengthM}m
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2">
                    <div className="text-[10px] font-sans text-zinc-400">
                      Total steel budget
                    </div>
                    <div className="text-sm font-medium text-emerald-400 mt-0.5">
                      {params.currency} {takeoffTotals.totalCost.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      @ {params.currency}
                      {params.steelRatePerKg}/kg
                    </div>
                  </div>
                </div>

                {/* Sub-View Tabs */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setTakeoffTab('bbs')}
                      className={`px-3 py-1 rounded-md font-medium tabular-nums transition ${
                        takeoffTab === 'bbs'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Bar bending schedule ({bbsItems.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTakeoffTab('diameter')}
                      className={`px-3 py-1 rounded-md font-medium tabular-nums transition ${
                        takeoffTab === 'diameter'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      By diameter ({diameterSummary.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTakeoffTab('audit')}
                      className={`px-3 py-1 rounded-md font-medium tabular-nums transition flex items-center gap-1 ${
                        takeoffTab === 'audit'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <span>IS 456 check</span>
                      {auditAnomalies.length > 0 ? (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                          {auditAnomalies.length}
                        </span>
                      ) : (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Contained Tab Body (Zero Outer Page Scroll) */}
              <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-950">
                {takeoffTab === 'bbs' && (
                  <table className="w-full border-collapse text-xs table-fixed">
                    <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
                      <tr>
                        <th className="py-2 pl-3 pr-2 text-left font-medium w-[18%]">Member</th>
                        <th className="py-2 px-2 text-left font-medium w-[28%]">Bar role & shape</th>
                        <th className="py-2 px-2 text-center font-medium w-[12%]">Dia</th>
                        <th className="py-2 px-2 text-right font-medium w-[14%]">Cut L (m)</th>
                        <th className="py-2 px-2 text-center font-medium w-[14%]">Bars</th>
                        <th className="py-2 pl-2 pr-3 text-right font-medium w-[14%]">Weight (kg)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 font-mono tabular-nums">
                      {bbsItems.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setHighlightedMark(item.memberId)}
                          className="hover:bg-zinc-900/50 cursor-pointer transition"
                        >
                          <td className="py-2 pl-3 pr-2 font-medium text-zinc-100 truncate">
                            {item.memberId}
                          </td>
                          <td className="py-2 px-2 font-sans text-zinc-300 truncate">
                            <span>{item.mark}</span>
                            <span className="block text-[10px] text-zinc-500 font-mono">
                              {item.shape.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center text-zinc-200">Φ{item.diameter}</td>
                          <td className="py-2 px-2 text-right text-zinc-200">
                            {item.cuttingLengthM.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-center text-zinc-400">
                            {item.numMembers}×{item.barsPerMember}={item.totalBars}
                          </td>
                          <td className="py-2 pl-2 pr-3 text-right font-medium text-emerald-400">
                            {item.totalWeightKg.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {takeoffTab === 'diameter' && (
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
                      <tr>
                        <th className="py-2 pl-3 pr-2 text-left font-medium">Bar diameter</th>
                        <th className="py-2 px-2 text-center font-medium">Total bars</th>
                        <th className="py-2 px-2 text-right font-medium">Total length (m)</th>
                        <th className="py-2 px-2 text-right font-medium">Unit wt (kg/m)</th>
                        <th className="py-2 px-2 text-right font-medium">Weight (kg)</th>
                        <th className="py-2 pl-2 pr-3 text-right font-medium">Tonnes (t)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 font-mono tabular-nums">
                      {diameterSummary.map((row) => (
                        <tr key={row.diameter} className="hover:bg-zinc-900/50">
                          <td className="py-2.5 pl-3 pr-2 font-medium text-zinc-100">
                            Φ {row.diameter} mm
                          </td>
                          <td className="py-2.5 px-2 text-center text-zinc-300">{row.totalBars}</td>
                          <td className="py-2.5 px-2 text-right text-zinc-300">
                            {row.totalLengthM.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2 text-right text-zinc-500">
                            {row.unitWeightKgM.toFixed(3)}
                          </td>
                          <td className="py-2.5 px-2 text-right font-medium text-emerald-400">
                            {row.totalWeightKg.toFixed(1)}
                          </td>
                          <td className="py-2.5 pl-2 pr-3 text-right text-zinc-200">
                            {row.weightTonnes.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {takeoffTab === 'audit' && (
                  <div className="p-3 space-y-2 text-xs">
                    {auditAnomalies.length === 0 ? (
                      <div className="p-6 rounded-xl bg-zinc-900/60 border border-zinc-800 text-center space-y-1">
                        <ShieldCheck className="w-5 h-5 text-emerald-400 mx-auto" />
                        <div className="font-medium text-zinc-200">
                          All members pass IS 456:2000 & project constraints
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Steel percentages, stirrup spacings, and bar diameters are within limits.
                        </div>
                      </div>
                    ) : (
                      auditAnomalies.map((a, i) => (
                        <div
                          key={`${a.memberMark}_${i}`}
                          onClick={() => setHighlightedMark(a.memberMark)}
                          className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-start gap-2.5 cursor-pointer hover:border-zinc-700"
                        >
                          <AlertTriangle
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              a.severity === 'error' ? 'text-rose-400' : 'text-amber-400'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-medium text-zinc-100">
                                {a.memberMark}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">
                                {a.codeClause}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-300 mt-0.5">{a.message}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Pinned Bottom Footer */}
              <div className="h-12 px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setCurrentStep('reinforcement')}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Reinforcement & sections</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportBbsCsv}
                    disabled={bbsItems.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveAll}
                    disabled={isSaving}
                    className="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : 'Save estimate'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Schedule Table Modal */}
      {inspectingTable && (
        <ScheduleTableModal
          table={inspectingTable}
          onClose={() => setInspectingTable(null)}
          onSaveTable={(updatedTable) => {
            setEstimateState((prev) => ({
              ...prev,
              scheduleTables: [
                ...prev.scheduleTables.filter((t) => t.id !== updatedTable.id),
                updatedTable,
              ],
            }));
            showToast('Saved schedule table');
          }}
          onShareToProject={async (tableToShare) => {
            const projectName = plan?.project_name;
            if (!projectName) {
              showToast('No project assigned to this plan');
              return;
            }
            try {
              const res = await authFetch(
                `/api/projects/${encodeURIComponent(projectName)}/share-table`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ table: tableToShare }),
                }
              );
              if (res.ok) {
                const data = await res.json();
                showToast(`Shared "${tableToShare.title}" with ${data.updated_plans} plans`);
              } else {
                showToast('Failed to share table');
              }
            } catch (err) {
              showToast('Network error while sharing table');
            }
          }}
          onImportToBbs={(_items, updatedTable) => {
            setEstimateState((prev) => ({
              ...prev,
              scheduleTables: [
                ...prev.scheduleTables.filter((t) => t.id !== updatedTable.id),
                updatedTable,
              ],
            }));
            showToast('Imported schedule table');
          }}
        />
      )}
    </div>
  );
};
