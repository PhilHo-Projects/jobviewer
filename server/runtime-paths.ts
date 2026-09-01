import path from 'path';

export interface RuntimePathOptions {
    cwd?: string;
    dataDirEnv?: string;
}

export interface RuntimePaths {
    dataDir: string;
    dbPath: string;
    legacyJsonDir: string;
    samplePath: string;
}

export function resolveRuntimePaths(options: RuntimePathOptions = {}): RuntimePaths {
    const cwd = options.cwd ?? process.cwd();
    const dataDir = options.dataDirEnv || path.join(cwd, 'data');

    return {
        dataDir,
        dbPath: path.join(dataDir, 'jobviewer.db'),
        legacyJsonDir: dataDir,
        samplePath: path.join(cwd, 'public-sample.json'),
    };
}
