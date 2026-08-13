/**
 * NebulaGraph 集成模块
 *
 * 功能:
 *  1. 从本体 schema 生成 nGQL DDL (CREATE SPACE / TAG / EDGE)
 *  2. 从实例数据生成 nGQL DML (INSERT VERTEX / EDGE)
 *  3. 通过 nebula-console 子进程执行 nGQL（可选）
 *  4. 图查询 (GET SUBGRAPH / GO / FETCH)
 *
 * 连接配置 (server/.env):
 *   NEBULA_HOST=127.0.0.1       (外部访问地址)
 *   NEBULA_DOCKER_HOST=graphd0   (Docker 网络内部地址)
 *   NEBULA_PORT=9669
 *   NEBULA_USER=root
 *   NEBULA_PASSWORD=nebula
 *   NEBULA_SPACE=ontology_playground
 *   NEBULA_CONSOLE_PATH=nebula-console
 *
 * 如果 nebula-console 不可用，API 仍返回生成的 nGQL 脚本供手动执行。
 */

import { spawn, execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── 配置 ──
const NEBULA_HOST = process.env.NEBULA_HOST || '127.0.0.1';
const NEBULA_DOCKER_HOST = process.env.NEBULA_DOCKER_HOST || 'graphd0';
const NEBULA_PORT = process.env.NEBULA_PORT || '9669';
const NEBULA_USER = process.env.NEBULA_USER || 'root';
const NEBULA_PASSWORD = process.env.NEBULA_PASSWORD || 'nebula';
const NEBULA_SPACE = process.env.NEBULA_SPACE || 'ontology_playground';
const NEBULA_CONSOLE_PATH = process.env.NEBULA_CONSOLE_PATH || 'nebula-console';
const NEBULA_DOCKER_CONSOLE = process.env.NEBULA_DOCKER_CONSOLE || 'nebula-console';

// ── 本体属性类型 → NebulaGraph 类型映射 ──
const TYPE_MAP = {
  string: 'string',
  integer: 'int64',
  decimal: 'double',
  double: 'double',
  date: 'string',
  datetime: 'string',
  boolean: 'bool',
  enum: 'string',
};

/** 转义 nGQL 字符串值 */
function escapeNGQLString(val) {
  if (val === null || val === undefined) return '""';
  const s = String(val);
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 格式化属性值用于 INSERT */
function formatNGQLValue(val, type) {
  if (val === null || val === undefined || val === '') return '""';
  const mapped = TYPE_MAP[type] || 'string';
  if (mapped === 'bool') {
    return val === true || val === 'true' || val === 1 ? 'true' : 'false';
  }
  if (mapped === 'int64' || mapped === 'double') {
    const n = Number(val);
    return isNaN(n) ? '0' : String(n);
  }
  return escapeNGQLString(val);
}

/** 清洗 ID 为合法 Nebula Vars */
function cleanVid(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
}

/** 构建点 VID: "entityTypeId:identifierValue" */
function buildVid(entityTypeId, identifierValue) {
  return `"${entityTypeId}::${cleanVid(identifierValue)}"`;
}

// ════════════════════════════════════════════════
//  nGQL 生成 — Schema DDL
// ════════════════════════════════════════════════

/**
 * 从本体定义生成 nGQL Schema DDL
 * @param {object} ontology - { entityTypes, relationships }
 * @returns {string} nGQL 脚本
 */
export function generateSchemaNGQL(ontology) {
  const lines = [];
  const spaceName = NEBULA_SPACE;

  lines.push(`-- NebulaGraph Schema DDL — 生成时间: ${new Date().toISOString()}`);
  lines.push('');

  // 1. 创建 Space（IF NOT EXISTS）
  lines.push(`CREATE SPACE IF NOT EXISTS \`${spaceName}\` (`);
  lines.push(`  vid_type = FIXED_STRING(256),`);
  lines.push(`  partition_num = 10,`);
  lines.push(`  replica_factor = 1`);
  lines.push(`);`);
  lines.push('');
  lines.push(`USE \`${spaceName}\`;`);
  lines.push('');

  // 2. 创建 Tag（实体类型）
  lines.push('-- ── Tag (实体类型) ──');
  for (const et of ontology.entityTypes) {
    const tagName = et.id.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`CREATE TAG IF NOT EXISTS \`${tagName}\` (`);
    const propLines = et.properties.map((p, i) => {
      const nebulaType = TYPE_MAP[p.dataType] || 'string';
      const nullable = p.isRequired ? 'NOT NULL' : '';  // NebulaGraph 默认允许 NULL
      const comma = i < et.properties.length - 1 ? ',' : '';
      return `  \`${p.name}\` ${nebulaType}${nullable ? ' ' + nullable : ''}${comma}`;
    });
    lines.push(...propLines);
    lines.push(`) COMMENT = "${et.name}";`);
    lines.push('');
  }

  // 3. 创建 Edge Type（关系类型）
  lines.push('-- ── Edge Type (关系) ──');
  for (const rel of ontology.relationships) {
    const edgeName = rel.id.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`CREATE EDGE IF NOT EXISTS \`${edgeName}\` (`);
    // 关系自身的属性（如果有）
    if (rel.attributes && rel.attributes.length > 0) {
      const attrLines = rel.attributes.map((a, i) => {
        const nebulaType = TYPE_MAP[a.dataType] || 'string';
        const comma = i < rel.attributes.length - 1 ? ',' : '';
        return `  \`${a.name}\` ${nebulaType}${comma}`;
      });
      lines.push(...attrLines);
    }
    // 添加 joinFrom/joinTo 作为边属性，方便追溯连接键
    if (rel.joinFrom && rel.joinFrom.length > 0) {
      const hasAttrs = rel.attributes && rel.attributes.length > 0;
      lines.push(`  \`_join_from\` string${hasAttrs ? ',' : ''}`);
    }
    lines.push(`) COMMENT = "${rel.name}";`);
    lines.push('');
  }

  // 4. 创建 Tag / Edge 索引（可选，加速查询）
  lines.push('-- ── 索引 ──');
  for (const et of ontology.entityTypes) {
    const tagName = et.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const idProp = et.properties.find(p => p.isIdentifier);
    if (idProp) {
      lines.push(`CREATE TAG INDEX IF NOT EXISTS \`idx_${tagName}_id\` ON \`${tagName}\` (\`${idProp.name}\`);`);
    }
  }
  lines.push('');

  // 5. 等 Schema 生效（注释说明，实际等待由调用方处理）
  lines.push('-- 等待 2 个心跳周期让 Schema 生效（调用方在执行 Data 前会 sleep）');

  return lines.join('\n');
}

// ════════════════════════════════════════════════
//  nGQL 生成 — Data DML (INSERT)
// ════════════════════════════════════════════════

/**
 * 从实例数据生成 nGQL DML (INSERT VERTEX / EDGE)
 * @param {object} ontology - { entityTypes, relationships }
 * @param {Array} entityInstances - [{ entityTypeId, values }]
 * @param {Array} relationshipInstances - [{ relationshipId, sourceKey, targetKey }]
 * @returns {string} nGQL 脚本
 */
export function generateDataNGQL(ontology, entityInstances, relationshipInstances) {
  const lines = [];
  const spaceName = NEBULA_SPACE;
  const entityMap = new Map(ontology.entityTypes.map(e => [e.id, e]));
  const relMap = new Map(ontology.relationships.map(r => [r.id, r]));

  lines.push(`-- NebulaGraph Data DML — 生成时间: ${new Date().toISOString()}`);
  lines.push(`USE \`${spaceName}\`;`);
  lines.push('');

  // ── INSERT VERTEX ──
  // 按实体类型分组批量插入
  const byType = new Map();
  for (const inst of entityInstances) {
    const list = byType.get(inst.entityTypeId) ?? [];
    list.push(inst);
    byType.set(inst.entityTypeId, list);
  }

  lines.push('-- ── INSERT VERTEX ──');
  for (const [entityTypeId, instances] of byType) {
    const et = entityMap.get(entityTypeId);
    if (!et) continue;
    const tagName = entityTypeId.replace(/[^a-zA-Z0-9_]/g, '_');
    const propNames = et.properties.map(p => `\`${p.name}\``).join(', ');
    const propTypes = et.properties.map(p => p.dataType);

    for (const inst of instances) {
      const idProp = et.properties.find(p => p.isIdentifier) ?? et.properties[0];
      const idValue = inst.values[idProp?.name];
      const vid = buildVid(entityTypeId, idValue);
      const values = et.properties.map((p, i) =>
        formatNGQLValue(inst.values[p.name], p.dataType)
      ).join(', ');
      lines.push(`INSERT VERTEX \`${tagName}\` (${propNames}) VALUES ${vid}: (${values});`);
    }
    lines.push('');
  }

  // ── INSERT EDGE ──
  lines.push('-- ── INSERT EDGE ──');
  let edgeCount = 0;
  for (const ri of relationshipInstances) {
    const rel = relMap.get(ri.relationshipId);
    if (!rel) continue;
    const edgeName = ri.relationshipId.replace(/[^a-zA-Z0-9_]/g, '_');

    const fromEt = entityMap.get(rel.from);
    const toEt = entityMap.get(rel.to);
    if (!fromEt || !toEt) continue;

    const fromIdProp = fromEt.properties.find(p => p.isIdentifier) ?? fromEt.properties[0];
    const toIdProp = toEt.properties.find(p => p.isIdentifier) ?? toEt.properties[0];

    const srcVid = buildVid(rel.from, ri.sourceKey);
    const tgtVid = buildVid(rel.to, ri.targetKey);
    const rank = edgeCount;

    // 包含 _join_from 属性
    if (rel.joinFrom && rel.joinFrom.length > 0) {
      const joinFromVal = escapeNGQLString(rel.joinFrom.join(','));
      lines.push(`INSERT EDGE \`${edgeName}\` (\`_join_from\`) VALUES ${srcVid}->${tgtVid}@${rank}: (${joinFromVal});`);
    } else {
      lines.push(`INSERT EDGE \`${edgeName}\` () VALUES ${srcVid}->${tgtVid}@${rank}: ();`);
    }
    edgeCount++;
  }

  lines.push('');
  lines.push(`-- 共 ${entityInstances.length} 个点, ${edgeCount} 条边`);

  return lines.join('\n');
}

// ════════════════════════════════════════════════
//  nebula-console 执行器
// ════════════════════════════════════════════════

/** 检测是否可以使用 docker exec 调用容器内 console */
function isDockerConsoleAvailable() {
  try {
    const out = execSync(
      `docker inspect -f "{{.State.Running}}" ${NEBULA_DOCKER_CONSOLE} 2>nul`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/** 检测本地 console 是否可用 */
function isLocalConsoleAvailable() {
  try {
    execSync(`"${NEBULA_CONSOLE_PATH}" --version`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 通过 nebula-console 执行 nGQL 脚本
 * 优先使用 Docker 容器内 console，其次本地 console
 * @param {string} ngql - nGQL 脚本
 * @param {number} timeoutMs - 超时（毫秒）
 * @returns {Promise<{success: boolean, output: string, error?: string}>}
 */
export async function executeNGQL(ngql, timeoutMs = 60000) {
  const useDocker = isDockerConsoleAvailable();
  const useLocal = !useDocker && isLocalConsoleAvailable();

  if (!useDocker && !useLocal) {
    return {
      success: false,
      output: '',
      error: 'nebula-console 不可用（Docker 容器和本地均未检测到）。nGQL 脚本已生成，可在 NebulaGraph Studio 中手动执行。',
    };
  }

  // 清理脚本：移除注释行、console 元命令(:开头)，压缩为单行（空格连接）
  // nebula-console -e 按分号分隔语句，换行会导致语句被截断
  const cleanScript = ngql
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('--') && !l.startsWith(':'))
    .join(' ');

  return new Promise((resolve) => {
    let proc;
    // 在 Docker 内部使用容器主机名 graphd0，本地使用配置的 NEBULA_HOST
    const targetHost = useDocker ? NEBULA_DOCKER_HOST : NEBULA_HOST;

    if (useDocker) {
      proc = spawn('docker', [
        'exec', NEBULA_DOCKER_CONSOLE,
        '/usr/local/bin/nebula-console',
        '-addr', targetHost,
        '-port', String(NEBULA_PORT),
        '-u', NEBULA_USER,
        '-p', NEBULA_PASSWORD,
        '-e', cleanScript,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      proc = spawn(NEBULA_CONSOLE_PATH, [
        '-addr', targetHost,
        '-port', String(NEBULA_PORT),
        '-u', NEBULA_USER,
        '-p', NEBULA_PASSWORD,
        '-e', cleanScript,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ success: false, output: stdout, error: '执行超时' });
      } else if (code === 0 && !stderr.includes('ERROR') && !stdout.includes('[ERROR')) {
        resolve({ success: true, output: stdout });
      } else {
        // nebula-console 可能退出码为 0 但在 stdout 中输出 [ERROR ...]
        const errMatch = stdout.match(/\[ERROR[^\]]*\][^\n]*/);
        resolve({ success: false, output: stdout, error: stderr || errMatch?.[0] || `退出码 ${code}` });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: '',
        error: `执行失败: ${err.message}`,
      });
    });
  });
}

/**
 * 检查 nebula-console 是否可用（Docker 或本地）
 */
export function checkNebulaAvailable() {
  return isDockerConsoleAvailable() || isLocalConsoleAvailable();
}

/**
 * 获取 NebulaGraph 配置信息（脱敏）
 */
export function getNebulaConfig() {
  return {
    host: NEBULA_HOST,
    port: NEBULA_PORT,
    user: NEBULA_USER,
    space: NEBULA_SPACE,
    consoleAvailable: null, // 运行时填充
  };
}
