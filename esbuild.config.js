const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

/** 运行时由 Obsidian(Electron)提供的模块,保持 external */
const external = ['obsidian', 'electron', 'crypto', 'path', 'fs', 'buffer', 'http', 'https'];

async function build() {
  const opts = {
    entryPoints: ['src/main.ts'],
    bundle: true,
    external,
    format: 'cjs',
    target: 'es2022',
    platform: 'browser',
    outfile: 'main.js',
    sourcemap: false,
    logLevel: 'info',
  };
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
  } else {
    await esbuild.build(opts);
  }

  // 冒烟测试入口(node 环境,验证 ilink 协议)
  if (fs.existsSync('tests/smoke.ts')) {
    await esbuild.build({
      entryPoints: ['tests/smoke.ts'],
      bundle: true,
      external: ['obsidian', 'crypto'],
      format: 'cjs',
      target: 'es2022',
      platform: 'node',
      outfile: 'scripts/smoke.js',
      logLevel: 'info',
    });
  }

  // 单元测试入口(node:test,跑 node --test scripts/unit-*.js)。
  // 'obsidian' 别名到空 shim:bundle 里残留的值引用(如 i18n 的语言探测)在 node 下容忍空导出
  const testBundles = [
    ['tests/unit.ts', 'scripts/unit-test.js'],
    ['tests/unit-ilink.ts', 'scripts/unit-ilink.js'],
    ['tests/unit-article.ts', 'scripts/unit-article.js'],
  ];
  for (const [entry, outfile] of testBundles) {
    if (fs.existsSync(entry)) {
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        external: ['crypto'],
        alias: { obsidian: path.resolve(__dirname, 'tests/obsidian-shim.js') },
        format: 'cjs',
        target: 'es2022',
        platform: 'node',
        outfile,
        logLevel: 'info',
      });
    }
  }

  // 分发到 vault 的插件目录(可用 OBSIDIAN_PLUGIN_DIR 覆盖)
  const dest =
    process.env.OBSIDIAN_PLUGIN_DIR ??
    path.join(process.env.HOME ?? '', 'Library/Mobile Documents/iCloud~md~obsidian/Documents/Laruence/.obsidian/plugins/wechatian');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, 'main.js'), path.join(dest, 'main.js'));
  fs.copyFileSync(path.resolve(__dirname, 'manifest.json'), path.join(dest, 'manifest.json'));
  if (fs.existsSync(path.resolve(__dirname, 'styles.css'))) {
    fs.copyFileSync(path.resolve(__dirname, 'styles.css'), path.join(dest, 'styles.css'));
  }
  console.log(`-> 已安装到 ${dest}`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
