import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { Core, EventObject, LayoutOptions } from 'cytoscape';
import { useAppStore } from '../store/appStore';
import type { EntityInstance, RelationshipInstance, EntityType } from '../data/ontology';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Download, Crosshair, Boxes, Share2 } from 'lucide-react';

// Register fcose layout
cytoscape.use(fcose);

declare global {
  interface Window {
    __ONTOLOGY_PREVIEW_CY__?: Core;
  }
}

type GraphColors = { nodeText: string; edgeColor: string; edgeText: string; edgeLabelBg: string };

// Read graph colors from the active theme's CSS custom properties, falling
// back to the dark/light defaults when the variables can't be resolved yet.
function readGraphColors(darkMode: boolean, el?: HTMLElement | null): GraphColors {
  const fallback: GraphColors = darkMode
    ? { nodeText: '#B3B3B3', edgeColor: '#6E6E6E', edgeText: '#9CA0A8', edgeLabelBg: '#15161D' }
    : { nodeText: '#2A2A2A', edgeColor: '#888888', edgeText: '#555555', edgeLabelBg: '#F2F2F2' };
  const source = el ?? (typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.app-container') : null);
  if (!source) return fallback;
  const cs = getComputedStyle(source);
  return {
    nodeText: cs.getPropertyValue('--graph-node-text').trim() || fallback.nodeText,
    edgeColor: cs.getPropertyValue('--graph-edge-color').trim() || fallback.edgeColor,
    edgeText: cs.getPropertyValue('--graph-edge-text').trim() || fallback.edgeText,
    edgeLabelBg: cs.getPropertyValue('--graph-edge-label-bg').trim() || fallback.edgeLabelBg,
  };
}

// ── Instance-view helpers ──────────────────────────────────────────────────

/** Build a unique Cytoscape node id for an entity instance. */
function instanceNodeId(entityTypeId: string, instanceKey: string): string {
  return `inst:${entityTypeId}:${instanceKey}`;
}

/** Find the identifier property name of an entity type (falls back to first). */
function identifierPropOf(entity: EntityType): string | undefined {
  return (entity.properties.find(p => p.isIdentifier) ?? entity.properties[0])?.name;
}

/** Get the identifier value of an instance (by entity type's identifier prop). */
function instanceKeyValue(entity: EntityType, inst: EntityInstance): string {
  const idProp = identifierPropOf(entity);
  return idProp ? String(inst.values[idProp] ?? '') : inst.id;
}

/** Pick a human-readable label for an instance (prefer non-id string values). */
function instanceDisplayLabel(entity: EntityType, inst: EntityInstance): string {
  const idProp = identifierPropOf(entity);
  for (const [name, v] of Object.entries(inst.values)) {
    if (typeof v === 'string' && v.length > 1 && name !== idProp) {
      return v;
    }
  }
  const key = instanceKeyValue(entity, inst);
  return key || inst.id;
}

/** Build Cytoscape elements for the instance view: instance nodes + instance edges. */
function buildInstanceElements(
  ontology: { entityTypes: EntityType[]; relationships: Array<{ id: string; name: string; from: string; to: string }> },
  entityInstances: EntityInstance[],
  relationshipInstances: RelationshipInstance[],
) {
  const entityById = new Map(ontology.entityTypes.map(e => [e.id, e]));

  // Build instance nodes with stable ids: "inst:<entityTypeId>:<keyValue>"
  const nodes = entityInstances.map(inst => {
    const entity = entityById.get(inst.entityTypeId);
    const fallbackColor = '#888888';
    const label = entity
      ? `${entity.icon} ${instanceDisplayLabel(entity, inst)}`
      : inst.id;
    const key = entity ? instanceKeyValue(entity, inst) : inst.id;
    return {
      data: {
        id: instanceNodeId(inst.entityTypeId, key),
        label,
        name: label,
        color: entity?.color ?? fallbackColor,
        icon: entity?.icon ?? '•',
        type: 'instance',
        entityTypeId: inst.entityTypeId,
        instanceKey: key,
      }
    };
  });

  const nodeIds = new Set(nodes.map(n => n.data.id));

  // Build instance edges from relationship instances.
  // sourceKey/targetKey reference identifier values; resolve to node ids.
  const edges: Array<{ data: Record<string, unknown> }> = [];
  for (const ri of relationshipInstances) {
    const rel = ontology.relationships.find(r => r.id === ri.relationshipId);
    if (!rel) continue;
    const fromEntity = entityById.get(rel.from);
    const toEntity = entityById.get(rel.to);
    if (!fromEntity || !toEntity) continue;
    const sourceId = instanceNodeId(rel.from, ri.sourceKey);
    const targetId = instanceNodeId(rel.to, ri.targetKey);
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;
    const attrStr = ri.values
      ? ` (${Object.entries(ri.values).map(([k, v]) => `${k}=${v}`).join(', ')})`
      : '';
    edges.push({
      data: {
        id: `ri:${ri.id}`,
        source: sourceId,
        target: targetId,
        label: `${rel.name}${attrStr}`,
        type: 'instance-relationship',
        relationshipId: ri.id,
      }
    });
  }

  return [...nodes, ...edges];
}

export function OntologyGraph() {
  const cyRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const focusNodeIdRef = useRef<string | null>(null);
  
  // Helper to safely get cytoscape instance - returns null if destroyed
  const getCy = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || !mountedRef.current) return null;
    // Check if cy is still mounted (destroyed instances have no container)
    try {
      if (!cy.container()) return null;
    } catch {
      return null;
    }
    return cy;
  }, []);
  
  const {
    currentOntology,
    selectedEntityId,
    selectedRelationshipId,
    highlightedEntities,
    highlightedRelationships,
    selectEntity,
    selectRelationship,
    activeQuest,
    currentStepIndex,
    advanceQuestStep,
    darkMode,
    theme,
    entityInstances,
    relationshipInstances,
    graphViewMode,
    selectedInstanceKey,
    setGraphViewMode,
    selectInstance
  } = useAppStore();

  // Use refs for quest state to avoid re-creating the graph when quest changes
  const activeQuestRef = useRef(activeQuest);
  const currentStepIndexRef = useRef(currentStepIndex);
  const advanceQuestStepRef = useRef(advanceQuestStep);
  
  // Keep refs in sync
  useEffect(() => {
    activeQuestRef.current = activeQuest;
    currentStepIndexRef.current = currentStepIndex;
    advanceQuestStepRef.current = advanceQuestStep;
  }, [activeQuest, currentStepIndex, advanceQuestStep]);
  
  // Theme-aware colors, sourced from the active theme's CSS variables so each
  // theme (including the derived ones) renders with its own graph palette.
  const [themeColors, setThemeColors] = useState<GraphColors>(() => readGraphColors(darkMode));
  useEffect(() => {
    setThemeColors(readGraphColors(darkMode, containerRef.current));
  }, [theme, darkMode]);

  // Initial theme colors for graph creation
  const initialThemeColors = useRef(themeColors);

  // Build graph elements from ontology — schema view (entity types) or
  // instance view (actual records linked by relationship instances).
  const buildElements = useCallback(() => {
    if (graphViewMode === 'instance') {
      return buildInstanceElements(
        currentOntology,
        entityInstances,
        relationshipInstances,
      );
    }
    const nodes = currentOntology.entityTypes.map(entity => ({
      data: {
        id: entity.id,
        label: `${entity.icon} ${entity.name}`,
        name: entity.name,
        icon: entity.icon,
        color: entity.color,
        description: entity.description,
        type: 'entity'
      }
    }));

    const nodeIds = new Set(nodes.map(n => n.data.id));

    const edges = currentOntology.relationships
      .filter(rel => rel.from && rel.to && nodeIds.has(rel.from) && nodeIds.has(rel.to))
      .map(rel => ({
        data: {
          id: rel.id,
          source: rel.from,
          target: rel.to,
          label: rel.name,
          cardinality: rel.cardinality,
          description: rel.description,
          type: 'relationship'
        }
      }));

    return [...nodes, ...edges];
  }, [currentOntology, graphViewMode, entityInstances, relationshipInstances]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(),
      style: [
        // Base node style
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'font-size': '14px',
            'font-family': 'Segoe UI, sans-serif',
            'font-weight': 600,
            'color': initialThemeColors.current.nodeText,
            'text-margin-y': 10,
            'width': 70,
            'height': 70,
            'background-color': 'data(color)',
            'border-width': 3,
            'border-color': 'data(color)',
            'border-opacity': 0.5,
            'transition-property': 'border-width, border-color, width, height',
            'transition-duration': 200
          }
        },
        // Selected node
        {
          selector: 'node:selected',
          style: {
            'border-width': 5,
            'border-color': '#0078D4',
            'width': 85,
            'height': 85
          }
        },
        // Highlighted node
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 4,
            'border-color': '#FFB900',
            'width': 80,
            'height': 80
          }
        },
        // Dimmed node
        {
          selector: 'node.dimmed',
          style: {
            'opacity': 0.3
          }
        },
        // Base edge style
        {
          selector: 'edge',
          style: {
            'label': 'data(label)',
            'font-size': '11px',
            'font-family': 'Segoe UI, sans-serif',
            'color': initialThemeColors.current.edgeText,
            'text-rotation': 'autorotate',
            'text-margin-y': -10,
            'text-wrap': 'ellipsis',
            'text-max-width': '120px',
            'text-background-color': initialThemeColors.current.edgeLabelBg,
            'text-background-opacity': 1,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'width': 3,
            'line-color': initialThemeColors.current.edgeColor,
            'target-arrow-color': initialThemeColors.current.edgeColor,
            'target-arrow-shape': 'triangle',
            'curve-style': 'unbundled-bezier',
            'control-point-step-size': 40,
            'edge-distances': 'node-position',
            'transition-property': 'width, line-color, target-arrow-color',
            'transition-duration': 200
          }
        },
        // Selected edge
        {
          selector: 'edge:selected',
          style: {
            'width': 5,
            'line-color': '#0078D4',
            'target-arrow-color': '#0078D4',
            'color': '#0078D4'
          }
        },
        // Highlighted edge
        {
          selector: 'edge.highlighted',
          style: {
            'width': 4,
            'line-color': '#FFB900',
            'target-arrow-color': '#FFB900',
            'color': '#FFB900'
          }
        },
        // Dimmed edge
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.2
          }
        }
      ],
       
      layout: {
        name: 'fcose',
        quality: 'proof',
        randomize: false,
        animate: false,
        fit: true,
        padding: 60,
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: () => 15000,
        idealEdgeLength: () => 200,
        edgeElasticity: () => 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        gravityRange: 3.8,
        numIter: 2500,
        tile: true,
        tilingPaddingVertical: 40,
        tilingPaddingHorizontal: 40,
        nodeSeparation: 100
      } as LayoutOptions,
      minZoom: 0.3,
      maxZoom: 3
    });

    // Event handlers
    cy.on('tap', 'node', (evt: EventObject) => {
      const node = evt.target;
      const nodeId = node.id();
      const nodeData = node.data();

      // In instance view, select instance and highlight its neighbourhood
      if (nodeData.type === 'instance') {
        const key = `${nodeData.entityTypeId}:${nodeData.instanceKey}`;
        selectInstance(key);
        return;
      }

      selectEntity(nodeId);

      // Check if this advances a quest step (use refs to avoid re-creating graph)
      const quest = activeQuestRef.current;
      const stepIndex = currentStepIndexRef.current;
      if (quest) {
        const currentStep = quest.steps[stepIndex];
        if (currentStep.targetType === 'entity' && currentStep.targetId === nodeId) {
          advanceQuestStepRef.current();
        }
      }
    });

    cy.on('tap', 'edge', (evt: EventObject) => {
      const edge = evt.target;
      const edgeId = edge.id();
      const edgeData = edge.data();

      // In instance view, edges are relationship instances — no quest logic
      if (edgeData.type === 'instance-relationship') {
        return;
      }

      selectRelationship(edgeId);

      // Check if this advances a quest step (use refs to avoid re-creating graph)
      const quest = activeQuestRef.current;
      const stepIndex = currentStepIndexRef.current;
      if (quest) {
        const currentStep = quest.steps[stepIndex];
        if (currentStep.targetType === 'relationship' && currentStep.targetId === edgeId) {
          advanceQuestStepRef.current();
        }
      }
    });

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        // Exit focus mode BEFORE clearing selection so the selection effect
        // doesn't see a stale focusNodeIdRef and skip its dimmed cleanup
        if (focusNodeIdRef.current !== null) {
          focusNodeIdRef.current = null;
          setFocusNodeId(null);
          getCy()?.elements().removeClass('dimmed focus-hidden');
        }
        selectEntity(null);
        selectRelationship(null);
        selectInstance(null);
      }
    });

    cy.on('dbltap', 'node', (evt: EventObject) => {
      const nodeId = evt.target.id();
      const alreadyFocused = focusNodeIdRef.current === nodeId;

      if (alreadyFocused) {
        // Toggle off
        focusNodeIdRef.current = null;
        setFocusNodeId(null);
        cy.elements().removeClass('dimmed focus-hidden');
      } else {
        focusNodeIdRef.current = nodeId;
        setFocusNodeId(nodeId);
        const node = cy.getElementById(nodeId);
        const neighbourhood = node.closedNeighborhood();
        cy.elements().addClass('dimmed');
        neighbourhood.removeClass('dimmed');
      }
    });

    cyRef.current = cy;
    window.__ONTOLOGY_PREVIEW_CY__ = cy;
    mountedRef.current = true;

    // Run layout explicitly after initialization for better results
     
    cy.layout({
      name: 'fcose',
      quality: 'proof',
      randomize: true,
      animate: false,
      fit: true,
      padding: 60,
      nodeDimensionsIncludeLabels: true,
      nodeRepulsion: () => 15000,
      idealEdgeLength: () => 200,
      edgeElasticity: () => 0.45,
      nodeSeparation: 100
    } as unknown as Parameters<Core['layout']>[0]).run();

    return () => {
      mountedRef.current = false;
      if (window.__ONTOLOGY_PREVIEW_CY__ === cy) {
        delete window.__ONTOLOGY_PREVIEW_CY__;
      }
      cy.destroy();
      cyRef.current = null;
    };
  }, [buildElements, selectEntity, selectRelationship, selectInstance]);

  // Keep focusNodeIdRef in sync with state
  useEffect(() => {
    focusNodeIdRef.current = focusNodeId;
  }, [focusNodeId]);

  // Re-apply focus neighbourhood when focusNodeId changes
  useEffect(() => {
    const cy = getCy();
    if (!cy) return;
    if (focusNodeId === null) {
      cy.elements().removeClass('dimmed');
    } else {
      const node = cy.getElementById(focusNodeId);
      if (node.length) {
        cy.elements().addClass('dimmed');
        node.closedNeighborhood().removeClass('dimmed');
      }
    }
  }, [focusNodeId, getCy]);

  // Update graph colors when theme changes (without recreating graph)
  useEffect(() => {
    const cy = getCy();
    if (!cy) return;

    try {
      // Apply text-color update to ALL edges/nodes (text colors don't affect highlight line-color)
      cy.$('node').style({ 'color': themeColors.nodeText });
      cy.$('edge').style({ 'color': themeColors.edgeText, 'text-background-color': themeColors.edgeLabelBg, 'text-background-opacity': 1 });
      // Line/arrow colors: only update non-highlighted edges so path-finder highlights survive
      cy.edges().not('.highlighted').style({
        'line-color': themeColors.edgeColor,
        'target-arrow-color': themeColors.edgeColor,
      });
    } catch {
      // Graph may have been destroyed
    }
  }, [themeColors, darkMode, getCy]);

  // Handle selection changes
  useEffect(() => {
    const cy = getCy();
    if (!cy) return;

    // Instance view: highlight selected instance's neighbourhood
    if (graphViewMode === 'instance') {
      try {
        cy.elements().removeClass('highlighted dimmed');
        cy.elements().unselect();
        if (selectedInstanceKey) {
          const [entityTypeId, ...keyParts] = selectedInstanceKey.split(':');
          const instanceKey = keyParts.join(':');
          const nodeId = instanceNodeId(entityTypeId, instanceKey);
          const node = cy.getElementById(nodeId);
          if (node.length) {
            node.select();
            const connectedEdges = node.connectedEdges();
            const connectedNodes = connectedEdges.connectedNodes();
            cy.elements().addClass('dimmed');
            node.removeClass('dimmed');
            connectedEdges.removeClass('dimmed');
            connectedNodes.removeClass('dimmed');
          }
        }
      } catch { /* ignore */ }
      return;
    }

    // If focus mode is active, let the focus effect manage dimming
    if (focusNodeIdRef.current !== null) {
      // Just update selection highlight without touching dimmed
      try {
        cy.elements().unselect();
        if (selectedEntityId) cy.getElementById(selectedEntityId).select();
        if (selectedRelationshipId) cy.getElementById(selectedRelationshipId).select();
      } catch { /* ignore */ }
      return;
    }

    try {
      cy.elements().removeClass('highlighted dimmed');
      cy.elements().unselect();

      if (selectedEntityId) {
        const node = cy.getElementById(selectedEntityId);
        node.select();
        
        // Highlight connected edges and nodes
        const connectedEdges = node.connectedEdges();
        const connectedNodes = connectedEdges.connectedNodes();
        
        cy.elements().addClass('dimmed');
        node.removeClass('dimmed');
        connectedEdges.removeClass('dimmed');
        connectedNodes.removeClass('dimmed');
      }

      if (selectedRelationshipId) {
        const edge = cy.getElementById(selectedRelationshipId);
        edge.select();
        
        const connectedNodes = edge.connectedNodes();
        
        cy.elements().addClass('dimmed');
        edge.removeClass('dimmed');
        connectedNodes.removeClass('dimmed');
      }
    } catch {
      // Graph may have been destroyed
    }
  }, [selectedEntityId, selectedRelationshipId, graphViewMode, selectedInstanceKey, getCy]);

  // Handle highlights from queries
  useEffect(() => {
    const cy = getCy();
    if (!cy) return;

    try {
      // Clear previous highlights and restore theme line colors on previously-highlighted edges
      cy.$('edge.highlighted').style({
        'line-color': themeColors.edgeColor,
        'target-arrow-color': themeColors.edgeColor,
      });
      cy.elements().removeClass('highlighted');

      highlightedEntities.forEach(id => {
        cy.getElementById(id).addClass('highlighted');
      });

      highlightedRelationships.forEach(id => {
        const el = cy.getElementById(id);
        el.addClass('highlighted');
        // Force bypass so it overrides any theme update residue
        el.style({ 'line-color': '#FFB900', 'target-arrow-color': '#FFB900' });
      });
    } catch {
      // Graph may have been destroyed
    }
  }, [highlightedEntities, highlightedRelationships, themeColors, getCy]);

  // Graph controls
  const handleZoomIn = () => {
    const cy = getCy();
    if (cy) {
      try {
        cy.zoom(cy.zoom() * 1.3);
        cy.center();
      } catch { /* ignore */ }
    }
  };

  const handleZoomOut = () => {
    const cy = getCy();
    if (cy) {
      try {
        cy.zoom(cy.zoom() / 1.3);
        cy.center();
      } catch { /* ignore */ }
    }
  };

  const handleFit = () => {
    const cy = getCy();
    if (cy) {
      try {
        cy.fit(undefined, 60);
      } catch { /* ignore */ }
    }
  };

  const handleReset = () => {
    const cy = getCy();
    if (cy) {
      try {
         
        cy.layout({
          name: 'fcose',
          quality: 'proof',
          randomize: true,
          animate: true,
          animationDuration: 500,
          fit: true,
          padding: 60,
          nodeDimensionsIncludeLabels: true,
          nodeRepulsion: () => 15000,
          idealEdgeLength: () => 200,
          nodeSeparation: 100
        } as unknown as Parameters<Core['layout']>[0]).run();
      } catch { /* ignore */ }
    }
  };

  const handleDownload = () => {
    const cy = getCy();
    if (!cy) return;
    try {
      const graphCs = containerRef.current ? getComputedStyle(containerRef.current) : null;
      const bg = (graphCs && graphCs.getPropertyValue('--graph-bg').trim()) || (darkMode ? '#1E1E1E' : '#F5F5F5');
      const pngData = cy.png({ scale: 2, full: true, bg });
      const link = document.createElement('a');
      link.href = pngData;
      const safeName = (currentOntology.name || 'ontology').toLowerCase().replace(/\s+/g, '-');
      link.download = `${safeName}-graph.png`;
      link.click();
    } catch { /* ignore */ }
  };

  return (
    <div className="graph-container">
      <div ref={containerRef} className="graph-canvas" data-testid="ontology-graph-canvas" />

      {focusNodeId && (
        <div className="graph-focus-badge">
          <Crosshair size={13} />
          <span>Focus mode</span>
          <button
            className="graph-focus-exit"
            onClick={() => {
              setFocusNodeId(null);
              const cy = getCy();
              if (cy) cy.elements().removeClass('dimmed');
            }}
          >
            Click background or ✕ to exit
          </button>
        </div>
      )}
      
      <div className="graph-view-toggle">
        <button
          className={`graph-view-btn ${graphViewMode === 'schema' ? 'active' : ''}`}
          onClick={() => setGraphViewMode('schema')}
          title="Schema view — entity types and relationship types"
        >
          <Share2 size={15} />
          <span>Schema</span>
        </button>
        <button
          className={`graph-view-btn ${graphViewMode === 'instance' ? 'active' : ''}`}
          onClick={() => setGraphViewMode('instance')}
          title="Instance view — actual records and their links"
          disabled={entityInstances.length === 0}
        >
          <Boxes size={15} />
          <span>Instances</span>
          {entityInstances.length > 0 && (
            <span className="graph-view-count">{entityInstances.length}</span>
          )}
        </button>
      </div>

      <div className="graph-controls">
        <button className="graph-control-btn" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn size={18} />
        </button>
        <button className="graph-control-btn" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut size={18} />
        </button>
        <button className="graph-control-btn" onClick={handleFit} title="Fit to View">
          <Maximize2 size={18} />
        </button>
        <button className="graph-control-btn" onClick={handleReset} title="Reset Layout">
          <RotateCcw size={18} />
        </button>
        <button className="graph-control-btn" onClick={handleDownload} title="Download Graph as PNG" data-testid="download-ontology-png">
          <Download size={18} />
        </button>
      </div>

      <div className="graph-legend">
        <div className="legend-title">
          {graphViewMode === 'instance' ? 'Instances by Entity' : 'Entity Types'}
        </div>
        {currentOntology.entityTypes.map(entity => {
          const count = graphViewMode === 'instance'
            ? entityInstances.filter(i => i.entityTypeId === entity.id).length
            : 0;
          return (
            <div key={entity.id} className="legend-item">
              <div className="legend-dot" style={{ backgroundColor: entity.color }} />
              <span>{entity.icon} {entity.name}</span>
              {graphViewMode === 'instance' && count > 0 && (
                <span className="legend-count">{count}</span>
              )}
            </div>
          );
        })}
        {graphViewMode === 'instance' && entityInstances.length === 0 && (
          <div className="legend-empty">No instance data loaded for this ontology.</div>
        )}
      </div>
    </div>
  );
}
