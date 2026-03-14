const fs = require("fs");
const path = require("path");
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const R2_ENABLED = process.env.R2_ENABLED === "1";

let cachedClient = null;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} for R2 configuration`);
  }
  return value;
}

function getBucket() {
  return requiredEnv("R2_BUCKET");
}

function getClient() {
  if (!R2_ENABLED) return null;
  if (cachedClient) return cachedClient;
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });
  return cachedClient;
}

function isR2Enabled() {
  return R2_ENABLED;
}

function normalizeKey(key) {
  return String(key || "").replace(/^\/+/, "");
}

function contentTypeFromKey(key) {
  const ext = path.extname(key).toLowerCase();
  const types = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
    ".wmv": "video/x-ms-wmv",
    ".ts": "video/mp2t",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".m3u8": "application/vnd.apple.mpegurl"
  };
  return types[ext] || "application/octet-stream";
}

async function uploadLocalFile({ key, filePath, contentType }) {
  const client = getClient();
  const bucket = getBucket();
  const finalKey = normalizeKey(key);
  const body = fs.createReadStream(filePath);
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: finalKey,
      Body: body,
      ContentType: contentType || contentTypeFromKey(finalKey)
    }
  });
  await upload.done();
  return finalKey;
}

async function getObjectStream({ key, range }) {
  const client = getClient();
  const bucket = getBucket();
  const finalKey = normalizeKey(key);
  const params = { Bucket: bucket, Key: finalKey };
  if (range) {
    params.Range = range;
  }
  return client.send(new GetObjectCommand(params));
}

async function deleteObject({ key }) {
  const client = getClient();
  const bucket = getBucket();
  const finalKey = normalizeKey(key);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey }));
}

module.exports = {
  isR2Enabled,
  getObjectStream,
  uploadLocalFile,
  deleteObject,
  contentTypeFromKey
};
