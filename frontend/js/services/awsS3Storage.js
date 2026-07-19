const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function hasAwsS3Config(env = process.env) {
  return Boolean(
    String(env.AWS_S3_BUCKET || '').trim() &&
    String(env.AWS_REGION || '').trim()
  );
}

function createS3Client(env = process.env) {
  const accessKeyId = String(env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.AWS_SECRET_ACCESS_KEY || '').trim();
  return new S3Client({
    region: String(env.AWS_REGION || '').trim(),
    // On AWS, the default credential provider chain uses the IAM role safely.
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {})
  });
}

function getS3PublicUrl({ bucket, region, key, customBaseUrl }) {
  const base = String(customBaseUrl || '').trim();
  if (base) {
    return `${base.replace(/\/+$/, '')}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

async function createPresignedUploadUrl({ key, contentType, expiresIn = 900, env = process.env }) {
  const bucket = String(env.AWS_S3_BUCKET || '').trim();
  const region = String(env.AWS_REGION || '').trim();
  const customBaseUrl = String(env.AWS_S3_PUBLIC_BASE_URL || '').trim();

  const client = createS3Client(env);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream'
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  const publicUrl = getS3PublicUrl({ bucket, region, key, customBaseUrl });

  return { uploadUrl, publicUrl, bucket, key };
}

async function putBufferToS3({ key, buffer, contentType, env = process.env }) {
  const bucket = String(env.AWS_S3_BUCKET || '').trim();
  const client = createS3Client(env);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    ServerSideEncryption: 'AES256'
  }));
  return { bucket, key };
}

async function createPresignedDownloadUrl({ key, expiresIn = 300, env = process.env }) {
  const bucket = String(env.AWS_S3_BUCKET || '').trim();
  const client = createS3Client(env);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

module.exports = {
  hasAwsS3Config,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  putBufferToS3,
  getS3PublicUrl
};
