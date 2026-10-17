/**
 * Lightweight, zero-dependency YAML parser for GitLab CI configurations.
 */

export function parseGitLabCiYaml(content: string): {
  stages: string[];
  jobs: {
    name: string;
    stage: string;
    needs?: string[];
    script?: string[];
    tags?: string[];
    when?: string;
    allow_failure?: boolean;
  }[];
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n');

  let currentKey = '';
  let currentIndent = 0;
  const rootObject: Record<string, any> = {};
  let inStagesList = false;
  const stagesList: string[] = [];

  // Parse lines
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Remove comments
    const lineWithoutComment = rawLine.replace(/#.*$/, '');
    if (!lineWithoutComment.trim()) continue;

    const indentMatch = lineWithoutComment.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const trimmed = lineWithoutComment.trim();

    // Check root level keys (indent === 0)
    if (indent === 0 && trimmed.includes(':')) {
      inStagesList = false;
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      currentKey = key;
      currentIndent = indent;

      if (key === 'stages') {
        inStagesList = true;
        // Check inline list [a, b, c]
        if (val.startsWith('[') && val.endsWith(']')) {
          const items = val
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          stagesList.push(...items);
          inStagesList = false;
        }
        rootObject[key] = [];
      } else {
        rootObject[key] = val ? val : {};
      }
      continue;
    }

    // Inside stages list: "- build"
    if (inStagesList && (trimmed.startsWith('-') || indent > 0)) {
      if (trimmed.startsWith('-')) {
        const stageName = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
        if (stageName) stagesList.push(stageName);
      }
      continue;
    }

    // Inside current root key (e.g. job definition)
    if (currentKey && indent > 0 && typeof rootObject[currentKey] === 'object') {
      if (trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const subKey = trimmed.slice(0, colonIdx).trim();
        const subVal = trimmed.slice(colonIdx + 1).trim();

        if (subVal.startsWith('[') && subVal.endsWith(']')) {
          rootObject[currentKey][subKey] = subVal
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        } else if (subVal) {
          const cleanVal = subVal.replace(/^['"]|['"]$/g, '');
          rootObject[currentKey][subKey] = cleanVal === 'true' ? true : cleanVal === 'false' ? false : cleanVal;
        } else {
          rootObject[currentKey][subKey] = [];
        }
      } else if (trimmed.startsWith('-')) {
        // List item under last subKey (like script commands)
        const itemVal = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
        const subKeys = Object.keys(rootObject[currentKey]);
        const lastSubKey = subKeys[subKeys.length - 1];
        if (lastSubKey) {
          if (!Array.isArray(rootObject[currentKey][lastSubKey])) {
            rootObject[currentKey][lastSubKey] = [];
          }
          rootObject[currentKey][lastSubKey].push(itemVal);
        }
      }
    }
  }

  const stages: string[] = stagesList.length > 0 ? stagesList : ['build', 'test', 'deploy'];
  const reservedKeys = new Set([
    'stages',
    'default',
    'variables',
    'workflow',
    'include',
    'image',
    'services',
    'before_script',
    'after_script',
    'cache'
  ]);
  const jobs: any[] = [];

  for (const [key, val] of Object.entries(rootObject)) {
    if (key.startsWith('.')) continue; // Hidden jobs/templates
    if (reservedKeys.has(key)) continue;

    if (val && typeof val === 'object') {
      const jobStage = val.stage || 'test';
      if (!stages.includes(jobStage)) {
        warnings.push(`Job "${key}" specifies stage "${jobStage}" not present in "stages" declaration.`);
      }

      jobs.push({
        name: key,
        stage: jobStage,
        needs: Array.isArray(val.needs) ? val.needs : undefined,
        script: Array.isArray(val.script) ? val.script : val.script ? [String(val.script)] : [],
        tags: Array.isArray(val.tags) ? val.tags : undefined,
        when: val.when,
        allow_failure: Boolean(val.allow_failure)
      });
    }
  }

  if (jobs.length === 0) {
    warnings.push('No executable pipeline jobs found in the configuration.');
  }

  return {
    stages,
    jobs,
    errors,
    warnings
  };
}
