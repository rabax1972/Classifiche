// Prima run: raccoglie gli snapshot di oggi e tutto lo storico recuperabile
// (Netflix Top 10 degli ultimi 2 anni, classifiche annuali FIMI degli ultimi 5 anni),
// poi genera le classifiche. Si può rilanciare senza problemi.

import { buildCharts } from './aggregate';
import { ingest } from './ingest';

await ingest({ seed: true });
await buildCharts();
