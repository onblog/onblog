import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读取仓库根目录的 `.env`（.gitignore 已忽略），只补空缺的变量：
 * 显式传入的环境变量优先，CI / Workers Builds 的 build variables 不会被本地文件覆盖。
 *
 * @param {string} [file]
 * @returns {boolean} 是否存在并读取了文件
 */
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return false;

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return true;
}

/** 从 SITE_URL 推导站点主机名（构建期用它替换 homepage 里的 `__SITE_DOMAIN__`）。 */
export function siteHostFromEnv() {
  const siteUrl = (process.env.SITE_URL ?? '').trim();
  if (!siteUrl) return '';
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
