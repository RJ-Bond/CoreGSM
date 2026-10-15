import type { Agent } from 'node:http';

/** The proxy agent for the Discord gateway; looked up on every (re)connect, so the panel can change it without a restart. */
let gatewayAgent: Agent | undefined;
export const getGatewayAgent = () => gatewayAgent;
export const setGatewayAgent = (a: Agent | undefined) => {
  gatewayAgent = a;
};
