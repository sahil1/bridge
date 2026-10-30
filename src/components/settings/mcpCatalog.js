// Popular MCP servers, one source of truth for the UI and GET /api/mcp/catalog. Each entry was
// checked against the vendor's own docs or package registry (October 2026); `docs` is that source.
// Only official or vendor-maintained servers that a person can connect without registering their
// own OAuth app are listed.
//
//   id, name, blurb   card text
//   category          one of MCP_CATEGORIES; the catalog grid groups cards under these headings
//   transport         'stdio' (a local program) or 'http' (a hosted server)
//   command, args     for stdio. Args in <angle brackets> are placeholders the user fills in.
//   url               for http
//   env               env vars the server needs: [{ key, hint }]
//   auth              one line on how sign-in works, when it isn't just env vars
//   needs             a program that must be installed (npx needs Node, uvx needs uv)

// Display order of the headings in the catalog grid.
export const MCP_CATEGORIES = [
  'Web and research',
  'Docs and knowledge',
  'Work and planning',
  'Communication',
  'Code and dev tools',
  'Deploy and monitor',
  'Data',
  'Design',
  'Local and system',
]

export const MCP_CATALOG = [
  // Web and research
  {
    id: 'brave-search', name: 'Brave Search', category: 'Web and research', blurb: 'Web, news, image and local search from Brave’s independent index.',
    transport: 'stdio', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'], needs: 'Node.js 22 or later',
    env: [{ key: 'BRAVE_API_KEY', hint: 'A Brave Search API key (api-dashboard.search.brave.com)' }],
    docs: 'https://github.com/brave/brave-search-mcp-server',
  },
  {
    id: 'exa', name: 'Exa', category: 'Web and research', blurb: 'Neural web search, page contents and code search built for agents.',
    transport: 'http', url: 'https://mcp.exa.ai/mcp',
    auth: 'Works without a key at a free, rate-limited tier. For your own quota, use https://mcp.exa.ai/mcp?login to sign in with OAuth.',
    docs: 'https://exa.ai/docs/reference/exa-mcp',
  },
  {
    id: 'tavily', name: 'Tavily', category: 'Web and research', blurb: 'Real-time web search, page extraction, site maps and crawling.',
    transport: 'http', url: 'https://mcp.tavily.com/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://docs.tavily.com/documentation/mcp',
  },
  {
    id: 'firecrawl', name: 'Firecrawl', category: 'Web and research', blurb: 'Scrape, crawl and search the web into clean Markdown or structured data.',
    transport: 'http', url: 'https://mcp.firecrawl.dev/v2/mcp-oauth', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://docs.firecrawl.dev/mcp-server',
  },
  {
    id: 'fetch', name: 'Fetch', category: 'Web and research', blurb: 'Fetch a web page and turn it into clean Markdown.',
    transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], needs: 'uv (Python)',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'playwright', name: 'Playwright', category: 'Web and research', blurb: 'Drive a real browser: open pages, click, fill forms, take snapshots.',
    transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], needs: 'Node.js',
    docs: 'https://github.com/microsoft/playwright-mcp',
  },

  // Docs and knowledge
  {
    id: 'notion', name: 'Notion', category: 'Docs and knowledge', blurb: 'Search and edit pages and databases in your Notion workspace.',
    transport: 'http', url: 'https://mcp.notion.com/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://developers.notion.com/docs/get-started-with-mcp',
  },
  {
    id: 'granola', name: 'Granola', category: 'Docs and knowledge', blurb: 'Search your meeting notes and transcripts, pull decisions and action items.',
    transport: 'http', url: 'https://mcp.granola.ai/mcp',
    auth: 'Sign in with OAuth when the agent connects. The free plan only exposes your last 30 days of notes.',
    docs: 'https://docs.granola.ai/help-center/sharing/integrations/mcp',
  },
  {
    id: 'readwise', name: 'Readwise', category: 'Docs and knowledge', blurb: 'Your Readwise highlights and Reader library: search, ground answers, manage items.',
    transport: 'http', url: 'https://mcp2.readwise.io/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://docs.readwise.io/tools/mcp',
  },
  {
    id: 'memory', name: 'Memory', category: 'Docs and knowledge', blurb: 'A small knowledge graph your agent can remember things in across sessions.',
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], needs: 'Node.js',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },

  // Work and planning
  {
    id: 'linear', name: 'Linear', category: 'Work and planning', blurb: 'Find, create and update Linear issues and projects.',
    transport: 'http', url: 'https://mcp.linear.app/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://linear.app/docs/mcp',
  },
  {
    id: 'atlassian', name: 'Atlassian', category: 'Work and planning', blurb: 'Jira and Confluence: search, read and update issues and pages.',
    transport: 'http', url: 'https://mcp.atlassian.com/v2/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/',
  },
  {
    id: 'monday', name: 'monday.com', category: 'Work and planning', blurb: 'Boards, items and updates: query, create and change work in monday.com.',
    transport: 'http', url: 'https://mcp.monday.com/mcp',
    auth: 'Sign in with OAuth when the agent connects. Tool calls count toward your account’s daily API limit.',
    docs: 'https://developer.monday.com/api-reference/docs/mondaycom-mcp',
  },
  {
    id: 'clickup', name: 'ClickUp', category: 'Work and planning', blurb: 'Tasks, Docs, comments and time tracking in your ClickUp workspace.',
    transport: 'http', url: 'https://mcp.clickup.com/mcp',
    auth: 'Sign in with OAuth when the agent connects. ClickUp only accepts vetted clients (Claude Code, Cursor, VS Code and a few others).',
    docs: 'https://clickup.com/blog/how-to-use-clickup-mcp-server/',
  },
  {
    id: 'airtable', name: 'Airtable', category: 'Work and planning', blurb: 'Read and update records, schemas and automations in your Airtable bases.',
    transport: 'http', url: 'https://mcp.airtable.com/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://airtable.com/developers/agents/mcp/getting-started',
  },
  {
    id: 'zapier', name: 'Zapier', category: 'Work and planning', blurb: 'Act in thousands of apps through the actions you enable on your Zapier MCP server.',
    transport: 'http', url: 'https://mcp.zapier.com/api/v1/connect',
    auth: 'Set up your server and pick its actions at mcp.zapier.com first. Claude Code and Cursor sign in with OAuth at this URL; other agents need your personal URL from the server’s Connect tab (https://mcp.zapier.com/api/v1/connect?token=…). That token is a secret.',
    docs: 'https://docs.zapier.com/mcp/get-started/authentication',
  },

  // Communication
  {
    id: 'microsoft-365', name: 'Microsoft 365', category: 'Communication', blurb: 'Microsoft’s Work IQ server: Outlook mail and calendar, Teams, SharePoint and OneDrive.',
    transport: 'stdio', command: 'npx', args: ['-y', '@microsoft/workiq@latest', 'mcp'], needs: 'Node.js',
    auth: 'Signs in with your Microsoft work account. A tenant admin has to consent to Work IQ once before it can read Microsoft 365 data.',
    docs: 'https://github.com/microsoft/work-iq',
  },

  // Code and dev tools
  {
    id: 'github', name: 'GitHub', category: 'Code and dev tools', blurb: "GitHub's official server: issues, pull requests, code search, Actions.",
    transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
    env: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', hint: 'A GitHub personal access token' }], needs: 'Docker',
    auth: 'Runs locally in Docker with a personal access token. A hosted version is at https://api.githubcopilot.com/mcp/ for clients that sign in with OAuth.',
    docs: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'context7', name: 'Context7', category: 'Code and dev tools', blurb: 'Up-to-date library and framework docs pulled into the prompt.',
    transport: 'http', url: 'https://mcp.context7.com/mcp',
    auth: 'Works without a key; an API key (Authorization header) raises the rate limit.',
    docs: 'https://github.com/upstash/context7',
  },
  {
    id: 'chrome-devtools', name: 'Chrome DevTools', category: 'Code and dev tools', blurb: 'Inspect and debug a live Chrome: console, network, performance traces.',
    transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], needs: 'Node.js and Chrome',
    docs: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
  },
  {
    id: 'postman', name: 'Postman', category: 'Code and dev tools', blurb: 'Your Postman workspaces, collections, environments and API specs.',
    transport: 'http', url: 'https://mcp.postman.com/minimal',
    auth: 'Sign in with OAuth when the agent connects (US region; EU needs an API key). Use https://mcp.postman.com/mcp for the full 100+ tool set.',
    docs: 'https://learning.postman.com/docs/developer/postman-api/postman-mcp-server/postman-mcp-remote-server',
  },
  {
    id: 'huggingface', name: 'Hugging Face', category: 'Code and dev tools', blurb: 'Search models, datasets, Spaces and papers; run Hub tools and jobs.',
    transport: 'http', url: 'https://huggingface.co/mcp?login', auth: 'Sign in with your Hugging Face account (OAuth) when the agent connects.',
    docs: 'https://huggingface.co/docs/hub/hf-mcp-server',
  },

  // Deploy and monitor
  {
    id: 'vercel', name: 'Vercel', category: 'Deploy and monitor', blurb: 'Projects, deployments, build logs and Web Analytics on Vercel.',
    transport: 'http', url: 'https://mcp.vercel.com',
    auth: 'Sign in with OAuth when the agent connects. Vercel only accepts clients it has reviewed (Claude Code, Codex, Cursor, Gemini CLI, OpenCode and others).',
    docs: 'https://vercel.com/docs/agent-resources/vercel-mcp',
  },
  {
    id: 'cloudflare', name: 'Cloudflare', category: 'Deploy and monitor', blurb: 'The whole Cloudflare API: Workers, DNS, R2, D1 and more, from one server.',
    transport: 'http', url: 'https://mcp.cloudflare.com/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
  },
  {
    id: 'netlify', name: 'Netlify', category: 'Deploy and monitor', blurb: 'Create, build, deploy and manage Netlify sites and resources.',
    transport: 'stdio', command: 'npx', args: ['-y', '@netlify/mcp'], needs: 'Node.js',
    auth: 'Signs in to Netlify in the browser on first use. If that fails, add NETLIFY_PERSONAL_ACCESS_TOKEN.',
    docs: 'https://github.com/netlify/netlify-mcp',
  },
  {
    id: 'sentry', name: 'Sentry', category: 'Deploy and monitor', blurb: 'Look up errors, issues and releases in your Sentry org.',
    transport: 'http', url: 'https://mcp.sentry.dev/mcp', auth: 'Sign in with OAuth the first time the agent connects.',
    docs: 'https://mcp.sentry.dev/',
  },
  {
    id: 'posthog', name: 'PostHog', category: 'Deploy and monitor', blurb: 'Product analytics, feature flags, experiments and error tracking in PostHog.',
    transport: 'http', url: 'https://mcp.posthog.com/mcp', auth: 'Sign in with OAuth when the agent connects; it routes to your US or EU region.',
    docs: 'https://posthog.com/docs/model-context-protocol',
  },
  {
    id: 'datadog', name: 'Datadog', category: 'Deploy and monitor', blurb: 'Logs, metrics, traces, monitors, dashboards and incidents from Datadog.',
    transport: 'http', url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
    auth: 'Sign in with OAuth when the agent connects. This URL is for the US1 site; other sites use their own endpoint (see docs). Add ?toolsets=all for more than the core tools.',
    docs: 'https://docs.datadoghq.com/bits_ai/mcp_server/setup/',
  },
  {
    id: 'grafana', name: 'Grafana', category: 'Deploy and monitor', blurb: 'Dashboards, datasources, alerts, Prometheus and Loki queries, incidents.',
    transport: 'stdio', command: 'uvx', args: ['mcp-grafana'], needs: 'uv (Python)',
    env: [
      { key: 'GRAFANA_URL', hint: 'Your Grafana URL, e.g. https://myinstance.grafana.net' },
      { key: 'GRAFANA_SERVICE_ACCOUNT_TOKEN', hint: 'A Grafana service account token' },
    ],
    docs: 'https://github.com/grafana/mcp-grafana',
  },

  // Data
  {
    id: 'supabase', name: 'Supabase', category: 'Data', blurb: 'Manage Supabase projects: tables, SQL, migrations, logs.',
    transport: 'http', url: 'https://mcp.supabase.com/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://supabase.com/docs/guides/getting-started/mcp',
  },
  {
    id: 'neon', name: 'Neon', category: 'Data', blurb: 'Neon Postgres: projects, branches, SQL queries and schema changes.',
    transport: 'http', url: 'https://mcp.neon.tech/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://neon.com/docs/ai/neon-mcp-server',
  },
  {
    id: 'stripe', name: 'Stripe', category: 'Data', blurb: 'Stripe API and docs: customers, payments, subscriptions.',
    transport: 'http', url: 'https://mcp.stripe.com', auth: 'Sign in with OAuth, or use an agent API key as a bearer token.',
    docs: 'https://docs.stripe.com/mcp',
  },

  // Design
  {
    id: 'figma', name: 'Figma', category: 'Design', blurb: 'Pull design context, variables and components from Figma files.',
    transport: 'http', url: 'https://mcp.figma.com/mcp', auth: 'Sign in with OAuth when the agent connects.',
    docs: 'https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server',
  },

  // Local and system
  {
    id: 'filesystem', name: 'Filesystem', category: 'Local and system', blurb: 'Read and write files inside the folders you allow.',
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<folder>'], needs: 'Node.js',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'sequential-thinking', name: 'Sequential Thinking', category: 'Local and system', blurb: 'Step-by-step reasoning tool for breaking down hard problems.',
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], needs: 'Node.js',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
]
