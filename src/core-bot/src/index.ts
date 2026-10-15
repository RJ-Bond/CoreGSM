import { getGatewayAgent } from './gateway.js';
import { patchGatewayAgent } from './proxy.js';

// The gateway socket is created inside discord.js, so the proxy hook must be installed before it is loaded:
// everything that imports discord.js is loaded dynamically below.
patchGatewayAgent(getGatewayAgent);
const bot = await import('./bot.js');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void bot.stop(sig).finally(() => process.exit(0));
  });
}
bot.start();
