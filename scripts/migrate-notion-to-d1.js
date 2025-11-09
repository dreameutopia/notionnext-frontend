#!/usr/bin/env node
/**
 * Notion 数据迁移工具
 * 将现有 Notion 数据库导入到 Cloudflare Worker D1
 * 
 * 使用方法:
 * node scripts/migrate-notion-to-d1.js --tenant-id=demo --notion-id=你的Notion页面ID
 */

const fs = require('fs');
const path = require('path');

// 配置
const config = {
  workerAPI: process.env.WORKER_API || 'http://localhost:8787',
  notionAPI: 'https://www.notion.so/api/v3',
  notionToken: process.env.NOTION_TOKEN_V2, // 可选
};

// 从命令行获取参数
const args = process.argv.slice(2);
let tenantId = 'default';
let notionPageId = '';

args.forEach(arg => {
  if (arg.startsWith('--tenant-id=')) {
    tenantId = arg.split('=')[1];
  }
  if (arg.startsWith('--notion-id=')) {
    notionPageId = arg.split('=')[1];
  }
});

if (!notionPageId) {
  console.error('错误: 请提供 Notion 页面 ID');
  console.log('使用方法: node migrate-notion-to-d1.js --tenant-id=demo --notion-id=你的页面ID');
  process.exit(1);
}

/**
 * 从 Notion 获取数据
 */
async function fetchNotionData(pageId) {
  console.log(`正在从 Notion 获取数据: ${pageId}...`);
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (config.notionToken) {
    headers['Cookie'] = `token_v2=${config.notionToken}`;
  }
  
  const response = await fetch(`${config.notionAPI}/getPage`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pageId }),
  });
  
  if (!response.ok) {
    throw new Error(`Notion API 错误: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 导入数据到 Worker
 */
async function importToWorker(tenantId, notionData) {
  console.log(`正在导入数据到租户: ${tenantId}...`);
  
  const response = await fetch(`${config.workerAPI}/api/import/notion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: tenantId,
      notion_data: notionData,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Worker API 错误: ${error}`);
  }
  
  return await response.json();
}

/**
 * 保存数据到本地（备份）
 */
function saveBackup(tenantId, notionData) {
  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${tenantId}_${timestamp}.json`;
  const filepath = path.join(backupDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(notionData, null, 2));
  console.log(`✓ 数据已备份到: ${filepath}`);
  
  return filepath;
}

/**
 * 统计数据
 */
function analyzeData(notionData) {
  const stats = {
    blocks: 0,
    collections: 0,
    collectionViews: 0,
    pages: 0,
    types: {},
  };
  
  if (notionData.recordMap?.block) {
    stats.blocks = Object.keys(notionData.recordMap.block).length;
    Object.values(notionData.recordMap.block).forEach(block => {
      const type = block.value?.type;
      if (type) {
        stats.types[type] = (stats.types[type] || 0) + 1;
        if (type === 'page') stats.pages++;
      }
    });
  }
  
  if (notionData.recordMap?.collection) {
    stats.collections = Object.keys(notionData.recordMap.collection).length;
  }
  
  if (notionData.recordMap?.collection_view) {
    stats.collectionViews = Object.keys(notionData.recordMap.collection_view).length;
  }
  
  return stats;
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Notion 数据迁移工具');
  console.log('='.repeat(60));
  console.log(`租户 ID: ${tenantId}`);
  console.log(`Notion 页面 ID: ${notionPageId}`);
  console.log('='.repeat(60));
  
  try {
    // 1. 从 Notion 获取数据
    const notionData = await fetchNotionData(notionPageId);
    console.log('✓ 成功获取 Notion 数据');
    
    // 2. 分析数据
    const stats = analyzeData(notionData);
    console.log('\n数据统计:');
    console.log(`  - Blocks: ${stats.blocks}`);
    console.log(`  - Pages: ${stats.pages}`);
    console.log(`  - Collections: ${stats.collections}`);
    console.log(`  - Collection Views: ${stats.collectionViews}`);
    console.log('\nBlock 类型分布:');
    Object.entries(stats.types).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}`);
    });
    
    // 3. 备份数据
    console.log('\n正在备份数据...');
    saveBackup(tenantId, notionData);
    
    // 4. 导入到 Worker
    console.log('\n正在导入到 Worker...');
    const result = await importToWorker(tenantId, notionData);
    console.log('✓ 导入成功!');
    console.log(`  - 导入的 Blocks: ${result.imported_blocks || 0}`);
    console.log(`  - 导入的 Collections: ${result.imported_collections || 0}`);
    
    console.log('\n='.repeat(60));
    console.log('✓ 迁移完成!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n✗ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main().catch(console.error);
