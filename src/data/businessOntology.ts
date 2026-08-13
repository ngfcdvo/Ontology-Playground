/**
 * 业务本体定义 — 基于 Doris 数仓 (jfdb)
 *
 * 实体 → Doris 表映射:
 *   开票明细     → dwd_marketing_tob_ordermanagements_rt_df
 *   产品         → ods_model_product_line_h2
 *   商业         → ods_customers
 *   区域架构     → jdp_bus_data_org_region
 *   流向明细     → dwd_sapflowto_team_region_h2
 *   医院归属     → dwd_hospital_belong_wh
 *   剩余库存     → dwd_remain_inventory_team_region
 *   医院主数据   → dim_hospitals
 */

import type { Ontology, DataBinding, EntityInstance, RelationshipInstance } from './ontology';

// ──────────────────────────────────────────────
//  实体定义
// ──────────────────────────────────────────────

export const businessOntology: Ontology = {
  name: '营销数据本体 (Doris/jfdb)',
  description: '基于 Doris 数仓 DWD/DIM/ODS 层的业务本体，覆盖开票、产品、商业、流向、库存、医院等核心域',
  entityTypes: [
    {
      id: 'invoice',
      name: '开票明细',
      description: '销售订单开票明细记录 (DWD)',
      icon: '🧾',
      color: '#0078D4',
      properties: [
        { name: 'order_number', type: 'string', description: '订单编号', isIdentifier: true },
        { name: 'order_date', type: 'date', description: '订单日期' },
        { name: 'customer_code', type: 'string', description: '客户编码' },
        { name: 'customer_name', type: 'string', description: '客户名称' },
        { name: 'order_type_t', type: 'string', description: '订单类型名称' },
        { name: 'model', type: 'string', description: '规格/型号' },
        { name: 'model_code', type: 'string', description: '物料编码' },
        { name: 'amount_before', type: 'decimal', description: '人民币总金额(折扣前)', unit: 'CNY' },
        { name: 'amount_after', type: 'decimal', description: '人民币总金额(折扣后)', unit: 'CNY' },
        { name: 'count', type: 'string', description: '数量' },
        { name: 'province_name', type: 'string', description: '销售省份' },
        { name: 'salesman_name', type: 'string', description: '业务员名称' },
        { name: 'product_line_new', type: 'string', description: '最终归属产品线' },
        { name: 'region', type: 'string', description: '大区名称' },
        { name: 'team', type: 'string', description: '团队名称' },
        { name: 'status', type: 'string', description: '更新标识' },
      ],
    },
    {
      id: 'product',
      name: '产品',
      description: '产品和产品线关系维度 (ODS)',
      icon: '📦',
      color: '#107c10',
      properties: [
        { name: 'id', type: 'integer', description: '主键', isIdentifier: true },
        { name: 'model', type: 'string', description: '型号' },
        { name: 'general_name', type: 'string', description: '通用名' },
        { name: 'product_line', type: 'string', description: '产品线' },
        { name: 'model_classify', type: 'string', description: '型号分类' },
        { name: 'model_classify_dataease', type: 'string', description: 'DataEase型号分类' },
        { name: 'is_count_inventory', type: 'string', description: '是否计算库存' },
      ],
    },
    {
      id: 'dealer',
      name: '商业',
      description: '商业/经销商客户主数据 (ODS)',
      icon: '🏢',
      color: '#d13438',
      properties: [
        { name: 'code', type: 'string', description: '商业编码', isIdentifier: true },
        { name: 'name', type: 'string', description: '商业名称' },
        { name: 'account_group_t', type: 'string', description: '账套描述' },
        { name: 'customer_group_t', type: 'string', description: '客户组描述' },
        { name: 'country_t', type: 'string', description: '国家名称' },
        { name: 'province_name', type: 'string', description: '省份' },
        { name: 'sale_group_t', type: 'string', description: '销售组文本' },
        { name: 'department_belong_t', type: 'string', description: '销售办事处文本' },
        { name: 'vtweg', type: 'string', description: '分销渠道' },
        { name: 'customer_type_t', type: 'string', description: '客户价格组文本' },
      ],
    },
    {
      id: 'region',
      name: '区域架构',
      description: '产品线-区域-团队组织架构维度',
      icon: '🗺️',
      color: '#8764b8',
      properties: [
        { name: 'id', type: 'integer', description: '主键', isIdentifier: true },
        { name: 'product_line', type: 'string', description: '产品线' },
        { name: 'province', type: 'string', description: '省份' },
        { name: 'team', type: 'string', description: '团队' },
        { name: 'region', type: 'string', description: '大区' },
        { name: 'principal', type: 'string', description: '负责人' },
        { name: 'employee_no', type: 'string', description: '工号' },
      ],
    },
    {
      id: 'flow',
      name: '流向明细',
      description: '产品流向明细记录 (DWD)',
      icon: '🚚',
      color: '#ca5010',
      properties: [
        { name: '_id', type: 'string', description: '唯一主键ID', isIdentifier: true },
        { name: 'ztjrq', type: 'string', description: '归属年月' },
        { name: 'delivery_date', type: 'string', description: '发货日期' },
        { name: 'dealer_code', type: 'string', description: '经销商编码' },
        { name: 'dealer_name', type: 'string', description: '经销商名称' },
        { name: 'materiel_code', type: 'string', description: '物料编码' },
        { name: 'model', type: 'string', description: '规格/型号' },
        { name: 'count', type: 'integer', description: '数量' },
        { name: 'unit_price', type: 'decimal', description: '单价' },
        { name: 'total_price', type: 'decimal', description: '总金额' },
        { name: 'hospital_code', type: 'string', description: '医院编码' },
        { name: 'hospital_name', type: 'string', description: '医院名称' },
        { name: 'province', type: 'string', description: '省份名称' },
        { name: 'region_t', type: 'string', description: '区域名称' },
        { name: 'calc_product_line', type: 'string', description: '产品线' },
        { name: 'calc_team', type: 'string', description: '团队' },
      ],
    },
    {
      id: 'hospital_belong',
      name: '医院归属',
      description: '医院客户归属关系维度 (DWD)',
      icon: '🏥',
      color: '#008575',
      properties: [
        { name: 'id', type: 'integer', description: 'ID', isIdentifier: true },
        { name: 'model', type: 'string', description: '型号' },
        { name: 'hospital_code', type: 'string', description: '医院编码' },
        { name: 'hospital_name', type: 'string', description: '医院名称' },
        { name: 'product_line', type: 'string', description: '产品线' },
        { name: 'sale_region', type: 'string', description: '销售区域' },
        { name: 'big_region', type: 'string', description: '大区' },
        { name: 'office', type: 'string', description: '办事处' },
        { name: 'hospital_type', type: 'string', description: '医院类型' },
        { name: 'hospital_grading', type: 'string', description: '医院分级' },
        { name: 'class_a_dealer', type: 'string', description: 'A类经销商名称' },
      ],
    },
    {
      id: 'inventory',
      name: '剩余库存',
      description: '剩余库存明细 (DWD)',
      icon: '📊',
      color: '#7719aa',
      properties: [
        { name: 'id', type: 'string', description: '明细唯一主键ID', isIdentifier: true },
        { name: 'yearmonth', type: 'integer', description: '业务归属年月' },
        { name: 'delivery_date', type: 'date', description: '实际发货日期' },
        { name: 'customer_name', type: 'string', description: '客户名称' },
        { name: 'product_name', type: 'string', description: '产品名称' },
        { name: 'model', type: 'string', description: '产品规格型号' },
        { name: 'quantity', type: 'integer', description: '发货数量' },
        { name: 'unit_price', type: 'decimal', description: '实际执行单价' },
        { name: 'product_line', type: 'string', description: '产品线' },
        { name: 'calc_team', type: 'string', description: '核算口径团队' },
        { name: 'big_region', type: 'string', description: '所属大区' },
      ],
    },
    {
      id: 'hospital',
      name: '医院主数据',
      description: '医院客户主数据维度 (DIM)',
      icon: '🏩',
      color: '#e3008c',
      properties: [
        { name: '_id', type: 'string', description: '医院维度唯一主键ID', isIdentifier: true },
        { name: 'code', type: 'string', description: '医院编码' },
        { name: 'name', type: 'string', description: '医院全称' },
        { name: 'province_name', type: 'string', description: '省份名称' },
        { name: 'city', type: 'string', description: '地市名称' },
        { name: 'district', type: 'string', description: '区县名称' },
        { name: 'hospital_level', type: 'string', description: '医院等级' },
        { name: 'address', type: 'string', description: '详细地址' },
        { name: 'medical_insurance', type: 'string', description: '医保资质类型' },
        { name: 'reimbursement_ratio', type: 'string', description: '医保报销比例' },
        { name: 'delete_status', type: 'string', description: '删除状态' },
      ],
    },
  ],

  // ──────────────────────────────────────────────
  //  关系定义
  // ──────────────────────────────────────────────
  relationships: [
    {
      id: 'dealer_places_invoice',
      name: '开票',
      from: 'dealer',
      to: 'invoice',
      cardinality: 'one-to-many',
      description: '经销商开具的销售订单 (dealer.code = invoice.customer_code)',
      joinFrom: ['code'],
      joinTo: ['customer_code'],
    },
    {
      id: 'product_in_invoice',
      name: '订单产品',
      from: 'product',
      to: 'invoice',
      cardinality: 'one-to-many',
      description: '产品出现在哪些订单中 (product.model = invoice.model)',
      joinFrom: ['model'],
      joinTo: ['model'],
    },
    {
      id: 'region_covers_product',
      name: '覆盖产品',
      from: 'region',
      to: 'product',
      cardinality: 'one-to-many',
      description: '区域架构覆盖的产品线 (region.product_line = product.product_line)',
      joinFrom: ['product_line'],
      joinTo: ['product_line'],
    },
    {
      id: 'hospital_belong_flow',
      name: '流向归属',
      from: 'hospital_belong',
      to: 'flow',
      cardinality: 'one-to-many',
      description: '医院归属产生的流向 (hospital_belong.hospital_code = flow.hospital_code AND hospital_belong.model = flow.model)',
      joinFrom: ['hospital_code', 'model'],
      joinTo: ['hospital_code', 'model'],
    },
    {
      id: 'dealer_has_inventory',
      name: '库存',
      from: 'dealer',
      to: 'inventory',
      cardinality: 'one-to-many',
      description: '经销商的剩余库存 (dealer.name = inventory.customer_name)',
      joinFrom: ['name'],
      joinTo: ['customer_name'],
    },
    {
      id: 'product_in_flow',
      name: '流向产品',
      from: 'product',
      to: 'flow',
      cardinality: 'one-to-many',
      description: '产品在哪些流向中 (product.model = flow.model)',
      joinFrom: ['model'],
      joinTo: ['model'],
    },
    {
      id: 'hospital_to_belong',
      name: '医院归属',
      from: 'hospital',
      to: 'hospital_belong',
      cardinality: 'one-to-many',
      description: '医院的归属关系 (hospital.code = hospital_belong.hospital_code)',
      joinFrom: ['code'],
      joinTo: ['hospital_code'],
    },
    {
      id: 'hospital_in_flow',
      name: '医院流向',
      from: 'hospital',
      to: 'flow',
      cardinality: 'one-to-many',
      description: '医院相关的流向记录 (hospital.code = flow.hospital_code)',
      joinFrom: ['code'],
      joinTo: ['hospital_code'],
    },
  ],
};

// ──────────────────────────────────────────────
//  DataBinding 映射 (实体 → Doris 物理表)
// ──────────────────────────────────────────────

export const businessBindings: DataBinding[] = [
  {
    entityTypeId: 'invoice',
    source: 'Doris / jfdb',
    table: 'jfdb.dwd_marketing_tob_ordermanagements_rt_df',
    columnMappings: {
      order_number: 'order_number',
      order_date: 'order_date',
      customer_code: 'customer_code',
      customer_name: 'customer_name',
      order_type_t: 'order_type_t',
      model: 'model',
      model_code: 'model_code',
      amount_before: 'amount_before',
      amount_after: 'amount_after',
      count: 'count',
      province_name: 'province_name',
      salesman_name: 'salesman_name',
      product_line_new: 'product_line_new',
      region: 'region',
      team: 'team',
      status: 'status',
    },
  },
  {
    entityTypeId: 'product',
    source: 'Doris / jfdb',
    table: 'jfdb.ods_model_product_line_h2',
    columnMappings: {
      id: 'id',
      model: 'model',
      general_name: 'general_name',
      product_line: 'product_line',
      model_classify: 'model_classify',
      model_classify_dataease: 'model_classify_dataease',
      is_count_inventory: 'is_count_inventory',
    },
  },
  {
    entityTypeId: 'dealer',
    source: 'Doris / jfdb',
    table: 'jfdb.ods_customers',
    columnMappings: {
      code: 'code',
      name: 'name',
      account_group_t: 'account_group_t',
      customer_group_t: 'customer_group_t',
      country_t: 'country_t',
      province_name: 'province_name',
      sale_group_t: 'sale_group_t',
      department_belong_t: 'department_belong_t',
      vtweg: 'vtweg',
      customer_type_t: 'customer_type_t',
    },
  },
  {
    entityTypeId: 'region',
    source: 'Doris / catalog',
    table: 'catalog_prod_js_dataplatform_business.jdp_bus_data_org_region',
    columnMappings: {
      id: 'id',
      product_line: 'product_line',
      province: 'province',
      team: 'team',
      region: 'region',
      principal: 'principal',
      employee_no: 'employee_no',
    },
  },
  {
    entityTypeId: 'flow',
    source: 'Doris / jfdb',
    table: 'jfdb.dwd_sapflowto_team_region_h2',
    columnMappings: {
      _id: '_id',
      ztjrq: 'ztjrq',
      delivery_date: 'delivery_date',
      dealer_code: 'dealer_code',
      dealer_name: 'dealer_name',
      materiel_code: 'materiel_code',
      model: 'model',
      count: 'count',
      unit_price: 'unit_price',
      total_price: 'total_price',
      hospital_code: 'hospital_code',
      hospital_name: 'hospital_name',
      province: 'province',
      region_t: 'region_t',
      calc_product_line: 'calc_product_line',
      calc_team: 'calc_team',
    },
  },
  {
    entityTypeId: 'hospital_belong',
    source: 'Doris / jfdb',
    table: 'jfdb.dwd_hospital_belong_wh',
    columnMappings: {
      id: 'id',
      model: 'model',
      hospital_code: 'hospital_code',
      hospital_name: 'hospital_name',
      product_line: 'product_line',
      sale_region: 'sale_region',
      big_region: 'big_region',
      office: 'office',
      hospital_type: 'hospital_type',
      hospital_grading: 'hospital_grading',
      class_a_dealer: 'class_a_dealer',
    },
  },
  {
    entityTypeId: 'inventory',
    source: 'Doris / jfdb',
    table: 'jfdb.dwd_remain_inventory_team_region',
    columnMappings: {
      id: 'id',
      yearmonth: 'yearmonth',
      delivery_date: 'delivery_date',
      customer_name: 'customer_name',
      product_name: 'product_name',
      model: 'model',
      quantity: 'quantity',
      unit_price: 'unit_price',
      product_line: 'product_line',
      calc_team: 'calc_team',
      big_region: 'big_region',
    },
  },
  {
    entityTypeId: 'hospital',
    source: 'Doris / jfdb',
    table: 'jfdb.dim_hospitals',
    columnMappings: {
      _id: '_id',
      code: 'code',
      name: 'name',
      province_name: 'province_name',
      city: 'city',
      district: 'district',
      hospital_level: 'hospital_level',
      address: 'address',
      medical_insurance: 'medical_insurance',
      reimbursement_ratio: 'reimbursement_ratio',
      delete_status: 'delete_status',
    },
  },
];

// ──────────────────────────────────────────────
//  示例实例数据 (模拟，接 Doris 后会被替换)
// ──────────────────────────────────────────────

export const businessInstances: EntityInstance[] = [
  // ── 商业 (3条) ──
  { id: 'dealer-0', entityTypeId: 'dealer', values: { code: '100001', name: '北京医药股份有限公司', province_name: '北京', sale_group_t: '北京一组', customer_type_t: '商业客户', department_belong_t: '北京办' } },
  { id: 'dealer-1', entityTypeId: 'dealer', values: { code: '100002', name: '上海健康药业有限公司', province_name: '上海', sale_group_t: '上海一组', customer_type_t: '商业客户', department_belong_t: '上海办' } },
  { id: 'dealer-2', entityTypeId: 'dealer', values: { code: '100003', name: '广州医疗器材有限公司', province_name: '广东', sale_group_t: '广州二组', customer_type_t: '连锁客户', department_belong_t: '广州办' } },

  // ── 产品 (4条) ──
  { id: 'product-0', entityTypeId: 'product', values: { id: 1, model: 'MODEL-A100', general_name: '一次性使用输液器', product_line: '输液器系列', model_classify: '常规' } },
  { id: 'product-1', entityTypeId: 'product', values: { id: 2, model: 'MODEL-B200', general_name: '一次性使用注射器', product_line: '注射器系列', model_classify: '常规' } },
  { id: 'product-2', entityTypeId: 'product', values: { id: 3, model: 'MODEL-C300', general_name: '血液透析器', product_line: '透析系列', model_classify: '高端' } },
  { id: 'product-3', entityTypeId: 'product', values: { id: 4, model: 'MODEL-D400', general_name: '心脏支架', product_line: '介入系列', model_classify: '高端' } },

  // ── 开票明细 (4条) ──
  { id: 'invoice-0', entityTypeId: 'invoice', values: { order_number: 'SO-2026-0001', order_date: '2026-01-15', customer_code: '100001', customer_name: '北京医药股份有限公司', model: 'MODEL-A100', amount_after: 125000.50, count: '500', province_name: '北京', product_line_new: '输液器系列' } },
  { id: 'invoice-1', entityTypeId: 'invoice', values: { order_number: 'SO-2026-0002', order_date: '2026-01-20', customer_code: '100002', customer_name: '上海健康药业有限公司', model: 'MODEL-B200', amount_after: 89000.00, count: '300', province_name: '上海', product_line_new: '注射器系列' } },
  { id: 'invoice-2', entityTypeId: 'invoice', values: { order_number: 'SO-2026-0003', order_date: '2026-02-01', customer_code: '100001', customer_name: '北京医药股份有限公司', model: 'MODEL-C300', amount_after: 450000.00, count: '50', province_name: '北京', product_line_new: '透析系列' } },
  { id: 'invoice-3', entityTypeId: 'invoice', values: { order_number: 'SO-2026-0004', order_date: '2026-02-10', customer_code: '100003', customer_name: '广州医疗器材有限公司', model: 'MODEL-D400', amount_after: 1200000.00, count: '20', province_name: '广东', product_line_new: '介入系列' } },

  // ── 区域架构 (3条) ──
  { id: 'region-0', entityTypeId: 'region', values: { id: 1, product_line: '输液器系列', province: '北京', team: '北京团队A', region: '华北大区', principal: '张三', employee_no: 'EMP001' } },
  { id: 'region-1', entityTypeId: 'region', values: { id: 2, product_line: '注射器系列', province: '上海', team: '上海团队B', region: '华东大区', principal: '李四', employee_no: 'EMP002' } },
  { id: 'region-2', entityTypeId: 'region', values: { id: 3, product_line: '介入系列', province: '广东', team: '广州团队C', region: '华南大区', principal: '王五', employee_no: 'EMP003' } },

  // ── 医院 (2条) ──
  { id: 'hospital-0', entityTypeId: 'hospital', values: { _id: 'H001', code: 'HOSP-BJ-001', name: '北京协和医院', province_name: '北京', city: '北京', hospital_level: '三甲', medical_insurance: '医保定点' } },
  { id: 'hospital-1', entityTypeId: 'hospital', values: { _id: 'H002', code: 'HOSP-SH-001', name: '上海瑞金医院', province_name: '上海', city: '上海', hospital_level: '三甲', medical_insurance: '医保定点' } },

  // ── 医院归属 (2条) ──
  { id: 'hospital_belong-0', entityTypeId: 'hospital_belong', values: { id: 101, model: 'MODEL-A100', hospital_code: 'HOSP-BJ-001', hospital_name: '北京协和医院', product_line: '输液器系列', sale_region: '华北', big_region: '华北大区', hospital_type: '三级', hospital_grading: '三甲' } },
  { id: 'hospital_belong-1', entityTypeId: 'hospital_belong', values: { id: 102, model: 'MODEL-C300', hospital_code: 'HOSP-SH-001', hospital_name: '上海瑞金医院', product_line: '透析系列', sale_region: '华东', big_region: '华东大区', hospital_type: '三级', hospital_grading: '三甲' } },

  // ── 流向明细 (2条) ──
  { id: 'flow-0', entityTypeId: 'flow', values: { _id: 'FLOW-001', ztjrq: '202601', delivery_date: '2026-01-10', dealer_code: '100001', dealer_name: '北京医药股份有限公司', model: 'MODEL-A100', count: 200, hospital_code: 'HOSP-BJ-001', hospital_name: '北京协和医院', province: '北京', calc_product_line: '输液器系列' } },
  { id: 'flow-1', entityTypeId: 'flow', values: { _id: 'FLOW-002', ztjrq: '202601', delivery_date: '2026-01-25', dealer_code: '100002', dealer_name: '上海健康药业有限公司', model: 'MODEL-C300', count: 30, hospital_code: 'HOSP-SH-001', hospital_name: '上海瑞金医院', province: '上海', calc_product_line: '透析系列' } },

  // ── 剩余库存 (2条) ──
  { id: 'inventory-0', entityTypeId: 'inventory', values: { id: 'INV-001', yearmonth: 202601, delivery_date: '2026-01-15', customer_name: '北京医药股份有限公司', model: 'MODEL-A100', quantity: 100, unit_price: 250.00, product_line: '输液器系列', calc_team: '北京团队A', big_region: '华北大区' } },
  { id: 'inventory-1', entityTypeId: 'inventory', values: { id: 'INV-002', yearmonth: 202601, delivery_date: '2026-02-01', customer_name: '上海健康药业有限公司', model: 'MODEL-C300', quantity: 15, unit_price: 9000.00, product_line: '透析系列', calc_team: '上海团队B', big_region: '华东大区' } },
];

// ──────────────────────────────────────────────
//  示例关系实例
// ──────────────────────────────────────────────

export const businessRelationshipInstances: RelationshipInstance[] = [
  // dealer → invoice (customer_code)
  { id: 'ri-d2i-0', relationshipId: 'dealer_places_invoice', sourceKey: '100001', targetKey: 'SO-2026-0001' },
  { id: 'ri-d2i-1', relationshipId: 'dealer_places_invoice', sourceKey: '100002', targetKey: 'SO-2026-0002' },
  { id: 'ri-d2i-2', relationshipId: 'dealer_places_invoice', sourceKey: '100001', targetKey: 'SO-2026-0003' },
  { id: 'ri-d2i-3', relationshipId: 'dealer_places_invoice', sourceKey: '100003', targetKey: 'SO-2026-0004' },

  // product → invoice (model)
  { id: 'ri-p2i-0', relationshipId: 'product_in_invoice', sourceKey: '1', targetKey: 'SO-2026-0001' },
  { id: 'ri-p2i-1', relationshipId: 'product_in_invoice', sourceKey: '2', targetKey: 'SO-2026-0002' },
  { id: 'ri-p2i-2', relationshipId: 'product_in_invoice', sourceKey: '3', targetKey: 'SO-2026-0003' },
  { id: 'ri-p2i-3', relationshipId: 'product_in_invoice', sourceKey: '4', targetKey: 'SO-2026-0004' },

  // region → product (product_line)
  { id: 'ri-r2p-0', relationshipId: 'region_covers_product', sourceKey: '1', targetKey: '1' },
  { id: 'ri-r2p-1', relationshipId: 'region_covers_product', sourceKey: '2', targetKey: '2' },
  { id: 'ri-r2p-2', relationshipId: 'region_covers_product', sourceKey: '3', targetKey: '4' },

  // hospital → hospital_belong (hospital_code)
  { id: 'ri-h2hb-0', relationshipId: 'hospital_to_belong', sourceKey: 'H001', targetKey: '101' },
  { id: 'ri-h2hb-1', relationshipId: 'hospital_to_belong', sourceKey: 'H002', targetKey: '102' },

  // hospital_belong → flow (hospital_code + model)
  { id: 'ri-hb2f-0', relationshipId: 'hospital_belong_flow', sourceKey: '101', targetKey: 'FLOW-001' },
  { id: 'ri-hb2f-1', relationshipId: 'hospital_belong_flow', sourceKey: '102', targetKey: 'FLOW-002' },

  // hospital → flow (hospital_code)
  { id: 'ri-h2f-0', relationshipId: 'hospital_in_flow', sourceKey: 'H001', targetKey: 'FLOW-001' },
  { id: 'ri-h2f-1', relationshipId: 'hospital_in_flow', sourceKey: 'H002', targetKey: 'FLOW-002' },

  // product → flow (model)
  { id: 'ri-p2f-0', relationshipId: 'product_in_flow', sourceKey: '1', targetKey: 'FLOW-001' },
  { id: 'ri-p2f-1', relationshipId: 'product_in_flow', sourceKey: '3', targetKey: 'FLOW-002' },

  // dealer → inventory (customer_name)
  { id: 'ri-d2inv-0', relationshipId: 'dealer_has_inventory', sourceKey: '100001', targetKey: 'INV-001' },
  { id: 'ri-d2inv-1', relationshipId: 'dealer_has_inventory', sourceKey: '100002', targetKey: 'INV-002' },
];
