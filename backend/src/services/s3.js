'use strict';
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  forcePathStyle: true, // required for MinIO / non-AWS S3
});

/**
 * Upload a delivery photo buffer to S3.
 * Returns the permanent object key.
 *
 * @param {string} orgId
 * @param {string} requisitionId
 * @param {Buffer} buffer
 * @param {string} mimeType  e.g. 'image/jpeg'
 */
async function uploadDeliveryPhoto(orgId, requisitionId, buffer, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const key = `deliveries/${orgId}/${requisitionId}/${uuidv4()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256',
    })
  );

  return key;
}

/**
 * Generate a pre-signed URL for temporary access to a delivery photo.
 * Default expiry: 1 hour.
 */
async function getSignedPhotoUrl(key, expiresInSeconds = 3600) {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

module.exports = { uploadDeliveryPhoto, getSignedPhotoUrl };
