import { NodeConnectionTypes, NodeOperationError, OperationalError, UserError } from 'n8n-workflow';
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

const paths: Record<string, string> = {
  analyze: '/face/analyze',
  beautify: '/face/beautify',
  changeAge: '/face/change-age',
  changeGender: '/face/change-gender',
  swap: '/face/swap',
  cartoon: '/face/cartoon',
  detectLive: '/face/detect-live',
};
const imageActions = ['analyze', 'beautify', 'changeAge', 'changeGender', 'cartoon', 'detectLive'];

const properties: INodeProperties[] = [
  {
    displayName: 'Operation', name: 'operation', type: 'options', default: 'analyze', noDataExpression: true,
    options: [
      { name: 'Analyze Keypoints', value: 'analyze', action: 'Analyze keypoints', description: 'Find facial landmarks in an image' },
      { name: 'Beautify', value: 'beautify', action: 'Beautify a portrait', description: 'Adjust portrait appearance' },
      { name: 'Cartoonize', value: 'cartoon', action: 'Cartoonize a portrait', description: 'Convert a portrait to a cartoon style' },
      { name: 'Change Age', value: 'changeAge', action: 'Change apparent age', description: 'Change the apparent age of a face' },
      { name: 'Change Gender', value: 'changeGender', action: 'Change facial gender', description: 'Change facial gender characteristics' },
      { name: 'Detect Liveness', value: 'detectLive', action: 'Detect liveness', description: 'Score whether a face appears live' },
      { name: 'Swap Face', value: 'swap', action: 'Swap a face', description: 'Put the source face into the target image' },
    ],
    description: 'Face Transform operation to run; each item submits one paid API request',
  },
  {
    displayName: 'Image URL', name: 'imageUrl', type: 'string', default: '', required: true,
    displayOptions: { show: { operation: imageActions } },
    description: 'Public HTTPS URL of an image you are allowed to process',
  },
  {
    displayName: 'Analyze Mode', name: 'mode', type: 'options', default: 1,
    displayOptions: { show: { operation: ['analyze'] } },
    options: [{ name: 'Largest Face', value: 1 }, { name: 'All Faces', value: 0 }],
    description: 'Choose the largest face or all detected faces',
  },
  {
    displayName: 'Rotate Detection', name: 'rotateDetection', type: 'boolean', default: false,
    displayOptions: { show: { operation: ['analyze'] } },
    description: 'Whether to detect rotated faces',
  },
  {
    displayName: 'Smoothing', name: 'smoothing', type: 'number', default: 10,
    typeOptions: { minValue: 0, maxValue: 100 },
    displayOptions: { show: { operation: ['beautify'] } },
    description: 'Skin smoothing from 0 to 100',
  },
  {
    displayName: 'Whitening', name: 'whitening', type: 'number', default: 30,
    typeOptions: { minValue: 0, maxValue: 100 },
    displayOptions: { show: { operation: ['beautify'] } },
    description: 'Skin whitening from 0 to 100',
  },
  {
    displayName: 'Face Lifting', name: 'faceLifting', type: 'number', default: 70,
    typeOptions: { minValue: 0, maxValue: 100 },
    displayOptions: { show: { operation: ['beautify'] } },
    description: 'Face slimming from 0 to 100',
  },
  {
    displayName: 'Eye Enlarging', name: 'eyeEnlarging', type: 'number', default: 70,
    typeOptions: { minValue: 0, maxValue: 100 },
    displayOptions: { show: { operation: ['beautify'] } },
    description: 'Eye enlargement from 0 to 100',
  },
  {
    displayName: 'Age Information', name: 'ageInfos', type: 'json', default: '[{"age":30}]', required: true,
    displayOptions: { show: { operation: ['changeAge'] } },
    description: 'JSON array with one target age per face, for example [{"age":30}]',
  },
  {
    displayName: 'Gender Information', name: 'genderInfos', type: 'json', default: '[{"gender":0}]', required: true,
    displayOptions: { show: { operation: ['changeGender'] } },
    description: 'JSON array with gender 0 for male to female or 1 for female to male',
  },
  {
    displayName: 'Source Image URL', name: 'sourceImageUrl', type: 'string', default: '', required: true,
    displayOptions: { show: { operation: ['swap'] } },
    description: 'Public HTTPS URL of the face to apply to the target',
  },
  {
    displayName: 'Target Image URL', name: 'targetImageUrl', type: 'string', default: '', required: true,
    displayOptions: { show: { operation: ['swap'] } },
    description: 'Public HTTPS URL of the image that receives the source face',
  },
];

function httpsUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048)
    throw new UserError(`${label} must be a nonempty HTTPS URL of at most 2048 characters`);
  let parsed: URL | undefined;
  try { parsed = new URL(value.trim()); }
  catch { /* Invalid URLs are handled below. */ }
  if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password)
    throw new UserError(`${label} must be a public HTTPS URL without embedded credentials`);
  return parsed.toString();
}

function percentage(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    throw new UserError(`${label} must be a number from 0 to 100`);
  return value;
}

function infoArray(value: unknown, label: string, kind: 'age' | 'gender'): IDataObject[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    let valid = true;
    try { parsed = JSON.parse(value); }
    catch { valid = false; }
    if (!valid) throw new UserError(`${label} must be a valid JSON array`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new UserError(`${label} must be a nonempty JSON array`);
  const result: IDataObject[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new UserError(`${label} entries must be objects`);
    const item = entry as Record<string, unknown>;
    if (kind === 'age' && (typeof item.age !== 'number' || !Number.isInteger(item.age) || item.age < 0))
      throw new UserError('Each age entry needs a nonnegative integer age');
    if (kind === 'gender' && item.gender !== 0 && item.gender !== 1)
      throw new UserError('Each gender entry needs gender 0 or 1');
    result.push(kind === 'age' ? { age: item.age as number } : { gender: item.gender as number });
  }
  return result;
}

export function faceRequest(get: (name: string) => unknown): { path: string; body: IDataObject } {
  const operation = get('operation');
  if (typeof operation !== 'string' || !Object.prototype.hasOwnProperty.call(paths, operation))
    throw new UserError('Select a supported Face Transform operation');
  const body: IDataObject = {};
  if (operation === 'swap') {
    body.source_image_url = httpsUrl(get('sourceImageUrl'), 'Source Image URL');
    body.target_image_url = httpsUrl(get('targetImageUrl'), 'Target Image URL');
  } else {
    body.image_url = httpsUrl(get('imageUrl'), 'Image URL');
  }
  if (operation === 'analyze') {
    const mode = get('mode');
    if (mode !== 0 && mode !== 1) throw new UserError('Analyze Mode must be 0 or 1');
    const rotate = get('rotateDetection');
    if (typeof rotate !== 'boolean') throw new UserError('Rotate Detection must be true or false');
    body.mode = mode;
    body.face_model_version = '3.0';
    body.need_rotate_detection = rotate ? 1 : 0;
  } else if (operation === 'beautify') {
    body.smoothing = percentage(get('smoothing'), 'Smoothing');
    body.whitening = percentage(get('whitening'), 'Whitening');
    body.face_lifting = percentage(get('faceLifting'), 'Face Lifting');
    body.eye_enlarging = percentage(get('eyeEnlarging'), 'Eye Enlarging');
  } else if (operation === 'changeAge') {
    body.age_infos = infoArray(get('ageInfos'), 'Age Information', 'age');
  } else if (operation === 'changeGender') {
    body.gender_infos = infoArray(get('genderInfos'), 'Gender Information', 'gender');
  }
  return { path: paths[operation], body };
}

const privateFields = new Set([
  'request', 'request_body', 'user_id', 'actor_user_id', 'credential_id', 'authorization_id',
  'application_id', 'api_key', 'api_token', 'token', 'credential', 'credentials',
  'access_token', 'refresh_token', 'authorization', 'headers',
  'supplier', 'supplier_id', 'provider_route', 'upstream', 'upstream_model', 'actual_model', 'secret',
]);

export function publicResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicResult);
  if (!value || typeof value !== 'object') return value;
  const clean: IDataObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (privateFields.has(key.toLowerCase()) || /(^internal(?:_|$)|supplier|upstream|(?:^|_)secret(?:_|$))/i.test(key))
      continue;
    if (key === 'error' && item) {
      clean.error = 'Operation failed. Inspect the original request and trace ID before retrying.';
      continue;
    }
    clean[key] = publicResult(item) as IDataObject[string];
  }
  return clean;
}

function requestFailure(error: unknown): OperationalError {
  const code = error && typeof error === 'object'
    ? String((error as { httpCode?: unknown; statusCode?: unknown }).httpCode
      ?? (error as { statusCode?: unknown }).statusCode ?? '')
    : '';
  const status = /^\d{3}$/.test(code) ? code : '';
  return new OperationalError(status
    ? `Face Transform returned HTTP ${status}. Check service access and request history before retrying.`
    : 'Face Transform did not complete. Check request history before retrying; the first request may have been charged.');
}

export class FaceTransform implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Face Transform by Ace Data Cloud',
    name: 'faceTransform',
    icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Analyze and transform faces through Ace Data Cloud',
    defaults: { name: 'Face Transform by Ace Data Cloud' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'aceDataFaceTransformApi', required: true }],
    properties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const results: INodeExecutionData[] = [];
    for (let index = 0; index < this.getInputData().length; index++) {
      try {
        let hasToken = false;
        try {
          const credentials = await this.getCredentials('aceDataFaceTransformApi');
          hasToken = typeof credentials.apiToken === 'string' && Boolean(credentials.apiToken.trim());
        } catch { /* n8n did not provide a credential. */ }
        if (!hasToken)
          throw new NodeOperationError(this.getNode(), 'A Face Transform by Ace Data Cloud credential is required.');
        const { path, body } = faceRequest((name) => this.getNodeParameter(name, index, ''));
        let response: unknown;
        try {
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'aceDataFaceTransformApi', {
            method: 'POST', url: `https://api.acedata.cloud${path}`, body, json: true,
            disableFollowRedirect: true, timeout: 130000,
          });
        } catch (error) {
          throw requestFailure(error);
        }
        if (!response || typeof response !== 'object' || Array.isArray(response))
          throw new OperationalError('Face Transform returned an unexpected result');
        const result = response as IDataObject;
        if (result.success === false || result.error)
          throw new OperationalError('Face Transform failed. Check the original request and trace ID before retrying.');
        results.push({ json: publicResult(result) as IDataObject, pairedItem: { item: index } });
      } catch (error) {
        if (!this.continueOnFail())
          throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
        results.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
      }
    }
    return [results];
  }
}
