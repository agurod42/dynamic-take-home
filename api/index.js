import 'dotenv/config';
import { App } from '../server/app.js';
import { configureRoutes } from '../server/routes.js';
import { initSchemaIfNeeded } from '../server/db.js';

// Initialize once per Lambda/Serverless instance
const app = new App({ basePath: '/api' });
configureRoutes(app);

let bootstrapped = false;
export default async function handler(req, res) {
  try {
    if (!bootstrapped) {
      await initSchemaIfNeeded();
      bootstrapped = true;
    }
    await app.handle(req, res);
  } catch (error) {
    console.error('Unhandled serverless error', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unexpected error' }));
  }
}


