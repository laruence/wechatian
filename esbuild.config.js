const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

/** 运行时由 Obsidian(Electron)提供的模块,保持 external */
const external = ['obsidian', 'electron', 'crypto', 'path', 'fs', 'buffer'];

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
  if (fs.existsSync('src/smoke.ts')) {
    await esbuild.build({
      entryPoints: ['src/smoke.ts'],
      bundle: true,
      external: ['crypto'],
      format: 'cjs',
      target: 'es2022',
      platform: 'node',
      outfile: 'scripts/smoke.js',
      logLevel: 'info',
    });
  }

  // 分发到 .obsidian/plugins/wechatian/
  const dest = path.resolve(__dirname, '../.obsidian/plugins/wechatian');
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
