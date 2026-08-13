/**
 * Doris 查询代理服务
 *
 * Doris 使用 MySQL 协议，浏览器无法直连，需要这层中间代理。
 * 启动: cd server && npm install && npm start
 *
 * 接口:
 *  GET  /api/health            健康检查 + Doris 连通性测试
 *  POST /api/query             执行 SQL 查询
 *  POST /api/entity/:type      按实体类型拉取数据 (带 DataBinding 映射)
 */
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  generateSchemaNGQL,
  generateDataNGQL,
  executeNGQL,
  checkNebulaAvailable,
  getNebulaConfig,
} from './nebulaClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── 配置 ──
const DORIS_HOST = process.env.DORIS_HOST || '10.0.63.141';
const DORIS_PORT = parseInt(process.env.DORIS_PORT || '6030', 10);
const DORIS_USER = process.env.DORIS_USER || 'ontologyreadonly';
const DORIS_PASSWORD = process.env.DORIS_PASSWORD || '';
const DORIS_DATABASE = process.env.DORIS_DATABASE || 'jfdb';
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const MAX_QUERY_ROWS = parseInt(process.env.MAX_QUERY_ROWS || '200', 10);

// ── 连接池 ──
const pool = mysql.createPool({
  host: DORIS_HOST,
  port: DORIS_PORT,
  user: DORIS_USER,
  password: DORIS_PASSWORD,
  database: DORIS_DATABASE,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// ── 加载业务本体的 DataBinding (从同目录的 bindings.json 或从环境配置) ──
// 前端在请求时会传入 entityTypeId + columnMappings，所以后端不需要硬编码

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ── 健康检查 ──
app.get('/api/health', async (_req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT 1 AS ok');
    conn.release();
    res.json({
      status: 'ok',
      doris: { host: DORIS_HOST, port: DORIS_PORT, database: DORIS_DATABASE },
      ping: rows[0],
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      doris: { host: DORIS_HOST, port: DORIS_PORT },
    });
  }
});

// ── 通用 SQL 查询 ──
app.post('/api/query', async (req, res) => {
  const { sql, limit } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Missing "sql" in request body' });
  }

  // 安全：禁止写操作 (readonly 账号本身也有限制，这是第二道防线)
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('DROP') || upper.startsWith('ALTER') || upper.startsWith('CREATE') || upper.startsWith('TRUNCATE')) {
    return res.status(403).json({ error: 'Write operations are not allowed' });
  }

  const rowLimit = Math.min(limit || MAX_QUERY_ROWS, MAX_QUERY_ROWS);

  // 自动加 LIMIT (如果没有)
  let finalSql = sql.trim().replace(/;$/, '');
  if (!upper.includes('LIMIT ')) {
    finalSql += ` LIMIT ${rowLimit}`;
  }

  try {
    const [rows] = await pool.execute(finalSql);
    res.json({
      rows,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      truncated: Array.isArray(rows) && rows.length >= rowLimit,
      sql: finalSql,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: finalSql });
  }
});

// ── 按实体类型拉取数据 ──
// 请求体: { table, columns: {propName: columnName}, limit?, filter? }
app.post('/api/entity', async (req, res) => {
  const { table, columns, limit, filter } = req.body;

  if (!table || !columns || typeof columns !== 'object') {
    return res.status(400).json({ error: 'Missing "table" or "columns" in request body' });
  }

  const colNames = Object.values(columns).map(c => `\`${c}\``);
  const rowLimit = Math.min(limit || MAX_QUERY_ROWS, MAX_QUERY_ROWS);

  let sql = `SELECT ${colNames.join(', ')} FROM ${table}`;
  if (filter) {
    // filter 是 { columnName: value } 格式
    const conditions = Object.entries(filter).map(([col, val]) => `\`${col}\` = ${typeof val === 'number' ? val : `'${String(val).replace(/'/g, "''")}'`}`);
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
  }
  sql += ` LIMIT ${rowLimit}`;

  try {
    const [rows] = await pool.execute(sql);
    // 映射回 propName
    const mapped = (rows).map(row => {
      const obj = {};
      for (const [propName, colName] of Object.entries(columns)) {
        obj[propName] = row[colName];
      }
      return obj;
    });
    res.json({
      rows: mapped,
      rowCount: mapped.length,
      truncated: mapped.length >= rowLimit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, sql });
  }
});

// ── 获取表结构 ──
app.get('/api/schema/:table', async (req, res) => {
  const tableName = req.params.table;
  try {
    const [rows] = await pool.execute(`DESCRIBE ${tableName}`);
    res.json({ columns: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════
//  NebulaGraph 集成端点
// ════════════════════════════════════════════════

// ── Graph 配置 + 状态 ──
app.get('/api/graph/config', async (_req, res) => {
  const config = getNebulaConfig();
  config.consoleAvailable = await checkNebulaAvailable();
  res.json(config);
});

// ── 生成 Schema DDL ──
// POST /api/graph/schema
// body: { ontology: { entityTypes, relationships } }
app.post('/api/graph/schema', (req, res) => {
  const { ontology } = req.body;
  if (!ontology || !ontology.entityTypes) {
    return res.status(400).json({ error: 'Missing "ontology" in request body' });
  }
  try {
    const ngql = generateSchemaNGQL(ontology);
    res.json({ ngql, message: 'Schema DDL 已生成' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 生成 Data DML ──
// POST /api/graph/data
// body: { ontology, entityInstances, relationshipInstances }
app.post('/api/graph/data', (req, res) => {
  const { ontology, entityInstances, relationshipInstances } = req.body;
  if (!ontology || !entityInstances) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const ngql = generateDataNGQL(ontology, entityInstances, relationshipInstances);
    res.json({ ngql, vertexCount: entityInstances.length, edgeCount: relationshipInstances.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 执行 nGQL（通过 nebula-console） ──
// POST /api/graph/execute
// body: { ngql }
app.post('/api/graph/execute', async (req, res) => {
  const { ngql } = req.body;
  if (!ngql || typeof ngql !== 'string') {
    return res.status(400).json({ error: 'Missing "ngql" in request body' });
  }

  const available = await checkNebulaAvailable();
  if (!available) {
    return res.json({
      success: false,
      executed: false,
      error: 'nebula-console 不可用。nGQL 脚本已生成，请手动执行。',
      ngql,
    });
  }

  const result = await executeNGQL(ngql, 60000);
  res.json({ ...result, executed: true });
});

// ── 一键同步：Schema + Data ──
// POST /api/graph/sync
// body: { ontology, entityInstances, relationshipInstances }
app.post('/api/graph/sync', async (req, res) => {
  const { ontology, entityInstances, relationshipInstances } = req.body;
  if (!ontology || !entityInstances) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const steps = [];

  // Step 1: 生成 Schema DDL
  const schemaNGQL = generateSchemaNGQL(ontology);
  steps.push({ step: 'schema-ngql', status: 'generated', size: schemaNGQL.length });

  // Step 2: 生成 Data DML
  const dataNGQL = generateDataNGQL(ontology, entityInstances, relationshipInstances);
  steps.push({ step: 'data-ngql', status: 'generated', size: dataNGQL.length });

  // Step 3: 尝试执行
  const available = await checkNebulaAvailable();
  if (available) {
    // 提取 CREATE SPACE 语句（跨多行直到分号）
    const spaceMatch = schemaNGQL.match(/CREATE\s+SPACE[\s\S]*?;/i);
    const createSpaceNGQL = spaceMatch
      ? spaceMatch[0].replace(/\s+/g, ' ').trim()
      : `CREATE SPACE IF NOT EXISTS \`${process.env.NEBULA_SPACE || 'ontology_playground'}\` (vid_type=FIXED_STRING(256), partition_num=10, replica_factor=1);`;

    // 拆分 schema: 分离索引语句（索引需要额外的心跳传播）
    const allStatements = schemaNGQL
      .split('\n').map(l => l.trim())
      .filter(l => l && !l.startsWith('--') && !l.startsWith(':'))
      .join(' ')
      .split(';')
      .map(s => s.trim())
      .filter(s => s);

    const schemaStmts = allStatements.filter(s => !s.toUpperCase().startsWith('CREATE TAG INDEX') && !s.toUpperCase().startsWith('CREATE EDGE INDEX') && !s.toUpperCase().startsWith('CREATE SPACE'));
    const indexStmts = allStatements.filter(s => s.toUpperCase().startsWith('CREATE TAG INDEX') || s.toUpperCase().startsWith('CREATE EDGE INDEX'));
    const schemaNGQLExec = schemaStmts.join('; ') + ';';

    // Phase 1: CREATE SPACE only
    const spaceResult = await executeNGQL(createSpaceNGQL, 15000);
    steps.push({ step: 'execute-create-space', status: spaceResult.success ? 'ok' : 'error', error: spaceResult.error });

    if (spaceResult.success) {
      // 等待 2 个心跳周期让 Space 生效（默认心跳 10s × 2 = 20s）
      steps.push({ step: 'wait-heartbeat', status: 'ok', detail: '20s' });
      await new Promise(r => setTimeout(r, 20000));

      // Phase 2: USE + CREATE TAG/EDGE (不含索引)
      const restResult = await executeNGQL(schemaNGQLExec, 30000);
      steps.push({ step: 'execute-schema', status: restResult.success ? 'ok' : 'error', output: restResult.output?.slice(-500), error: restResult.error });

      if (restResult.success) {
        // 等 Tag/Edge schema 生效（需要 2 个心跳周期）
        steps.push({ step: 'wait-schema', status: 'ok', detail: '20s' });
        await new Promise(r => setTimeout(r, 20000));
        const dataResult = await executeNGQL(dataNGQL, 60000);
        steps.push({ step: 'execute-data', status: dataResult.success ? 'ok' : 'error', output: dataResult.output?.slice(-500), error: dataResult.error });

        // Phase 3: 创建索引（非阻塞，失败不影响整体结果）
        if (indexStmts.length > 0) {
          const indexScript = `USE \`${process.env.NEBULA_SPACE || 'ontology_playground'}\`; ${indexStmts.join('; ')};`;
          const indexResult = await executeNGQL(indexScript, 15000);
          steps.push({ step: 'execute-indexes', status: indexResult.success ? 'ok' : 'warning', error: indexResult.success ? undefined : (indexResult.error || '索引创建可能需要更多心跳传播时间，可在 Studio 中手动重试') });
        }
      }
    }
  } else {
    steps.push({ step: 'execute', status: 'skipped', error: 'nebula-console 不可用，nGQL 脚本已生成供手动执行' });
  }

  // 索引失败只算警告不算错误
  const hasError = steps.some(s => s.status === 'error');
  res.json({
    success: !hasError,
    steps,
    schemaNGQL,
    dataNGQL,
    vertexCount: entityInstances.length,
    edgeCount: relationshipInstances.length,
  });
});

// ── 图查询 ──
// POST /api/graph/query
// body: { ngql }
app.post('/api/graph/query', async (req, res) => {
  const { ngql } = req.body;
  if (!ngql) {
    return res.status(400).json({ error: 'Missing "ngql"' });
  }

  const available = await checkNebulaAvailable();
  if (!available) {
    return res.status(503).json({ error: 'nebula-console 不可用' });
  }

  const result = await executeNGQL(ngql, 15000);
  res.json(result);
});

app.listen(API_PORT, () => {
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  Ontology Playground API                    │`);
  console.log(`  │  Listening: http://localhost:${API_PORT}           │`);
  console.log(`  │  Doris:      ${DORIS_HOST}:${DORIS_PORT} (${DORIS_DATABASE})        │`);
  console.log(`  │  Max Rows:   ${MAX_QUERY_ROWS}                              │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);
  console.log(`  Health check: curl http://localhost:${API_PORT}/api/health\n`);
});
