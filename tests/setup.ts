// Runs before every test file: keep cache and vault writes out of the repo's .data directory.
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

process.env.LAZYLAB_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'lazylab-test-'));
