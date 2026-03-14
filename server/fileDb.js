const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "db.json");

function ensureDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    const initial = { users: [], movies: [], series: [] };
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(dbPath, "utf8");
  const parsed = JSON.parse(raw || "{}");
  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.movies)) parsed.movies = [];
  if (!Array.isArray(parsed.series)) parsed.series = [];
  return parsed;
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function generateId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function matchesFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (filter.$or && Array.isArray(filter.$or)) {
    return filter.$or.some((item) => matchesFilter(doc, item));
  }
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && value.$regex) {
      const flags = value.$options || "";
      const re = new RegExp(value.$regex, flags);
      return re.test(String(doc[key] || ""));
    }
    return String(doc[key]) === String(value);
  });
}

function selectFields(doc, select) {
  if (!select) return doc;
  const fields = select.split(" ").map((field) => field.trim()).filter(Boolean);
  const picked = { _id: doc._id };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(doc, field)) {
      picked[field] = doc[field];
    }
  }
  return picked;
}

class Query {
  constructor(result, kind, db) {
    this.result = result;
    this.kind = kind;
    this.db = db;
  }

  populate(path, select) {
    if (!this.result) return this;
    const isArray = Array.isArray(this.result);
    const items = isArray ? this.result : [this.result];

    if (this.kind === "movie" && path === "uploader") {
      for (const movie of items) {
        const user = this.db.users.find((u) => String(u._id) === String(movie.uploader));
        movie.uploader = user ? selectFields(user, select || "username") : null;
      }
    }

    if (this.kind === "user" && path === "uploadedMovies") {
      for (const user of items) {
        const movies = (user.uploadedMovies || [])
          .map((id) => this.db.movies.find((m) => String(m._id) === String(id)))
          .filter(Boolean)
          .map((movie) => selectFields(movie, select));
        user.uploadedMovies = movies;
      }
    }

    this.result = isArray ? items : items[0];
    return this;
  }

  sort(spec) {
    if (!Array.isArray(this.result)) return this;
    const [[field, direction]] = Object.entries(spec || {});
    if (!field || !direction) return this;

    this.result.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (direction < 0) return av > bv ? -1 : 1;
      return av > bv ? 1 : -1;
    });
    return this;
  }

  exec() {
    return Promise.resolve(this.result);
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

function createModel(kind) {
  if (kind !== "users" && kind !== "movies" && kind !== "series") {
    throw new Error(`Unsupported collection: ${kind}`);
  }

  return {
    find(filter = {}) {
      const db = readDb();
      const items = db[kind].filter((doc) => matchesFilter(doc, filter));
      return new Query(clone(items), kind === "movies" ? "movie" : "user", db);
    },

    findOne(filter = {}) {
      const db = readDb();
      const item = db[kind].find((doc) => matchesFilter(doc, filter)) || null;
      return new Query(clone(item), kind === "movies" ? "movie" : "user", db);
    },

    findById(id) {
      const db = readDb();
      const item = db[kind].find((doc) => String(doc._id) === String(id)) || null;
      return new Query(clone(item), kind === "movies" ? "movie" : "user", db);
    },

    async create(payload) {
      const db = readDb();
      const now = new Date().toISOString();
      const doc = {
        _id: generateId(),
        ...payload,
        createdAt: now,
        updatedAt: now
      };

      if (kind === "users") {
        if (!doc.uploadedMovies) doc.uploadedMovies = [];
      }

      if (kind === "movies") {
        if (doc.views == null) doc.views = 0;
        if (!doc.uploadDate) doc.uploadDate = now;
      }

      db[kind].push(doc);
      writeDb(db);
      return clone(doc);
    },

    async findByIdAndUpdate(id, update = {}, options = {}) {
      const db = readDb();
      const index = db[kind].findIndex((doc) => String(doc._id) === String(id));
      if (index === -1) return null;

      const current = db[kind][index];
      const original = clone(current);
      const now = new Date().toISOString();

      if (update.$inc) {
        for (const [key, inc] of Object.entries(update.$inc)) {
          current[key] = (Number(current[key]) || 0) + Number(inc);
        }
      }

      if (update.$pull) {
        for (const [key, value] of Object.entries(update.$pull)) {
          if (!Array.isArray(current[key])) continue;
          current[key] = current[key].filter((item) => String(item) !== String(value));
        }
      }

      if (update.$push) {
        for (const [key, value] of Object.entries(update.$push)) {
          if (!Array.isArray(current[key])) current[key] = [];
          current[key].push(value);
        }
      }

      for (const [key, value] of Object.entries(update)) {
        if (key.startsWith("$")) continue;
        current[key] = value;
      }

      current.updatedAt = now;
      db[kind][index] = current;
      writeDb(db);

      const result = options.new ? current : original;
      return clone(result);
    },

    async findByIdAndDelete(id) {
      const db = readDb();
      const index = db[kind].findIndex((doc) => String(doc._id) === String(id));
      if (index === -1) return null;
      const [removed] = db[kind].splice(index, 1);
      writeDb(db);
      return clone(removed);
    }
  };
}

module.exports = { createModel };
