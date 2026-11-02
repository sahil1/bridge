// The catalog's shapes (shared/whiteboard/catalog.js) in the user's language, for the Shapes panel
// and for the words a shape gets when it's added. Products (EC2, Cloud SQL…) keep their names.
import { t, tx } from '../../../i18n/index.js'

export const SET_NAMES = { flowchart: tx('Flowchart'), network: tx('Network'), containers: tx('Containers'), aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud' }
const NAMES = {
  process: tx('Process'), decision: tx('Decision'), start: tx('Start or end'), circle: tx('Circle'), note: tx('Note'), database: tx('Database'), document: tx('Document'), person: tx('Person'), text: tx('Text'),
  router: tx('Router'), switch: tx('Switch'), firewall: tx('Firewall'), 'load-balancer': tx('Load balancer'), server: tx('Server'), db: tx('Database'), storage: tx('Storage'), client: tx('Client'), laptop: tx('Laptop'), mobile: tx('Mobile'), users: tx('Users'), cloud: tx('Cloud'), internet: tx('Internet'), service: tx('Service'), container: tx('Container'), function: tx('Function'), queue: tx('Queue'), cache: tx('Cache'), wifi: tx('Wireless access point'), monitoring: tx('Monitoring'), identity: tx('Identity'), secrets: tx('Secrets'),
  region: tx('Region'), vpc: tx('VPC or network'), subnet: tx('Subnet'), zone: tx('Availability zone'), cluster: tx('Cluster'), group: tx('Group'), lane: tx('Swimlane'), lanes: tx('Swimlanes'),
}
export const nameOf = (it) => (NAMES[it.id] ? t(NAMES[it.id]) : it.name)
// A lane's own name, for a pool of swimlanes.
export const laneName = () => t('Lane')
