const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');

  // extraResources のバイナリに実行権限を付与
  const binaries = ['key-listener', 'text-typer', 'apple-speech'];
  for (const bin of binaries) {
    const binPath = path.join(resourcesPath, bin);
    if (!fs.existsSync(binPath)) continue;

    try {
      execSync(`chmod +x "${binPath}"`);
      console.log(`  • fixed permissions for ${bin}`);
    } catch (e) {
      console.warn(`  • warning: could not fix permissions for ${bin}`);
    }
  }

  // asar.unpacked 内のバイナリにも実行権限を付与
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'resources');
  for (const bin of binaries) {
    const binPath = path.join(unpackedPath, bin);
    if (!fs.existsSync(binPath)) continue;

    try {
      execSync(`chmod +x "${binPath}"`);
      console.log(`  • fixed permissions for unpacked ${bin}`);
    } catch (e) {}
  }
};
