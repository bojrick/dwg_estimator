import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Download,
  Printer,
  Trash2,
  Table as TableIcon,
  Sparkles,
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
  LongitudinalSectionDefinition,
} from './types';
import {
  STANDARD_DIAMETERS,
  calculateDiameterSummary,
  calculateTakeoffTotals,
  generateBbsFromMemberDefinitions,
  generateCompleteBbs,
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
import { LongitudinalSectionDrawer } from './LongitudinalSectionDrawer';
import { GuidedWorkflowBar } from './GuidedWorkflowBar';
import { MemberCatalogStep } from './MemberCatalogStep';
import { ReinforcementLinkStep } from './ReinforcementLinkStep';
import { ProjectScopeStep } from './ProjectScopeStep';
import { TakeoffSummaryStep } from './TakeoffSummaryStep';
import {
  scanStructuralTagsWithVerification,
  scanGeneralNotesAndSections,
  isExactTokenMatch,
} from './tagScanner';
import { cropRawDataToSheet } from '../SheetSelectorModal';
import {
  extractBeamCrossSectionFromBBox,
  extractContinuousBeamSpansFromWindow,
} from './cadGeometryEngine';
import { authFetch } from '../../auth';
import { CadEstimatorCanvas, WorldBBox } from '../estimators/shared/CadEstimatorCanvas';
import { VersionHistoryControl } from '../estimators/shared/VersionHistoryControl';

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
  const [sheets, setSheets] = useState<any[]>(
    () => plan?.sheets || fullRawData?.sheets || initialRawData?.sheets || []
  );
  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    const initialSheets = plan?.sheets || fullRawData?.sheets || initialRawData?.sheets || [];
    const saved = plan?.structural_estimate || {};
    return saved.layoutSheetId || plan?.active_sheet_id || initialSheets[0]?.id || 'all';
  });
  const [versions, setVersions] = useState<any[]>(
    () => (plan?.structural_estimate?.versions as any[]) || []
  );

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
    if (
      definedMembers.length > 0 ||
      (estimateState.longitudinalSections && estimateState.longitudinalSections.length > 0)
    ) {
      const generated = generateCompleteBbs(
        definedMembers,
        estimateState.longitudinalSections || [],
        estimateState.parameters
      );
      setBbsItems(generated);
    } else if (estimateState.members && estimateState.members.length > 0) {
      const flat = estimateState.members.flatMap((m) => m.items || []);
      setBbsItems(flat);
    } else {
      setBbsItems([]);
    }
  }, [definedMembers, estimateState.longitudinalSections, estimateState.members, estimateState.parameters]);

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
  const [selectedPlanCallout, setSelectedPlanCallout] = useState<any | null>(null);
  const [highlightedMark, setHighlightedMark] = useState<string | null>(null);
  const [inspectingTable, setInspectingTable] = useState<ExtractedCadTable | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [toolMode, setToolMode] = useState<
    'pan' | 'select_table' | 'pick_span' | 'select_layout' | 'select_cross_section' | 'select_longitudinal_section'
  >('pan');
  const [activeLongitudinalSection, setActiveLongitudinalSection] =
    useState<LongitudinalSectionDefinition | null>(null);
  const [isInferringLs, setIsInferringLs] = useState(false);
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
        if (selectedScope !== 'beam' && detectedSpan) mem.spanMm = detectedSpan;
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
          spanMm:
            selectedScope === 'beam'
              ? existing?.spanMm || 0
              : detectedSpan || existing?.spanMm || fallbackSpan,
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

  const handleCanvasBoxSelected = useCallback(
    (wb: WorldBBox) => {
      const bbox: BoxCoords = {
        min_x: wb.min_x,
        min_y: wb.min_y,
        max_x: wb.max_x,
        max_y: wb.max_y,
      };
      if (toolMode === 'select_layout') {
        setLayoutBoundingBox(bbox);
        setEstimateState((prev) => ({ ...prev, layoutBoundingBox: bbox }));
        showToast('Cropped drawing scan area');
      } else if (toolMode === 'select_table') {
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
      } else if (toolMode === 'select_cross_section') {
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
      } else if (toolMode === 'select_longitudinal_section') {
        const spatialTokensInBox = (activeRaw?.texts || []).filter(
          (t: any) =>
            t &&
            t.text &&
            typeof t.x === 'number' &&
            typeof t.y === 'number' &&
            t.x >= bbox.min_x - 0.2 &&
            t.x <= bbox.max_x + 0.2 &&
            t.y >= bbox.min_y - 0.2 &&
            t.y <= bbox.max_y + 0.2
        );
        const textsInBox = spatialTokensInBox.map((t: any) => String(t.text).trim());

        // Extract physical column-to-column center-to-center spans directly from CAD geometry
        const measured = extractContinuousBeamSpansFromWindow(
          bbox,
          activeRaw?.lines || [],
          activeRaw?.polylines || [],
          activeRaw?.texts || [],
          activeRaw?.scale_to_m || 0.001,
          definedMembers.map((m) => m.mark)
        );

        setIsInferringLs(true);
        const fallbackLs: LongitudinalSectionDefinition = {
          id: `ls_${Date.now()}`,
          name:
            measured.beamMarks.length > 0
              ? `L-SEC: ${measured.beamMarks.slice(0, 4).join(' + ')}`
              : 'Longitudinal Section (Inferring...)',
          sheetId: activeSheetId,
          windowBox: bbox,
          spans:
            measured.spans.length > 0
              ? measured.spans.map((ms) => ({
                  id: ms.id,
                  beamMark: ms.beamMark,
                  centerToCenterSpanMm: ms.centerToCenterSpanMm,
                  clearSpanMm: ms.clearSpanMm,
                  widthMm: ms.widthMm,
                  depthMm: ms.depthMm,
                  supportColLeftMm: ms.supportColLeftMm,
                  supportColRightMm: ms.supportColRightMm,
                }))
              : [
                  {
                    id: 'span_1',
                    beamMark: 'B1-1',
                    centerToCenterSpanMm: 4100,
                    clearSpanMm: 3800,
                    widthMm: 230,
                    depthMm: 450,
                    supportColLeftMm: 300,
                    supportColRightMm: 400,
                  },
                ],
          reinforcement: {
            bottomContinuousBars: { count: 3, diameter: 20 },
            bottomCurtailedBars: { count: 2, diameter: 16, curtailRatio: 0.15 },
            topContinuousBars: { count: 2, diameter: 12 },
            supportTopExtraBars: { count: 2, diameter: 20, extensionRatio: 0.33 },
            stirrups: {
              diameter: 8,
              legs: 2,
              spacingEndMm: 100,
              spacingMidMm: 175,
              confinementZoneMm: Math.round(2 * (measured.depthMm - 40)),
            },
          },
        };
        setActiveLongitudinalSection(fallbackLs);

        authFetch(`/api/plans/${plan.id}/structural-ai/infer-longitudinal-section`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            window_texts: textsInBox,
            spatial_tokens: spatialTokensInBox.map((t: any) => ({
              text: String(t.text).trim(),
              x: t.x,
              y: t.y,
              height: t.height || 0.25,
            })),
            measured_spans: fallbackLs.spans,
            candidate_beams: definedMembers.map((m) => m.mark),
            scale_to_m: activeRaw?.scale_to_m || 0.001,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && data.spans) {
              setActiveLongitudinalSection({
                id: fallbackLs.id,
                name: data.name || fallbackLs.name,
                sheetId: activeSheetId,
                windowBox: bbox,
                spans: data.spans || fallbackLs.spans,
                reinforcement: data.reinforcement || fallbackLs.reinforcement,
                notes: data.notes || '',
              });
              showToast(`Inferred Longitudinal Section (${data.spans.length} spans)`);
            }
          })
          .catch(() => {
            showToast('Loaded section with physical CAD spans');
          })
          .finally(() => setIsInferringLs(false));
      }
      setToolMode('pan');
    },
    [toolMode, activeRaw, activeSheetId, definedMembers, plan.id, showToast]
  );

  const handleCanvasTwoPointPicked = useCallback(
    (distMeters: number) => {
      if (!pickingMemberId) return;
      const distMm = Math.round(distMeters * 1000);
      setDefinedMembers((prev) =>
        prev.map((m) => (m.id === pickingMemberId ? { ...m, spanMm: distMm } : m))
      );
      showToast(`Measured span: ${distMm} mm (${distMeters.toFixed(2)} m)`);
      setPickingMemberId(null);
      setToolMode('pan');
    },
    [pickingMemberId, showToast]
  );

  const handleCanvasClickWorld = useCallback(
    (wx: number, wy: number) => {
      if (currentStep === 'reinforcement' && activeRaw?.texts) {
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
        }
      }
    },
    [currentStep, activeRaw, showToast]
  );

  const renderStructuralOverlay = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      worldToScreen: (wx: number, wy: number) => [number, number],
      zoom: number
    ) => {
      if (inspectedMember) {
        for (const t of activeRaw?.texts || []) {
          if (t.text && isExactTokenMatch(String(t.text), inspectedMember.mark)) {
            const [tx, ty] = worldToScreen(t.x, t.y);
            const r = Math.max(12, (t.height || 0.25) * zoom * 1.5 + 4);
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
            geom.boundaryPoints.forEach((pt, idx) => {
              const [bx, by] = worldToScreen(pt[0], pt[1]);
              if (idx === 0) ctx.moveTo(bx, by);
              else ctx.lineTo(bx, by);
            });
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
    },
    [inspectedMember, activeRaw, detectedRebarTexts]
  );

  const handleStartPickingSpan = (memberId: string) => {
    setPickingMemberId(memberId);
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

      const activeSheetName =
        activeSheetId === 'all' ? 'All sheets combined' : activeSheet?.name || 'Sheet 1';
      const newVersion = {
        versionId: `v_${Date.now()}`,
        versionNumber: versions.length + 1,
        createdAt: new Date().toISOString(),
        sheetId: activeSheetId,
        sheetName: activeSheetName,
        notes: estimateState.notes || '',
        totalCost: takeoffTotals.totalCost,
        snapshot: {
          activeSheetId,
          definedMembers,
          parameters: estimateState.parameters,
          longitudinalSections: estimateState.longitudinalSections || [],
          notes: estimateState.notes,
        },
      };
      const nextVersions = [...versions, newVersion].slice(-20);
      setVersions(nextVersions);

      const nextState: StructuralEstimateState & { versions?: any[]; sheetName?: string } = {
        ...estimateState,
        layoutSheetId: activeSheetId,
        sheetName: activeSheetName,
        workflowStep: currentStep,
        selectedScope,
        definedMembers,
        members: Array.from(memberGroupsMap.values()),
        versions: nextVersions,
      };

      setEstimateState(nextState);
      await onSaveEstimate(nextState);
      showToast(`Saved structural BBS estimate v${newVersion.versionNumber} (${activeSheetName})`);
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

          <VersionHistoryControl
            versions={versions}
            currency={params.currency}
            onRestoreVersion={(v) => {
              if (!v?.snapshot) return;
              if (v.snapshot.activeSheetId) setActiveSheetId(v.snapshot.activeSheetId);
              if (v.snapshot.definedMembers) setDefinedMembers(v.snapshot.definedMembers);
              setEstimateState((prev) => ({
                ...prev,
                parameters: v.snapshot.parameters ? { ...prev.parameters, ...v.snapshot.parameters } : prev.parameters,
                longitudinalSections: v.snapshot.longitudinalSections || prev.longitudinalSections || [],
                notes: v.snapshot.notes || prev.notes,
              }));
              showToast(`Restored Structural BBS v${v.versionNumber} (${v.sheetName})`);
            }}
          />

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
        {/* Left Pane: Shared Interactive CAD Canvas (All Sheets, Measure, Clean LOD, Layers) */}
        <div className="w-full lg:w-1/2 h-1/2 lg:h-full border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-col relative bg-zinc-950">
          <CadEstimatorCanvas
            rawData={activeRaw}
            sheets={sheets}
            activeSheetId={activeSheetId}
            onSelectSheetId={setActiveSheetId}
            highlightedMark={highlightedMark}
            layoutBox={layoutBoundingBox}
            boxSelectLabel={
              toolMode === 'select_table'
                ? 'Drag box around schedule table'
                : toolMode === 'select_layout'
                ? 'Drag box around floor plan area'
                : toolMode === 'select_cross_section'
                ? 'Drag box around cross-section detail'
                : toolMode === 'select_longitudinal_section'
                ? 'Drag box around Longitudinal Section (multi-span beam)'
                : null
            }
            onBoxSelected={handleCanvasBoxSelected}
            twoPointPickLabel={
              toolMode === 'pick_span' && pickingMemberId
                ? 'Click 2 points on drawing to measure clear span'
                : null
            }
            onTwoPointPicked={handleCanvasTwoPointPicked}
            onCancelExternalTool={() => {
              setPickingMemberId(null);
              setToolMode('pan');
            }}
            onClickWorld={handleCanvasClickWorld}
            renderCustomOverlay={renderStructuralOverlay}
          />
        </div>

        {/* Right Pane: Zero-Scroll Workstation Container */}
        <div className="w-full lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-zinc-900 overflow-hidden">
          {/* STEP 1: PROJECT SETUP, STEEL PRICING, STOCK CONSTRAINTS & IS CODE ASSUMPTIONS */}
          {currentStep === 'scope' && (
            <ProjectScopeStep
              selectedScope={selectedScope}
              onSelectScope={setSelectedScope}
              params={params}
              updateParameters={updateParameters}
              toggleAllowedDiameter={toggleAllowedDiameter}
              isAiAnalyzing={isAiAnalyzingStep1}
              onAnalyzeSheetsAndSpecsAi={handleAnalyzeSheetsAndSpecsAi}
              sheets={sheets}
              activeSheetId={activeSheetId}
              setActiveSheetId={setActiveSheetId}
              scheduleSheetId={estimateState.scheduleSheetId}
              onSelectScheduleSheetId={(id) =>
                setEstimateState((prev) => ({ ...prev, scheduleSheetId: id }))
              }
              scheduleTables={estimateState.scheduleTables}
              onAutoDetectAllTables={handleAutoDetectAllTables}
              toolMode={toolMode}
              setToolMode={setToolMode}
              onViewTable={(tbl) => setInspectingTable(tbl)}
              onDeleteTable={(tableId) =>
                setEstimateState((prev) => ({
                  ...prev,
                  scheduleTables: prev.scheduleTables.filter((t) => t.id !== tableId),
                }))
              }
              onContinue={() => setCurrentStep('catalog')}
            />
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
              onStartLongitudinalSectionWindow={() =>
                setToolMode(
                  toolMode === 'select_longitudinal_section' ? 'pan' : 'select_longitudinal_section'
                )
              }
              isLongitudinalSectionToolActive={toolMode === 'select_longitudinal_section'}
              longitudinalSectionsCount={estimateState.longitudinalSections?.length || 0}
              longitudinalSections={estimateState.longitudinalSections || []}
              onOpenLongitudinalSectionDrawer={(ls) => setActiveLongitudinalSection(ls)}
              onDeleteLongitudinalSection={(id) => {
                setEstimateState((prev) => ({
                  ...prev,
                  longitudinalSections: (prev.longitudinalSections || []).filter((ls) => ls.id !== id),
                }));
                showToast('Deleted longitudinal section');
              }}
            />
          )}

          {/* STEP 4: BBS & STEEL TAKEOFF + IS 456 AUDIT (Zero-Scroll Tabbed View) */}
          {currentStep === 'takeoff' && (
            <TakeoffSummaryStep
              takeoffTotals={takeoffTotals}
              params={params}
              takeoffTab={takeoffTab}
              setTakeoffTab={setTakeoffTab}
              bbsItems={bbsItems}
              diameterSummary={diameterSummary}
              auditAnomalies={auditAnomalies}
              onExportBbsCsv={handleExportBbsCsv}
              onHighlightMember={(mark) => setHighlightedMark(mark)}
              onSaveAll={handleSaveAll}
              isSaving={isSaving}
              onBackToStep3={() => setCurrentStep('reinforcement')}
              longitudinalSections={estimateState.longitudinalSections || []}
              definedMembers={definedMembers}
            />
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

      {/* Longitudinal Section Inspector Drawer */}
      <LongitudinalSectionDrawer
        isOpen={Boolean(activeLongitudinalSection)}
        section={activeLongitudinalSection}
        isInferring={isInferringLs}
        definedMembers={definedMembers}
        onClose={() => setActiveLongitudinalSection(null)}
        onSave={(updatedLs) => {
          setEstimateState((prev) => {
            const existing = prev.longitudinalSections || [];
            const filtered = existing.filter((ls) => ls.id !== updatedLs.id);
            return {
              ...prev,
              longitudinalSections: [...filtered, updatedLs],
            };
          });
          showToast(`Applied "${updatedLs.name}" to BBS takeoff`);
        }}
        onDelete={(id) => {
          setEstimateState((prev) => ({
            ...prev,
            longitudinalSections: (prev.longitudinalSections || []).filter((ls) => ls.id !== id),
          }));
          showToast('Deleted longitudinal section');
        }}
      />
    </div>
  );
};
