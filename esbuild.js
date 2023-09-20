const {build} = require('esbuild');
const {copyFolder} = require('copy-folder-util');
const {rimraf} = require('rimraf');

const baseConfig = {
    bundle: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: true,
};
const extensionConfig = {
    ...baseConfig,
    platform: 'node',
    mainFields: ['module', 'main'],
    format: 'cjs',
    entryPoints: ['./src/extension.ts'],
    outfile: './out/extension.js',
    external: ['vscode'],
};

const watchConfig = {
    watch: {
        onRebuild(error, result) {
            console.log('[watch] build started');
            if (error) {
                error.errors.forEach(error => console.error(`> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`));
            } else {
                console.log('[watch] build finished');
            }
        },
    },
};

const mockarooConfig = {
    ...baseConfig,
    target: 'es2020',
    format: 'esm',
    entryPoints: ['./src/mock-data/main.ts'],
    outfile: './out/mock-data.js',
};

const resultsConfig = {
    ...baseConfig,
    target: 'es2020',
    format: 'esm',
    entryPoints: ['./src/result-view/main.ts'],
    outfile: './out/result-view.js',
};

(async () => {
    rimraf('./out/');
    const args = process.argv.slice(2);
    copyFolder.cp('./node_modules/node-firebird-native-api/build/Release/', './out/Release');
    try {
        if (args.includes('--watch')) {
            // Build and watch source code
            console.log('[watch] build started');
            await build({
                ...extensionConfig,
                ...watchConfig,
            });
            await build({
                ...mockarooConfig,
                ...watchConfig,
            });            
            await build({
                ...resultsConfig,
                ...watchConfig,
            });
            console.log('[watch] build finished');
        } else {
            // Build source code
            await build(extensionConfig);
            await build(mockarooConfig);
            await build(resultsConfig);
            console.log('build complete');
        }
    } catch (err) {
        process.stderr.write(err.stderr);
        process.exit(1);
    }
})();
