const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FaceTransform, faceRequest, publicResult } = require('../dist/nodes/FaceTransform/FaceTransform.node.js');
const { AceDataFaceTransformApi } = require('../dist/credentials/AceDataFaceTransformApi.credentials.js');

const image = 'https://example.com/authorized-portrait.jpg';
const base = { operation: 'analyze', imageUrl: image, mode: 1, rotateDetection: false };
function request(parameters) { return faceRequest((name) => parameters[name]); }
function context(parameters, responses = [], continueOnFail = false, credentials = { apiToken: 'test-token' }) {
  const calls = [];
  let next = 0;
  return {
    calls,
    getInputData: () => parameters.map(() => ({ json: {} })),
    getNode: () => ({ name: 'Face Transform', type: '@acedatacloud/n8n-nodes-face-transform.faceTransform', typeVersion: 1, position: [0, 0], parameters: {} }),
    getNodeParameter: (name, index, fallback) => parameters[index][name] ?? fallback,
    getCredentials: async () => credentials,
    continueOnFail: () => continueOnFail,
    helpers: {
      httpRequestWithAuthentication: async (credential, options) => {
        calls.push({ credential, ...options });
        const response = responses[next++];
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

const node = new FaceTransform();
test('analyze submits exactly one authenticated request and links its input', async () => {
  const response = { face_shape_set: [{ face_profile: [{ x: 10, y: 20 }] }], image_width: 1024, cost: { amount: 0.0025, currency: 'credit' } };
  const ctx = context([base], [response]);
  const [items] = await node.execute.call(ctx);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].credential, 'aceDataFaceTransformApi');
  assert.equal(ctx.calls[0].url, 'https://api.acedata.cloud/face/analyze');
  assert.equal(ctx.calls[0].method, 'POST');
  assert.equal(ctx.calls[0].disableFollowRedirect, true);
  assert.deepEqual(ctx.calls[0].body, { image_url: image, mode: 1, face_model_version: '3.0', need_rotate_detection: 0 });
  assert.deepEqual(items[0], { json: response, pairedItem: { item: 0 } });
});

test('each Face Transform action maps only to its own service endpoint and parameters', () => {
  const cases = [
    [{ operation: 'beautify', imageUrl: image, smoothing: 10, whitening: 30, faceLifting: 70, eyeEnlarging: 70 }, '/face/beautify', 'smoothing', 5],
    [{ operation: 'changeAge', imageUrl: image, ageInfos: '[{"age":30,"unexpected":"drop me"}]' }, '/face/change-age', 'age_infos', 2],
    [{ operation: 'changeGender', imageUrl: image, genderInfos: '[{"gender":0}]' }, '/face/change-gender', 'gender_infos', 2],
    [{ operation: 'swap', sourceImageUrl: image, targetImageUrl: 'https://example.com/target.jpg' }, '/face/swap', 'source_image_url', 2],
    [{ operation: 'cartoon', imageUrl: image }, '/face/cartoon', 'image_url', 1],
    [{ operation: 'detectLive', imageUrl: image }, '/face/detect-live', 'image_url', 1],
  ];
  for (const [parameters, path, field, fieldCount] of cases) {
    const result = request(parameters);
    assert.equal(result.path, path);
    assert.ok(result.body[field]);
    assert.equal(Object.keys(result.body).length, fieldCount);
    if (path === '/face/change-age') assert.deepEqual(result.body.age_infos, [{ age: 30 }]);
  }
});

test('bad URLs, JSON and ranges stop before any paid request', async () => {
  const invalid = [
    { ...base, imageUrl: 'http://example.com/image.jpg' },
    { ...base, imageUrl: 'https://user:secret@example.com/image.jpg' },
    { ...base, mode: 2 },
    { operation: 'beautify', imageUrl: image, smoothing: 101, whitening: 30, faceLifting: 70, eyeEnlarging: 70 },
    { operation: 'changeAge', imageUrl: image, ageInfos: '[{"age":-2}]' },
    { operation: 'changeGender', imageUrl: image, genderInfos: '[{"gender":2}]' },
    { operation: 'changeGender', imageUrl: image, genderInfos: '{bad json}' },
    { operation: 'swap', sourceImageUrl: image, targetImageUrl: '' },
    { operation: 'other', imageUrl: image },
  ];
  for (const parameters of invalid) {
    const ctx = context([parameters]);
    await assert.rejects(node.execute.call(ctx));
    assert.equal(ctx.calls.length, 0);
  }
});

test('transport failure never retries an uncertain paid call', async () => {
  const ctx = context([base, base], [new Error('connection lost'), { face_shape_set: [] }], true);
  const [items] = await node.execute.call(ctx);
  assert.equal(ctx.calls.length, 2);
  assert.match(items[0].json.error, /request history/i);
  assert.deepEqual(items[1].pairedItem, { item: 1 });
});

test('response cleanup removes credentials and internal routing from nested data', () => {
  const result = publicResult({ image_url: image, data: { supplier: 'private', api_key: 'private', face_shape_set: [] }, request: { image_url: image }, trace_id: 'abc' });
  assert.deepEqual(result, { image_url: image, data: { face_shape_set: [] }, trace_id: 'abc' });
});

test('credential is masked and tested on the free metadata route', async () => {
  const credential = new AceDataFaceTransformApi();
  assert.equal(credential.properties[0].typeOptions.password, true);
  assert.match(credential.authenticate.properties.headers.Authorization, /Bearer/);
  assert.equal(credential.test.request.url, '/openai/models');
  const ctx = context([base], [], false, { apiToken: '' });
  await assert.rejects(node.execute.call(ctx), /credential is required/i);
  assert.equal(ctx.calls.length, 0);
});
