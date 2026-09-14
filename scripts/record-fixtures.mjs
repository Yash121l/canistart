import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { canistart } from '../dist/index.js';
import { fixtureKey, NotFoundError } from '../dist/github.js';

const run = promisify(execFile);

const TARGETS = [
  'cline/cline#4932',
  'greghesp/ha-bambulab#2131',
  'p0deje/Maccy#1506',
  'litestar-org/litestar#2595',
  'meriyah/meriyah#650',
  'python-jsonschema/jsonschema#1218',
  'sqlalchemy/sqlalchemy#13583',
  ...process.argv.slice(2),
];

const pick = (source, keys) =>
  Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));

const user = (value) => (value ? { login: value.login, ...(value.type ? { type: value.type } : {}) } : value);

const issue = (value) => ({
  ...pick(value, [
    'number', 'title', 'html_url', 'state', 'state_reason', 'locked', 'created_at',
    'updated_at', 'closed_at', 'merged_at', 'draft', 'body', 'author_association',
  ]),
  user: user(value.user),
  assignees: (value.assignees ?? []).map(user),
  labels: (value.labels ?? []).map((label) => ({ name: label.name })),
  ...(value.pull_request ? { pull_request: { merged_at: value.pull_request.merged_at ?? null } } : {}),
});

function trim(path, body) {
  if (path.includes('/contents/')) {
    return {
      path: body.path,
      html_url: body.html_url,
      encoding: 'utf-8',
      content: Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8'),
    };
  }
  if (path.startsWith('search/')) {
    return { total_count: body.total_count, items: body.items.map(issue) };
  }
  if (path.endsWith('/actions/workflows')) {
    return { workflows: body.workflows.map((w) => pick(w, ['name', 'path', 'html_url'])) };
  }
  if (path.endsWith('/timeline')) {
    return body
      .filter((event) => event.event === 'cross-referenced' || event.event === 'referenced' || event.event === 'closed')
      .map((event) => ({
        event: event.event,
        commit_id: event.commit_id ?? null,
        ...(event.source
          ? {
              source: {
                type: event.source.type,
                issue: {
                  ...pick(event.source.issue, ['number', 'html_url', 'state']),
                  repository: { full_name: event.source.issue.repository?.full_name },
                  pull_request: event.source.issue.pull_request
                    ? { merged_at: event.source.issue.pull_request.merged_at ?? null }
                    : null,
                },
              },
            }
          : {}),
      }));
  }
  if (path.endsWith('/comments')) {
    return body.map((c) => ({
      user: user(c.user),
      author_association: c.author_association,
      body: c.body,
      created_at: c.created_at,
      html_url: c.html_url,
    }));
  }
  if (path.endsWith('/reviews')) return body.map((r) => ({ user: user(r.user), state: r.state, submitted_at: r.submitted_at }));
  if (/\/commits\/[0-9a-f]+$/.test(path)) return { sha: body.sha, html_url: body.html_url };
  if (/^repos\/[^/]+\/[^/]+$/.test(path)) {
    return pick(body, ['full_name', 'html_url', 'archived', 'pushed_at', 'open_issues_count', 'default_branch']);
  }
  return Array.isArray(body) ? body.map(issue) : issue(body);
}

function recorder(dir) {
  return {
    async get(path, query) {
      const url = new URL(path, 'https://api.github.com/');
      for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
      let body;
      try {
        const { stdout } = await run('gh', ['api', url.toString().replace('https://api.github.com/', '')], {
          maxBuffer: 64 * 1024 * 1024,
        });
        body = JSON.parse(stdout);
      } catch (error) {
        if (/HTTP (404|422)/.test(String(error.stderr ?? error.message))) throw new NotFoundError(path);
        throw error;
      }
      writeFileSync(join(dir, `${fixtureKey(path, query)}.json`), `${JSON.stringify(trim(path, body), null, 2)}\n`);
      return body;
    },
  };
}

for (const target of TARGETS) {
  const [slug, number] = target.split('#');
  const dir = join('tests/fixtures', `${slug.replace('/', '-')}-${number}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const result = await canistart(target, { client: recorder(dir), now: new Date(process.env.CANISTART_NOW) });
  console.log(`${target} -> ${result.verdict} (${dir})`);
}
