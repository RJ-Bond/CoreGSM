/** The OpenAPI 3 description of the public API (GET /api/v1/openapi.json), built as a plain object. */

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export function openApiSpec(opts: { version: string; baseUrl: string; title: string }) {
  const keyed = [{ bearerAuth: [] }, { apiKeyHeader: [] }];
  const common = {
    '401': errorResponse('The key is missing, wrong or revoked'),
    '429': {
      ...errorResponse('The request limit of the key is used up'),
      headers: { 'Retry-After': { description: 'Seconds until the next request is allowed', schema: { type: 'integer' } } },
    },
  };
  return {
    openapi: '3.0.3',
    info: {
      title: `${opts.title} public API`,
      version: opts.version,
      description: 'Read-only data of the game servers. Every request needs an API key (created by the administrator in Admin > Integrations).',
    },
    servers: [{ url: opts.baseUrl }],
    security: keyed,
    paths: {
      '/api/v1/status': {
        get: {
          summary: 'Summary of the panel',
          operationId: 'getStatus',
          responses: { '200': { description: 'Totals', content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } } }, ...common },
        },
      },
      '/api/v1/servers': {
        get: {
          summary: 'List of servers',
          operationId: 'listServers',
          parameters: [
            { name: 'game', in: 'query', required: false, schema: { type: 'string' }, description: 'Only servers of this game (for example minecraft)' },
            { name: 'online', in: 'query', required: false, schema: { type: 'boolean' }, description: 'true: only servers that are up; false: only those that are down' },
          ],
          responses: {
            '200': {
              description: 'Servers',
              content: { 'application/json': { schema: { type: 'object', properties: { servers: { type: 'array', items: { $ref: '#/components/schemas/Server' } } } } } },
            },
            ...common,
          },
        },
      },
      '/api/v1/servers/{id}': {
        get: {
          summary: 'One server',
          operationId: 'getServer',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'The server', content: { 'application/json': { schema: { $ref: '#/components/schemas/Server' } } } },
            '404': errorResponse('No such server'),
            ...common,
          },
        },
      },
      '/api/v1/servers/{id}/history': {
        get: {
          summary: 'Players and ping over time',
          operationId: 'getServerHistory',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'hours', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 168, default: 24 } },
          ],
          responses: { '200': { description: 'At most 180 points', content: { 'application/json': { schema: { $ref: '#/components/schemas/History' } } } }, '404': errorResponse('No such server'), ...common },
        },
      },
      '/api/v1/servers/{id}/events': {
        get: {
          summary: 'Went down, came back, the peak',
          operationId: 'getServerEvents',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'hours', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 168, default: 168 } },
          ],
          responses: { '200': { description: 'Newest first', content: { 'application/json': { schema: { $ref: '#/components/schemas/Events' } } } }, '404': errorResponse('No such server'), ...common },
        },
      },
      '/api/v1/servers/{id}/players': {
        get: {
          summary: 'Who is in the game now',
          operationId: 'getServerPlayers',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'The count always; names only while the panel is open to guests', content: { 'application/json': { schema: { $ref: '#/components/schemas/PlayersNow' } } } }, '404': errorResponse('No such server'), ...common },
        },
      },
      '/api/v1/community': {
        get: {
          summary: 'The community in numbers',
          operationId: 'getCommunity',
          parameters: [{ name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 30, default: 7 } }],
          responses: { '200': { description: 'Players now and the most active players of the period', content: { 'application/json': { schema: { $ref: '#/components/schemas/Community' } } } }, ...common },
        },
      },
      '/api/v1/openapi.json': {
        get: { summary: 'This description', operationId: 'getOpenApi', security: [], responses: { '200': { description: 'OpenAPI 3 document' } } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer <key>' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
        Server: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            game: { type: 'string' },
            online: { type: 'boolean' },
            status: { type: 'string', enum: ['online', 'offline', 'unknown'] },
            players: { type: 'integer' },
            maxPlayers: { type: 'integer' },
            ping: { type: 'integer', nullable: true, description: 'milliseconds' },
            map: { type: 'string', nullable: true },
            version: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true, description: 'null when the panel is closed to guests' },
            uptime24h: { type: 'number', nullable: true, description: 'share of confirmed polls that found the server up in the last 24 hours, percent' },
            stateSince: { type: 'integer', nullable: true, description: 'unix time in ms since the server is in its current state' },
            updatedAt: { type: 'integer', nullable: true, description: 'unix time in ms of the last poll' },
            maintenance: { type: 'boolean', description: 'a maintenance window is running' },
          },
        },
        History: {
          type: 'object',
          properties: {
            serverId: { type: 'integer' },
            hours: { type: 'integer' },
            points: { type: 'array', items: { type: 'object', properties: { ts: { type: 'integer' }, players: { type: 'integer' }, ping: { type: 'integer', nullable: true }, online: { type: 'boolean' } } } },
          },
        },
        Events: {
          type: 'object',
          properties: {
            serverId: { type: 'integer' },
            hours: { type: 'integer' },
            events: { type: 'array', items: { type: 'object', properties: { ts: { type: 'integer' }, type: { type: 'string', enum: ['up', 'down', 'peak'] }, players: { type: 'integer', nullable: true } } } },
          },
        },
        PlayersNow: {
          type: 'object',
          properties: {
            serverId: { type: 'integer' },
            online: { type: 'boolean' },
            count: { type: 'integer' },
            players: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, since: { type: 'integer' } } } },
          },
        },
        Community: {
          type: 'object',
          properties: {
            days: { type: 'integer' },
            playersNow: { type: 'integer' },
            serversOnline: { type: 'integer' },
            top: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, hours: { type: 'number' } } } },
          },
        },
        Status: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            servers: { type: 'integer' },
            online: { type: 'integer' },
            offline: { type: 'integer' },
            players: { type: 'integer', description: 'players on the servers that are up' },
            generatedAt: { type: 'integer' },
          },
        },
      },
    },
  };
}
