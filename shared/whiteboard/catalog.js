// The shapes a whiteboard offers in its Shapes panel (src/components/whiteboard/shapes) and a model
// may draw with in "Draw this" (server/boards.js): one list, so what the model is told matches what
// the board can draw. A diagram comes back as a small JSON spec naming these ids (spec.js here).
//   kind: 'shape' (a box, diamond, circle, pill or note with words in it), 'icon' (a picture with
//   its name under it; glyph names a picture in src/components/whiteboard/shapes/icons.js, from
//   Tabler Icons, MIT), 'container' (a region, network, subnet, cluster or lane that holds shapes
//   and moves them with it), 'lanes' (a pool of swimlanes) or 'text'.
//   color: the icon's colour (each cloud's sets keep to its own colours, as its diagrams do).
// The clouds' sets are drawn with the same open icons as the rest, in each cloud's colours: their
// own architecture icons are offered for making diagrams, not for handing on inside another app
// (Microsoft's terms say so outright, and forbid changing them), so Bridge AI doesn't ship them
// (NOTICE). Someone who has them can still put them on a board as pictures.

const NET = '#2f6fe0'
const INK = '#475569'
const shape = (id, name, shapeKind, keywords = '') => ({ id, name, kind: 'shape', shape: shapeKind, keywords })
const icon = (id, name, glyph, color, keywords = '') => ({ id, name, kind: 'icon', glyph, color, keywords })
const box = (id, name, style, keywords = '') => ({ id, name, kind: 'container', style, keywords })

// AWS's, Azure's and Google Cloud's colours for each kind of service.
const AWS = { compute: '#ED7100', storage: '#7AA116', db: '#C925D1', net: '#8C4FFF', app: '#E7157B', sec: '#DD344C', ml: '#01A88D', ops: '#E7157B' }
const AZ = '#0078D4'
const GC = { blue: '#1A73E8', green: '#188038', red: '#D93025', yellow: '#E37400' }

export const SETS = [
  { id: 'flowchart', name: 'Flowchart', items: [
    shape('process', 'Process', 'rectangle', 'box step task action'),
    shape('decision', 'Decision', 'diamond', 'choice if question branch'),
    shape('start', 'Start or end', 'pill', 'terminator begin finish stop end'),
    shape('circle', 'Circle', 'ellipse', 'connector event state'),
    shape('note', 'Note', 'note', 'sticky comment annotation'),
    icon('database', 'Database', 'database', INK, 'db data store sql table'),
    icon('document', 'Document', 'file-text', INK, 'file report page'),
    icon('person', 'Person', 'user', INK, 'user actor role human'),
    { id: 'text', name: 'Text', kind: 'text', keywords: 'words label title' },
  ] },
  { id: 'network', name: 'Network', items: [
    icon('router', 'Router', 'router', NET, 'gateway wan'),
    icon('switch', 'Switch', 'net-switch', NET, 'lan hub'),
    icon('firewall', 'Firewall', 'wall', NET, 'waf security'),
    icon('load-balancer', 'Load balancer', 'load-balancer', NET, 'lb balancer proxy alb nlb'),
    icon('server', 'Server', 'server', NET, 'host machine vm instance compute'),
    icon('db', 'Database', 'database', NET, 'data store sql postgres mysql'),
    icon('storage', 'Storage', 'archive', NET, 'disk files bucket blob nas san'),
    icon('client', 'Client', 'device-desktop', NET, 'desktop pc computer browser workstation'),
    icon('laptop', 'Laptop', 'device-laptop', NET, 'notebook computer'),
    icon('mobile', 'Mobile', 'device-mobile', NET, 'phone app ios android'),
    icon('users', 'Users', 'users', NET, 'people customers team'),
    icon('cloud', 'Cloud', 'cloud', NET, 'saas hosted'),
    icon('internet', 'Internet', 'world', NET, 'web www public'),
    icon('api', 'API', 'api', NET, 'rest endpoint gateway'),
    icon('service', 'Service', 'server-cog', NET, 'microservice backend app'),
    icon('container', 'Container', 'box', NET, 'docker pod'),
    icon('function', 'Function', 'lambda', NET, 'serverless lambda'),
    icon('queue', 'Queue', 'list-details', NET, 'message broker kafka rabbitmq'),
    icon('cache', 'Cache', 'bolt', NET, 'redis memcached'),
    icon('cdn', 'CDN', 'world-www', NET, 'edge content delivery'),
    icon('dns', 'DNS', 'world-search', NET, 'domain name'),
    icon('vpn', 'VPN', 'cloud-lock', NET, 'tunnel private'),
    icon('wifi', 'Wireless access point', 'wifi', NET, 'wlan ap'),
    icon('monitoring', 'Monitoring', 'activity', NET, 'metrics logs observability'),
    icon('identity', 'Identity', 'fingerprint', NET, 'auth login sso iam'),
    icon('secrets', 'Secrets', 'key', NET, 'keys vault kms'),
  ] },
  { id: 'containers', name: 'Containers', items: [
    box('region', 'Region', 'region', 'area location datacenter'),
    box('vpc', 'VPC or network', 'vpc', 'virtual network vnet'),
    box('subnet', 'Subnet', 'subnet', 'public private'),
    box('zone', 'Availability zone', 'zone', 'az'),
    box('cluster', 'Cluster', 'cluster', 'kubernetes k8s nodes'),
    box('group', 'Group', 'group', 'box boundary'),
    box('lane', 'Swimlane', 'lane', 'lane role team'),
    { id: 'lanes', name: 'Swimlanes', kind: 'lanes', n: 3, keywords: 'pool lanes process roles' },
  ] },
  { id: 'aws', name: 'AWS', brand: 'brand-aws', items: [
    icon('aws.ec2', 'EC2', 'server', AWS.compute, 'instance vm compute'),
    icon('aws.lambda', 'Lambda', 'lambda', AWS.compute, 'function serverless'),
    icon('aws.ecs', 'ECS', 'box', AWS.compute, 'containers fargate'),
    icon('aws.eks', 'EKS', 'topology-star-3', AWS.compute, 'kubernetes'),
    icon('aws.s3', 'S3', 'bucket', AWS.storage, 'bucket object storage'),
    icon('aws.ebs', 'EBS', 'archive', AWS.storage, 'volume disk block'),
    icon('aws.rds', 'RDS', 'database', AWS.db, 'postgres mysql aurora sql'),
    icon('aws.dynamodb', 'DynamoDB', 'table', AWS.db, 'nosql table'),
    icon('aws.elasticache', 'ElastiCache', 'bolt', AWS.db, 'redis cache'),
    icon('aws.elb', 'Elastic Load Balancing', 'load-balancer', AWS.net, 'alb nlb load balancer'),
    icon('aws.cloudfront', 'CloudFront', 'world-www', AWS.net, 'cdn edge'),
    icon('aws.route53', 'Route 53', 'world-search', AWS.net, 'dns'),
    icon('aws.apigateway', 'API Gateway', 'api', AWS.net, 'api rest'),
    icon('aws.igw', 'Internet gateway', 'world', AWS.net, 'internet'),
    icon('aws.nat', 'NAT gateway', 'arrows-exchange', AWS.net, 'nat'),
    icon('aws.sqs', 'SQS', 'list-details', AWS.app, 'queue'),
    icon('aws.sns', 'SNS', 'bell', AWS.app, 'notifications topic pubsub'),
    icon('aws.eventbridge', 'EventBridge', 'webhook', AWS.app, 'events bus'),
    icon('aws.stepfunctions', 'Step Functions', 'route-2', AWS.app, 'workflow state machine'),
    icon('aws.cognito', 'Cognito', 'fingerprint', AWS.sec, 'auth users identity'),
    icon('aws.iam', 'IAM', 'id-badge', AWS.sec, 'roles permissions'),
    icon('aws.kms', 'KMS', 'key', AWS.sec, 'keys encryption secrets'),
    icon('aws.waf', 'WAF', 'wall', AWS.sec, 'firewall'),
    icon('aws.cloudwatch', 'CloudWatch', 'activity', AWS.ops, 'monitoring logs metrics'),
    icon('aws.sagemaker', 'SageMaker', 'brain', AWS.ml, 'machine learning ml'),
    icon('aws.bedrock', 'Bedrock', 'robot', AWS.ml, 'ai llm models'),
  ] },
  { id: 'azure', name: 'Azure', brand: 'brand-azure', items: [
    icon('azure.vm', 'Virtual Machines', 'server', AZ, 'vm compute instance'),
    icon('azure.functions', 'Functions', 'bolt', AZ, 'serverless'),
    icon('azure.appservice', 'App Service', 'app-window', AZ, 'web app'),
    icon('azure.aks', 'AKS', 'topology-star-3', AZ, 'kubernetes'),
    icon('azure.containerapps', 'Container Apps', 'box', AZ, 'containers'),
    icon('azure.storage', 'Storage', 'archive', AZ, 'blob storage account'),
    icon('azure.sql', 'SQL Database', 'database', AZ, 'sql server'),
    icon('azure.cosmos', 'Cosmos DB', 'world-cog', AZ, 'nosql'),
    icon('azure.redis', 'Cache for Redis', 'bolt', AZ, 'redis cache'),
    icon('azure.lb', 'Load Balancer', 'load-balancer', AZ, 'lb'),
    icon('azure.appgateway', 'Application Gateway', 'arrows-split-2', AZ, 'gateway waf'),
    icon('azure.frontdoor', 'Front Door', 'world-www', AZ, 'cdn edge'),
    icon('azure.dns', 'DNS', 'world-search', AZ, 'dns'),
    icon('azure.apim', 'API Management', 'api', AZ, 'api'),
    icon('azure.vnet', 'Virtual Network', 'network', AZ, 'vnet network'),
    icon('azure.servicebus', 'Service Bus', 'list-details', AZ, 'queue messages'),
    icon('azure.eventgrid', 'Event Grid', 'webhook', AZ, 'events'),
    icon('azure.entra', 'Entra ID', 'fingerprint', AZ, 'active directory identity auth'),
    icon('azure.keyvault', 'Key Vault', 'key', AZ, 'secrets keys'),
    icon('azure.firewall', 'Firewall', 'wall', AZ, 'firewall'),
    icon('azure.monitor', 'Monitor', 'activity', AZ, 'monitoring logs'),
    icon('azure.openai', 'Azure OpenAI', 'brain', AZ, 'ai llm'),
  ] },
  { id: 'gcp', name: 'Google Cloud', brand: 'brand-google', items: [
    icon('gcp.compute', 'Compute Engine', 'server', GC.blue, 'vm instance'),
    icon('gcp.run', 'Cloud Run', 'box', GC.blue, 'containers serverless'),
    icon('gcp.functions', 'Cloud Functions', 'bolt', GC.blue, 'serverless'),
    icon('gcp.gke', 'GKE', 'topology-star-3', GC.blue, 'kubernetes'),
    icon('gcp.storage', 'Cloud Storage', 'bucket', GC.green, 'bucket object'),
    icon('gcp.sql', 'Cloud SQL', 'database', GC.green, 'postgres mysql'),
    icon('gcp.firestore', 'Firestore', 'file-database', GC.green, 'nosql documents'),
    icon('gcp.spanner', 'Spanner', 'world-cog', GC.green, 'database'),
    icon('gcp.memorystore', 'Memorystore', 'bolt', GC.green, 'redis cache'),
    icon('gcp.bigquery', 'BigQuery', 'chart-bar', GC.blue, 'analytics warehouse'),
    icon('gcp.lb', 'Cloud Load Balancing', 'load-balancer', GC.blue, 'lb'),
    icon('gcp.cdn', 'Cloud CDN', 'world-www', GC.blue, 'cdn'),
    icon('gcp.dns', 'Cloud DNS', 'world-search', GC.blue, 'dns'),
    icon('gcp.apigateway', 'API Gateway', 'api', GC.blue, 'api'),
    icon('gcp.vpc', 'VPC', 'network', GC.blue, 'network'),
    icon('gcp.pubsub', 'Pub/Sub', 'messages', GC.yellow, 'queue messages events'),
    icon('gcp.iam', 'IAM', 'id-badge', GC.red, 'identity roles'),
    icon('gcp.secrets', 'Secret Manager', 'key', GC.red, 'secrets'),
    icon('gcp.armor', 'Cloud Armor', 'shield', GC.red, 'firewall waf'),
    icon('gcp.monitoring', 'Cloud Monitoring', 'activity', GC.blue, 'logs metrics'),
    icon('gcp.vertex', 'Vertex AI', 'brain', GC.blue, 'ai ml'),
  ] },
]

// Every item by its id (the first set an id appears in wins), and the ids by kind.
export const ITEMS = new Map()
for (const s of SETS) for (const it of s.items) if (!ITEMS.has(it.id)) ITEMS.set(it.id, { ...it, set: s.id })
export const CONTAINER_KINDS = SETS.find((s) => s.id === 'containers').items.filter((i) => i.kind === 'container').map((i) => i.id)

// Words a model might use for a shape, to the shape: "db" is a database, "lb" a load balancer.
const ALIAS = { box: 'process', rectangle: 'process', rect: 'process', step: 'process', task: 'process', diamond: 'decision', choice: 'decision', ellipse: 'circle', oval: 'circle', end: 'start', terminator: 'start', stop: 'start', pill: 'start', sticky: 'note', user: 'person', actor: 'person', human: 'person', 'load balancer': 'load-balancer', loadbalancer: 'load-balancer', lb: 'load-balancer', web: 'client', browser: 'client', desktop: 'client', computer: 'client', phone: 'mobile', www: 'internet', world: 'internet', disk: 'storage', bucket: 'storage', file: 'document', microservice: 'service', app: 'service', lambda: 'function', redis: 'cache', kafka: 'queue', 'message queue': 'queue' }

// The item a model's shape name means, or null for one it made up (drawn as a box).
export function itemFor(name) {
  const s = String(name || '').trim().toLowerCase()
  if (!s) return null
  if (ITEMS.has(s)) return ITEMS.get(s)
  const a = ALIAS[s] || ALIAS[s.replace(/[-_]/g, ' ')]
  if (a) return ITEMS.get(a)
  // "aws ec2", "aws-ec2", "AWS EC2" for aws.ec2, and a cloud's service by its name.
  const dotted = s.replace(/^(aws|azure|gcp|google cloud|google)[\s_-]+/, (m, p) => `${p === 'google' || p === 'google cloud' ? 'gcp' : p}.`).replace(/\s+/g, '')
  if (ITEMS.has(dotted)) return ITEMS.get(dotted)
  for (const it of ITEMS.values()) if (it.name.toLowerCase() === s) return it
  return null
}

// The ids to offer a model, grouped as the panel groups them: only the sets a drawing of this
// kind needs, so the prompt stays small enough for a model on this computer.
export function shapesFor(sets) {
  return SETS.filter((s) => sets.includes(s.id)).map((s) => `${s.name}: ${s.items.filter((i) => i.kind !== 'text' && i.kind !== 'lanes').map((i) => (i.id.includes('.') ? `${i.id} (${i.name})` : i.id)).join(', ')}`).join('\n')
}
