#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { buildLenexXml } = require('../src');

function printUsage() {
  // eslint-disable-next-line no-console
  console.log('Usage: export-lenex <input.json|url> [output.lenex]');
  // eslint-disable-next-line no-console
  console.log('  input can be a timing.events JSON payload or a direct https://timing.events/... link');
}

function loadFromUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 400) {
          reject(new Error(`Request failed with status ${statusCode}`));
          return;
        }
        const chunks = [];
        res
          .on('data', chunk => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
          .on('error', reject);
      })
      .on('error', reject);
  });
}

async function loadJson(input) {
  if (/^https?:\/\//i.test(input)) {
    const body = await loadFromUrl(input);
    return JSON.parse(body);
  }
  const resolved = path.resolve(process.cwd(), input);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

async function main() {
  const [, , input, output] = process.argv;
  if (!input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const payload = await loadJson(input);
    const xml = await buildLenexXml(payload);
    if (output) {
      fs.writeFileSync(path.resolve(process.cwd(), output), xml, 'utf8');
      // eslint-disable-next-line no-console
      console.log(`Lenex exported to ${output}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(xml);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to export Lenex:', error.message);
    process.exitCode = 1;
  }
}

main();
