/**
 * Doris 数据获取客户端
 *
 * 前端通过这个模块调用后端 /api 接口，后端再查 Doris。
 * Dev 模式下 Vite proxy 自动转发到 localhost:3001。
 * 生产部署后由 Nginx/反向代理转发。
 */

import type { EntityInstance, RelationshipInstance, DataBinding, EntityType, Relationship } from '../data/ontology';

const API_BASE = '/api';
const DEFAULT_LIMIT = 200;

// ── 类型 ──
export interface DorisQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  sql?: string;
}

export interface EntityFetchParams {
  table: string;
  columns: Record<string, string>;
  limit?: number;
  filter?: Record<string, string | number>;
}

export interface LoadInstancesOptions {
  entityTypes: EntityType[];
  relationships: Relationship[];
  bindings: DataBinding[];
  limitPerEntity?: number;
}

export interface LoadInstancesResult {
  entityInstances: EntityInstance[];
  relationshipInstances: RelationshipInstance[];
  errors: Array<{ entityTypeId: string; error: string }>;
  truncated: string[];
}

// ── 健康检查 ──
export async function checkDorisHealth(): Promise<{
  status: 'ok' | 'error';
  message?: string;
  doris?: { host: string; port: number; database: string };
}> {
  try {
    const resp = await fetch(`${API_BASE}/health`);
    return await resp.json();
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

// ── 通用 SQL 查询 ──
export async function executeDorisQuery(sql: string, limit?: number): Promise<DorisQueryResult> {
  const resp = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limit }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 按实体类型拉取数据 ──
export async function fetchEntityData(params: EntityFetchParams): Promise<DorisQueryResult> {
  const resp = await fetch(`${API_BASE}/entity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table: params.table,
      columns: params.columns,
      limit: params.limit ?? DEFAULT_LIMIT,
      filter: params.filter,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 获取表结构 ──
export async function fetchTableSchema(table: string): Promise<{
  columns: Array<{ Field: string; Type: string; Null: string; Key: string; Default: string | null }>;
}> {
  const resp = await fetch(`${API_BASE}/schema/${encodeURIComponent(table)}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── 高层：根据 Ontology + DataBinding 从 Doris 加载实例 ──
export async function loadInstancesFromDoris(opts: LoadInstancesOptions): Promise<LoadInstancesResult> {
  const { entityTypes, relationships, bindings, limitPerEntity = DEFAULT_LIMIT } = opts;

  const bindingMap = new Map(bindings.map(b => [b.entityTypeId, b]));
  const entityMap = new Map(entityTypes.map(e => [e.id, e]));

  const entityInstances: EntityInstance[] = [];
  const errors: LoadInstancesResult['errors'] = [];
  const truncated: string[] = [];

  // 1. 并行拉取所有实体数据
  const fetchPromises = entityTypes.map(async (et) => {
    const binding = bindingMap.get(et.id);
    if (!binding) return;

    try {
      const result = await fetchEntityData({
        table: binding.table,
        columns: binding.columnMappings,
        limit: limitPerEntity,
      });

      if (result.truncated) truncated.push(et.id);

      const instances: EntityInstance[] = result.rows.map((row, idx) => ({
        id: `${et.id}-${idx}`,
        entityTypeId: et.id,
        values: row,
      }));

      return instances;
    } catch (err) {
      errors.push({ entityTypeId: et.id, error: (err as Error).message });
      return null;
    }
  });

  const results = await Promise.all(fetchPromises);
  for (const instances of results) {
    if (instances) entityInstances.push(...instances);
  }

  // 2. 构建关系实例
  const relationshipInstances = buildRelationshipInstances(
    relationships,
    entityInstances,
    entityMap,
    bindingMap,
  );

  return { entityInstances, relationshipInstances, errors, truncated };
}

// ── 根据实体实例构建关系实例（基于外键匹配） ──
function buildRelationshipInstances(
  relationships: Relationship[],
  instances: EntityInstance[],
  entityMap: Map<string, EntityType>,
  _bindingMap: Map<string, DataBinding>,
): RelationshipInstance[] {
  const result: RelationshipInstance[] = [];

  // 按实体类型分组
  const instancesByType = new Map<string, EntityInstance[]>();
  for (const inst of instances) {
    const list = instancesByType.get(inst.entityTypeId) ?? [];
    list.push(inst);
    instancesByType.set(inst.entityTypeId, list);
  }

  function getIdentifierProp(entityTypeId: string): string | null {
    const et = entityMap.get(entityTypeId);
    if (!et) return null;
    const idProp = et.properties.find(p => p.isIdentifier);
    return idProp?.name ?? et.properties[0]?.name ?? null;
  }

  /** 构建复合连接键 */
  function buildJoinKey(inst: EntityInstance, props: string[]): string {
    return props.map(p => String(inst.values[p] ?? '')).join('\u0001');
  }

  for (const rel of relationships) {
    // 获取连接列：优先使用 joinFrom/joinTo，回退到标识符
    const fromIdProp = getIdentifierProp(rel.from);
    const toIdProp = getIdentifierProp(rel.to);
    if (!fromIdProp || !toIdProp) continue;

    const joinFromProps = rel.joinFrom?.length ? rel.joinFrom : [fromIdProp];
    const joinToProps = rel.joinTo?.length ? rel.joinTo : [toIdProp];

    const fromInstances = instancesByType.get(rel.from) ?? [];
    const toInstances = instancesByType.get(rel.to) ?? [];

    // 构建 to 实体的连接键索引: joinKey → instances
    const toIndex = new Map<string, EntityInstance[]>();
    for (const ti of toInstances) {
      const jk = buildJoinKey(ti, joinToProps);
      if (!jk || jk.includes('')) continue; // 跳过有空值的键
      const list = toIndex.get(jk) ?? [];
      list.push(ti);
      toIndex.set(jk, list);
    }

    let matchCount = 0;
    for (const fi of fromInstances) {
      const jk = buildJoinKey(fi, joinFromProps);
      if (!jk || jk.includes('')) continue;

      const matched = toIndex.get(jk);
      if (matched) {
        for (const mi of matched) {
          // sourceKey/targetKey 存储标识符值，用于节点查找
          result.push({
            id: `${rel.id}-${matchCount}`,
            relationshipId: rel.id,
            sourceKey: String(fi.values[fromIdProp] ?? ''),
            targetKey: String(mi.values[toIdProp] ?? ''),
          });
          matchCount++;
        }
      }
    }
  }

  return result;
}
