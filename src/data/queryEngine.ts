import type { Ontology, EntityInstance, RelationshipInstance, EntityType } from './ontology';
import { nlQueryResponses } from './quests';

export interface QueryResponse {
  query: string;
  result: string;
  highlightEntities: string[];
  highlightRelationships: string[];
  interpretation?: string;
}

export interface QueryContext {
  entityInstances?: EntityInstance[];
  relationshipInstances?: RelationshipInstance[];
}

function stripLeadingArticle(text: string): string {
  return text.replace(/^(a|an|the)\s+/, '').trim();
}

function singularize(text: string): string {
  return text.endsWith('s') ? text.slice(0, -1) : text;
}

function matchesDemoQuery(normalizedQuery: string, demoQuery: string, matches: string[]): boolean {
  return normalizedQuery === demoQuery || matches.some(match => normalizedQuery.includes(match));
}

// Generate dynamic query suggestions based on the current ontology
export function generateQuerySuggestions(ontology: Ontology): string[] {
  const suggestions: string[] = [];
  const entities = ontology.entityTypes;
  const relationships = ontology.relationships;

  // Entity-based queries
  if (entities.length > 0) {
    const firstEntity = entities[0];
    suggestions.push(`Show me all ${firstEntity.name.toLowerCase()}s`);
    
    if (entities.length > 1) {
      const secondEntity = entities[1];
      suggestions.push(`List all ${secondEntity.name.toLowerCase()}s`);
    }
  }

  // Property-based queries
  entities.forEach(entity => {
    entity.properties.forEach(prop => {
      if (prop.type === 'string' && !prop.isIdentifier && prop.name !== 'name') {
        suggestions.push(`Show ${entity.name.toLowerCase()}s by ${prop.name}`);
      }
    });
  });

  // Relationship-based queries
  if (relationships.length > 0) {
    const rel = relationships[0];
    const fromEntity = entities.find(e => e.id === rel.from);
    const toEntity = entities.find(e => e.id === rel.to);
    if (fromEntity && toEntity) {
      suggestions.push(`How does ${fromEntity.name} connect to ${toEntity.name}?`);
    }
  }

  // Conceptual queries always available
  suggestions.push("What is an entity type?");
  suggestions.push("What is a relationship?");
  suggestions.push("How does ontology work?");

  // Return unique suggestions (max 6)
  return [...new Set(suggestions)].slice(0, 6);
}

// ── Instance-data helpers ──────────────────────────────────────────────────

/** Find the identifier property name of an entity type (falls back to first property). */
function identifierPropOf(entity: EntityType): string | undefined {
  return (entity.properties.find(p => p.isIdentifier) ?? entity.properties[0])?.name;
}

/** Format a set of entity instances as a markdown-style table for query results. */
function formatInstanceTable(
  entity: EntityType,
  instances: EntityInstance[],
  maxRows = 10,
): string {
  if (instances.length === 0) {
    return `_No ${entity.name.toLowerCase()} records found in the sample data._`;
  }
  const props = entity.properties.slice(0, 5);
  const header = `| ${props.map(p => p.name).join(' | ')} |`;
  const separator = `| ${props.map(() => '---').join(' | ')} |`;
  const rows = instances.slice(0, maxRows).map(inst => {
    const cells = props.map(p => {
      const v = inst.values[p.name];
      if (v === undefined || v === null) return '';
      return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    });
    return `| ${cells.join(' | ')} |`;
  });
  const truncated = instances.length > maxRows
    ? `\n\n_...and ${instances.length - maxRows} more._`
    : '';
  return `${header}\n${separator}\n${rows.join('\n')}${truncated}`;
}

/** Find identifier value of an entity instance (by entity type's identifier prop). */
function instanceKey(entity: EntityType, inst: EntityInstance): string {
  const idProp = identifierPropOf(entity);
  return idProp ? String(inst.values[idProp] ?? '') : inst.id;
}

/** Pick a human-readable label for an instance (prefer non-id string values, fall back to key). */
function instanceLabel(entity: EntityType, inst: EntityInstance, fallbackKey: string): string {
  const idProp = identifierPropOf(entity);
  for (const [name, v] of Object.entries(inst.values)) {
    if (typeof v === 'string' && v.length > 1 && name !== idProp) {
      return v;
    }
  }
  return fallbackKey;
}

/** Format relationship instances between two entity types as a readable list. */
function formatRelationshipLinks(
  fromEntity: EntityType,
  toEntity: EntityType,
  fromInstances: EntityInstance[],
  toInstances: EntityInstance[],
  relInstances: RelationshipInstance[],
  relName: string,
  maxRows = 10,
): string {
  if (relInstances.length === 0) {
    return `_No "${relName}" links found in the sample data._`;
  }
  const fromByKey = new Map(fromInstances.map(i => [instanceKey(fromEntity, i), i]));
  const toByKey = new Map(toInstances.map(i => [instanceKey(toEntity, i), i]));

  const rows = relInstances.slice(0, maxRows).map(ri => {
    const src = fromByKey.get(ri.sourceKey);
    const tgt = toByKey.get(ri.targetKey);
    const srcLabel = src ? instanceLabel(fromEntity, src, ri.sourceKey) : ri.sourceKey;
    const tgtLabel = tgt ? instanceLabel(toEntity, tgt, ri.targetKey) : ri.targetKey;
    const attrs = ri.values
      ? ` (${Object.entries(ri.values).map(([k, v]) => `${k}=${v}`).join(', ')})`
      : '';
    return `• **${srcLabel}** → ${relName} → **${tgtLabel}**${attrs}`;
  });
  const truncated = relInstances.length > maxRows
    ? `\n\n_...and ${relInstances.length - maxRows} more._`
    : '';
  return `${rows.join('\n')}${truncated}`;
}

/**
 * Detect instance-filter queries like:
 *   "Show orders for Arif" / "orders for CUST-001"
 *   "What products in ORD-2025-001" / "products in ORD-2025-001"
 *   "Which customer placed ORD-2025-001" / "who placed ORD-2025-001"
 *   "supplier of PROD-001" / "suppliers for PROD-001"
 *
 * Returns the target entity type, the filter value (lowercased string), and
 * optionally a relationship keyword if the query mentions a relationship name
 * (e.g. "placed", "contains", "from", "sourced").
 */
function matchInstanceFilterQuery(
  normalized: string,
  entities: EntityType[],
  entityInstances: EntityInstance[],
): { targetEntity: EntityType; filterValue: string; relKeyword?: string } | null {
  // Collect all known instance string values (lowercased) → entity type.
  const valueToEntity = new Map<string, EntityType>();
  for (const inst of entityInstances) {
    const entity = entities.find(e => e.id === inst.entityTypeId);
    if (!entity) continue;
    for (const v of Object.values(inst.values)) {
      if (typeof v === 'string' && v.trim().length > 1) {
        valueToEntity.set(v.toLowerCase(), entity);
      }
    }
  }

  // Patterns: "for <value>", "in <value>", "of <value>", "by <value>", "from <value>"
  // Also "who <rel> <value>", "which <entity> <rel> <value>"
  const prepositions = ['for', 'in', 'of', 'by', 'from'];
  const words = normalized.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (prepositions.includes(word) && i + 1 < words.length) {
      // The filter value could be multi-word (e.g. "Arif Ramadhan"), so
      // try progressively longer suffixes starting from the next word.
      const remaining = words.slice(i + 1).join(' ');
      // Strip trailing punctuation
      const candidate = remaining.replace(/[?!.]+$/g, '').trim();
      if (!candidate) continue;

      // Try exact match first, then progressively shorter prefixes (for
      // multi-word names followed by extra words).
      const candidates = [candidate];
      for (let end = candidate.length - 1; end > 1; end--) {
        const sub = candidate.slice(0, end).replace(/[\s-]+$/g, '').trim();
        if (sub.length > 1) candidates.push(sub);
      }

      for (const c of candidates) {
        const entity = valueToEntity.get(c.toLowerCase());
        if (entity) {
          // Check if there's a relationship keyword before the preposition.
          // e.g. "orders placed for Arif" → keyword "placed"
          let relKeyword: string | undefined;
          if (i >= 2) {
            const beforePrep = words.slice(Math.max(0, i - 3), i).join(' ');
            // Match against relationship names (normalized: remove spaces)
            for (const e of entities) {
              // no relationship list here; we'll just capture the word before
            }
            // Simpler: grab the word immediately before the preposition
            const prev = words[i - 1];
            if (prev && prev.length > 2 && !['show', 'list', 'what', 'which', 'all', 'the', 'a', 'an'].includes(prev)) {
              relKeyword = prev.replace(/[^a-z]/g, '');
            }
          }
          return { targetEntity: entity, filterValue: c.toLowerCase(), relKeyword };
        }
      }
    }
  }

  // Also handle "who placed <value>" / "which customer placed <value>"
  // where the verb comes before the value without a preposition.
  // e.g. "who placed ORD-2025-001"
  const verbMatch = normalized.match(/(?:who|which)\s+(\w+)\s+(.+)/);
  if (verbMatch) {
    const verb = verbMatch[1];
    const value = verbMatch[2].replace(/[?!.]+$/g, '').trim();
    const entity = valueToEntity.get(value.toLowerCase());
    if (entity) {
      return { targetEntity: entity, filterValue: value.toLowerCase(), relKeyword: verb };
    }
  }

  return null;
}


// Process a natural language query against the ontology
export function processQuery(query: string, ontology: Ontology, context?: QueryContext): QueryResponse {
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedNoPunctuation = normalizedQuery.replace(/[?!.:,;]+/g, '').trim();
  const entities = ontology.entityTypes;
  const relationships = ontology.relationships;
  const entityInstances = context?.entityInstances ?? [];
  const relationshipInstances = context?.relationshipInstances ?? [];

  if (ontology.name === 'Fourth Coffee') {
    const demoResponse = nlQueryResponses.find(response =>
      matchesDemoQuery(normalizedNoPunctuation, response.query, response.matches)
    );

    if (demoResponse) {
      return {
        query,
        result: demoResponse.result,
        highlightEntities: demoResponse.highlightEntities,
        highlightRelationships: demoResponse.highlightRelationships,
        interpretation: 'Detected: Fourth Coffee sample query'
      };
    }
  }

  // Conceptual queries (work for any ontology)
  if (normalizedQuery.includes('what is') && (normalizedQuery.includes('entity') || normalizedQuery.includes('ontology'))) {
    return {
      query,
      result: "An **Entity Type** is a reusable logical model of a real-world concept (like Customer, Product, or Order). In the Fabric IQ Ontology, entity types standardize:\n\n• **Name & Description** - Common terminology\n• **Properties** - Attributes with types and units\n• **Identifier** - Unique key for each instance\n\nEntity types ensure everyone in your organization uses consistent definitions.",
      highlightEntities: entities.slice(0, 2).map(e => e.id),
      highlightRelationships: [],
      interpretation: "Detected: conceptual question about entity types"
    };
  }

  if (normalizedQuery.includes('what is') && normalizedQuery.includes('relationship')) {
    return {
      query,
      result: "A **Relationship** is a typed, directional link between entity types. Relationships define:\n\n• **Name** - Action verb (e.g., 'places', 'contains')\n• **Direction** - From one entity to another\n• **Cardinality** - One-to-one, one-to-many, etc.\n• **Attributes** - Optional properties on the connection\n\nRelationships let you traverse the ontology to answer complex questions.",
      highlightEntities: [],
      highlightRelationships: relationships.slice(0, 2).map(r => r.id),
      interpretation: "Detected: conceptual question about relationships"
    };
  }

  if (normalizedQuery.includes('how') && (normalizedQuery.includes('ontology') || normalizedQuery.includes('work'))) {
    return {
      query,
      result: `The **${ontology.name}** ontology has:\n\n• **${entities.length} Entity Types** - ${entities.map(e => e.name).join(', ')}\n• **${relationships.length} Relationships** - Connecting entities together\n\nThe ontology acts as a semantic layer that binds to your data platform sources, enabling natural language queries that understand your business concepts.`,
      highlightEntities: entities.map(e => e.id),
      highlightRelationships: [],
      interpretation: "Detected: question about ontology structure"
    };
  }

  // Entity definition queries: "What is a Customer?"
  if (normalizedNoPunctuation.startsWith('what is ')) {
    const subjectRaw = normalizedNoPunctuation.slice('what is '.length).trim();
    const subject = stripLeadingArticle(subjectRaw);

    for (const entity of entities) {
      const entityNameLower = entity.name.toLowerCase();
      const entityNameSingular = entityNameLower.endsWith('s') ? entityNameLower.slice(0, -1) : entityNameLower;

      if (
        subject === entityNameLower ||
        subject === entityNameSingular ||
        singularize(subject) === entityNameSingular
      ) {
        const propList = entity.properties
          .slice(0, 4)
          .map(p => `• **${p.name}** (${p.type})${p.isIdentifier ? ' 🔑' : ''}`)
          .join('\n');

        return {
          query,
          result: `**${entity.name}** ${entity.icon}\n${entity.description}\n\n**Properties:**\n${propList}`,
          highlightEntities: [entity.id],
          highlightRelationships: [],
          interpretation: `Detected: definition query for ${entity.name}`
        };
      }
    }
  }

  // Entity listing queries — return actual instance data when available
  for (const entity of entities) {
    const entityNameLower = entity.name.toLowerCase();
    const entityNamePlural = entityNameLower + 's';
    
    if (
      normalizedQuery.includes(`show me all ${entityNameLower}`) ||
      normalizedQuery.includes(`show me all ${entityNamePlural}`) ||
      normalizedQuery.includes(`list all ${entityNameLower}`) ||
      normalizedQuery.includes(`list all ${entityNamePlural}`) ||
      normalizedQuery.includes(`show ${entityNamePlural}`) ||
      normalizedQuery.includes(`list ${entityNamePlural}`)
    ) {
      const matched = entityInstances.filter(i => i.entityTypeId === entity.id);
      const table = formatInstanceTable(entity, matched);
      const summary = matched.length > 0
        ? `**${matched.length} ${entity.name} record(s):**\n\n${table}`
        : `**${entity.name}** ${entity.icon}\n${entity.description}\n\n_No sample ${entityNameLower} instances loaded. In a real deployment, this would query the data platform for actual ${entityNameLower} records._`;
      
      return {
        query,
        result: summary,
        highlightEntities: [entity.id],
        highlightRelationships: [],
        interpretation: `Detected: query for ${entity.name} entities`
      };
    }
  }

  // Instance-filtered queries: "Show orders for <value>", "What products in <value>",
  // "Which customer placed <value>", etc. — traverse relationship instances.
  if (entityInstances.length > 0 && relationshipInstances.length > 0) {
    const instanceMatch = matchInstanceFilterQuery(normalizedNoPunctuation, entities, entityInstances);
    if (instanceMatch) {
      const { targetEntity, filterValue, relKeyword } = instanceMatch;
      // Find relationships whose from or to is the target entity.
      const candidateRels = relationships.filter(r =>
        r.from === targetEntity.id || r.to === targetEntity.id
      );
      // Find the target instance(s) whose property value matches filterValue.
      const matchedTargetInstances = entityInstances.filter(
        i => i.entityTypeId === targetEntity.id &&
          Object.values(i.values).some(v => typeof v === 'string' && v.toLowerCase() === filterValue)
      );

      if (matchedTargetInstances.length === 0) {
        return {
          query,
          result: `No **${targetEntity.name}** record found matching "${filterValue}".`,
          highlightEntities: [targetEntity.id],
          highlightRelationships: [],
          interpretation: `Detected: instance-filter query, no match for "${filterValue}"`,
        };
      }

      // For each matched target instance, find connected instances via relationship instances.
      const lines: string[] = [];
      const relatedEntityIds = new Set<string>();
      const relatedRelIds = new Set<string>();
      for (const targetInst of matchedTargetInstances) {
        const targetKey = instanceKey(targetEntity, targetInst);
        const targetLabel = instanceLabel(targetEntity, targetInst, targetKey);
        lines.push(`**${targetLabel}** (${targetEntity.name}):`);

        for (const rel of candidateRels) {
          const isOutgoing = rel.from === targetEntity.id;
          const otherEntityId = isOutgoing ? rel.to : rel.from;
          const otherEntity = entities.find(e => e.id === otherEntityId);
          if (!otherEntity) continue;

          // If a relationship keyword (e.g. "placed", "contains", "from") was
          // detected, only follow relationships whose name matches it.
          if (relKeyword) {
            const relNameNorm = rel.name.toLowerCase().replace(/\s+/g, '');
            if (!relNameNorm.includes(relKeyword) && !relKeyword.includes(relNameNorm)) {
              continue;
            }
          }

          // Find relationship instances where the target is source (outgoing) or target (incoming).
          const matchedRis = relationshipInstances.filter(ri => {
            if (ri.relationshipId !== rel.id) return false;
            return isOutgoing ? ri.sourceKey === targetKey : ri.targetKey === targetKey;
          });

          if (matchedRis.length === 0) continue;

          relatedEntityIds.add(otherEntityId);
          relatedRelIds.add(rel.id);

          const otherInstances = entityInstances.filter(i => i.entityTypeId === otherEntityId);
          const otherByKey = new Map(otherInstances.map(i => [instanceKey(otherEntity, i), i]));

          for (const ri of matchedRis) {
            const otherKey = isOutgoing ? ri.targetKey : ri.sourceKey;
            const otherInst = otherByKey.get(otherKey);
            const otherLabel = otherInst
              ? instanceLabel(otherEntity, otherInst, otherKey)
              : otherKey;
            const attrs = ri.values
              ? ` (${Object.entries(ri.values).map(([k, v]) => `${k}=${v}`).join(', ')})`
              : '';
            const arrow = isOutgoing ? '→' : '←';
            lines.push(`  ${arrow} **${rel.name}** → ${otherEntity.icon} ${otherLabel}${attrs}`);
          }
        }
      }

      const header = `**${matchedTargetInstances.length} ${targetEntity.name}(s) matched "${filterValue}":**\n\n`;
      return {
        query,
        result: header + lines.join('\n'),
        highlightEntities: [targetEntity.id, ...Array.from(relatedEntityIds)],
        highlightRelationships: Array.from(relatedRelIds),
        interpretation: `Detected: instance-filter query for ${targetEntity.name} = ${filterValue}`,
      };
    }
  }

  // Relationship-name connection queries — return actual relationship instances
  for (const rel of relationships) {
    const relationNameNormalized = rel.name.toLowerCase().trim().replace(/\s+/g, ' ');
    const fromEntity = entities.find(e => e.id === rel.from);
    const toEntity = entities.find(e => e.id === rel.to);

    if (
      normalizedNoPunctuation.includes(relationNameNormalized) &&
      (normalizedNoPunctuation.includes('connection') || normalizedNoPunctuation.includes('connections') || normalizedNoPunctuation.includes('relationship'))
    ) {
      const matchedRelInstances = relationshipInstances.filter(ri => ri.relationshipId === rel.id);
      const fromInstances = entityInstances.filter(i => i.entityTypeId === rel.from);
      const toInstances = entityInstances.filter(i => i.entityTypeId === rel.to);
      const links = (fromEntity && toEntity)
        ? formatRelationshipLinks(fromEntity, toEntity, fromInstances, toInstances, matchedRelInstances, rel.name)
        : '';
      const summary = matchedRelInstances.length > 0
        ? `**${rel.name}** connects **${fromEntity?.name ?? rel.from}** to **${toEntity?.name ?? rel.to}** (${rel.cardinality}).\n\n**${matchedRelInstances.length} link(s):**\n\n${links}`
        : `**${rel.name}** connects **${fromEntity?.name ?? rel.from}** to **${toEntity?.name ?? rel.to}** (${rel.cardinality}).${rel.description ? `\n\n${rel.description}` : ''}\n\n_No sample relationship instances loaded._`;

      return {
        query,
        result: summary,
        highlightEntities: [rel.from, rel.to],
        highlightRelationships: [rel.id],
        interpretation: `Detected: relationship-name query for ${rel.name}`
      };
    }
  }

  // Entity-connection queries ("how does X connect / relate") — return real links
  for (const entity of entities) {
    const entityNameLower = entity.name.toLowerCase();
    
    if (normalizedQuery.includes(`how does ${entityNameLower}`) || 
        normalizedQuery.includes(`${entityNameLower} connect`) ||
        normalizedQuery.includes(`${entityNameLower} relate`)) {
      
      const relatedRels = relationships.filter(r => r.from === entity.id || r.to === entity.id);
      
      if (relatedRels.length > 0) {
        const fromInstances = entityInstances.filter(i => i.entityTypeId === entity.id);
        const relBlocks = relatedRels.map(rel => {
          const isOutgoing = rel.from === entity.id;
          const otherEntityId = isOutgoing ? rel.to : rel.from;
          const otherEntity = entities.find(e => e.id === otherEntityId);
          const direction = isOutgoing ? '→' : '←';
          const otherInstances = entityInstances.filter(i => i.entityTypeId === otherEntityId);
          const matchedRis = relationshipInstances.filter(ri => ri.relationshipId === rel.id);
          const header = `• **${rel.name}** ${direction} ${otherEntity?.icon} ${otherEntity?.name} (${rel.cardinality}) — ${matchedRis.length} link(s)`;
          if (matchedRis.length === 0 || !otherEntity) return header;
          const links = isOutgoing
            ? formatRelationshipLinks(entity, otherEntity, fromInstances, otherInstances, matchedRis, rel.name)
            : formatRelationshipLinks(otherEntity, entity, otherInstances, fromInstances, matchedRis, rel.name);
          return `${header}\n  ${links.split('\n').join('\n  ')}`;
        }).join('\n');

        return {
          query,
          result: `**${entity.name}** ${entity.icon} has ${relatedRels.length} connection(s):\n\n${relBlocks}`,
          highlightEntities: [entity.id, ...relatedRels.map(r => r.from === entity.id ? r.to : r.from)],
          highlightRelationships: relatedRels.map(r => r.id),
          interpretation: `Detected: relationship query for ${entity.name}`
        };
      }
    }
  }

  // Property-based queries
  for (const entity of entities) {
    for (const prop of entity.properties) {
      if (normalizedQuery.includes(prop.name.toLowerCase()) && normalizedQuery.includes(entity.name.toLowerCase())) {
        return {
          query,
          result: `**${entity.name}.${prop.name}**\n\n• Type: ${prop.type}\n${prop.unit ? `• Unit: ${prop.unit}` : ''}\n${prop.isIdentifier ? '• This is the identifier property 🔑' : ''}\n${prop.description ? `• ${prop.description}` : ''}\n\n_In production, you could filter ${entity.name.toLowerCase()}s by this property._`,
          highlightEntities: [entity.id],
          highlightRelationships: [],
          interpretation: `Detected: property query for ${entity.name}.${prop.name}`
        };
      }
    }
  }

  // Counting queries — return actual instance counts when available
  if (normalizedQuery.includes('how many')) {
    for (const entity of entities) {
      if (normalizedQuery.includes(entity.name.toLowerCase())) {
        const count = entityInstances.filter(i => i.entityTypeId === entity.id).length;
        const summary = count > 0
          ? `**${count}** ${entity.name} record(s) in the sample data.`
          : `The ontology defines the **${entity.name}** entity type.\n\n_In production, this query would count actual ${entity.name.toLowerCase()} records from the data platform._\n\nExample: "SELECT COUNT(*) FROM ${entity.name.toLowerCase()}s"`;
        return {
          query,
          result: summary,
          highlightEntities: [entity.id],
          highlightRelationships: [],
          interpretation: `Detected: count query for ${entity.name}`
        };
      }
    }
  }

  // Schema overview query
  if (normalizedQuery.includes('entities') || normalizedQuery.includes('schema') || normalizedQuery.includes('overview')) {
    const entityList = entities.map(e => `• ${e.icon} **${e.name}** - ${e.description.slice(0, 50)}...`).join('\n');
    return {
      query,
      result: `**${ontology.name}** Schema Overview\n\n${entityList}\n\n**Total:** ${entities.length} entities, ${relationships.length} relationships`,
      highlightEntities: entities.map(e => e.id),
      highlightRelationships: [],
      interpretation: "Detected: schema overview request"
    };
  }

  // No match found - provide helpful suggestions
  const suggestions = generateQuerySuggestions(ontology).slice(0, 3);
  return {
    query,
    result: `I couldn't interpret "${query}" for **${ontology.name}**.\n\nTry asking:\n${suggestions.map(s => `• "${s}"`).join('\n')}\n\nOr click on graph elements to explore the ontology visually.`,
    highlightEntities: [],
    highlightRelationships: [],
    interpretation: undefined
  };
}
