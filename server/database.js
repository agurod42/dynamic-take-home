import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_STATE = {
  users: [],
  wallets: [],
  transactions: [],
  sessions: []
};

export class Database {
  constructor(relativePath = process.env.DATABASE_FILE || '../data/db.json') {
    this.filePath = resolve(__dirname, relativePath);
    const folder = dirname(this.filePath);
    mkdirSync(folder, { recursive: true });
    if (!existsSync(this.filePath)) {
      this.#write(DEFAULT_STATE);
    }
  }

  #read() {
    const raw = readFileSync(this.filePath, 'utf-8');
    return JSON.parse(raw);
  }

  #write(data) {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  #clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  getState() {
    const state = this.#read();
    return this.#clone(state);
  }

  update(mutator) {
    const state = this.#read();
    const cloned = this.#clone(state);
    const result = mutator(cloned);
    this.#write(cloned);
    return result ?? cloned;
  }

  setState(state) {
    this.#write(this.#clone(state));
  }

  reset() {
    this.#write(this.#clone(DEFAULT_STATE));
  }
}

export const db = new Database();

export function resetDatabase() {
  db.reset();
}
