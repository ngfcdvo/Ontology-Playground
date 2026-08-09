import { describe, expect, it } from 'vitest';
import { processQuery } from './queryEngine';
import type { Ontology, EntityInstance, RelationshipInstance } from './ontology';
// import { cosmicCoffeeOntology, sampleInstances, sampleRelationshipInstances } from './ontology';

const testOntology: Ontology = {
  name: 'Incident Management Ontology',
  description: 'Test ontology for query handling.',
  entityTypes: [
    {
      id: 'service',
      name: 'Service',
      description: 'Business or IT service being disrupted.',
      icon: '⚙️',
      color: '#E74C3C',
      properties: [
        { name: 'serviceId', type: 'string', isIdentifier: true },
        { name: 'name', type: 'string' },
      ],
    },
    {
      id: 'configurationitem',
      name: 'ConfigurationItem',
      description: 'Underlying asset or component causing the incident.',
      icon: '🧩',
      color: '#00A9E0',
      properties: [
        { name: 'ciId', type: 'string', isIdentifier: true },
        { name: 'name', type: 'string' },
      ],
    },
    {
      id: 'problem',
      name: 'Problem',
      description: 'Known error or root cause for recurring incidents.',
      icon: '⚡',
      color: '#FFB900',
      properties: [
        { name: 'problemId', type: 'string', isIdentifier: true },
        { name: 'title', type: 'string' },
      ],
    },
  ],
  relationships: [
    {
      id: 'service_supported_by_configuration_item',
      name: 'is supported by',
      from: 'service',
      to: 'configurationitem',
      cardinality: 'one-to-many',
      description: 'Service is supported by Configuration Item',
    },
  ],
};

describe('processQuery', () => {
  it('answers definition-style entity questions', () => {
    const response = processQuery('What is a Problem?', testOntology);

    expect(response.interpretation).toContain('definition query for Problem');
    expect(response.result).toContain('**Problem**');
    expect(response.result).toContain('Known error or root cause for recurring incidents.');
    expect(response.highlightEntities).toEqual(['problem']);
  });

  it('does not duplicate ontology wording in fallback text', () => {
    const response = processQuery('Completely unknown question', testOntology);

    expect(response.result).toContain('for **Incident Management Ontology**.');
    expect(response.result).not.toContain('Ontology** ontology');
  });

  it('answers relationship-name connection queries', () => {
    const response = processQuery('Show me all is supported by connections', testOntology);

    expect(response.interpretation).toContain('relationship-name query for is supported by');
    expect(response.result).toContain('connects **Service** to **ConfigurationItem**');
    expect(response.highlightRelationships).toEqual(['service_supported_by_configuration_item']);
  });
});

describe('processQuery with instance data', () => {
  const testInstances: EntityInstance[] = [
    { id: 'svc-1', entityTypeId: 'service', values: { serviceId: 'SVC-1', name: 'Web App' } },
    { id: 'ci-1', entityTypeId: 'configurationitem', values: { ciId: 'CI-1', name: 'Server A' } },
  ];
  const testRelInstances: RelationshipInstance[] = [
    { id: 'ri-1', relationshipId: 'service_supported_by_configuration_item', sourceKey: 'SVC-1', targetKey: 'CI-1' },
  ];

  it('returns actual instance records for entity listing queries', () => {
    const response = processQuery('Show me all services', testOntology, {
      entityInstances: testInstances,
      relationshipInstances: [],
    });

    expect(response.interpretation).toContain('query for Service');
    expect(response.result).toContain('1 Service record(s)');
    expect(response.result).toContain('SVC-1');
    expect(response.result).toContain('Web App');
    expect(response.result).not.toContain('In a real deployment');
  });

  it('falls back gracefully when no instances are available', () => {
    const response = processQuery('Show me all services', testOntology);

    expect(response.result).toContain('No sample service instances loaded');
    expect(response.result).toContain('In a real deployment');
  });

  it('returns actual relationship links for relationship-name queries', () => {
    const response = processQuery('Show me all is supported by connections', testOntology, {
      entityInstances: testInstances,
      relationshipInstances: testRelInstances,
    });

    expect(response.result).toContain('1 link(s)');
    expect(response.result).toContain('Web App');
    expect(response.result).toContain('Server A');
  });

  it('returns actual count for counting queries', () => {
    const response = processQuery('How many services?', testOntology, {
      entityInstances: testInstances,
      relationshipInstances: [],
    });

    expect(response.result).toContain('**1** Service record(s)');
    expect(response.result).not.toContain('In production');
  });
});

describe('processQuery instance-filter queries (Fourth Coffee)', () => {
  it('finds orders for a customer by name', () => {
    const response = processQuery('Show orders for Arif', cosmicCoffeeOntology, {
      entityInstances: sampleInstances,
      relationshipInstances: sampleRelationshipInstances,
    });

    expect(response.interpretation).toContain('instance-filter query');
    expect(response.interpretation).toContain('Customer');
    expect(response.interpretation).toContain('arif');
    // Should mention the order that Arif placed
    expect(response.result).toContain('ORD-2025-001');
    // Should mention the relationship "places"
    expect(response.result.toLowerCase()).toContain('places');
  });

  it('finds products in a specific order by id', () => {
    const response = processQuery('What products in ORD-2025-001', cosmicCoffeeOntology, {
      entityInstances: sampleInstances,
      relationshipInstances: sampleRelationshipInstances,
    });

    expect(response.interpretation).toContain('Order');
    expect(response.interpretation).toContain('ord-2025-001');
    // ORD-2025-001 contains PROD-001 and PROD-002
    expect(response.result).toContain('PROD-001');
    expect(response.result).toContain('PROD-002');
  });

  it('finds supplier of a product by id', () => {
    const response = processQuery('Show supplier of PROD-001', cosmicCoffeeOntology, {
      entityInstances: sampleInstances,
      relationshipInstances: sampleRelationshipInstances,
    });

    expect(response.interpretation).toContain('Product');
    // PROD-001 is sourced from SUPP-001
    expect(response.result).toContain('SUPP-001');
  });

  it('returns no-match message for unknown instance value', () => {
    const response = processQuery('Show orders for nonexistent', cosmicCoffeeOntology, {
      entityInstances: sampleInstances,
      relationshipInstances: sampleRelationshipInstances,
    });

    expect(response.result).toContain('No');
    expect(response.result).toContain('nonexistent');
  });
});
