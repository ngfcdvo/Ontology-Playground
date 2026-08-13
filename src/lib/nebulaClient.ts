/**
 * NebulaGraph 前端 API 客户端
 *
 * 通过后端 /api/graph/* 端点操作 NebulaGraph。
 */

import type { Ontology, EntityInstance, RelationshipInstance } from '../data/ontology';

const API_BASE = '/api/graph';

// ── 类型 ──

export interface NebulaConfig {
  host: string;
  port: string;
  user: string;
  space: string;
  consoleAvailable: boolean;
}

export interface SyncResult {
  success: boolean;
  steps: Array<{
    step: string;
    status: string;
    output?: string;
    error?: string;
    size?: number;
  }>;
  schemaNGQL: string;
  dataNGQL: string;
  vertexCount: number;
  edgeCount: number;
}

export interface ExecuteResult {
  success: boolean;
  executed: boolean;
  output?: string;
  error?: string;
  ngql?: string;
}

// ── 获取配置 ──
export async function getNebulaConfig(): Promise<NebulaConfig> {
  const resp = await fetch(`${API_BASE}/config`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ── 生成 Schema DDL ──
export async function generateSchemaNGQL(ontology: Ontology): Promise<{ ngql: string; message: string }> {
  const resp = await fetch(`${API_BASE}/schema`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ontology }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 生成 Data DML ──
export async function generateDataNGQL(
  ontology: Ontology,
  entityInstances: EntityInstance[],
  relationshipInstances: RelationshipInstance[],
): Promise<{ ngql: string; vertexCount: number; edgeCount: number }> {
  const resp = await fetch(`${API_BASE}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ontology, entityInstances, relationshipInstances }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 执行 nGQL ──
export async function executeNGQL(ngql: string): Promise<ExecuteResult> {
  const resp = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ngql }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 一键同步（Schema + Data 生成 + 执行） ──
export async function syncToNebula(
  ontology: Ontology,
  entityInstances: EntityInstance[],
  relationshipInstances: RelationshipInstance[],
): Promise<SyncResult> {
  const resp = await fetch(`${API_BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ontology, entityInstances, relationshipInstances }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 图查询 ──
export async function queryNebula(ngql: string): Promise<ExecuteResult> {
  const resp = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ngql }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}
