import path from 'path';

export interface RuntimePathOptions {
    cwd?: string;
    dataDirEnv?: string;
}

export interface RuntimePaths {
    dataDir: string;
    dbPath: string;
    samplePath: string;
}

/**
 * Single source of truth for on-disk locations. `dataDir` is the persistent volume;
 * `samplePath` is the committed demo fixture, which ships with the image rather than
 * the volume.
 */
export function resolveRuntimePaths(options: RuntimePathOptions = {}): RuntimePaths {
    const cwd = options.cwd ?? process.cwd();
    const dataDir = options.dataDirEnv || path.join(cwd, 'data');

    return {
        dataDir,
        dbPath: path.join(dataDir, 'jobviewer.db'),
        samplePath: path.join(cwd, 'public-sample.json'),
    };
}
