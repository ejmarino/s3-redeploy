const aws = require('aws-sdk');
const co = require('co');

const path = require('path');
const {
  globAsync,
  computeLocalFilesStats,
  getRemoteFilesStats,
  deleteObjects,
  uploadObjects,
  detectFileChanges,
  storeHashMap,
} = require('./lib');

// In order to run this:
// #1 run install --no-save mock-aws-s3
// #2 correct the following line in mock-aws-s3/lib/mock: line 210 "if (truncated && search.Delimiter) {" -> "if (truncated) {"
// #3 comment lines 229 -> 231 deleteObjects of function:
// else {
// errors.push(file);
// }
// TODO:
// perform requests in parallel (write a util function for that)
// use maps instead of objects
// build more comprehensive S3 parameters for upload / download (content-type, cache, etc)
// add cloudfront invalidation
// extend command line parameters list: aws profile, custom hash map name, custom hash algorithm...
// add command line parameters validation (both required / optional and type), dash to camel
// refactor code -> spread lib to modules, think about shared params (like s3Client)
// take a look at ACL:private for hash map
// build redirect objects
// add a local hash map and add a possibility to use it upon update
// add jsdocs / comments to methods
// unit tests + proper error handling
// check on Windows
// add Travis and coverall + badges

// TODO: think about work with versions and prefixes for S3 objects

const checkParams = params => {
  if (!params.bucket) {
    throw new Error('Bucket name should be set');
  }
  return params;
};
// TODO: supported now: bucket, region, cwd, pattern
module.exports = co.wrap(function* (params) {
  checkParams(params);
  const basePath = path.resolve(process.cwd(), params.cwd || '');
  const s3Params = { Bucket: params.bucket };
  const fileNames = (yield globAsync(params.pattern || './**', { cwd: basePath }))
    .map(p => path.relative(basePath, path.resolve(basePath, p)))
    .filter(p => !!p);

  // TODO: add profile usage possibility. Default is used for now
  const awsOptions = {
    sslEnabled: true,
    region: params.region,
  };
  aws.config.update(awsOptions);
  // const s3Client = new aws.S3();
  const s3Client = require('../s3-mock').getS3Mock(params.bucket);

  const localHashesMap = yield computeLocalFilesStats(fileNames, basePath);
  const remoteHashesMap = yield getRemoteFilesStats(s3Client, s3Params);

  // TODO: if local map is empty => clear the bucket?
  const { toUpload, toDelete } = detectFileChanges(localHashesMap, remoteHashesMap);

  const uploadNeeded = Object.keys(toUpload).length;
  const removalNeeded = Object.keys(toDelete).length;

  if (uploadNeeded) {
    console.log('Uploading', uploadNeeded, 'files');
    yield uploadObjects(s3Client, { toUpload, basePath, s3Params });
  }

  if (removalNeeded) {
    console.log('Removing', removalNeeded, 'files');
    yield deleteObjects(s3Client, { toDelete, s3Params });
  }

  yield storeHashMap(s3Client, JSON.stringify(localHashesMap), s3Params);
});
