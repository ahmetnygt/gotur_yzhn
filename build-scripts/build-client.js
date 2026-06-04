#!/usr/bin/env node
/*
 * Production client build script for app.js assets.
 * Performs minification, obfuscation, hashing, output rotation, and layout updates.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const terser = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SOURCE_RELATIVE = path.join('public', 'js', 'app.js');
const OUTPUT_DIR_RELATIVE = path.join('public', 'js');

(async () => {
  try {
    const projectRoot = path.resolve(__dirname, '..');
    const sourcePath = path.resolve(projectRoot, SOURCE_RELATIVE);
    const outputDir = path.resolve(projectRoot, OUTPUT_DIR_RELATIVE);

    console.log(`[build] Reading source file: ${SOURCE_RELATIVE}`);
    const source = await fs.promises.readFile(sourcePath, 'utf8');

    console.log('[build] Minifying with terser...');
    const minified = await terser.minify(source, {
      ecma: 2020,
      compress: true,
      mangle: true,
      output: {
        comments: false,
      },
    });

    if (minified.error) {
      throw new Error(`Terser failed: ${minified.error}`);
    }

    if (!minified.code) {
      throw new Error('Terser did not produce any output.');
    }

    console.log('[build] Obfuscating with javascript-obfuscator...');
    const obfuscation = JavaScriptObfuscator.obfuscate(minified.code, {
      compact: true,
      controlFlowFlattening: true,
      stringArray: true,
      stringArrayEncoding: ['rc4'],
      disableConsoleOutput: true,
    });

    const finalCode = obfuscation.getObfuscatedCode();

    console.log('[build] Calculating output hashes...');
    const sha256 = crypto.createHash('sha256').update(finalCode, 'utf8').digest('hex');
    const shortHash = sha256.slice(0, 8);
    const outputFileName = `app.${shortHash}.js`;
    const outputPath = path.join(outputDir, outputFileName);

    await fs.promises.mkdir(outputDir, { recursive: true });
    await fs.promises.writeFile(outputPath, finalCode, 'utf8');
    console.log(`[build] Wrote bundled file: public/js/${outputFileName}`);

    const sri =
      'sha384-' + crypto.createHash('sha384').update(finalCode, 'utf8').digest('base64');

    console.log(`[build] Subresource Integrity: ${sri}`);

    await updateLayout(projectRoot, outputFileName, sri);
    await cleanupOldBuilds(outputDir, outputFileName);

    console.log('[build] Build completed successfully.');
    console.log(`[build] Output: ${outputFileName}`);
    console.log(`[build] Integrity: ${sri}`);
  } catch (error) {
    console.error('[build] Fatal error:', error);
    process.exit(1);
  }
})();

/**
 * Update the layout template (Pug or HTML) to reference the new asset.
 * @param {string} projectRoot
 * @param {string} outputFileName
 * @param {string} sri
 */
async function updateLayout(projectRoot, outputFileName, sri) {
  const candidateLayouts = [
    path.resolve(projectRoot, 'views', 'layout.pug'),
    path.resolve(projectRoot, 'views', 'layout.html'),
  ];

  const scriptPug = `script(src="/js/${outputFileName}" integrity="${sri}" crossorigin="anonymous")`;
  const scriptHtml = `<script src="/js/${outputFileName}" integrity="${sri}" crossorigin="anonymous"></script>`;

  for (const layoutPath of candidateLayouts) {
    if (!fs.existsSync(layoutPath)) {
      continue;
    }

    console.log(`[layout] Updating ${path.relative(projectRoot, layoutPath)}...`);

    const original = await fs.promises.readFile(layoutPath, 'utf8');
    let updated = original;
    let changed = false;

    if (layoutPath.endsWith('.pug')) {
      const pugScriptPattern = /^(\s*)script\([^\n]*src=['"]\/js\/app[^'"]*\.js['"][^\n]*\).*$/gm;
      if (pugScriptPattern.test(updated)) {
        updated = updated.replace(pugScriptPattern, (_, indent) => {
          changed = true;
          return `${indent}${scriptPug}`;
        });
      }

      if (!changed) {
        updated = injectPugScript(updated, scriptPug);
        changed = updated !== original;
      }
    } else {
      const htmlScriptPattern = /<script[^>]*src=["']\/js\/app[^"']*\.js["'][^>]*><\/script>/gi;
      if (htmlScriptPattern.test(updated)) {
        updated = updated.replace(htmlScriptPattern, scriptHtml);
        changed = true;
      }

      if (!changed) {
        updated = injectHtmlScript(updated, scriptHtml);
        changed = updated !== original;
      }
    }

    if (changed) {
      await fs.promises.writeFile(layoutPath, updated, 'utf8');
      console.log('[layout] Layout updated with new asset reference.');
    } else {
      console.log('[layout] No changes made; existing reference already up to date.');
    }

    return;
  }

  const manualScript = scriptPug;
  console.log('[layout] Layout file not found. Please add the following script tag manually:');
  console.log(`  ${manualScript}`);
}

/**
 * Inject a pug script tag before the closing body block or at the end of the file.
 * @param {string} content
 * @param {string} scriptLine
 * @returns {string}
 */
function injectPugScript(content, scriptLine) {
  const lines = content.split(/\r?\n/);
  let bodyIndent = '';
  for (const line of lines) {
    const match = /^(\s*)body\b/.exec(line);
    if (match) {
      bodyIndent = match[1] + '  ';
    }
  }

  const scriptWithIndent = `${bodyIndent}${scriptLine}`;

  // Attempt to insert before a `block scripts` definition if present.
  for (let i = 0; i < lines.length; i++) {
    if (/^(\s*)block scripts/.test(lines[i])) {
      lines.splice(i, 0, scriptWithIndent);
      return lines.join('\n');
    }
  }

  // Otherwise append near the end of the file.
  lines.push(scriptWithIndent);
  return lines.join('\n');
}

/**
 * Inject an HTML script tag before </body> or append at the end.
 * @param {string} content
 * @param {string} scriptTag
 * @returns {string}
 */
function injectHtmlScript(content, scriptTag) {
  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `\n  ${scriptTag}\n</body>`);
  }

  return content + `\n${scriptTag}\n`;
}

/**
 * Remove older build outputs, keeping the three most recent app.*.js files.
 * @param {string} outputDir
 * @param {string} currentFile
 */
async function cleanupOldBuilds(outputDir, currentFile) {
  console.log('[cleanup] Removing old build artifacts...');
  const entries = await fs.promises.readdir(outputDir);
  const candidates = [];

  for (const entry of entries) {
    if (/^app\.[0-9a-fA-F]{8}\.js$/.test(entry) && entry !== currentFile) {
      const fullPath = path.join(outputDir, entry);
      const stats = await fs.promises.stat(fullPath);
      candidates.push({ name: entry, time: stats.mtimeMs, path: fullPath });
    }
  }

  candidates.sort((a, b) => b.time - a.time);

  const keep = 2; // keep this many older builds alongside the current one
  const removals = candidates.slice(keep);

  for (const removal of removals) {
    await fs.promises.unlink(removal.path);
    console.log(`[cleanup] Deleted ${removal.name}`);
  }

  console.log('[cleanup] Cleanup complete.');
}
